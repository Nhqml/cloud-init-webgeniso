// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Builds a complete cloud-init NoCloud seed image: volume label "cidata",
// a flat root directory, Rock Ridge and Joliet, like
// `genisoimage -volid cidata -rational-rock -joliet`.

import { SECTOR_SIZE, encodeUcs2BE, sectorsFor, writeAscii } from "./encode.ts";
import { rootPathTable } from "./pathtable.ts";
import { DOT, DOTDOT, directoryRecord } from "./records.ts";
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
} from "./rockridge.ts";
import {
  jolietVolumeDescriptor,
  primaryVolumeDescriptor,
  terminatorVolumeDescriptor,
} from "./volume.ts";

/** Content of one seed file: text (encoded as UTF-8) or raw bytes. */
export type FileContent = string | Uint8Array;

/** The files of a NoCloud seed. `user-data` and `meta-data` are required. */
export interface SeedFiles {
  "user-data": FileContent;
  "meta-data": FileContent;
  "network-config"?: FileContent;
  "vendor-data"?: FileContent;
}

export interface SeedIsoOptions {
  /**
   * Timestamp of every file, directory and volume date. Defaults to the Unix
   * epoch, so the same files always produce the same image.
   */
  date?: Date;
}

/**
 * The seed files we support, in the order their records appear in both
 * directory trees: sorted by name, which also sorts the 8.3 names (9.3).
 */
const SEED_FILES = [
  { name: "meta-data", isoName: "META_DAT.;1", required: true },
  { name: "network-config", isoName: "NETWORK_.;1", required: false },
  { name: "user-data", isoName: "USER_DAT.;1", required: true },
  { name: "vendor-data", isoName: "VENDOR_D.;1", required: false },
] as const;

/** Volume label cloud-init's NoCloud datasource looks for. */
const VOLUME_ID = "cidata";

// Fixed sector layout. Only the file data after FIRST_FILE_LBA varies.
//
//   LBA     byte offset
//         ┌──────────────────────────────────────────┐
//    0    │ System Area: 16 sectors of zeros         │ 0x00000
//   ...   │                                          │
//   15    │                                          │
//         ├──────────────────────────────────────────┤
//   16    │ Primary Volume Descriptor ───────────────┼──┐ 0x08000
//   17    │ Joliet Supplementary Volume Descriptor ──┼──┼──┐
//   18    │ Volume Descriptor Set Terminator         │  │  │
//         ├──────────────────────────────────────────┤  │  │
//   19    │ Primary path table, type L ◄─────────────┼──┤  │
//   20    │ Primary path table, type M ◄─────────────┼──┤  │
//   21    │ Joliet path table, type L ◄──────────────┼──┼──┤
//   22    │ Joliet path table, type M ◄──────────────┼──┼──┤
//         ├──────────────────────────────────────────┤  │  │
//   23    │ Primary root directory (Rock Ridge) ◄────┼──┘  │
//         │   ".": SP RR PX TF CE ───┐               │     │
//         │   "..": RR PX TF         │               │     │
//         │   files: RR PX NM TF ────┼───────┐       │     │
//   24    │ Continuation area: ER ◄──┘       │       │     │
//   25    │ Joliet root directory ◄──────────┼───────┼─────┘
//         │   ".", "..", files (UCS-2) ──────┤       │
//         ├──────────────────────────────────┼───────┤
//   26    │ File data, sorted by name ◄──────┘       │ 0x0d000
//   ...   │ each file starts on a new sector         │
//         │ empty files have no sector (extent 0)    │
//         └──────────────────────────────────────────┘
//
// Both directory trees point to the same file data.
const PVD_LBA = 16;
const JOLIET_SVD_LBA = 17;
const TERMINATOR_LBA = 18;
const PRIMARY_L_PATH_TABLE_LBA = 19;
const PRIMARY_M_PATH_TABLE_LBA = 20;
const JOLIET_L_PATH_TABLE_LBA = 21;
const JOLIET_M_PATH_TABLE_LBA = 22;
const PRIMARY_ROOT_LBA = 23;
/** Rock Ridge continuation area holding the ER entry (too big for "."). */
const CONTINUATION_LBA = 24;
const JOLIET_ROOT_LBA = 25;
const FIRST_FILE_LBA = 26;

