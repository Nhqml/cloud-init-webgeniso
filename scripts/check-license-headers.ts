// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Fails if any source file does not start with the license header.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const HEADER = [
  "// SPDX-License-Identifier: AGPL-3.0-or-later",
  "// Copyright (C) 2026 Kenji Gaillac",
];

const SOURCE_EXTENSIONS = /\.(ts|mts|cts|js|mjs|cjs)$/;

// Tracked files plus new files not covered by .gitignore.
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\n")
  .filter((file) => SOURCE_EXTENSIONS.test(file));

const missing = files.filter((file) => {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  // Allow a shebang and blank lines before the header, but not inside it.
  if (lines[0]?.startsWith("#!")) lines.shift();
  const start = lines.findIndex((line) => line.trim() !== "");
  return HEADER.some((line, i) => lines[start + i]?.trimEnd() !== line);
});

if (missing.length > 0) {
  console.error("Missing license header in:");
  for (const file of missing) console.error(`  ${file}`);
  console.error(`\nEach source file must start with:\n${HEADER.join("\n")}`);
  process.exit(1);
}

console.log(`License header OK in ${files.length} file(s).`);
