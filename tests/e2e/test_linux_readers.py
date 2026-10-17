#!/usr/bin/env -S uv run --quiet --script
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Kenji Gaillac

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

"""End-to-end tests: the Linux components that read a seed, in a Lima VM
(Ubuntu LTS).

- blkid sees an iso9660 filesystem labelled "cidata", as cloud-init needs;
- the kernel's isofs mounts it with Rock Ridge, Joliet or neither;
- cloud-init's own NoCloud helpers find the seed and read its files.

The seed is attached to a loop device in a running VM; no VM boots from it
(Lima provisions its VMs with its own cidata seed).

The VM lives in its own LIMA_HOME (.lima/ in the repository), so it never
touches other Lima instances, and has no host directories mounted. The first
run downloads an Ubuntu cloud image (Lima caches it).

E2E_VM_TEARDOWN chooses what happens to the VM after the run:
  stop    (default) stop it, keeping its disk; the next run restarts it
  delete  remove it, so the next run starts from a fresh VM
  keep    leave it running, for the fastest re-runs

Run: tests/e2e/test_linux_readers.py
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "support"))
from seed import DATE, REPOSITORY, as_bytes, tool, write_iso

INSTANCE = "e2e"
ENV = {**os.environ, "LIMA_HOME": str(REPOSITORY / ".lima")}

# limactl arguments for each E2E_VM_TEARDOWN value; None does nothing.
TEARDOWN_ACTIONS = {
    "delete": ("delete", "--force", INSTANCE),
    "stop": ("stop", INSTANCE),
    "keep": None,
}
TEARDOWN = os.environ.get("E2E_VM_TEARDOWN", "stop")
if TEARDOWN not in TEARDOWN_ACTIONS:
    raise SystemExit(
        f"E2E_VM_TEARDOWN must be one of {', '.join(TEARDOWN_ACTIONS)}, got {TEARDOWN!r}"
    )

FILES = {
    "user-data": """\
#cloud-config
hostname: e2e
""",
    "meta-data": """\
instance-id: iid-e2e
local-hostname: e2e
""",
    "network-config": """\
version: 2
ethernets:
  eth0:
    dhcp4: true
