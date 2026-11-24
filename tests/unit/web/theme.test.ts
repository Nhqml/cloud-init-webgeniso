// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DEFAULT_THEME,
  THEMES,
  THEME_STORAGE_KEY,
  downloadBehavior,
  parseTheme,
} from "../../../src/web/theme.ts";

describe("THEMES", () => {
  test("are Default, Jukebox (70s) and Windoze (90s), Default by default", () => {
    assert.deepEqual(THEMES, ["default", "jukebox", "windoze"]);
    assert.equal(DEFAULT_THEME, "default");
  });

  test("are remembered under a fixed storage key", () => {
    assert.equal(THEME_STORAGE_KEY, "theme");
  });
});

describe("parseTheme", () => {
  test("accepts every known theme", () => {
    for (const theme of THEMES) {
      assert.equal(parseTheme(theme), theme);
    }
  });

  test("falls back to the default for anything else", () => {
    // Including the themes' former names.
    for (const value of [null, undefined, "", "Default", " jukebox", "windoze ", "modern", "70s", "90s"]) {
      assert.equal(parseTheme(value), DEFAULT_THEME, JSON.stringify(value));
    }
  });
});

describe("downloadBehavior", () => {
  test("Windoze refuses the download and shows an error popup instead", () => {
    assert.equal(downloadBehavior("windoze"), "error-popup");
  });

  test("the other themes download the ISO", () => {
    assert.equal(downloadBehavior("default"), "download");
    assert.equal(downloadBehavior("jukebox"), "download");
  });
});
