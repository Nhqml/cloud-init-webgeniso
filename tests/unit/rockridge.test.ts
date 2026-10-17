// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MODE_DIRECTORY,
  MODE_FILE,
  RR_NM,
  RR_PX,
  RR_TF,
  ceEntry,
  erEntry,
  nmEntry,
  pxEntry,
  rrEntry,
  spEntry,
  tfEntry,
} from "../../src/rockridge.ts";
import { DATE, DATE_RECORD_HEX, toHex } from "../support/bytes.ts";

describe("modes for -rational-rock", () => {
  test("files are r--r--r--, directories r-xr-xr-x", () => {
    assert.equal(MODE_FILE, 0o100444);
    assert.equal(MODE_DIRECTORY, 0o040555);
  });
});

describe("SUSP entries", () => {
  // SUSP 5.3: signature, length 7, version 1, check bytes BE EF, skip 0.
  test("SP marks the start of SUSP use", () => {
    assert.equal(toHex(spEntry()), "535007" + "01" + "beef" + "00");
  });

  // SUSP 5.1: block, offset and length, each 32-bit both-byte order.
  test("CE points to a continuation area", () => {
    assert.equal(
      toHex(ceEntry(0x1a, 0, 237)),
      "43451c01" + "1a0000000000001a" + "0000000000000000" + "ed000000000000ed",
    );
  });

  // SUSP 5.5 with the RRIP 1.09 identifier, as genisoimage writes it.
  test("ER announces Rock Ridge RRIP_1991A", () => {
    const er = erEntry();
    const id = "RRIP_1991A";
    const description =
      "THE ROCK RIDGE INTERCHANGE PROTOCOL PROVIDES SUPPORT FOR POSIX FILE SYSTEM SEMANTICS";
    const source =
      "PLEASE CONTACT DISC PUBLISHER FOR SPECIFICATION SOURCE.  " +
      "SEE PUBLISHER IDENTIFIER IN PRIMARY VOLUME DESCRIPTOR FOR CONTACT INFORMATION.";

    assert.equal(er.length, 237);
    // Signature, length, version, then LEN_ID, LEN_DES, LEN_SRC, EXT_VER.
    assert.equal(toHex(er.subarray(0, 8)), "4552ed01" + "0a548701");
    assert.equal(Buffer.from(er.subarray(8)).toString("ascii"), id + description + source);
  });
});

describe("RRIP entries", () => {
  // RRIP 1.09 4.1.1 (obsolete in 1.12, still written by genisoimage).
  test("RR lists the entries present", () => {
    assert.equal(toHex(rrEntry(RR_PX | RR_NM | RR_TF)), "5252050189");
    assert.equal(toHex(rrEntry(RR_PX | RR_TF)), "5252050181");
  });

  test("RR rejects flags that don't fit a byte", () => {
    assert.throws(() => rrEntry(0x100), RangeError);
  });

  // RRIP 1.09 4.1.1: mode, links, uid, gid, each 32-bit both-byte order.
  test("PX holds POSIX attributes (36-byte RRIP 1.09 form)", () => {
    const px = pxEntry({ mode: MODE_FILE, links: 1, uid: 0, gid: 0 });
    assert.equal(
      toHex(px),
      "50582401" +
        "2481000000008124" +
        "0100000000000001" +
        "0000000000000000" +
        "0000000000000000",
    );
  });

  test("PX for a directory", () => {
    const px = pxEntry({ mode: MODE_DIRECTORY, links: 2, uid: 0, gid: 0 });
    assert.equal(toHex(px.subarray(4, 20)), "6d4100000000416d" + "0200000000000002");
  });

  // RRIP 1.09 4.1.6: flags MODIFY | ACCESS | ATTRIBUTES, 7-byte dates.
  test("TF records modification, access and attribute-change times", () => {
    assert.equal(toHex(tfEntry(DATE)), "54461a01" + "0e" + DATE_RECORD_HEX.repeat(3));
  });

  // RRIP 1.09 4.1.4: flags 0, then the name, no terminator.
  test("NM holds the real file name", () => {
    assert.equal(
      toHex(nmEntry("user-data")),
      "4e4d0e01" + "00" + Buffer.from("user-data", "ascii").toString("hex"),
    );
  });

  test("NM rejects names that don't fit one entry", () => {
    assert.throws(() => nmEntry("x".repeat(251)), RangeError);
    assert.doesNotThrow(() => nmEntry("x".repeat(250)));
  });
});
