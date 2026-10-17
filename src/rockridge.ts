// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// System Use Sharing Protocol (SUSP 1.10) and Rock Ridge (RRIP 1.09) entries,
// stored in the System Use field of directory records. Each function returns
// one complete entry: 2-byte signature, length, version 1, then its data.
// We write the RRIP 1.09 forms (36-byte PX, "RR" entry, RRIP_1991A), like
// genisoimage does.

import {
  writeAscii,
  writeRecordDate,
  writeU32Both,
  writeU8,
} from "./encode.ts";

/** POSIX mode for regular files under -rational-rock: S_IFREG | 0444. */
export const MODE_FILE = 0o100444;

/** POSIX mode for directories under -rational-rock: S_IFDIR | 0555. */
export const MODE_DIRECTORY = 0o040555;

/** "RR" entry flags (RRIP 1.09 4.1.1): which Rock Ridge entries are present. */
export const RR_PX = 0x01;
export const RR_NM = 0x08;
export const RR_TF = 0x80;

/** Allocates an entry with its 4-byte header and `dataLength` data bytes. */
function suspEntry(signature: string, dataLength: number): Uint8Array {
  const length = 4 + dataLength;
  if (length > 0xff) {
    throw new RangeError(`${signature} entry too long: ${length} bytes`);
  }
  const entry = new Uint8Array(length);
  writeAscii(entry, 0, signature);
  writeU8(entry, 2, length);
  writeU8(entry, 3, 1); // Entry version.
  return entry;
}

/** SUSP 5.3: marks the root directory's "." record as using SUSP. */
export function spEntry(): Uint8Array {
  const entry = suspEntry("SP", 3);
  entry[4] = 0xbe;
  entry[5] = 0xef;
  entry[6] = 0; // LEN_SKP: no bytes skipped before the entries.
  return entry;
}

/**
 * SUSP 5.1: continues the System Use field in `length` bytes at byte
 * `offset` of logical block `extent`.
 */
export function ceEntry(extent: number, offset: number, length: number): Uint8Array {
  const entry = suspEntry("CE", 24);
  writeU32Both(entry, 4, extent);
  writeU32Both(entry, 12, offset);
  writeU32Both(entry, 20, length);
  return entry;
}

const ER_IDENTIFIER = "RRIP_1991A";
const ER_DESCRIPTOR =
  "THE ROCK RIDGE INTERCHANGE PROTOCOL PROVIDES SUPPORT FOR POSIX FILE SYSTEM SEMANTICS";
const ER_SOURCE =
  "PLEASE CONTACT DISC PUBLISHER FOR SPECIFICATION SOURCE.  " +
  "SEE PUBLISHER IDENTIFIER IN PRIMARY VOLUME DESCRIPTOR FOR CONTACT INFORMATION.";

/** SUSP 5.5: declares that the image uses the Rock Ridge extensions. */
export function erEntry(): Uint8Array {
  const entry = suspEntry(
    "ER",
    4 + ER_IDENTIFIER.length + ER_DESCRIPTOR.length + ER_SOURCE.length,
  );
  writeU8(entry, 4, ER_IDENTIFIER.length);
  writeU8(entry, 5, ER_DESCRIPTOR.length);
  writeU8(entry, 6, ER_SOURCE.length);
  writeU8(entry, 7, 1); // Extension version.
  writeAscii(entry, 8, ER_IDENTIFIER + ER_DESCRIPTOR + ER_SOURCE);
  return entry;
}

/** RRIP 1.09 4.1.1: lists the Rock Ridge entries present in this record. */
export function rrEntry(flags: number): Uint8Array {
  const entry = suspEntry("RR", 1);
  writeU8(entry, 4, flags);
  return entry;
}

export interface PosixAttributes {
  mode: number;
  links: number;
  uid: number;
  gid: number;
}

/** RRIP 1.09 4.1.1: POSIX file attributes. */
export function pxEntry(attributes: PosixAttributes): Uint8Array {
  const entry = suspEntry("PX", 32);
  writeU32Both(entry, 4, attributes.mode);
  writeU32Both(entry, 12, attributes.links);
  writeU32Both(entry, 20, attributes.uid);
  writeU32Both(entry, 28, attributes.gid);
  return entry;
}

/** TF flags: modification, access and attribute-change times present. */
const TF_MODIFY_ACCESS_ATTRIBUTES = 0x0e;

/**
 * RRIP 1.09 4.1.6: timestamps. Modification, access and attribute-change
 * times are all set to `date`, in the 7-byte directory record format.
 */
export function tfEntry(date: Date): Uint8Array {
  const entry = suspEntry("TF", 1 + 3 * 7);
  writeU8(entry, 4, TF_MODIFY_ACCESS_ATTRIBUTES);
  for (let i = 0; i < 3; i++) writeRecordDate(entry, 5 + i * 7, date);
  return entry;
}

/** RRIP 1.09 4.1.4: the file's real (POSIX) name, in a single entry. */
export function nmEntry(name: string): Uint8Array {
  const entry = suspEntry("NM", 1 + name.length);
  entry[4] = 0; // Flags: no continuation, not "." or "..".
  writeAscii(entry, 5, name);
  return entry;
}
