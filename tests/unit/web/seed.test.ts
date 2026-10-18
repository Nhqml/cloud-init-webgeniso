// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_INSTANCE_ID,
  hostnameError,
  instanceIdError,
  metaData,
} from "../../../src/web/seed.ts";

describe("DEFAULT_INSTANCE_ID", () => {
  test("is cloud-localds' default", () => {
    assert.equal(DEFAULT_INSTANCE_ID, "iid-local01");
  });
});

describe("instanceIdError", () => {
  test("accepts any single-line, non-blank value", () => {
    for (const value of ["iid-local01", "i-0123456789abcdef", "my instance", "café"]) {
      assert.equal(instanceIdError(value), null, value);
    }
  });

  test("rejects empty and blank values", () => {
    assert.match(instanceIdError("") ?? "", /required/);
    assert.match(instanceIdError("   ") ?? "", /required/);
  });

  test("rejects line breaks and other control characters", () => {
    for (const value of ["iid\nlocal", "iid\rlocal", "iid\tlocal", "iid\u0000"]) {
      assert.match(instanceIdError(value) ?? "", /control/, JSON.stringify(value));
    }
  });
});

describe("hostnameError", () => {
  test("accepts an empty hostname: it's optional", () => {
    assert.equal(hostnameError(""), null);
  });

  test("accepts RFC 1123 host names", () => {
    for (const value of ["vm01", "VM-01", "123", "vm-01.example.com", "a".repeat(63)]) {
      assert.equal(hostnameError(value), null, value);
    }
  });

  test("accepts up to 253 characters in total", () => {
    const label = "a".repeat(63);
    const name = [label, label, label, "a".repeat(61)].join("."); // 253
    assert.equal(name.length, 253);
    assert.equal(hostnameError(name), null);
    assert.match(hostnameError(`${name}a`) ?? "", /253/);
  });

  test("rejects labels over 63 characters", () => {
    assert.match(hostnameError("a".repeat(64)) ?? "", /63/);
    assert.match(hostnameError(`vm.${"a".repeat(64)}`) ?? "", /63/);
  });

  test("rejects labels starting or ending with a hyphen", () => {
    for (const value of ["-vm", "vm-", "vm.-x", "vm.x-"]) {
      assert.match(hostnameError(value) ?? "", /hyphen/, value);
    }
  });

  test("rejects characters other than letters, digits and hyphens", () => {
    for (const value of ["vm_01", "vm 01", "café", "vm!"]) {
      assert.match(hostnameError(value) ?? "", /letters, digits/, value);
    }
  });

  test("rejects empty labels", () => {
    for (const value of ["vm..x", ".vm", "vm."]) {
      assert.match(hostnameError(value) ?? "", /empty/, value);
    }
  });
});

describe("metaData", () => {
  test("writes the instance-id alone when there's no hostname", () => {
    assert.equal(
      metaData({ instanceId: "iid-local01", hostname: "" }),
      'instance-id: "iid-local01"\n',
    );
  });

  test("adds local-hostname when given", () => {
    assert.equal(
      metaData({ instanceId: "iid-local01", hostname: "vm-01.example.com" }),
      'instance-id: "iid-local01"\nlocal-hostname: "vm-01.example.com"\n',
    );
  });

  test("always writes double-quoted strings", () => {
    // Including values YAML 1.1 or 1.2 would otherwise read as numbers,
    // booleans or null.
    for (const value of ["i-0123.abc_DEF", "123", "1e3", "0x1f", "yes", "No", "on", "true", "null", "~"]) {
      assert.equal(metaData({ instanceId: value, hostname: "" }), `instance-id: "${value}"\n`, value);
    }
    assert.equal(
      metaData({ instanceId: "iid-local01", hostname: "123" }),
      'instance-id: "iid-local01"\nlocal-hostname: "123"\n',
    );
  });

  test("escapes quotes and backslashes", () => {
    const cases: [string, string][] = [
      ["my instance", '"my instance"'],
      ["a: b", '"a: b"'],
      ["#iid", '"#iid"'],
      ['say "hi"', '"say \\"hi\\""'],
      ["back\\slash", '"back\\\\slash"'],
      ["café", '"café"'],
    ];
    for (const [value, yaml] of cases) {
      assert.equal(metaData({ instanceId: value, hostname: "" }), `instance-id: ${yaml}\n`, value);
    }
  });

  test("rejects invalid fields", () => {
    assert.throws(() => metaData({ instanceId: "", hostname: "" }), RangeError);
    assert.throws(() => metaData({ instanceId: "iid\nx", hostname: "" }), RangeError);
    assert.throws(() => metaData({ instanceId: "iid-local01", hostname: "vm_01" }), RangeError);
  });
});
