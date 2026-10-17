// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { encodeUcs2BE } from "../../src/encode.ts";
import {
  DOT,
  DOTDOT,
  type DirectoryRecordFields,
  directoryRecord,
} from "../../src/records.ts";
import {
  MODE_FILE,
  RR_PX,
  RR_TF,
  pxEntry,
  rrEntry,
} from "../../src/rockridge.ts";
import { DATE, DATE_RECORD_HEX, asciiBytes, toHex } from "../support/bytes.ts";

/** A regular file record; tests override only the fields they care about. */
function recordWithDefaults(overrides: Partial<DirectoryRecordFields> = {}): Uint8Array {
  return directoryRecord({
    extent: 0x1c,
    dataLength: 42,
    date: DATE,
    directory: false,
    identifier: asciiBytes("USER_DAT.;1"),
    ...overrides,
  });
}

describe("special identifiers (9.1.11)", () => {
  test('"." is the byte 0x00 and ".." the byte 0x01', () => {
    assert.equal(toHex(DOT), "00");
    assert.equal(toHex(DOTDOT), "01");
  });
});

describe("directoryRecord (9.1)", () => {
  test("lays out every field of a file record", () => {
    assert.equal(
      toHex(recordWithDefaults()),
      "2c" + // Length of directory record: 33 + 11.
        "00" + // Extended attribute record length.
        "1c0000000000001c" + // Location of extent, both-byte order.
        "2a0000000000002a" + // Data length, both-byte order.
        DATE_RECORD_HEX + // Recording date and time.
        "00" + // File flags: regular file.
        "00" + // File unit size: not interleaved.
        "00" + // Interleave gap size.
        "01000001" + // Volume sequence number 1, both-byte order.
        "0b" + // Length of file identifier.
        toHex(asciiBytes("USER_DAT.;1")),
    );
  });

  test("sets the directory flag (9.1.6, bit 1)", () => {
    const record = directoryRecord({
      extent: 23,
      dataLength: 2048,
      date: DATE,
      directory: true,
      identifier: DOT,
    });
    assert.equal(record.length, 34);
    assert.equal(record[25], 0x02);
  });

  test("adds a padding byte after an even-length identifier (9.1.12)", () => {
    // The Joliet name "a" is 2 bytes in UCS-2.
    const identifier = encodeUcs2BE("a");
    const record = recordWithDefaults({ identifier });
    assert.equal(record.length, 36);
    assert.equal(record[0], 36);
    assert.equal(toHex(record.subarray(32)), "02" + toHex(identifier) + "00");
  });

  test("appends the System Use field after the identifier and padding (9.1.13)", () => {
    // A 36-byte PX entry, so no extra padding is needed at the end.
    const systemUse = pxEntry({ mode: MODE_FILE, links: 1, uid: 0, gid: 0 });
    const record = recordWithDefaults({ identifier: encodeUcs2BE("a"), systemUse });
    assert.equal(record.length, 36 + 36);
    assert.equal(record[0], 72);
    assert.equal(toHex(record.subarray(36)), toHex(systemUse));
  });

  test("pads the whole record to an even length", () => {
    // 33 + 1 (".") + 5-byte RR entry = 39, padded to 40.
    const systemUse = rrEntry(RR_PX | RR_TF);
    const record = directoryRecord({
      extent: 23,
      dataLength: 2048,
      date: DATE,
      directory: true,
      identifier: DOT,
      systemUse,
    });
    assert.equal(record.length, 40);
    assert.equal(record[0], 40);
    assert.equal(toHex(record.subarray(34, 39)), toHex(systemUse));
    assert.equal(record[39], 0);
  });

  test("every record has an even length", () => {
    for (let idLength = 1; idLength <= 12; idLength++) {
      for (let suLength = 0; suLength <= 5; suLength++) {
        const record = recordWithDefaults({
          identifier: asciiBytes("A".repeat(idLength)),
          systemUse: new Uint8Array(suLength),
        });
        assert.equal(record.length % 2, 0, `id ${idLength}, system use ${suLength}`);
        assert.equal(record[0], record.length);
      }
    }
  });

  test("accepts the longest possible record: 254 bytes (255 isn't even)", () => {
    // 33 + 1 + 220 = 254.
    const record = recordWithDefaults({ identifier: DOT, systemUse: new Uint8Array(220) });
    assert.equal(record.length, 254);
  });

  test("rejects records longer than 255 bytes", () => {
    // 33 + 1 + 222 = 256.
    assert.throws(
      () => recordWithDefaults({ identifier: DOT, systemUse: new Uint8Array(222) }),
      RangeError,
    );
    // 33 + 1 + 221 = 255, padded to 256: also too long.
    assert.throws(
      () => recordWithDefaults({ identifier: DOT, systemUse: new Uint8Array(221) }),
      RangeError,
    );
  });

  test("rejects an empty identifier", () => {
    assert.throws(() => recordWithDefaults({ identifier: asciiBytes("") }), RangeError);
  });

  test("rejects extents and sizes that don't fit 32 bits", () => {
    assert.throws(() => recordWithDefaults({ extent: 2 ** 32 }), RangeError);
    assert.throws(() => recordWithDefaults({ dataLength: -1 }), RangeError);
  });

  test("returns a fresh buffer each call", () => {
    const first = recordWithDefaults();
    first[0] = 0xff;
    assert.equal(recordWithDefaults()[0], 0x2c);
  });
});
