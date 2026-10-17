// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Volume descriptors (ECMA-119 8): the Primary Volume Descriptor, the Joliet
// Supplementary Volume Descriptor and the Volume Descriptor Set Terminator.
// Each one fills exactly one sector, starting at logical sector 16.

import {
  SECTOR_SIZE,
  writeAscii,
  writePaddedAscii,
  writeU16Both,
  writeU32BE,
  writeU32Both,
  writeU32LE,
  writeU8,
  writeUcs2BEPadded,
  writeVolumeDate,
} from "./encode.ts";
import { ROOT_PATH_TABLE_SIZE } from "./pathtable.ts";

/** Fields shared by the primary and the Joliet volume descriptors. */
export interface VolumeDescriptorFields {
  /** Volume identifier (label), written as given: "cidata". */
  volumeId: string;
  /** Total size of the image, in logical blocks. */
  volumeSpaceSize: number;
  /** Logical block of this tree's type L (little-endian) path table. */
  lPathTableExtent: number;
  /** Logical block of this tree's type M (big-endian) path table. */
  mPathTableExtent: number;
  /** 34-byte directory record of this tree's root directory. */
  rootDirectoryRecord: Uint8Array;
  /** Creation, modification and effective date. */
  date: Date;
}

const TYPE_PRIMARY = 1;
const TYPE_SUPPLEMENTARY = 2;
const TYPE_TERMINATOR = 255;

/** Joliet escape sequence for UCS-2 Level 3 (all UCS-2 characters allowed). */
const JOLIET_LEVEL_3_ESCAPE = "%/E";

/** Size of a root directory record with no System Use field: 33 + ".". */
const ROOT_DIRECTORY_RECORD_LENGTH = 34;

/** Writes `value` into a fixed-length text field, padding the rest. */
type TextFieldWriter = (
  buf: Uint8Array,
  offset: number,
  length: number,
  value: string,
) => void;

/**
 * Builds the layout shared by the primary and supplementary descriptors
 * (8.4 and 8.5). `writeText` encodes the text fields: ASCII for the primary
 * descriptor, UCS-2 for Joliet. Fields not written here stay zero.
 */
function volumeDescriptor(
  type: number,
  fields: VolumeDescriptorFields,
  writeText: TextFieldWriter,
): Uint8Array {
  if (fields.rootDirectoryRecord.length !== ROOT_DIRECTORY_RECORD_LENGTH) {
    throw new RangeError(
      `root directory record must be ${ROOT_DIRECTORY_RECORD_LENGTH} bytes, ` +
      `got ${fields.rootDirectoryRecord.length}`,
    );
  }

  const descriptor = new Uint8Array(SECTOR_SIZE);
  writeHeader(descriptor, type);
  writeText(descriptor, 8, 32, ""); // System identifier.
  writeText(descriptor, 40, 32, fields.volumeId);
  writeU32Both(descriptor, 80, fields.volumeSpaceSize);
  writeU16Both(descriptor, 120, 1); // Volume set size.
  writeU16Both(descriptor, 124, 1); // Volume sequence number.
  writeU16Both(descriptor, 128, SECTOR_SIZE); // Logical block size.
  writeU32Both(descriptor, 132, ROOT_PATH_TABLE_SIZE);
  writeU32LE(descriptor, 140, fields.lPathTableExtent);
  writeU32BE(descriptor, 148, fields.mPathTableExtent);
  descriptor.set(fields.rootDirectoryRecord, 156);
  writeText(descriptor, 190, 128, ""); // Volume set identifier.
  writeText(descriptor, 318, 128, ""); // Publisher identifier.
  writeText(descriptor, 446, 128, ""); // Data preparer identifier.
  writeText(descriptor, 574, 128, ""); // Application identifier.
  writeText(descriptor, 702, 37, ""); // Copyright file identifier.
  writeText(descriptor, 739, 37, ""); // Abstract file identifier.
  writeText(descriptor, 776, 37, ""); // Bibliographic file identifier.
  writeVolumeDate(descriptor, 813, fields.date); // Creation.
  writeVolumeDate(descriptor, 830, fields.date); // Modification.
  writeVolumeDate(descriptor, 847, null); // Expiration: never.
  writeVolumeDate(descriptor, 864, fields.date); // Effective.
  writeU8(descriptor, 881, 1); // File structure version.
  return descriptor;
}

/** Writes the type, "CD001" and version 1 that start every descriptor (8.1). */
function writeHeader(descriptor: Uint8Array, type: number): void {
  writeU8(descriptor, 0, type);
  writeAscii(descriptor, 1, "CD001");
  writeU8(descriptor, 6, 1);
}

/**
 * Joliet text field: UCS-2 big-endian padded with UCS-2 spaces. Fields with
 * an odd length (the 37-byte file identifiers) end with one zero byte.
 */
function writeJolietText(
  buf: Uint8Array,
  offset: number,
  length: number,
  value: string,
): void {
  writeUcs2BEPadded(buf, offset, length - (length % 2), value);
}

/** Builds the Primary Volume Descriptor (8.4). */
export function primaryVolumeDescriptor(fields: VolumeDescriptorFields): Uint8Array {
  return volumeDescriptor(TYPE_PRIMARY, fields, writePaddedAscii);
}

/**
 * Builds the Joliet Supplementary Volume Descriptor (8.5): same layout as the
 * primary one, text fields in UCS-2 big-endian, escape sequence "%/E".
 */
export function jolietVolumeDescriptor(fields: VolumeDescriptorFields): Uint8Array {
  const descriptor = volumeDescriptor(TYPE_SUPPLEMENTARY, fields, writeJolietText);
  writeAscii(descriptor, 88, JOLIET_LEVEL_3_ESCAPE);
  return descriptor;
}

/** Builds the Volume Descriptor Set Terminator (8.3). */
export function terminatorVolumeDescriptor(): Uint8Array {
  const descriptor = new Uint8Array(SECTOR_SIZE);
  writeHeader(descriptor, TYPE_TERMINATOR);
  return descriptor;
}
