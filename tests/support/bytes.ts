// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Byte helpers and fixtures shared by the unit tests.

/** Lowercase hex of `bytes`, e.g. "4344303031". */
export const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");

/** The ASCII bytes of `value`. */
export const asciiBytes = (value: string): Uint8Array =>
  new Uint8Array(Buffer.from(value, "ascii"));

/** Hex of the ASCII bytes of `value`, to build expected byte strings. */
export const asciiHex = (value: string): string => toHex(asciiBytes(value));

/** A fixed date for tests: 2026-10-17T08:05:09Z. */
export const DATE = new Date(Date.UTC(2026, 9, 17, 8, 5, 9));

/**
 * DATE as a 7-byte directory record date (ECMA-119 9.1.5): years since
 * 1900, month, day, hour, minute, second, GMT offset.
 */
export const DATE_RECORD_HEX = "7e0a1108050900";
