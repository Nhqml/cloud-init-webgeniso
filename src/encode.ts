// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Low-level field encoders for ISO 9660 (ECMA-119) and Joliet.
//
// Every writer stores its value into `buf` at byte offset `offset` and
// returns nothing. Values that don't fit their field throw instead of being
// truncated, so a bug can never produce a silently corrupt image.
// Section numbers refer to ECMA-119 4th edition (2019).

// --- Helpers ---------------------------------------------------------------

function assertUint(value: number, max: number, what: string): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new RangeError(`${what} out of range: ${value}`);
  }
}

/** Throws unless `size` bytes starting at `offset` lie inside `buf`. */
function assertFits(buf: Uint8Array, offset: number, size: number): void {
  if (!Number.isInteger(offset) || offset < 0 || offset + size > buf.length) {
    throw new RangeError(
      `write of ${size} byte(s) at offset ${offset} overflows ${buf.length}-byte buffer`,
    );
  }
}

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("invalid date");
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

// ---------------------------------------------------------------------------

/** Logical sector (and logical block) size used throughout the image. */
export const SECTOR_SIZE = 2048;

/** Number of sectors needed to hold `bytes` bytes. */
export function sectorsFor(bytes: number): number {
  assertUint(bytes, 2 ** 53 - 1, "byte count");
  return Math.ceil(bytes / SECTOR_SIZE);
}

// --- Numbers (7.2, 7.3) ----------------------------------------------------

/** 8-bit unsigned (7.1.1). */
export function writeU8(buf: Uint8Array, offset: number, value: number): void {
  assertUint(value, 0xff, "u8");
  assertFits(buf, offset, 1);
  buf[offset] = value;
}

/** 8-bit signed, two's complement (7.1.2). */
export function writeI8(buf: Uint8Array, offset: number, value: number): void {
  if (!Number.isInteger(value) || value < -128 || value > 127) {
    throw new RangeError(`i8 out of range: ${value}`);
  }
  assertFits(buf, offset, 1);
  buf[offset] = value & 0xff;
}

/** 16-bit little-endian (7.2.1). */
export function writeU16LE(buf: Uint8Array, offset: number, value: number): void {
  assertUint(value, 0xffff, "u16");
  assertFits(buf, offset, 2);
  buf[offset] = value & 0xff;
  buf[offset + 1] = value >>> 8;
}

/** 16-bit big-endian (7.2.2). */
export function writeU16BE(buf: Uint8Array, offset: number, value: number): void {
  assertUint(value, 0xffff, "u16");
  assertFits(buf, offset, 2);
  buf[offset] = value >>> 8;
  buf[offset + 1] = value & 0xff;
}

/** 16-bit both-byte order: 4 bytes, little-endian then big-endian (7.2.3). */
export function writeU16Both(buf: Uint8Array, offset: number, value: number): void {
  writeU16LE(buf, offset, value);
  writeU16BE(buf, offset + 2, value);
}

/** 32-bit little-endian (7.3.1). */
export function writeU32LE(buf: Uint8Array, offset: number, value: number): void {
  assertUint(value, 0xffffffff, "u32");
  assertFits(buf, offset, 4);
  buf[offset] = value & 0xff;
  buf[offset + 1] = (value >>> 8) & 0xff;
  buf[offset + 2] = (value >>> 16) & 0xff;
  buf[offset + 3] = value >>> 24;
}

/** 32-bit big-endian (7.3.2). */
export function writeU32BE(buf: Uint8Array, offset: number, value: number): void {
  assertUint(value, 0xffffffff, "u32");
  assertFits(buf, offset, 4);
  buf[offset] = value >>> 24;
  buf[offset + 1] = (value >>> 16) & 0xff;
  buf[offset + 2] = (value >>> 8) & 0xff;
  buf[offset + 3] = value & 0xff;
}

/** 32-bit both-byte order: 8 bytes, little-endian then big-endian (7.3.3). */
export function writeU32Both(buf: Uint8Array, offset: number, value: number): void {
  writeU32LE(buf, offset, value);
  writeU32BE(buf, offset + 4, value);
}

// --- Strings ---------------------------------------------------------------

/**
 * Writes raw ASCII bytes with no padding and no character-set check, for
 * fixed identifiers such as "CD001" or file identifiers like "USER_DAT.;1".
 */
export function writeAscii(buf: Uint8Array, offset: number, value: string): void {
  assertFits(buf, offset, value.length);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code > 0x7f) {
      throw new RangeError(`non-ASCII character in ${JSON.stringify(value)}`);
    }
    buf[offset + i] = code;
  }
}

function writePaddedAscii(
  buf: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  if (value.length > length) {
    throw new RangeError(
      `string longer than its ${length}-byte field: ${JSON.stringify(value)}`,
    );
  }
  assertFits(buf, offset, length);
  writeAscii(buf, offset, value);
  buf.fill(0x20, offset + value.length, offset + length);
}

