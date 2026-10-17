// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Integration tests: build seed images, then read them back with bsdtar
// (libarchive), an independent ISO 9660 reader. Each of the three ways an
// image can be read is checked: Rock Ridge (Linux), Joliet (Windows) and
// plain ISO 9660.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";

import { type SeedFiles, buildSeedIso } from "../../src/iso.ts";

/** bsdtar read options selecting which directory tree it uses. */
const VIEWS = {
  rockRidge: [],
  joliet: ["--options", "!rockridge"],
  plain: ["--options", "!rockridge,!joliet"],
} as const;
type View = keyof typeof VIEWS;

const workDir = mkdtempSync(join(tmpdir(), "seed-iso-test-"));
let imageCount = 0;

before(() => {
  const version = execFileSync("bsdtar", ["--version"], { encoding: "utf8" });
  assert.match(version, /libarchive/, "bsdtar is required: run `mise install`");
});

after(() => {
  // Extracted directories keep the image's read-only r-xr-xr-x mode; make
  // them writable again so their contents can be deleted.
  for (const entry of readdirSync(workDir, { recursive: true, withFileTypes: true })) {
    if (entry.isDirectory()) chmodSync(join(entry.parentPath, entry.name), 0o700);
  }
  rmSync(workDir, { recursive: true, force: true });
});

/** Builds an image and writes it to a temporary file. Returns its path. */
function writeImage(files: SeedFiles, date?: Date): string {
  const path = join(workDir, `seed-${imageCount++}.iso`);
  writeFileSync(path, buildSeedIso(files, date ? { date } : {}));
  return path;
}

interface ListedEntry {
  mode: string;
  links: number;
  uid: number;
  gid: number;
  size: number;
  name: string;
}

/** Lists the image's entries, as seen through `view`. */
function list(image: string, view: View): ListedEntry[] {
  const output = execFileSync(
    "bsdtar",
    ["-tvf", image, "--numeric-owner", ...VIEWS[view]],
    { encoding: "utf8" },
  );
  return output
    .trim()
    .split("\n")
    .map((line) => {
      // mode links uid gid size <date: 3 fields> name
      const [mode, links, uid, gid, size, , , , name] = line.trim().split(/\s+/);
      return {
        mode: mode ?? "",
        links: Number(links),
        uid: Number(uid),
        gid: Number(gid),
        size: Number(size),
        name: name ?? "",
      };
    });
}

/** Extracts the image, as seen through `view`. Returns the target directory. */
function extract(image: string, view: View): string {
  const target = mkdtempSync(join(workDir, "extract-"));
  execFileSync("bsdtar", ["-xpf", image, "-C", target, ...VIEWS[view]]);
  return target;
}

const minimal: SeedFiles = {
  "user-data": "#cloud-config\nhostname: test\n",
  "meta-data": "instance-id: iid-test\nlocal-hostname: test\n",
};

const complete: SeedFiles = {
  ...minimal,
  "network-config": "version: 2\nethernets:\n  eth0:\n    dhcp4: true\n",
  "vendor-data": "#cloud-config\n",
};

describe("Rock Ridge view (Linux)", () => {
  test("lists the real names, in sorted order", () => {
    const names = list(writeImage(complete), "rockRidge").map((entry) => entry.name);
    assert.deepEqual(names, [".", "meta-data", "network-config", "user-data", "vendor-data"]);
  });

  test("lists only the files given", () => {
    const names = list(writeImage(minimal), "rockRidge").map((entry) => entry.name);
    assert.deepEqual(names, [".", "meta-data", "user-data"]);
  });

  test("files are -rational-rock: r--r--r--, owned by root, one link", () => {
    const files = list(writeImage(complete), "rockRidge").filter((e) => e.name !== ".");
    for (const entry of files) {
      assert.equal(entry.mode, "-r--r--r--", entry.name);
      assert.equal(entry.uid, 0, entry.name);
      assert.equal(entry.gid, 0, entry.name);
      assert.equal(entry.links, 1, entry.name);
    }
  });

  test("the root directory is r-xr-xr-x, owned by root, two links", () => {
    const root = list(writeImage(minimal), "rockRidge").find((e) => e.name === ".");
    assert.deepEqual(root && [root.mode, root.uid, root.gid, root.links], [
      "dr-xr-xr-x",
      0,
      0,
      2,
    ]);
  });

  test("reports the exact file sizes", () => {
    const entries = list(writeImage(complete), "rockRidge");
    for (const [name, content] of Object.entries(complete)) {
      const entry = entries.find((e) => e.name === name);
      assert.equal(entry?.size, Buffer.byteLength(content), name);
    }
  });
});

