#!/usr/bin/env -S uv run --quiet --script
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Kenji Gaillac

# /// script
# requires-python = ">=3.10"
# dependencies = []
# ///

"""Fails if any source file does not start with the license header.

A shebang and blank lines may come before the header, but the header lines
must be consecutive. Checks tracked files plus new files not covered by
.gitignore.

Run: scripts/check_license_headers.py
"""

import re
import subprocess
import sys
from pathlib import Path

HEADER_TEXT = [
    "SPDX-License-Identifier: AGPL-3.0-or-later",
    "Copyright (C) 2026 Kenji Gaillac",
]

#: Line comment marker for each kind of source file we check.
COMMENT_MARKERS = [
    (re.compile(r"\.(ts|mts|cts|js|mjs|cjs)$"), "//"),
    (re.compile(r"\.py$"), "#"),
]


def comment_marker(path):
    for pattern, marker in COMMENT_MARKERS:
        if pattern.search(path):
            return marker
    return None


def header_for(marker):
    return [f"{marker} {line}" for line in HEADER_TEXT]


def has_header(path, marker):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    if lines and lines[0].startswith("#!"):
        lines = lines[1:]
    start = next((i for i, line in enumerate(lines) if line.strip()), len(lines))
    actual = [line.rstrip() for line in lines[start : start + len(HEADER_TEXT)]]
    return actual == header_for(marker)


def main():
    listed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    # Deleted but still tracked files show up in the index; skip them.
    files = [f for f in listed if comment_marker(f) and Path(f).exists()]
    missing = [f for f in files if not has_header(f, comment_marker(f))]

    if missing:
        print("Missing license header in:", file=sys.stderr)
        for path in missing:
            print(f"  {path}", file=sys.stderr)
        print(
            "\nEach source file must start with:\n"
            + "\n".join(header_for("//"))
            + '\n(or "#" instead of "//" in Python files)',
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"License header OK in {len(files)} file(s).")


if __name__ == "__main__":
    main()
