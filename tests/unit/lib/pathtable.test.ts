// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { ROOT_PATH_TABLE_SIZE, rootPathTable } from "../../../src/lib/pathtable.ts";
import { DOT } from "../../../src/lib/records.ts";
import { toHex } from "../../support/bytes.ts";

describe("rootPathTable (9.4)", () => {
  // Our trees only have the root directory, so each path table holds a
  // single record. The root's identifier is the "." byte and its parent is
  // itself, directory number 1.
  test("type L path table uses little-endian numbers (6.9.1)", () => {
    assert.equal(
      toHex(rootPathTable(0x17, "L")),
      "01" + // Length of directory identifier.
        "00" + // Extended attribute record length.
        "17000000" + // Location of extent, little-endian.
        "0100" + // Parent directory number, little-endian.
        toHex(DOT) + // Directory identifier: the root.
        "00", // Padding: the identifier length is odd.
    );
  });

  test("type M path table uses big-endian numbers (6.9.2)", () => {
    assert.equal(
      toHex(rootPathTable(0x17, "M")),
      "01" + // Length of directory identifier.
        "00" + // Extended attribute record length.
        "00000017" + // Location of extent, big-endian.
        "0001" + // Parent directory number, big-endian.
        toHex(DOT) + // Directory identifier: the root.
        "00", // Padding: the identifier length is odd.
    );
  });

  test("handles extents over 16 bits", () => {
    assert.equal(toHex(rootPathTable(0x12345678, "L").subarray(2, 6)), "78563412");
    assert.equal(toHex(rootPathTable(0x12345678, "M").subarray(2, 6)), "12345678");
  });

  test("ROOT_PATH_TABLE_SIZE is the table's length, for the volume descriptors", () => {
    assert.equal(ROOT_PATH_TABLE_SIZE, 10);
    assert.equal(rootPathTable(0x17, "L").length, ROOT_PATH_TABLE_SIZE);
    assert.equal(rootPathTable(0x17, "M").length, ROOT_PATH_TABLE_SIZE);
  });

  test("rejects extents that don't fit 32 bits", () => {
    assert.throws(() => rootPathTable(2 ** 32, "L"), RangeError);
    assert.throws(() => rootPathTable(-1, "M"), RangeError);
  });
});