// --- Character strings (7.4, 8.4) ------------------------------------------

/** d-characters (7.4.1): upper-case letters, digits and underscore. */
const D_CHARACTERS = /^[A-Z0-9_]*$/;

/** a-characters (7.4.1): d-characters plus space and some punctuation. */
const A_CHARACTERS = /^[A-Z0-9_ !"%&'()*+,\-./:;<=>?]*$/;

/**
 * Writes `value` into a fixed-length field of `length` bytes, padded with
 * spaces (0x20), after checking it uses only d-characters.
 */
export function writeDString(
  buf: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  if (!D_CHARACTERS.test(value)) {
    throw new RangeError(`not a d-character string: ${JSON.stringify(value)}`);
  }
  writePaddedAscii(buf, offset, length, value);
}

/**
 * Writes `value` into a fixed-length field of `length` bytes, padded with
 * spaces (0x20), after checking it uses only a-characters.
 */
export function writeAString(
  buf: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  if (!A_CHARACTERS.test(value)) {
    throw new RangeError(`not an a-character string: ${JSON.stringify(value)}`);
  }
  writePaddedAscii(buf, offset, length, value);
}

// --- Joliet (UCS-2 big-endian) ---------------------------------------------

/**
 * Encodes `value` as UCS-2 big-endian, as Joliet requires. Characters outside
 * the Basic Multilingual Plane can't be represented in UCS-2 and throw.
 */
export function encodeUcs2BE(value: string): Uint8Array {
  const out = new Uint8Array(value.length * 2);
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdfff) {
      throw new RangeError(`character outside UCS-2 in ${JSON.stringify(value)}`);
    }
    out[i * 2] = code >>> 8;
    out[i * 2 + 1] = code & 0xff;
  }
  return out;
}

/**
 * Writes `value` as UCS-2 big-endian into a fixed-length field of `length`
 * bytes, padded with UCS-2 spaces (0x00 0x20). Used for the Joliet
 * Supplementary Volume Descriptor's text fields.
 */
export function writeUcs2BEPadded(
  buf: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  if (length % 2 !== 0) {
    throw new RangeError(`UCS-2 field length must be even: ${length}`);
  }
  const encoded = encodeUcs2BE(value);
  if (encoded.length > length) {
    throw new RangeError(
      `string longer than its ${length}-byte field: ${JSON.stringify(value)}`,
    );
  }
  assertFits(buf, offset, length);
  buf.set(encoded, offset);
  for (let i = offset + encoded.length; i < offset + length; i += 2) {
    buf[i] = 0x00;
    buf[i + 1] = 0x20;
  }
}

// --- Dates (8.4.26.1, 9.1.5) -----------------------------------------------
// All dates are written in UTC (GMT offset 0) so the output doesn't depend
// on the time zone of the machine building the image.

/**
 * Writes a 17-byte volume descriptor date (8.4.26.1): "YYYYMMDDHHMMSScc" as
 * ASCII digits, then a signed GMT offset in 15-minute units. `null` writes
 * the "not specified" form: sixteen "0" digits and a zero offset.
 */
export function writeVolumeDate(
  buf: Uint8Array,
  offset: number,
  date: Date | null,
): void {
  assertFits(buf, offset, 17);
  if (date === null) {
    writeAscii(buf, offset, "0000000000000000");
    buf[offset + 16] = 0;
    return;
  }
  assertValidDate(date);
  const year = date.getUTCFullYear();
  if (year < 1 || year > 9999) {
    throw new RangeError(`year out of range for a volume date: ${year}`);
  }
  const digits =
    pad(year, 4) +
    pad(date.getUTCMonth() + 1, 2) +
    pad(date.getUTCDate(), 2) +
    pad(date.getUTCHours(), 2) +
    pad(date.getUTCMinutes(), 2) +
    pad(date.getUTCSeconds(), 2) +
    pad(Math.floor(date.getUTCMilliseconds() / 10), 2);
  writeAscii(buf, offset, digits);
  buf[offset + 16] = 0;
}

/**
 * Writes a 7-byte directory record date (9.1.5): years since 1900, month,
 * day, hour, minute, second, then a signed GMT offset in 15-minute units.
 */
export function writeRecordDate(buf: Uint8Array, offset: number, date: Date): void {
  assertFits(buf, offset, 7);
  assertValidDate(date);
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 1900 + 255) {
    throw new RangeError(`year out of range for a directory record date: ${year}`);
  }
  buf[offset] = year - 1900;
  buf[offset + 1] = date.getUTCMonth() + 1;
  buf[offset + 2] = date.getUTCDate();
  buf[offset + 3] = date.getUTCHours();
  buf[offset + 4] = date.getUTCMinutes();
  buf[offset + 5] = date.getUTCSeconds();
  buf[offset + 6] = 0;
}
