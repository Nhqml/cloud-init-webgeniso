// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { SECTOR_SIZE, encodeUcs2BE } from "../../src/encode.ts";
import { DOT, directoryRecord } from "../../src/records.ts";
import {
  type VolumeDescriptorFields,
  jolietVolumeDescriptor,
  primaryVolumeDescriptor,
  terminatorVolumeDescriptor,
} from "../../src/volume.ts";
import { DATE, asciiHex, toHex } from "../support/bytes.ts";

const ucs2 = (value: string): string => toHex(encodeUcs2BE(value));
const zeros = (length: number): string => "00".repeat(length);
const asciiSpaces = (length: number): string => "20".repeat(length);
const ucs2Spaces = (chars: number): string => "0020".repeat(chars);

/** Hex of `length` bytes of `descriptor` starting at `offset`. */
const field = (descriptor: Uint8Array, offset: number, length: number): string =>
  toHex(descriptor.subarray(offset, offset + length));

const volumeDate = asciiHex("2026101708050900") + "00";
const notSpecifiedDate = asciiHex("0000000000000000") + "00";

const rootRecord = directoryRecord({
  extent: 23,
  dataLength: SECTOR_SIZE,
  date: DATE,
  directory: true,
  identifier: DOT,
});

const fields: VolumeDescriptorFields = {
  volumeId: "cidata",
  // Distinct byte values, so any byte-order mistake changes the output.
  volumeSpaceSize: 0x12345678,
  lPathTableExtent: 0x00010203,
  mPathTableExtent: 0x04050607,
  rootDirectoryRecord: rootRecord,
  date: DATE,
};

describe("primaryVolumeDescriptor (8.4)", () => {
  // Built per test, so each one reports its own failure.
  const pvd = () => primaryVolumeDescriptor(fields);

  test("is one sector long", () => {
    assert.equal(pvd().length, SECTOR_SIZE);
  });

  test("starts with type 1, CD001 and version 1", () => {
    assert.equal(field(pvd(), 0, 1), "01"); // Volume descriptor type.
    assert.equal(field(pvd(), 1, 5), asciiHex("CD001")); // Standard identifier.
    assert.equal(field(pvd(), 6, 1), "01"); // Volume descriptor version.
    assert.equal(field(pvd(), 7, 1), "00"); // Unused.
  });

  test("leaves the system identifier blank", () => {
    assert.equal(field(pvd(), 8, 32), asciiSpaces(32));
  });

  test("writes the volume identifier as given, lowercase", () => {
    assert.equal(field(pvd(), 40, 32), asciiHex("cidata") + asciiSpaces(26));
  });

  test("writes the volume space size in both-byte order", () => {
    assert.equal(field(pvd(), 72, 8), zeros(8)); // Unused.
    assert.equal(field(pvd(), 80, 8), "7856341212345678");
    assert.equal(field(pvd(), 88, 32), zeros(32)); // Unused in a PVD.
  });

  test("describes a single-volume set with 2048-byte blocks", () => {
    assert.equal(field(pvd(), 120, 4), "01000001"); // Volume set size.
    assert.equal(field(pvd(), 124, 4), "01000001"); // Volume sequence number.
    assert.equal(field(pvd(), 128, 4), "00080800"); // Logical block size.
  });

  test("points to the root-only path tables", () => {
    assert.equal(field(pvd(), 132, 8), "0a0000000000000a"); // Path table size: 10.
    assert.equal(field(pvd(), 140, 4), "03020100"); // Type L location, little-endian.
    assert.equal(field(pvd(), 144, 4), zeros(4)); // No optional type L table.
    assert.equal(field(pvd(), 148, 4), "04050607"); // Type M location, big-endian.
    assert.equal(field(pvd(), 152, 4), zeros(4)); // No optional type M table.
  });

  test("embeds the root directory record", () => {
    assert.equal(field(pvd(), 156, 34), toHex(rootRecord));
  });

  test("leaves the text identifiers blank", () => {
    assert.equal(field(pvd(), 190, 128), asciiSpaces(128)); // Volume set.
    assert.equal(field(pvd(), 318, 128), asciiSpaces(128)); // Publisher.
    assert.equal(field(pvd(), 446, 128), asciiSpaces(128)); // Data preparer.
    assert.equal(field(pvd(), 574, 128), asciiSpaces(128)); // Application.
    assert.equal(field(pvd(), 702, 37), asciiSpaces(37)); // Copyright file.
    assert.equal(field(pvd(), 739, 37), asciiSpaces(37)); // Abstract file.
    assert.equal(field(pvd(), 776, 37), asciiSpaces(37)); // Bibliographic file.
  });

  test("dates: created, modified and effective now, never expires", () => {
    assert.equal(field(pvd(), 813, 17), volumeDate); // Creation.
    assert.equal(field(pvd(), 830, 17), volumeDate); // Modification.
    assert.equal(field(pvd(), 847, 17), notSpecifiedDate); // Expiration.
    assert.equal(field(pvd(), 864, 17), volumeDate); // Effective.
  });

  test("ends with file structure version 1, blank application use and zeros", () => {
    assert.equal(field(pvd(), 881, 1), "01"); // File structure version.
    assert.equal(field(pvd(), 882, 1), "00"); // Reserved.
    // Application use: spaces, like genisoimage and pycdlib-genisoimage.
    assert.equal(field(pvd(), 883, 512), asciiSpaces(512));
    assert.equal(field(pvd(), 1395, 653), zeros(653)); // Reserved.
  });

  test("rejects a volume identifier longer than 32 characters", () => {
    assert.throws(
      () => primaryVolumeDescriptor({ ...fields, volumeId: "x".repeat(33) }),
      RangeError,
    );
  });

  test("rejects a root directory record that isn't 34 bytes", () => {
    const withSystemUse = directoryRecord({
      extent: 23,
      dataLength: SECTOR_SIZE,
      date: DATE,
      directory: true,
      identifier: DOT,
      systemUse: new Uint8Array(4),
    });
    assert.throws(
      () => primaryVolumeDescriptor({ ...fields, rootDirectoryRecord: withSystemUse }),
      RangeError,
    );
  });
});

