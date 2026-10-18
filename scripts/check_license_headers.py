#!/usr/bin/env -S uv run --quiet --script
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Kenji Gaillac

# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///

"""Fails if any source file does not start with the license header.

Each language uses its own comment syntax (see COMMENT_STYLES). A shebang
(or an HTML doctype) and blank lines may come before the header, but the
header lines must be consecutive. Checks tracked files plus new files not covered by
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

# Comment syntax (opening, closing) for each kind of source file we check;
# each header line is one comment.
COMMENT_STYLES = [
    (re.compile(r"\.(ts|mts|cts|js|mjs|cjs)$"), ("//", "")),
    (re.compile(r"\.py$"), ("#", "")),
    (re.compile(r"\.html$"), ("<!--", "-->")),
    (re.compile(r"\.css$"), ("/*", "*/")),
]

# Lines that must stay first and may come before the header.
PRELUDE = re.compile(r"^(#!|<!doctype )", re.IGNORECASE)


def comment_style(path):
    for pattern, style in COMMENT_STYLES:
        if pattern.search(path):
            return style
    return None


def header_for(style):
    opening, closing = style
    return [f"{opening} {line} {closing}".rstrip() for line in HEADER_TEXT]


def has_header(path, style):
    lines = Path(path).read_text(encoding="utf-8").splitlines()
    if lines and PRELUDE.match(lines[0]):
        lines = lines[1:]
    start = next((i for i, line in enumerate(lines) if line.strip()), len(lines))
    actual = [line.rstrip() for line in lines[start : start + len(HEADER_TEXT)]]
    return actual == header_for(style)


def main():
    listed = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        capture_output=True,
        text=True,
        check=True,
    ).stdout.splitlines()
    # Deleted but still tracked files show up in the index; skip them.
    files = [f for f in listed if comment_style(f) and Path(f).exists()]
    missing = [f for f in files if not has_header(f, comment_style(f))]

    if missing:
        print("Missing license header in:", file=sys.stderr)
        for path in missing:
            print(f"  {path}", file=sys.stderr)
        print(
            "\nEach source file must start with:\n"
            + "\n".join(header_for(("//", "")))
            + "\nin its own comment syntax (#, <!-- -->, /* */). A shebang or"
            + " <!doctype html> may come first.",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"License header OK in {len(files)} file(s).")


if __name__ == "__main__":
    main()
