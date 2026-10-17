# cloud-init-webgeniso

TypeScript library (and later a static web page) that builds cloud-init
NoCloud seed ISO images in the browser. Output must match what this command
produces, structurally:

```sh
genisoimage -output seed.img -volid cidata -rational-rock -joliet user-data meta-data [network-config] [vendor-data]
```

Scope is deliberately narrow: flat root directory, only the files `user-data`,
`meta-data`, `network-config`, `vendor-data`, volume label `cidata`, Rock Ridge
and Joliet. No subdirectories, boot images or large files. Don't add general
ISO features unless asked.

## Rules

- Every source file (`.ts`, `.js`, `.mjs`, `.cjs`, `.py`) must start with
  exactly:

  ```ts
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 Kenji Gaillac
  ```

  with `#` instead of `//` in Python files. A shebang and blank lines may
  come before it, but the two lines must be consecutive.
  `pnpm check:headers` enforces this.
- The project is AGPL-3.0-or-later. Don't copy code from projects with
  incompatible licenses (GPLv2-only, proprietary, unlicensed snippets).
  Implement from the specs (ECMA-119, SUSP/RRIP, Joliet) instead.
- No runtime dependencies. Library code in `src/` must run in browsers, Node
  and workers: use only web-standard APIs (`Uint8Array`, `DataView`,
  `TextEncoder`), no `node:*` imports. The build config sets `types: []` to
  catch this.
- Output must be deterministic: same inputs and same date give identical bytes.
- Test-driven development for everything in `src/`. Each cycle:
  1. Write the tests.
  2. Write the structure they need: module, exports, types, constants and
     function signatures, with bodies that only
     `throw new Error("not implemented")`. Typecheck must pass.
  3. Run the tests and watch them fail on the stubs, not on missing modules.
  4. Only then write the function or method bodies.

  This also applies to changes to existing functions (add or change the test
  first) and to exporting a previously private function. Code inside
  `tests/` is exempt: the tests that use it validate it.

## Format decisions

Copy genisoimage's behaviour for `-volid cidata -rational-rock -joliet`:

- Volume identifier is written as given, lowercase `cidata`, in both the
  Primary and the Joliet volume descriptors (not strict d-characters, but
  what genisoimage does and what cloud-init expects).
- Primary-tree file names use genisoimage's default 8.3 mapping:
  `META_DAT.;1`, `NETWORK_.;1`, `USER_DAT.;1`, `VENDOR_D.;1`. Rock Ridge `NM`
  entries and Joliet carry the real names.
- Joliet names have no `;1` version suffix, like pycdlib-genisoimage, the
  genisoimage-compatible reference the integration tests compare against.
- Rock Ridge as `-rational-rock`: uid and gid 0, files `0444`, directories
  `0555`.

Our own choices, where matching genisoimage would make output host- or
time-dependent:

- All dates default to the Unix epoch (1970-01-01T00:00:00Z), so the same
  files always give the same image. Callers pass `date` to override.
- System, publisher, preparer and application identifiers are left blank.

## Tooling

- Tool versions are pinned in `mise.toml` (Node, pnpm, libarchive, Lima).
  Use mise for every dev tool; never rely on what the OS ships. Run commands
  inside the mise environment (`mise exec -- pnpm test`, or a shell with mise
  activated).
- Exception: Python (3.11+) and uv are expected on the host, not in
  `mise.toml`.
- Unit tests are TypeScript (`node:test`). Integration and e2e tests are
  Python `unittest` files. Each Python file meant to be run (tests and
  scripts) is an executable PEP 723 script with the shebang
  `#!/usr/bin/env -S uv run --quiet --script`, so it runs directly; its
  dependencies (e.g. pycdlib) are pinned in its inline metadata. Tests get
  images from our builder through `tests/support/build_iso.ts` (JSON on
  stdin, ISO on stdout).
- Python tests never take tools from PATH: `tool(name)` in
  `tests/support/seed.py` resolves them with `mise which`, so they use the
  versions pinned in `mise.toml` even when run outside the mise environment
  (where PATH could hold, for example, the bsdtar macOS ships).
- Integration tests read images back with `bsdtar` (libarchive, from mise)
  and pycdlib, and compare with `pycdlib-genisoimage`.
- E2E tests run Linux in a Lima VM (Lima from mise, Ubuntu LTS template)
  with its own `LIMA_HOME` (`.lima/`, gitignored) and no host mounts, so it
  never touches other Lima instances. They are not part of `pnpm test`; run
  them with `pnpm test:e2e`. `E2E_VM_TEARDOWN` chooses what happens to the
  VM afterwards: `stop` (default, keeps the disk; the tests only attach and
  mount images, so a reused VM is fine), `delete` (next run starts fresh) or
  `keep` (leaves it running, fastest re-runs). Remove the VM with
  `LIMA_HOME=.lima limactl delete --force e2e`.
- Package manager: pnpm.
- TypeScript runs directly in Node (type stripping), so source must stay
  erasable: no `enum`, `namespace` or parameter properties
  (`erasableSyntaxOnly` is on). Relative imports use the `.ts` extension.

## Commands

```sh
pnpm typecheck         # tsc --noEmit over src, tests and scripts
pnpm test              # unit + integration tests
pnpm test:unit         # node:test, tests/unit/**/*.test.ts
pnpm test:integration  # tests/integration/test_*.py (bsdtar, pycdlib)
pnpm test:e2e          # tests/e2e/test_linux_readers.py, in a Lima VM (slow)
pnpm check:headers     # license header check (scripts/check_license_headers.py)
pnpm check+test        # typecheck, headers, unit + integration tests
pnpm build             # emit dist/ (JS + .d.ts) from src/

E2E_VM_TEARDOWN=keep pnpm test:e2e  # e2e tests, leaving the VM running
```

## Layout

```
src/                library source (published as dist/)
tests/unit/         TypeScript unit tests (node:test)
tests/integration/  Python tests reading images back with bsdtar and pycdlib
tests/e2e/          Python tests on Linux in a Lima VM
tests/support/      helpers shared by the tests (build_iso.ts, seed.py)
scripts/            dev scripts (executable Python uv scripts)
```

## Git

- Commit messages: `<area>: <summary>`, lowercase summary, e.g.
  `iso9660: add path table`, `tests: rework integration tests`,
  `scripts: …`, `CLAUDE.md: …`, `treewide: …` for cross-cutting changes.
- Commit or push only when asked.