describe("jolietVolumeDescriptor (8.5, Joliet)", () => {
  const svd = () => jolietVolumeDescriptor(fields);

  test("is one sector long", () => {
    assert.equal(svd().length, SECTOR_SIZE);
  });

  test("starts with type 2, CD001, version 1 and no volume flags", () => {
    assert.equal(field(svd(), 0, 1), "02"); // Supplementary volume descriptor.
    assert.equal(field(svd(), 1, 5), asciiHex("CD001"));
    assert.equal(field(svd(), 6, 1), "01");
    assert.equal(field(svd(), 7, 1), "00"); // Volume flags.
  });

  test("text fields are UCS-2 big-endian, padded with UCS-2 spaces", () => {
    assert.equal(field(svd(), 8, 32), ucs2Spaces(16)); // System identifier.
    assert.equal(field(svd(), 40, 32), ucs2("cidata") + ucs2Spaces(10)); // Volume.
  });

  test("declares Joliet UCS-2 level 3 with the %/E escape sequence", () => {
    assert.equal(field(svd(), 88, 32), asciiHex("%/E") + zeros(29));
  });

  test("shares the numeric fields with the primary descriptor", () => {
    assert.equal(field(svd(), 72, 8), zeros(8));
    assert.equal(field(svd(), 80, 8), "7856341212345678");
    assert.equal(field(svd(), 120, 4), "01000001");
    assert.equal(field(svd(), 124, 4), "01000001");
    assert.equal(field(svd(), 128, 4), "00080800");
    assert.equal(field(svd(), 132, 8), "0a0000000000000a");
    assert.equal(field(svd(), 140, 4), "03020100");
    assert.equal(field(svd(), 144, 4), zeros(4));
    assert.equal(field(svd(), 148, 4), "04050607");
    assert.equal(field(svd(), 152, 4), zeros(4));
    assert.equal(field(svd(), 156, 34), toHex(rootRecord));
  });

  test("leaves the text identifiers blank in UCS-2", () => {
    assert.equal(field(svd(), 190, 128), ucs2Spaces(64)); // Volume set.
    assert.equal(field(svd(), 318, 128), ucs2Spaces(64)); // Publisher.
    assert.equal(field(svd(), 446, 128), ucs2Spaces(64)); // Data preparer.
    assert.equal(field(svd(), 574, 128), ucs2Spaces(64)); // Application.
    // 37-byte fields hold 18 UCS-2 characters; the odd last byte is zero.
    assert.equal(field(svd(), 702, 37), ucs2Spaces(18) + "00"); // Copyright file.
    assert.equal(field(svd(), 739, 37), ucs2Spaces(18) + "00"); // Abstract file.
    assert.equal(field(svd(), 776, 37), ucs2Spaces(18) + "00"); // Bibliographic file.
  });

  test("has the same dates and trailer as the primary descriptor", () => {
    assert.equal(field(svd(), 813, 17), volumeDate);
    assert.equal(field(svd(), 830, 17), volumeDate);
    assert.equal(field(svd(), 847, 17), notSpecifiedDate);
    assert.equal(field(svd(), 864, 17), volumeDate);
    assert.equal(field(svd(), 881, 1), "01");
    assert.equal(field(svd(), 882, 1), "00");
    // Application use is ASCII spaces in Joliet too, not UCS-2.
    assert.equal(field(svd(), 883, 512), asciiSpaces(512));
    assert.equal(field(svd(), 1395, 653), zeros(653));
  });

  test("rejects a volume identifier longer than 16 UCS-2 characters", () => {
    assert.throws(
      () => jolietVolumeDescriptor({ ...fields, volumeId: "x".repeat(17) }),
      RangeError,
    );
  });
});

describe("terminatorVolumeDescriptor (8.3)", () => {
  test("is type 255, CD001, version 1, then zeros", () => {
    const terminator = terminatorVolumeDescriptor();
    assert.equal(terminator.length, SECTOR_SIZE);
    assert.equal(field(terminator, 0, 7), "ff" + asciiHex("CD001") + "01");
    assert.equal(field(terminator, 7, SECTOR_SIZE - 7), zeros(SECTOR_SIZE - 7));
  });
});
