// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import { type Plugin, defineConfig } from "vite";

/**
 * License notice for the built JS and CSS, whose minification drops the
 * source files' headers. "/*!" marks it as a comment to keep.
 */
const LICENSE_BANNER =
  "/*! cloud-init-webgeniso | SPDX-License-Identifier: AGPL-3.0-or-later | " +
  "Copyright (C) 2026 Kenji Gaillac */\n";

/** Prepends LICENSE_BANNER to every emitted JS and CSS file, once minified. */
function licenseBanner(): Plugin {
  return {
    name: "license-banner",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === "chunk") {
          file.code = LICENSE_BANNER + file.code;
        } else if (file.fileName.endsWith(".css") && typeof file.source === "string") {
          file.source = LICENSE_BANNER + file.source;
        }
      }
    },
  };
}

export default defineConfig({
  root: "src/web",
  // Relative asset paths, so the built page works from any directory or URL
  // prefix (e.g. a GitHub Pages project path).
  base: "./",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  plugins: [licenseBanner()],
});