/** A seed file given as input: its real and 8.3 names, and its bytes. */
interface SeedFile {
  name: string;
  isoName: string;
  data: Uint8Array;
}

/** A seed file ready to be written: also knows where its data goes. */
interface PlacedFile extends SeedFile {
  /** First logical block of the data; 0 for empty files, which have none. */
  extent: number;
}

/** Builds a NoCloud seed ISO image from `files`. */
export function buildSeedIso(files: SeedFiles, options: SeedIsoOptions = {}): Uint8Array {
  const date = options.date ?? new Date(0);
  const placed = placeFiles(readSeedFiles(files));
  const volumeSpaceSize = placed.reduce(
    (end, file) => Math.max(end, file.extent + sectorsFor(file.data.length)),
    FIRST_FILE_LBA,
  );

  const image = new Uint8Array(volumeSpaceSize * SECTOR_SIZE);
  const put = (lba: number, bytes: Uint8Array): void => {
    image.set(bytes, lba * SECTOR_SIZE);
  };

  // Root directory records embedded in the volume descriptors: plain ".",
  // no System Use, so they stay 34 bytes.
  const primaryRoot = rootDirectoryRecord(PRIMARY_ROOT_LBA, date, DOT);
  const jolietRoot = rootDirectoryRecord(JOLIET_ROOT_LBA, date, DOT);
  put(
    PVD_LBA,
    primaryVolumeDescriptor({
      volumeId: VOLUME_ID,
      volumeSpaceSize,
      lPathTableExtent: PRIMARY_L_PATH_TABLE_LBA,
      mPathTableExtent: PRIMARY_M_PATH_TABLE_LBA,
      rootDirectoryRecord: primaryRoot,
      date,
    }),
  );
  put(
    JOLIET_SVD_LBA,
    jolietVolumeDescriptor({
      volumeId: VOLUME_ID,
      volumeSpaceSize,
      lPathTableExtent: JOLIET_L_PATH_TABLE_LBA,
      mPathTableExtent: JOLIET_M_PATH_TABLE_LBA,
      rootDirectoryRecord: jolietRoot,
      date,
    }),
  );
  put(TERMINATOR_LBA, terminatorVolumeDescriptor());

  put(PRIMARY_L_PATH_TABLE_LBA, rootPathTable(PRIMARY_ROOT_LBA, "L"));
  put(PRIMARY_M_PATH_TABLE_LBA, rootPathTable(PRIMARY_ROOT_LBA, "M"));
  put(JOLIET_L_PATH_TABLE_LBA, rootPathTable(JOLIET_ROOT_LBA, "L"));
  put(JOLIET_M_PATH_TABLE_LBA, rootPathTable(JOLIET_ROOT_LBA, "M"));

  const er = erEntry();
  put(PRIMARY_ROOT_LBA, primaryDirectory(placed, date, er.length));
  put(CONTINUATION_LBA, er);
  put(JOLIET_ROOT_LBA, jolietDirectory(placed, date));

  for (const file of placed) {
    if (file.data.length > 0) put(file.extent, file.data);
  }
  return image;
}

/** Validates `files` and returns the seed files present, in SEED_FILES order. */
function readSeedFiles(files: SeedFiles): SeedFile[] {
  if (typeof files !== "object" || files === null || Array.isArray(files)) {
    throw new TypeError("files must be an object mapping seed file names to contents");
  }
  const known: ReadonlySet<string> = new Set(SEED_FILES.map((file) => file.name));
  for (const key of Object.keys(files)) {
    if (!known.has(key)) {
      throw new TypeError(
        `unknown seed file ${JSON.stringify(key)}, expected one of: ${[...known].join(", ")}`,
      );
    }
  }

  const present: SeedFile[] = [];
  for (const { name, isoName, required } of SEED_FILES) {
    const content: unknown = files[name];
    if (content === undefined) {
      if (required) throw new TypeError(`missing required seed file ${JSON.stringify(name)}`);
      continue;
    }
    present.push({ name, isoName, data: toBytes(name, content) });
  }
  return present;
}

