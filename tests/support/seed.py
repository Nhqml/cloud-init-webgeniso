# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Kenji Gaillac

"""Shared helpers for the Python integration and end-to-end tests."""

import base64
import functools
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path

REPOSITORY = Path(__file__).resolve().parents[2]
BUILD_ISO = REPOSITORY / "tests" / "support" / "build_iso.ts"


@functools.cache
def tool(name):
    """Absolute path of the dev tool `name`, as pinned in mise.toml.

    Tests never take tools from PATH: run outside the mise environment, PATH
    could hold another version, such as the bsdtar macOS ships.
    """
    result = subprocess.run(
        ["mise", "which", name], cwd=REPOSITORY, capture_output=True, text=True
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"{name} must be provided by mise (see mise.toml, run `mise install`): "
            + result.stderr.strip()
        )
    return result.stdout.strip()

MINIMAL = {
    "user-data": """\
#cloud-config
hostname: test
""",
    "meta-data": """\
instance-id: iid-test
local-hostname: test
""",
}

COMPLETE = {
    **MINIMAL,
    "network-config": """\
version: 2
ethernets:
  eth0:
    dhcp4: true
""",
    "vendor-data": """\
#cloud-config
""",
}

# Primary-tree (8.3) name of each seed file.
ISO9660_NAMES = {
    "meta-data": "META_DAT.;1",
    "network-config": "NETWORK_.;1",
    "user-data": "USER_DAT.;1",
    "vendor-data": "VENDOR_D.;1",
}

# A fixed date for tests that check timestamps.
DATE = datetime(2026, 10, 17, 8, 5, 9, tzinfo=UTC)


def as_bytes(content):
    """Seed file content as bytes: text is encoded as UTF-8."""
    return content.encode("utf-8") if isinstance(content, str) else bytes(content)


def build_iso(files, date=None):
    """Builds a seed image with our TypeScript buildSeedIso, through Node."""
    request = {
        "files": {
            name: base64.b64encode(as_bytes(content)).decode("ascii")
            for name, content in files.items()
        }
    }
    if date is not None:
        request["date"] = date.isoformat()
    result = subprocess.run(
        [tool("node"), str(BUILD_ISO)],
        input=json.dumps(request).encode("utf-8"),
        capture_output=True,
        check=True,
    )
    return result.stdout


def write_iso(directory, files, date=None, name="seed.iso"):
    """Builds a seed image into `directory` and returns its path."""
    path = Path(directory) / name
    path.write_bytes(build_iso(files, date))
    return path