describe("Joliet view (Windows)", () => {
  test("lists the real names, in sorted order", () => {
    const names = list(writeImage(complete), "joliet").map((entry) => entry.name);
    assert.deepEqual(names, [".", "meta-data", "network-config", "user-data", "vendor-data"]);
  });
});

describe("plain ISO 9660 view", () => {
  test("lists genisoimage's 8.3 names", () => {
    const names = list(writeImage(complete), "plain").map((entry) => entry.name);
    assert.deepEqual(names, [".", "META_DAT", "NETWORK_", "USER_DAT", "VENDOR_D"]);
  });
});

describe("file contents", () => {
  const names = { "meta-data": "META_DAT", "network-config": "NETWORK_", "user-data": "USER_DAT", "vendor-data": "VENDOR_D" } as const;

  test("every file reads back exactly, through every view", () => {
    const image = writeImage(complete);
    for (const view of Object.keys(VIEWS) as View[]) {
      const dir = extract(image, view);
      for (const [name, content] of Object.entries(complete)) {
        const file = view === "plain" ? names[name as keyof typeof names] : name;
        assert.equal(readFileSync(join(dir, file), "utf8"), content, `${view}: ${name}`);
      }
    }
  });

  test("UTF-8 text reads back byte for byte", () => {
    const text = "#cloud-config\nhostname: café-☁\nusers: [{ name: jürgen }]\n";
    const dir = extract(writeImage({ ...minimal, "user-data": text }), "rockRidge");
    assert.deepEqual(readFileSync(join(dir, "user-data")), Buffer.from(text, "utf8"));
  });

  test("binary data reads back byte for byte", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    const dir = extract(writeImage({ ...minimal, "user-data": bytes }), "rockRidge");
    assert.deepEqual(new Uint8Array(readFileSync(join(dir, "user-data"))), bytes);
  });

  test("files spanning several sectors read back exactly", () => {
    const text = "#cloud-config\n" + "# padding line\n".repeat(400);
    const dir = extract(writeImage({ ...minimal, "user-data": text }), "rockRidge");
    assert.equal(readFileSync(join(dir, "user-data"), "utf8"), text);
  });

  test("empty files read back empty", () => {
    const image = writeImage({ ...minimal, "vendor-data": "" });
    const entry = list(image, "rockRidge").find((e) => e.name === "vendor-data");
    assert.equal(entry?.size, 0);
    const dir = extract(image, "rockRidge");
    assert.equal(readFileSync(join(dir, "vendor-data"), "utf8"), "");
  });
});

describe("timestamps", () => {
  test("default to the Unix epoch", () => {
    const dir = extract(writeImage(minimal), "rockRidge");
    assert.equal(statSync(join(dir, "user-data")).mtimeMs, 0);
  });

  test("use the given date, to the second", () => {
    const date = new Date(Date.UTC(2026, 9, 17, 8, 5, 9));
    const dir = extract(writeImage(minimal, date), "rockRidge");
    assert.equal(statSync(join(dir, "user-data")).mtimeMs, date.getTime());
    assert.equal(statSync(join(dir, "meta-data")).mtimeMs, date.getTime());
  });
});
