// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_INSTANCE_ID,
  hostnameError,
  instanceIdError,
  metaData,
  userDataWarning,
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

describe("userDataWarning", () => {
  const warned = /^This app doesn't recognize.*cloud-init may ignore.*know what you're doing/s;

  test("accepts the headers documented by cloud-init", () => {
    const headers = [
      "#cloud-config",
      "#cloud-config-archive",
      "#!/bin/sh",
      "#cloud-boothook",
      "#include",
      "## template: jinja",
    ];
    for (const header of headers) {
      assert.equal(userDataWarning(`${header}\nrest\n`), null, header);
    }
  });

  test("ignores case and leading whitespace, like cloud-init", () => {
    assert.equal(userDataWarning("#Cloud-Config\n"), null);
    assert.equal(userDataWarning("\n\n  \t#cloud-config\n"), null);
  });

  test("accepts empty user-data", () => {
    assert.equal(userDataWarning(""), null);
    assert.equal(userDataWarning(" \n\t\n"), null);
  });

  test("warns about content without a recognized header", () => {
    // "# cloud-config" (with a space) is a common typo.
    for (const content of ["hostname: vm01\n", "# cloud-config\n", "cloud-config\n", "#"]) {
      const warning = userDataWarning(content);
      assert.match(warning ?? "", warned, JSON.stringify(content));
      assert.match(warning ?? "", /#cloud-config/);
    }
  });

  test("warns about headers cloud-init accepts but doesn't document", () => {
    // #include-once and #cloud-config-jsonp aren't documented either, but
    // they start with documented headers, so they're accepted: cloud-init
    // processes them.
    const headers = [
      "#part-handler",
      "text/x-shellscript-per-boot",
      "text/x-shellscript-per-instance",
      "text/x-shellscript-per-once",
    ];
    for (const header of headers) {
      assert.match(userDataWarning(`${header}\nrest\n`) ?? "", warned, header);
    }
  });

  test("warns about MIME and gzip user-data: advanced uses the app doesn't check", () => {
    const mime = 'Content-Type: multipart/mixed; boundary="X"\nMIME-Version: 1.0\n\n--X\n';
    assert.match(userDataWarning(mime) ?? "", warned);
    assert.match(userDataWarning(new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff])) ?? "", warned);
  });

  test("reads bytes the same as text", () => {
    assert.equal(userDataWarning(new TextEncoder().encode("#cloud-config\n")), null);
    assert.match(userDataWarning(new TextEncoder().encode("hostname: x\n")) ?? "", warned);
  });
});
