// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import { defineConfig } from "vite";

export default defineConfig({
  root: "src/web",
  // Relative asset paths, so the built page works from any directory or URL
  // prefix (e.g. a GitHub Pages project path).
  base: "./",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
});
