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

- Every source file (`.ts`, `.js`, `.mjs`, `.cjs`, …) must start with exactly:

  ```ts
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 Kenji Gaillac
  ```

  A shebang line may come before it. `pnpm check:headers` enforces this.
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
  first) and to exporting a previously private function. Helpers inside
  `test/` are exempt: the tests that use them validate them.

## Format decisions

Copy genisoimage's behaviour for `-volid cidata -rational-rock -joliet`:

- Volume identifier is written as given, lowercase `cidata`, in both the
  Primary and the Joliet volume descriptors (not strict d-characters, but
  what genisoimage does and what cloud-init expects).
- Primary-tree file names use genisoimage's default 8.3 mapping:
  `META_DAT.;1`, `NETWORK_.;1`, `USER_DAT.;1`, `VENDOR_D.;1`. Rock Ridge `NM`
  entries and Joliet carry the real names.
- Rock Ridge as `-rational-rock`: uid and gid 0, files `0444`, directories
  `0555`.

Our own choices, where matching genisoimage would make output host- or
time-dependent:

- All dates default to the Unix epoch (1970-01-01T00:00:00Z), so the same
  files always give the same image. Callers pass `date` to override.
- System, publisher, preparer and application identifiers are left blank.

## Tooling

- Tool versions are pinned in `mise.toml` (Node, pnpm, libarchive). Use mise
  for every dev tool; never rely on what the OS ships.
- Integration tests (`test/integration/`) read images back with `bsdtar` from
  libarchive (`conda:libarchive` in mise). Run tests inside the mise
  environment (`mise exec -- pnpm test`, or a shell with mise activated).
- Package manager: pnpm.
- TypeScript runs directly in Node (type stripping), so source must stay
  erasable: no `enum`, `namespace` or parameter properties
  (`erasableSyntaxOnly` is on). Relative imports use the `.ts` extension.

## Commands

```sh
pnpm typecheck       # tsc --noEmit over src, test, scripts
pnpm test            # node:test, test/**/*.test.ts
pnpm check:headers   # license header check
pnpm check           # all of the above
pnpm build           # emit dist/ (JS + .d.ts) from src/
```

## Layout

```
src/       library source (published as dist/)
test/      node:test unit tests
test/integration/  tests reading images back with external tools
scripts/   dev scripts (run with node directly)
```