""",
    "vendor-data": "",
}


def limactl(*args, input="", timeout=60):
    return subprocess.run(
        [tool("limactl"), *args],
        env=ENV,
        input=input,
        capture_output=True,
        text=True,
        check=True,
        timeout=timeout,
    ).stdout


def in_vm(script):
    """Runs a bash script as root in the VM and returns its stdout. The script
    goes through stdin: `limactl shell` joins its arguments into a single
    remote command line, which would split a `bash -c` script at every `;`."""
    try:
        return limactl(
            "shell",
            "--workdir=/",
            INSTANCE,
            "sudo",
            "bash",
            "-euo",
            "pipefail",
            "-s",
            input=script,
        )
    except subprocess.CalledProcessError as error:
        raise AssertionError(
            f"VM script failed:\n{script}\n--- stderr:\n{error.stderr}"
        ) from None


def instance_status():
    for line in limactl("list", "--format", "{{.Name}} {{.Status}}").splitlines():
        name, status = line.split()
        if name == INSTANCE:
            return status
    return None


def setUpModule():
    if instance_status() is None:
        limactl(
            "create",
            f"--name={INSTANCE}",
            "--tty=false",
            "--cpus=1",
            "--memory=1",
            "--set=.mounts=[]",
            "template:ubuntu-lts",
            timeout=15 * 60,
        )
    if instance_status() != "Running":
        limactl("start", "--tty=false", INSTANCE, timeout=15 * 60)


def tearDownModule():
    if (action := TEARDOWN_ACTIONS[TEARDOWN]) is not None:
        limactl(*action, timeout=5 * 60)


class LinuxTestCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="seed-iso-e2e-")
        self.addCleanup(temporary.cleanup)
        self.work_dir = Path(temporary.name)

    def attach(self, files=FILES, date=None):
        """Builds an image, copies it into the VM and attaches it to a loop
        device, like a seed disc attached to a VM. Returns the device path."""
        local = write_iso(self.work_dir, files, date)
        remote = f"/tmp/{self.id()}.iso"
        limactl("copy", str(local), f"{INSTANCE}:{remote}")
        device = in_vm(f"losetup --find --show --read-only {remote}").strip()
        self.addCleanup(
            in_vm,
            f"umount -q {device} 2>/dev/null || true; losetup --detach {device}; rm {remote}",
        )
        return device

    def on_mount(self, device, options, script):
        """Mounts `device` with extra isofs `options`, then runs `script`
        inside the mount point."""
        mount_options = ",".join(["ro", *([options] if options else [])])
        return in_vm(
            f'dir=$(mktemp -d); mount -t iso9660 -o {mount_options} {device} "$dir"; '
            f'trap \'cd /; umount "$dir"; rmdir "$dir"\' EXIT; cd "$dir"; {script}'
        )


class BlkidTest(LinuxTestCase):
    """How cloud-init finds the seed."""

    def test_reports_an_iso9660_filesystem_labelled_cidata(self):
        probe = in_vm(f"blkid -p -o export {self.attach()}").splitlines()
        self.assertIn("TYPE=iso9660", probe)
        self.assertIn("LABEL=cidata", probe)

    def test_finds_the_device_by_label(self):
        device = self.attach()
        found = in_vm("blkid -c /dev/null -t LABEL=cidata -o device").split()
        self.assertIn(device, found)


class IsofsTest(LinuxTestCase):
    def test_rock_ridge_names_attributes_and_sizes(self):
        device = self.attach()
        self.assertEqual(
            self.on_mount(device, "", "stat -c '%A %u %g %s %n' * | sort -k5"),
            "".join(
                f"-r--r--r-- 0 0 {len(as_bytes(FILES[name]))} {name}\n"
                for name in ["meta-data", "network-config", "user-data", "vendor-data"]
            ),
        )
        self.assertEqual(
            self.on_mount(device, "", "stat -c '%A %u %g' ."), "dr-xr-xr-x 0 0\n"
        )

    def test_rock_ridge_contents_and_timestamps(self):
        device = self.attach(date=DATE)
        for name in FILES:
            with self.subTest(name):
                self.assertEqual(self.on_mount(device, "", f"cat {name}"), FILES[name])
        self.assertEqual(
            self.on_mount(device, "", "stat -c %Y user-data").strip(),
            str(int(DATE.timestamp())),
        )

    def test_joliet_names_and_contents(self):
        device = self.attach()
        self.assertEqual(
            self.on_mount(device, "norock", "ls -1"),
            "meta-data\nnetwork-config\nuser-data\nvendor-data\n",
        )
        self.assertEqual(
            self.on_mount(device, "norock", "cat user-data"), FILES["user-data"]
        )

    def test_plain_iso9660_names_and_contents(self):
        device = self.attach()
        # Linux's default map=normal lowercases names and drops ";1" and the
        # trailing dot.
        self.assertEqual(
            self.on_mount(device, "norock,nojoliet", "ls -1"),
            "meta_dat\nnetwork_\nuser_dat\nvendor_d\n",
        )
        self.assertEqual(
            self.on_mount(device, "norock,nojoliet", "cat user_dat"), FILES["user-data"]
        )


class CloudInitTest(LinuxTestCase):
    def test_nocloud_helpers_find_the_seed_and_read_every_file(self):
        device = self.attach()
        script = "\n".join(
            [
                "import json",
                "from cloudinit import util",
                "devices = util.find_devs_with('LABEL=cidata')",
                f"assert {device!r} in devices, devices",
                f"names = {list(FILES)!r}",
                "read = lambda d: {n: open(d + '/' + n).read() for n in names}",
                f"print(json.dumps(util.mount_cb({device!r}, read)))",
            ]
        )
        seed = json.loads(in_vm(f"python3 - <<'PYTHON'\n{script}\nPYTHON"))
        self.assertEqual(seed, FILES)


if __name__ == "__main__":
    unittest.main(verbosity=2)
