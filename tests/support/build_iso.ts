// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Command-line bridge for the Python tests: reads a JSON request on stdin,
// writes the seed image built by buildSeedIso to stdout.
//
// Request: {
//   "files": { "<seed file name>": "<content, base64>", ... },
//   "date": "<ISO 8601 date>"   (optional, defaults to the Unix epoch)
// }

import { readFileSync } from "node:fs";

import { buildSeedIso, type SeedFiles } from "../../src/iso.ts";

interface Request {
  files: Record<string, string>;
  date?: string;
}

const request = JSON.parse(readFileSync(0, "utf8")) as Request;
const files = Object.fromEntries(
  Object.entries(request.files).map(([name, content]) => [
    name,
    new Uint8Array(Buffer.from(content, "base64")),
  ]),
) as unknown as SeedFiles;

const image = buildSeedIso(files, request.date ? { date: new Date(request.date) } : {});
process.stdout.write(image);
