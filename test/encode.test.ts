// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SECTOR_SIZE,
  encodeUcs2BE,
  sectorsFor,
  writeAString,
  writeAscii,
  writeDString,
  writeI8,
  writePaddedAscii,
  writeRecordDate,
  writeU16BE,
  writeU16Both,
  writeU16LE,
  writeU32BE,
  writeU32Both,
  writeU32LE,
  writeU8,
  writeUcs2BEPadded,
  writeVolumeDate,
} from "../src/encode.ts";

/** Runs `write` on a zeroed buffer of `size` bytes and returns it as hex. */
function hex(size: number, write: (buf: Uint8Array) => void): string {
  const buf = new Uint8Array(size);
  write(buf);
  return Buffer.from(buf).toString("hex");
}

describe("sectorsFor", () => {
  test("rounds up to whole sectors", () => {
    assert.equal(SECTOR_SIZE, 2048);
    assert.equal(sectorsFor(0), 0);
    assert.equal(sectorsFor(1), 1);
    assert.equal(sectorsFor(2048), 1);
    assert.equal(sectorsFor(2049), 2);
  });

  test("rejects negative and fractional sizes", () => {
    assert.throws(() => sectorsFor(-1), RangeError);
    assert.throws(() => sectorsFor(1.5), RangeError);
  });
});

describe("integers", () => {
  test("u8 and i8 (7.1.1, 7.1.2)", () => {
    assert.equal(hex(1, (b) => writeU8(b, 0, 0xab)), "ab");
    assert.equal(hex(1, (b) => writeI8(b, 0, -1)), "ff");
    assert.equal(hex(1, (b) => writeI8(b, 0, -48)), "d0");
    assert.throws(() => writeU8(new Uint8Array(1), 0, 256), RangeError);
    assert.throws(() => writeI8(new Uint8Array(1), 0, 128), RangeError);
    assert.throws(() => writeI8(new Uint8Array(1), 0, -129), RangeError);
  });

  // ECMA-119 7.2: the value 0x1234.
  test("u16 little, big and both-byte order (7.2)", () => {
    assert.equal(hex(2, (b) => writeU16LE(b, 0, 0x1234)), "3412");
    assert.equal(hex(2, (b) => writeU16BE(b, 0, 0x1234)), "1234");
    assert.equal(hex(4, (b) => writeU16Both(b, 0, 0x1234)), "34121234");
  });

  // ECMA-119 7.3: the value 0x12345678.
  test("u32 little, big and both-byte order (7.3)", () => {
    assert.equal(hex(4, (b) => writeU32LE(b, 0, 0x12345678)), "78563412");
    assert.equal(hex(4, (b) => writeU32BE(b, 0, 0x12345678)), "12345678");
    assert.equal(hex(8, (b) => writeU32Both(b, 0, 0x12345678)), "7856341212345678");
  });

  test("u32 handles the full unsigned range", () => {
    assert.equal(hex(8, (b) => writeU32Both(b, 0, 0xffffffff)), "ffffffffffffffff");
    assert.equal(hex(4, (b) => writeU32BE(b, 0, 0x80000000)), "80000000");
  });

  test("writes at the given offset only", () => {
    assert.equal(hex(6, (b) => writeU16Both(b, 1, 1)), "000100000100");
  });

  test("rejects values that don't fit", () => {
    const buf = new Uint8Array(8);
    assert.throws(() => writeU16LE(buf, 0, 0x10000), RangeError);
    assert.throws(() => writeU16Both(buf, 0, -1), RangeError);
    assert.throws(() => writeU32Both(buf, 0, 2 ** 32), RangeError);
    assert.throws(() => writeU32LE(buf, 0, 1.5), RangeError);
    assert.throws(() => writeU32LE(buf, 0, Number.NaN), RangeError);
  });

  test("rejects writes past the end of the buffer", () => {
    assert.throws(() => writeU8(new Uint8Array(1), 1, 0), RangeError);
    assert.throws(() => writeU16Both(new Uint8Array(3), 0, 0), RangeError);
    assert.throws(() => writeU32Both(new Uint8Array(7), 0, 0), RangeError);
    assert.throws(() => writeU32LE(new Uint8Array(8), -1, 0), RangeError);
  });
});

