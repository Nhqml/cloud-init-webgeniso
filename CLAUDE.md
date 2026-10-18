# cloud-init-webgeniso

Static web page that builds cloud-init NoCloud seed ISO images in the
browser, with no server. The ISO writer is an internal TypeScript library
(`src/lib/`, not published on its own; the page is its only consumer). Output must match what this command
produces, structurally:

```sh
genisoimage -output seed.img -volid cidata -rational-rock -joliet user-data meta-data [network-config] [vendor-data]
```

Scope is deliberately narrow: flat root directory, only the files `user-data`,
`meta-data`, `network-config`, `vendor-data`, volume label `cidata`, Rock Ridge
and Joliet. No subdirectories, boot images or large files. Don't add general
ISO features unless asked.

## Rules

- Every source file (`.ts`, `.js`, `.mjs`, `.cjs`, `.py`, `.html`, `.css`)
  must start with exactly these two lines, each in its own comment of the
  file's syntax:

  ```ts
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 Kenji Gaillac
  ```

  `#` in Python, `<!-- … -->` in HTML, `/* … */` in CSS. A shebang (or
  `<!doctype html>`) and blank lines may come before them, but the two lines
  must be consecutive. `pnpm check:headers` enforces this.
- The project is AGPL-3.0-or-later. Don't copy code from projects with
  incompatible licenses (GPLv2-only, proprietary, unlicensed snippets).
  Implement from the specs (ECMA-119, SUSP/RRIP, Joliet) instead.
- No runtime dependencies. Code in `src/` must run in browsers (the library
  also in Node, for the tests): use only web-standard APIs (`Uint8Array`,
  `DataView`, `TextEncoder`, the DOM), no `node:*` imports.
  `tsconfig.browser.json` typechecks `src/` without Node types (`types: []`)
  to catch this; it runs as part of `pnpm typecheck`.
- Output must be deterministic: same inputs and same date give identical bytes.
- Test-driven development for everything in `src/lib/` (tested in
  `tests/unit/lib/`), and for the page logic in `src/web/` (pure modules such
  as `src/web/seed.ts`, tested in `tests/unit/web/`). The DOM wiring in
  `src/web/main.ts` stays thin and isn't unit-tested. Each
  cycle:
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
  `0555`. Rock Ridge version 1.09, on purpose (see `src/lib/rockridge.ts`).
- Application Use (512 bytes in both volume descriptors) is filled with
  ASCII spaces, like genisoimage and pycdlib-genisoimage.

Our own choices, where matching genisoimage would make output host- or
time-dependent, or add nothing for a VM seed:

- All dates default to the Unix epoch (1970-01-01T00:00:00Z), so the same
  files always give the same image. Callers pass `date` to override.
- System, publisher, preparer and application identifiers are left blank.
- No trailing padding. genisoimage appends 150 zero sectors (300 KiB) by
  default (`-pad`), a workaround for CD drive read-ahead bugs that's useless
  for VM seed discs; pycdlib-genisoimage doesn't pad either.

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
  never touches other Lima instances. `mise.toml` sets `LIMA_HOME` for the
  repository, so `limactl` in the mise environment sees only that VM; the
  test sets it too, so it also works when run outside mise. They are not part of `pnpm test`; run
  them with `pnpm test:e2e`. `E2E_VM_TEARDOWN` chooses what happens to the
  VM afterwards: `stop` (default, keeps the disk; the tests only attach and
  mount images, so a reused VM is fine), `delete` (next run starts fresh) or
  `keep` (leaves it running, fastest re-runs). Remove the VM with
  `limactl delete --force e2e` (in the mise environment).
- Package manager: pnpm.
- TypeScript runs directly in Node (type stripping), so source must stay
  erasable: no `enum`, `namespace` or parameter properties
  (`erasableSyntaxOnly` is on). Relative imports use the `.ts` extension.

## Commands

```sh
pnpm typecheck         # tsc over src, tests and vite.config.ts, then src without Node types
pnpm test              # unit + integration tests
pnpm test:unit         # node:test, tests/unit/**/*.test.ts
pnpm test:integration  # tests/integration/test_*.py (bsdtar, pycdlib)
pnpm test:e2e          # tests/e2e/test_linux_readers.py, in a Lima VM (slow)
pnpm check:headers     # license header check (scripts/check_license_headers.py)
pnpm check+test        # typecheck, headers, unit + integration tests
pnpm dev               # serve the web page locally with Vite (reloads on change)
pnpm build             # build the web page into dist/ (static files)
pnpm preview           # serve the built dist/ locally

E2E_VM_TEARDOWN=keep pnpm test:e2e  # e2e tests, leaving the VM running
```

## Layout

```
src/lib/            the ISO writer (internal library)
src/web/            the web page (Vite root): index.html, main.ts (DOM wiring),
                    seed.ts, theme.ts and jingle.ts (logic), sound.ts (Web
                    Audio player for the Jukebox jingle, loaded on demand),
                    style.css
src/web/styles/     base.css (shared layout) and one stylesheet per theme;
                    only base + default ship with the page, jukebox/windoze load
                    on demand
tests/unit/         TypeScript unit tests (node:test): lib/ and web/
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
