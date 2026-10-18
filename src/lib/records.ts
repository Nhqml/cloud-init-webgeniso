// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Directory records (ECMA-119 9.1), shared by the primary (Rock Ridge) and the
// Joliet directory trees.

import {
  writeRecordDate,
  writeU16Both,
  writeU32Both,
  writeU8,
} from "./encode.ts";

/** File identifier of a directory's "." record (9.1.11). */
export const DOT = new Uint8Array([0x00]);

/** File identifier of a directory's ".." record (9.1.11). */
export const DOTDOT = new Uint8Array([0x01]);

/** File flags bit 1 (9.1.6): the record describes a directory. */
const FLAG_DIRECTORY = 0x02;

/** Size of the fixed fields before the file identifier (9.1, bytes 0-32). */
const FIXED_FIELDS_LENGTH = 33;

export interface DirectoryRecordFields {
  /** Logical block where the file or directory data starts. */
  extent: number;
  /** Size of the file or directory data, in bytes. */
  dataLength: number;
  /** Recording date and time. */
  date: Date;
  /** Whether the record describes a directory. */
  directory: boolean;
  /** File identifier, already encoded (ASCII or UCS-2 big-endian). */
  identifier: Uint8Array;
  /** System Use field, e.g. Rock Ridge entries. */
  systemUse?: Uint8Array;
}

/**
 * Builds one directory record. The record is padded to an even length, and
 * throws if it would exceed the 255 bytes its length field can express.
 */
export function directoryRecord(fields: DirectoryRecordFields): Uint8Array {
  const { identifier, systemUse = new Uint8Array() } = fields;
  if (identifier.length === 0) {
    throw new RangeError("directory record identifier must not be empty");
  }

  // Fixed fields, the identifier, then one padding byte if the identifier
  // length is even (9.1.12), so the System Use field starts at an even offset.
  const systemUseOffset =
    FIXED_FIELDS_LENGTH + identifier.length + (identifier.length % 2 === 0 ? 1 : 0);
  const unpadded = systemUseOffset + systemUse.length;
  const length = unpadded + (unpadded % 2);
  if (length > 0xff) {
    throw new RangeError(`directory record too long: ${length} bytes`);
  }

  const record = new Uint8Array(length);
  writeU8(record, 0, length);
  writeU8(record, 1, 0); // Extended attribute record length.
  writeU32Both(record, 2, fields.extent);
  writeU32Both(record, 10, fields.dataLength);
  writeRecordDate(record, 18, fields.date);
  writeU8(record, 25, fields.directory ? FLAG_DIRECTORY : 0);
  writeU8(record, 26, 0); // File unit size: not interleaved.
  writeU8(record, 27, 0); // Interleave gap size.
  writeU16Both(record, 28, 1); // Volume sequence number.
  writeU8(record, 32, identifier.length);
  record.set(identifier, FIXED_FIELDS_LENGTH);
  record.set(systemUse, systemUseOffset);
  return record;
}
