#!/usr/bin/env -S uv run --quiet --script

# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Kenji Gaillac

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

"""Integration tests: read seed images back with bsdtar (libarchive).

bsdtar is an independent ISO 9660 reader. Each of the three ways an image can
be read is checked: Rock Ridge (Linux), Joliet (Windows) and plain ISO 9660.
bsdtar comes from mise (conda:libarchive), see mise.toml.

Run: tests/integration/test_bsdtar.py
"""

import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "support"))
from seed import COMPLETE, DATE, MINIMAL, as_bytes, write_iso

# bsdtar read options selecting which directory tree it uses.
VIEWS = {
    "rock_ridge": [],
    "joliet": ["--options", "!rockridge"],
    "plain": ["--options", "!rockridge,!joliet"],
}

# Names bsdtar shows for each seed file in the plain ISO 9660 view.
PLAIN_NAMES = {
    "meta-data": "META_DAT",
    "network-config": "NETWORK_",
    "user-data": "USER_DAT",
    "vendor-data": "VENDOR_D",
}


def setUpModule():
    version = subprocess.run(
        ["bsdtar", "--version"], capture_output=True, text=True, check=True
    ).stdout
    if "libarchive" not in version:
        raise RuntimeError("bsdtar from libarchive is required: run `mise install`")


class BsdtarTestCase(unittest.TestCase):
    def setUp(self):
        self.work_dir = Path(tempfile.mkdtemp(prefix="seed-iso-bsdtar-"))
        self.addCleanup(self.remove_work_dir)
        self.image_count = 0

    def remove_work_dir(self):
        # Extracted directories keep the image's read-only r-xr-xr-x mode;
        # make them writable again so their contents can be deleted.
        for root, dirs, _ in os.walk(self.work_dir):
            for name in dirs:
                os.chmod(Path(root) / name, stat.S_IRWXU)
        shutil.rmtree(self.work_dir)

    def image(self, files, date=None):
        self.image_count += 1
        return write_iso(
            self.work_dir, files, date, name=f"seed-{self.image_count}.iso"
        )

    def list(self, image, view):
        """The image's entries as seen through `view`, as dicts."""
        output = subprocess.run(
            ["bsdtar", "-tvf", str(image), "--numeric-owner", *VIEWS[view]],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        entries = []
        for line in output.strip().splitlines():
            # mode links uid gid size <date: 3 fields> name
            mode, links, uid, gid, size, _, _, _, name = line.split(maxsplit=8)
            entries.append(
                {
                    "mode": mode,
                    "links": int(links),
                    "uid": int(uid),
                    "gid": int(gid),
                    "size": int(size),
                    "name": name,
                }
            )
        return entries

    def names(self, image, view):
        return [entry["name"] for entry in self.list(image, view)]

    def extract(self, image, view):
        """Extracts the image as seen through `view`; returns the directory."""
        target = Path(tempfile.mkdtemp(dir=self.work_dir, prefix="extract-"))
        subprocess.run(
            ["bsdtar", "-xpf", str(image), "-C", str(target), *VIEWS[view]], check=True
        )
        return target


class RockRidgeViewTest(BsdtarTestCase):
    def test_lists_the_real_names_in_sorted_order(self):
        self.assertEqual(
            self.names(self.image(COMPLETE), "rock_ridge"),
            [".", "meta-data", "network-config", "user-data", "vendor-data"],
        )

    def test_lists_only_the_files_given(self):
        self.assertEqual(
            self.names(self.image(MINIMAL), "rock_ridge"),
            [".", "meta-data", "user-data"],
        )

    def test_files_are_rational_rock(self):
        entries = self.list(self.image(COMPLETE), "rock_ridge")
        for entry in entries[1:]:
            with self.subTest(entry["name"]):
                self.assertEqual(
                    (entry["mode"], entry["uid"], entry["gid"], entry["links"]),
                    ("-r--r--r--", 0, 0, 1),
                )

    def test_root_directory_is_rational_rock(self):
        root = self.list(self.image(MINIMAL), "rock_ridge")[0]
        self.assertEqual(
            (root["name"], root["mode"], root["uid"], root["gid"], root["links"]),
            (".", "dr-xr-xr-x", 0, 0, 2),
        )

    def test_reports_the_exact_file_sizes(self):
        sizes = {
            e["name"]: e["size"] for e in self.list(self.image(COMPLETE), "rock_ridge")
        }
        for name, content in COMPLETE.items():
            with self.subTest(name):
                self.assertEqual(sizes[name], len(as_bytes(content)))


class JolietViewTest(BsdtarTestCase):
    def test_lists_the_real_names_in_sorted_order(self):
        self.assertEqual(
            self.names(self.image(COMPLETE), "joliet"),
            [".", "meta-data", "network-config", "user-data", "vendor-data"],
        )


class PlainViewTest(BsdtarTestCase):
    def test_lists_the_8_3_names(self):
        self.assertEqual(
            self.names(self.image(COMPLETE), "plain"),
            [".", "META_DAT", "NETWORK_", "USER_DAT", "VENDOR_D"],
        )


class FileContentsTest(BsdtarTestCase):
    def test_every_file_reads_back_exactly_through_every_view(self):
        image = self.image(COMPLETE)
        for view in VIEWS:
            directory = self.extract(image, view)
            for name, content in COMPLETE.items():
                with self.subTest(view=view, file=name):
                    file = PLAIN_NAMES[name] if view == "plain" else name
                    self.assertEqual((directory / file).read_bytes(), as_bytes(content))

    def test_utf8_text_reads_back_byte_for_byte(self):
        text = "#cloud-config\nhostname: café-☁\nusers: [{ name: jürgen }]\n"
        directory = self.extract(
            self.image({**MINIMAL, "user-data": text}), "rock_ridge"
        )
        self.assertEqual((directory / "user-data").read_bytes(), text.encode("utf-8"))

    def test_binary_data_reads_back_byte_for_byte(self):
        data = bytes(range(256))
        directory = self.extract(
            self.image({**MINIMAL, "user-data": data}), "rock_ridge"
        )
        self.assertEqual((directory / "user-data").read_bytes(), data)

    def test_files_spanning_several_sectors_read_back_exactly(self):
        text = "#cloud-config\n" + "# padding line\n" * 400
        directory = self.extract(
            self.image({**MINIMAL, "user-data": text}), "rock_ridge"
        )
        self.assertEqual((directory / "user-data").read_text(), text)

    def test_empty_files_read_back_empty(self):
        image = self.image({**MINIMAL, "vendor-data": ""})
        sizes = {e["name"]: e["size"] for e in self.list(image, "rock_ridge")}
        self.assertEqual(sizes["vendor-data"], 0)
        self.assertEqual(
            (self.extract(image, "rock_ridge") / "vendor-data").read_bytes(), b""
        )


class TimestampsTest(BsdtarTestCase):
    def test_default_to_the_unix_epoch(self):
        directory = self.extract(self.image(MINIMAL), "rock_ridge")
        self.assertEqual((directory / "user-data").stat().st_mtime, 0)

    def test_use_the_given_date_to_the_second(self):
        directory = self.extract(self.image(MINIMAL, DATE), "rock_ridge")
        for name in MINIMAL:
            with self.subTest(name):
                self.assertEqual((directory / name).stat().st_mtime, DATE.timestamp())


if __name__ == "__main__":
    unittest.main(verbosity=2)
