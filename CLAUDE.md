# cloud-init-webgeniso

TypeScript library (and later a static web page) that builds cloud-init
NoCloud seed ISO images in the browser. Output must match what this command
produces, structurally:

```sh
genisoimage -output seed.img -volid cidata -rational-rock -joliet user-data meta-data [network-config] [vendor-data]
```

Scope is deliberately narrow: flat root directory, only the files `user-data`,
`meta-data`, `network-config`, `vendor-data`, volume label `CIDATA`, Rock Ridge
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

## Tooling

- Tool versions are pinned in `mise.toml` (Node, pnpm). Use mise for every
  dev tool.
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
test/      node:test tests and fixtures
scripts/   dev scripts (run with node directly)
```
