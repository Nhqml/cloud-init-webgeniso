// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// Page logic, kept free of the DOM so it can be unit-tested: turning the
// form's fields into seed files.

import type { FileContent } from "../lib/iso.ts";

/** Default instance-id, the same as cloud-localds'. */
export const DEFAULT_INSTANCE_ID = "iid-local01";

/** C0 control characters (line breaks included) and DELincluded. */
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * The user-data headers documented at docs.cloud-init.io, compared with the
 * lowercased content. cloud-init accepts a few more, undocumented ones, and
 * also gzip and MIME user-data; the app doesn't check those advanced uses.
 */
const USER_DATA_HEADERS = [
  "#cloud-config",
  "#cloud-config-archive",
  "#!",
  "#cloud-boothook",
  "#include",
  "## template: jinja",
];

/** The meta-data form's fields. An empty hostname means none. */
export interface MetaDataFields {
  instanceId: string;
  hostname: string;
}

/** Why `value` isn't a usable instance-id, or null if it is. */
export function instanceIdError(value: string): string | null {
  if (value.trim() === "") return "An instance-id is required.";
  if (CONTROL_CHARACTERS.test(value)) {
    return "The instance-id can't contain line breaks or other control characters.";
  }
  return null;
}

/**
 * Why `value` isn't a valid host name (RFC 1123), or null if it is. An empty
 * value is valid: the hostname is optional.
 */
export function hostnameError(value: string): string | null {
  if (value === "") return null;
  if (value.length > 253) return "A host name is at most 253 characters long.";
  for (const label of value.split(".")) {
    if (label === "") {
      return "A host name can't have empty labels: no dot at the start or end, nor two in a row.";
    }
    if (label.length > 63) {
      return "Each part of a host name between dots is at most 63 characters long.";
    }
    if (!/^[A-Za-z0-9-]+$/.test(label)) {
      return "A host name can only contain letters, digits, hyphens and dots.";
    }
    if (label.startsWith("-") || label.endsWith("-")) {
      return "A part of a host name can't start or end with a hyphen.";
    }
  }
  return null;
}

/**
 * The meta-data file for `fields`, as YAML. Throws a RangeError if a field
 * is invalid; check them with instanceIdError and hostnameError first.
 */
export function metaData(fields: MetaDataFields): string {
  const error = instanceIdError(fields.instanceId) ?? hostnameError(fields.hostname);
  if (error !== null) throw new RangeError(error);

  let yaml = `instance-id: ${yamlString(fields.instanceId)}\n`;
  if (fields.hostname !== "") yaml += `local-hostname: ${yamlString(fields.hostname)}\n`;
  return yaml;
}

/**
 * `value` as a YAML double-quoted string, always: no value is ever read as a
 * number, boolean or null. YAML's double-quoted style accepts JSON string
 * escapes, so JSON.stringify does the quoting.
 */
function yamlString(value: string): string {
  return JSON.stringify(value);
}

/**
 * A warning when `userData` doesn't start with a documented header, or null
 * if it does or is empty. Like cloud-init, ignores case and leading
 * whitespace.
 */
export function userDataWarning(userData: FileContent): string | null {
  const text = typeof userData === "string" ? userData : new TextDecoder().decode(userData);
  const content = text.trimStart().toLowerCase();
  if (content === "" || USER_DATA_HEADERS.some((header) => content.startsWith(header))) {
    return null;
  }
  return (
    "This app doesn't recognize this user-data: it doesn't start with a header such as " +
    "#cloud-config (configuration) or #! (a script). cloud-init may ignore it; continue " +
    "only if you know what you're doing."
  );
}
