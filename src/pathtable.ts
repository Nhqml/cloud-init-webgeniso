// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Path tables (ECMA-119 9.4). A path table lists every directory of a tree
// so readers can find one without walking the hierarchy. Our trees only
// contain the root directory, so each table holds a single record.

import {
  writeU16BE,
  writeU16LE,
  writeU32BE,
  writeU32LE,
  writeU8,
} from "./encode.ts";
import { DOT } from "./records.ts";

/**
 * Byte order of a path table: "L" (little-endian, 6.9.1) or "M"
 * (big-endian, 6.9.2). Each tree needs one of each.
 */
export type PathTableType = "L" | "M";

/** Directories are numbered from 1 in path table order; the root comes first. */
const ROOT_DIRECTORY_NUMBER = 1;

/** Size in bytes of a path table holding only the root directory. */
export const ROOT_PATH_TABLE_SIZE = 10;

/** Builds a path table holding only the root directory, at `rootExtent`. */
export function rootPathTable(rootExtent: number, type: PathTableType): Uint8Array {
  const writeU16 = type === "L" ? writeU16LE : writeU16BE;
  const writeU32 = type === "L" ? writeU32LE : writeU32BE;

  const table = new Uint8Array(ROOT_PATH_TABLE_SIZE);
  writeU8(table, 0, DOT.length); // Length of directory identifier.
  writeU8(table, 1, 0); // Extended attribute record length.
  writeU32(table, 2, rootExtent);
  writeU16(table, 6, ROOT_DIRECTORY_NUMBER); // The root is its own parent.
  table.set(DOT, 8);
  // Byte 9 is padding, since the identifier length is odd. Left zero.
  return table;
}