/** Encodes text as UTF-8 and passes bytes through; rejects anything else. */
function toBytes(name: string, content: unknown): Uint8Array {
  if (typeof content === "string") return new TextEncoder().encode(content);
  if (content instanceof Uint8Array) return content;
  throw new TypeError(`content of ${JSON.stringify(name)} must be a string or a Uint8Array`);
}

/** Assigns each non-empty file consecutive sectors, starting at FIRST_FILE_LBA. */
function placeFiles(files: SeedFile[]): PlacedFile[] {
  let next = FIRST_FILE_LBA;
  return files.map((file) => {
    if (file.data.length === 0) return { ...file, extent: 0 };
    const extent = next;
    next += sectorsFor(file.data.length);
    return { ...file, extent };
  });
}

/**
 * A directory record describing the root directory, whose data is the
 * one-sector directory at `extent`: its "." and ".." entries, and the copy
 * embedded in each volume descriptor.
 */
function rootDirectoryRecord(
  extent: number,
  date: Date,
  identifier: Uint8Array,
  systemUse?: Uint8Array,
): Uint8Array {
  return directoryRecord({
    extent,
    dataLength: SECTOR_SIZE,
    date,
    directory: true,
    identifier,
    ...(systemUse === undefined ? {} : { systemUse }),
  });
}

/**
 * The primary (Rock Ridge) root directory: ".", ".." and one record per
 * file, each carrying POSIX attributes, the real name and timestamps.
 * The "." record also starts SUSP (SP) and points to the ER entry (CE).
 */
function primaryDirectory(files: PlacedFile[], date: Date, erLength: number): Uint8Array {
  const directoryAttributes = { mode: MODE_DIRECTORY, links: 2, uid: 0, gid: 0 };
  const fileAttributes = { mode: MODE_FILE, links: 1, uid: 0, gid: 0 };

  return directorySector([
    rootDirectoryRecord(
      PRIMARY_ROOT_LBA,
      date,
      DOT,
      concat([
        spEntry(),
        rrEntry(RR_PX | RR_TF),
        pxEntry(directoryAttributes),
        tfEntry(date),
        ceEntry(CONTINUATION_LBA, 0, erLength),
      ]),
    ),
    rootDirectoryRecord(
      PRIMARY_ROOT_LBA,
      date,
      DOTDOT,
      concat([rrEntry(RR_PX | RR_TF), pxEntry(directoryAttributes), tfEntry(date)]),
    ),
    ...files.map((file) =>
      directoryRecord({
        extent: file.extent,
        dataLength: file.data.length,
        date,
        directory: false,
        identifier: asciiBytes(file.isoName),
        systemUse: concat([
          rrEntry(RR_PX | RR_NM | RR_TF),
          pxEntry(fileAttributes),
          nmEntry(file.name),
          tfEntry(date),
        ]),
      }),
    ),
  ]);
}

/** The Joliet root directory: ".", ".." and the files' UCS-2 names, without a ";1" version suffix. */
function jolietDirectory(files: PlacedFile[], date: Date): Uint8Array {
  return directorySector([
    rootDirectoryRecord(JOLIET_ROOT_LBA, date, DOT),
    rootDirectoryRecord(JOLIET_ROOT_LBA, date, DOTDOT),
    ...files.map((file) =>
      directoryRecord({
        extent: file.extent,
        dataLength: file.data.length,
        date,
        directory: false,
        identifier: encodeUcs2BE(file.name),
      }),
    ),
  ]);
}

/** Packs directory records into one sector; ours always fit in one. */
function directorySector(records: Uint8Array[]): Uint8Array {
  const sector = concat(records);
  if (sector.length > SECTOR_SIZE) {
    throw new RangeError(`directory doesn't fit one sector: ${sector.length} bytes`);
  }
  return sector;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  writeAscii(bytes, 0, value);
  return bytes;
}
