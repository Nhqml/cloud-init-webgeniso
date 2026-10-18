// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

// The page's visual themes. Each one is a stylesheet in styles/, selected
// by the data-theme attribute of <html>.

/**
 * The available themes, in the order the picker lists them. index.html
 * repeats this list in its early theme script; keep both in sync.
 */
export const THEMES = ["default", "jukebox", "windoze"] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "default";

/** localStorage key under which the chosen theme is remembered. */
export const THEME_STORAGE_KEY = "theme";

/** `value` if it names a theme, else the default theme. */
export function parseTheme(value: string | null | undefined): Theme {
  return (THEMES as readonly (string | null | undefined)[]).includes(value)
    ? (value as Theme)
    : DEFAULT_THEME;
}
