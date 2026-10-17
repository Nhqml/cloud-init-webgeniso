#!/usr/bin/env -S uv run --quiet --script

# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Kenji Gaillac

# /// script
# requires-python = ">=3.11"
# dependencies = ["pycdlib==1.22.0"]
# ///

"""Integration tests with pycdlib, a strict ISO 9660 parser.

- pycdlib must open our images: it validates structures while parsing and
  raises on malformed ones.
- Our images must match, field by field, the image pycdlib-genisoimage (its
  genisoimage-compatible tool) builds from the same files with
  `-V cidata -r -J`, apart from layout, dates and the application name.

Run: tests/integration/test_pycdlib.py
"""

import io
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import pycdlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "support"))
from seed import COMPLETE, DATE, ISO9660_NAMES, MINIMAL, as_bytes, write_iso


def ascii_field(field):
    """An ASCII descriptor field, padding included."""
    return field.decode("ascii")


def ucs2_field(field):
    """A UCS-2 big-endian descriptor field, padding included. Odd-length
    fields end with a lone byte, kept separately."""
    even = len(field) - len(field) % 2
    return field[:even].decode("utf-16-be"), field[even:]


def describe_descriptor(vd, decode):
    return {
        "system_identifier": decode(vd.system_identifier),
        "volume_identifier": decode(vd.volume_identifier),
        "space_size": vd.space_size,
        "set_size": vd.set_size,
        "sequence_number": vd.seqnum,
        "logical_block_size": vd.log_block_size,
        "path_table_size": vd.path_tbl_size,
        "volume_set_identifier": decode(vd.volume_set_identifier),
        "publisher_identifier": decode(vd.publisher_identifier.record()),
        "preparer_identifier": decode(vd.preparer_identifier.record()),
        "application_identifier": decode(vd.application_identifier.record()),
        "copyright_file_identifier": decode(vd.copyright_file_identifier),
        "abstract_file_identifier": decode(vd.abstract_file_identifier),
        "bibliographic_file_identifier": decode(vd.bibliographic_file_identifier),
        "file_structure_version": vd.file_structure_version,
        "escape_sequences": getattr(vd, "escape_sequences", b""),
    }


def describe_record(record, decode_name):
    described = {
        "identifier": decode_name(record.file_identifier()),
        "directory": record.is_dir(),
        "size": record.data_length,
        "extent": record.extent_location(),
        "record_length": record.dr_len,
        "rock_ridge": None,
    }
    rock_ridge = record.rock_ridge
    if rock_ridge is not None:
        px = rock_ridge.dr_entries.px_record
        described["rock_ridge"] = {
            "name": rock_ridge.name().decode("ascii"),
            "mode": px.posix_file_mode,
            "links": px.posix_file_links,
            "uid": px.posix_user_id,
            "gid": px.posix_group_id,
        }
    return described


#: pycdlib path keyword and file name decoder for each directory tree.
TREES = {
    "iso9660": ("iso_path", lambda name: name.decode("ascii")),
    "joliet": ("joliet_path", lambda name: name.decode("utf-16-be")),
    "rock_ridge": ("rr_path", lambda name: name.decode("ascii")),
}


def describe_image(path):
    """Everything we compare about an image, as parsed by pycdlib."""
    iso = pycdlib.PyCdlib()
    iso.open(str(path))
    try:
        trees, contents = {}, {}
        for tree, (keyword, decode_name) in TREES.items():
            records = [
                describe_record(r, decode_name)
                for r in iso.list_children(**{keyword: "/"})
            ]
            trees[tree] = records
            contents[tree] = {}
            for record in records:
                if record["directory"]:
                    continue
                name = (
                    record["rock_ridge"]["name"]
                    if tree == "rock_ridge"
                    else record["identifier"]
                )
                data = io.BytesIO()
                iso.get_file_from_iso_fp(data, **{keyword: "/" + name})
                contents[tree][name] = data.getvalue()
        return {
            "rock_ridge_version": iso.rock_ridge if iso.has_rock_ridge() else None,
            "joliet": iso.has_joliet(),
            "primary": describe_descriptor(iso.pvd, ascii_field),
            "joliet_descriptor": describe_descriptor(iso.joliet_vd, ucs2_field),
            "trees": trees,
            "contents": contents,
        }
    finally:
        iso.close()


