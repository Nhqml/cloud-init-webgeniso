// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Unit tests for buildSeedIso: input handling and image-wide invariants that
// need no ISO parser. Reading the image back is covered by the integration
// tests in tests/integration/, which use real ISO readers.

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SECTOR_SIZE } from "../../../src/lib/encode.ts";
import { type SeedFiles, buildSeedIso } from "../../../src/lib/iso.ts";
import { DATE, asciiHex, toHex } from "../../support/bytes.ts";

const files: SeedFiles = {
  "user-data": "#cloud-config\n",
  "meta-data": "instance-id: test\n",
};

/** Bytes of logical sector `lba` of `image`. */
const sector = (image: Uint8Array, lba: number): Uint8Array =>
  image.subarray(lba * SECTOR_SIZE, (lba + 1) * SECTOR_SIZE);

describe("buildSeedIso: image layout", () => {
  test("is a whole number of sectors", () => {
    const image = buildSeedIso(files);
    assert.ok(image instanceof Uint8Array);
    assert.ok(image.length > 0);
    assert.equal(image.length % SECTOR_SIZE, 0);
  });

  test("leaves the System Area (sectors 0-15) zeroed", () => {
    const image = buildSeedIso(files);
    assert.ok(image.subarray(0, 16 * SECTOR_SIZE).every((byte) => byte === 0));
  });

  test("has the primary, Joliet and terminator descriptors at sectors 16-18", () => {
    const image = buildSeedIso(files);
    assert.equal(toHex(sector(image, 16).subarray(0, 7)), "01" + asciiHex("CD001") + "01");
    assert.equal(toHex(sector(image, 17).subarray(0, 7)), "02" + asciiHex("CD001") + "01");
    assert.equal(toHex(sector(image, 18).subarray(0, 7)), "ff" + asciiHex("CD001") + "01");
  });

  test("declares its own size as the volume space size", () => {
    const image = buildSeedIso(files);
    const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
    const pvdSize = view.getUint32(16 * SECTOR_SIZE + 80, true);
    const jolietSize = view.getUint32(17 * SECTOR_SIZE + 80, true);
    assert.equal(pvdSize * SECTOR_SIZE, image.length);
    assert.equal(jolietSize * SECTOR_SIZE, image.length);
  });

  test("labels the volume cidata", () => {
    const image = buildSeedIso(files);
    const pvdLabel = sector(image, 16).subarray(40, 72);
    assert.equal(toHex(pvdLabel), asciiHex("cidata") + "20".repeat(26));
  });

  test("grows with the file data", () => {
    const small = buildSeedIso(files);
    const large = buildSeedIso({ ...files, "user-data": "x".repeat(3 * SECTOR_SIZE) });
    assert.equal(large.length - small.length, 2 * SECTOR_SIZE);
  });
});

describe("buildSeedIso: determinism", () => {
  test("same inputs give identical bytes", () => {
    assert.deepEqual(buildSeedIso(files, { date: DATE }), buildSeedIso(files, { date: DATE }));
  });

  test("defaults the date to the Unix epoch", () => {
    assert.deepEqual(buildSeedIso(files), buildSeedIso(files, { date: new Date(0) }));
  });

  test("the date changes the output", () => {
    assert.notDeepEqual(buildSeedIso(files), buildSeedIso(files, { date: DATE }));
  });

  test("rejects an invalid date", () => {
    assert.throws(() => buildSeedIso(files, { date: new Date(Number.NaN) }), RangeError);
  });
});

describe("buildSeedIso: file contents", () => {
  test("strings are encoded as UTF-8", () => {
    const text = "#cloud-config\nhostname: café-☁\n";
    assert.deepEqual(
      buildSeedIso({ ...files, "user-data": text }),
      buildSeedIso({ ...files, "user-data": new TextEncoder().encode(text) }),
    );
  });

  test("bytes are used as given, including Buffer instances", () => {
    const bytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff]);
    assert.deepEqual(
      buildSeedIso({ ...files, "user-data": bytes }),
      buildSeedIso({ ...files, "user-data": Buffer.from(bytes) }),
    );
  });

  test("the image doesn't share memory with the inputs", () => {
    const bytes = new TextEncoder().encode("#cloud-config\n");
    const image = buildSeedIso({ ...files, "user-data": bytes });
    const before = image.slice();
    bytes.fill(0x41);
    assert.deepEqual(image, before);
  });

  test("optional files left undefined are treated as absent", () => {
    const withUndefined = { ...files, "vendor-data": undefined } as unknown as SeedFiles;
    assert.deepEqual(buildSeedIso(withUndefined), buildSeedIso(files));
  });

  test("adding an optional file changes the image", () => {
    assert.notDeepEqual(
      buildSeedIso({ ...files, "network-config": "version: 2\n" }),
      buildSeedIso(files),
    );
  });
});

describe("buildSeedIso: input validation", () => {
  test("requires user-data and meta-data", () => {
    const { "user-data": _userData, ...noUserData } = files;
    const { "meta-data": _metaData, ...noMetaData } = files;
    assert.throws(() => buildSeedIso(noUserData as SeedFiles), TypeError);
    assert.throws(() => buildSeedIso(noMetaData as SeedFiles), TypeError);
  });

  test("rejects unknown file names", () => {
    const withExtra = { ...files, "user-data.txt": "" } as unknown as SeedFiles;
    assert.throws(() => buildSeedIso(withExtra), TypeError);
  });

  test("rejects contents that are neither strings nor bytes", () => {
    for (const value of [42, null, {}, new ArrayBuffer(4), ["a"]]) {
      const bad = { ...files, "user-data": value } as unknown as SeedFiles;
      assert.throws(() => buildSeedIso(bad), TypeError, String(value));
    }
  });

  test("rejects a files argument that isn't an object", () => {
    for (const value of [undefined, null, "user-data", 42]) {
      assert.throws(() => buildSeedIso(value as unknown as SeedFiles), TypeError);
    }
  });
});