describe("character strings", () => {
  test("padded ASCII allows lowercase, for the genisoimage-style label", () => {
    assert.equal(hex(8, (b) => writePaddedAscii(b, 0, 8, "cidata")), "6369646174612020");
  });

  test("padded ASCII: empty string writes only padding", () => {
    assert.equal(hex(3, (b) => writePaddedAscii(b, 0, 3, "")), "202020");
  });

  test("padded ASCII writes only inside its field", () => {
    assert.equal(hex(5, (b) => writePaddedAscii(b, 1, 3, "ab")), "0061622000");
  });

  test("padded ASCII rejects overflow and non-ASCII", () => {
    assert.throws(() => writePaddedAscii(new Uint8Array(8), 0, 3, "abcd"), RangeError);
    assert.throws(() => writePaddedAscii(new Uint8Array(8), 0, 8, "é"), RangeError);
    assert.throws(() => writePaddedAscii(new Uint8Array(4), 2, 4, "a"), RangeError);
  });

  test("d-strings are space-padded (7.4.1)", () => {
    assert.equal(hex(8, (b) => writeDString(b, 0, 8, "CIDATA")), "4349444154412020");
    assert.equal(hex(3, (b) => writeDString(b, 0, 3, "")), "202020");
  });

  test("d-strings reject anything but A-Z, 0-9 and _", () => {
    const buf = new Uint8Array(32);
    assert.throws(() => writeDString(buf, 0, 32, "cidata"), RangeError);
    assert.throws(() => writeDString(buf, 0, 32, "USER-DATA"), RangeError);
    assert.throws(() => writeDString(buf, 0, 32, "A B"), RangeError);
  });

  test("a-strings allow space and punctuation", () => {
    assert.equal(hex(6, (b) => writeAString(b, 0, 6, "A-B. ")), "412d422e2020");
    assert.throws(() => writeAString(new Uint8Array(8), 0, 8, "abc"), RangeError);
    assert.throws(() => writeAString(new Uint8Array(8), 0, 8, "A#B"), RangeError);
  });

  test("strings longer than their field throw", () => {
    assert.throws(() => writeDString(new Uint8Array(8), 0, 3, "ABCD"), RangeError);
    assert.throws(() => writeAString(new Uint8Array(4), 2, 3, "AB"), RangeError);
  });

  test("raw ASCII is written as is, without padding", () => {
    assert.equal(hex(7, (b) => writeAscii(b, 1, "CD001")), "00434430303100");
    assert.equal(hex(2, (b) => writeAscii(b, 0, ";1")), "3b31");
    assert.throws(() => writeAscii(new Uint8Array(4), 0, "é"), RangeError);
    assert.throws(() => writeAscii(new Uint8Array(4), 0, "CD001"), RangeError);
  });
});

describe("UCS-2 big-endian (Joliet)", () => {
  test("encodes BMP characters as 2 bytes each", () => {
    assert.equal(Buffer.from(encodeUcs2BE("user-data")).toString("hex"),
      "0075007300650072002d0064006100740061");
    assert.equal(Buffer.from(encodeUcs2BE("é€")).toString("hex"), "00e920ac");
    assert.equal(encodeUcs2BE("").length, 0);
  });

  test("rejects characters outside the BMP", () => {
    assert.throws(() => encodeUcs2BE("😀"), RangeError);
    assert.throws(() => encodeUcs2BE("\ud800"), RangeError);
  });

  test("padded fields use UCS-2 spaces", () => {
    assert.equal(hex(8, (b) => writeUcs2BEPadded(b, 0, 8, "ci")), "0063006900200020");
  });

  test("padded fields reject odd lengths and overflow", () => {
    assert.throws(() => writeUcs2BEPadded(new Uint8Array(8), 0, 7, "a"), RangeError);
    assert.throws(() => writeUcs2BEPadded(new Uint8Array(8), 0, 4, "abc"), RangeError);
    assert.throws(() => writeUcs2BEPadded(new Uint8Array(4), 2, 4, "a"), RangeError);
  });
});

describe("dates", () => {
  const date = new Date(Date.UTC(2026, 9, 17, 8, 5, 9, 470));

  test("volume date: 16 ASCII digits plus GMT offset (8.4.26.1)", () => {
    const buf = new Uint8Array(17);
    writeVolumeDate(buf, 0, date);
    assert.equal(Buffer.from(buf.subarray(0, 16)).toString("ascii"), "2026101708050947");
    assert.equal(buf[16], 0);
  });

  test("volume date: null means not specified", () => {
    const buf = new Uint8Array(17).fill(0xff);
    writeVolumeDate(buf, 0, null);
    assert.equal(Buffer.from(buf.subarray(0, 16)).toString("ascii"), "0000000000000000");
    assert.equal(buf[16], 0);
  });

  test("record date: 7 binary bytes, years since 1900 (9.1.5)", () => {
    assert.equal(hex(7, (b) => writeRecordDate(b, 0, date)), "7e0a1108050900");
  });

  test("dates are written in UTC whatever the local time zone", () => {
    // Same instant expressed with an explicit offset.
    const sameInstant = new Date("2026-10-17T10:05:09.470+02:00");
    assert.equal(
      hex(7, (b) => writeRecordDate(b, 0, sameInstant)),
      hex(7, (b) => writeRecordDate(b, 0, date)),
    );
  });

  test("rejects invalid and out-of-range dates", () => {
    const buf = new Uint8Array(17);
    assert.throws(() => writeVolumeDate(buf, 0, new Date(Number.NaN)), RangeError);
    assert.throws(() => writeRecordDate(buf, 0, new Date(Number.NaN)), RangeError);
    assert.throws(() => writeRecordDate(buf, 0, new Date(Date.UTC(1899, 11, 31))), RangeError);
    assert.throws(() => writeRecordDate(buf, 0, new Date(Date.UTC(2156, 0, 1))), RangeError);
    assert.doesNotThrow(() => writeRecordDate(buf, 0, new Date(Date.UTC(2155, 11, 31))));
  });

  test("rejects writes past the end of the buffer", () => {
    assert.throws(() => writeVolumeDate(new Uint8Array(16), 0, null), RangeError);
    assert.throws(() => writeRecordDate(new Uint8Array(7), 1, date), RangeError);
  });
});