def comparable(image):
    """Drops what legitimately differs between two writers: where things are
    (extents, total size), dates (not described) and the application name."""
    image = dict(image)
    for descriptor in ("primary", "joliet_descriptor"):
        image[descriptor] = {
            key: value
            for key, value in image[descriptor].items()
            if key not in ("space_size", "application_identifier")
        }
    image["trees"] = {
        tree: [{k: v for k, v in record.items() if k != "extent"} for record in records]
        for tree, records in image["trees"].items()
    }
    return image


def pycdlib_genisoimage(args):
    """Runs pycdlib's genisoimage-compatible tool, from this environment."""
    tool = Path(sys.executable).parent / "pycdlib-genisoimage"
    subprocess.run([sys.executable, str(tool), *args], check=True, capture_output=True)


class PycdlibTestCase(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="seed-iso-pycdlib-")
        self.addCleanup(temporary.cleanup)
        self.work_dir = Path(temporary.name)
        self.count = 0

    def describe_ours(self, files):
        self.count += 1
        return describe_image(
            write_iso(self.work_dir, files, DATE, name=f"ours-{self.count}.iso")
        )

    def describe_reference(self, files):
        self.count += 1
        inputs = self.work_dir / f"input-{self.count}"
        inputs.mkdir()
        for name, content in files.items():
            (inputs / name).write_bytes(as_bytes(content))
        image = self.work_dir / f"reference-{self.count}.iso"
        pycdlib_genisoimage(
            [
                "-o",
                str(image),
                "-V",
                "cidata",
                "-r",
                "-J",
                *(str(inputs / n) for n in files),
            ]
        )
        return describe_image(image)


class ParsesOurImagesTest(PycdlibTestCase):
    def test_parses_with_rock_ridge_1_09_and_joliet(self):
        cases = {
            "minimal": MINIMAL,
            "complete": COMPLETE,
            "with an empty file": {**MINIMAL, "vendor-data": ""},
            "with a multi-sector file": {**MINIMAL, "user-data": "#" * 5000},
            "with binary data": {**MINIMAL, "user-data": bytes(range(256))},
        }
        for label, files in cases.items():
            with self.subTest(label):
                image = self.describe_ours(files)
                self.assertEqual(image["rock_ridge_version"], "1.09")
                self.assertTrue(image["joliet"])


class ReadsOurFilesBackTest(PycdlibTestCase):
    def test_through_all_three_directory_trees(self):
        contents = self.describe_ours(COMPLETE)["contents"]
        expected = {name: as_bytes(content) for name, content in COMPLETE.items()}
        self.assertEqual(contents["rock_ridge"], expected)
        self.assertEqual(contents["joliet"], expected)
        self.assertEqual(
            contents["iso9660"],
            {ISO9660_NAMES[name]: data for name, data in expected.items()},
        )

    def test_joliet_names_have_no_version_suffix(self):
        names = [
            r["identifier"] for r in self.describe_ours(COMPLETE)["trees"]["joliet"]
        ]
        self.assertEqual(
            names,
            [".", "..", "meta-data", "network-config", "user-data", "vendor-data"],
        )


class MatchesGenisoimageTest(PycdlibTestCase):
    """Compares with pycdlib-genisoimage -V cidata -r -J."""

    def test_matches(self):
        for label, files in {"minimal": MINIMAL, "complete": COMPLETE}.items():
            with self.subTest(label):
                self.assertEqual(
                    comparable(self.describe_ours(files)),
                    comparable(self.describe_reference(files)),
                )


if __name__ == "__main__":
    unittest.main(verbosity=2)
