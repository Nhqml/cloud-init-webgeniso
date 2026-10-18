// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Kenji Gaillac

/// <reference types="vite/client" />

// DOM wiring for the page. Decisions live in seed.ts, which is unit-tested;
// this file only reads the form, shows messages and triggers the download.

import { type FileContent, buildSeedIso } from "../lib/iso.ts";
import {
  DEFAULT_INSTANCE_ID,
  hostnameError,
  instanceIdError,
  isoFileName,
  loadedFile,
  seedFiles,
  userDataWarning,
} from "./seed.ts";
import { DEFAULT_THEME, THEME_STORAGE_KEY, type Theme, parseTheme } from "./theme.ts";

/** What each editor starts with. */
const DEFAULT_CONTENT: Record<string, string> = {
  "user-data": "#cloud-config\n",
  "network-config": [
    "version: 2",
    "ethernets:",
    "  all:",
    "    match:",
    '      name: "eth*"',
    "    dhcp4: true",
    "",
  ].join("\n"),
  "vendor-data": "#cloud-config\n",
};

/** The element matching `selector` in `root`; throws if the markup lacks it. */
function element<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`missing element: ${selector}`);
  return found;
}

/**
 * Shows `text` in `target`, or hides it when there's nothing to say. Parts
 * between backticks become <code> elements; everything stays plain text,
 * never parsed as HTML.
 */
function show(target: HTMLElement, text: string | null): void {
  target.replaceChildren(
    ...(text ?? "").split("`").map((part, index) => {
      if (index % 2 === 0) return part;
      const code = document.createElement("code");
      code.textContent = part;
      return code;
    }),
  );
  target.hidden = text === null;
}

interface Editor {
  /** The file's content, or null when an optional file is turned off. */
  content(): FileContent | null;
}

/**
 * Wires one file editor (a section with data-file): typing, loading or
 * dropping a file, turning an optional file on and off. `onChange` runs
 * after every change.
 */
function setUpEditor(section: HTMLElement, onChange: () => void): Editor {
  const name = section.dataset.file ?? "";
  const body = element(section, ".file-body");
  const textarea = element<HTMLTextAreaElement>(section, "textarea");
  const binary = element(section, ".binary");
  const binaryName = element(section, ".binary-name");
  const notice = element(section, ".notice");
  const fileInput = element<HTMLInputElement>(section, ".file-input");
  const warning = section.querySelector<HTMLElement>(".warning"); // user-data only
  const enabled = section.querySelector<HTMLInputElement>(".enabled"); // optional files only

  // Content of a loaded file that isn't text, shown as a summary instead.
  let bytes: Uint8Array | null = null;
  textarea.value = DEFAULT_CONTENT[name] ?? "";

  const content = (): FileContent | null => {
    if (enabled !== null && !enabled.checked) return null;
    return bytes ?? textarea.value;
  };

  const refresh = (): void => {
    body.hidden = enabled !== null && !enabled.checked;
    textarea.hidden = bytes !== null;
    binary.hidden = bytes === null;
    if (warning !== null) {
      const current = content();
      show(warning, current === null ? null : userDataWarning(current));
    }
    onChange();
  };

  const load = async (file: File): Promise<void> => {
    const loaded = loadedFile(new Uint8Array(await file.arrayBuffer()));
    if (typeof loaded.content === "string") {
      textarea.value = loaded.content;
      bytes = null;
    } else {
      bytes = loaded.content;
      binaryName.textContent = `Binary file: ${file.name} (${bytes.length} bytes)`;
    }
    show(notice, loaded.notice);
    if (enabled !== null) enabled.checked = true;
    refresh();
  };

  textarea.addEventListener("input", () => {
    show(notice, null);
    refresh();
  });
  enabled?.addEventListener("change", refresh);

  element(section, ".load").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // So loading the same file again still fires "change".
    if (file !== undefined) void load(file);
  });
  element(section, ".clear").addEventListener("click", () => {
    bytes = null;
    textarea.value = "";
    show(notice, null);
    refresh();
  });

  section.addEventListener("dragover", (event) => {
    event.preventDefault();
    section.classList.add("dragging");
  });
  section.addEventListener("dragleave", (event) => {
    if (!section.contains(event.relatedTarget as Node | null)) {
      section.classList.remove("dragging");
    }
  });
  section.addEventListener("drop", (event) => {
    event.preventDefault();
    section.classList.remove("dragging");
    const file = event.dataTransfer?.files[0];
    if (file !== undefined) void load(file);
  });

  refresh();
  return { content };
}

/** Wires a text field to its validator; returns whether it's currently valid. */
function setUpField(
  input: HTMLInputElement,
  error: HTMLElement,
  validate: (value: string) => string | null,
  onChange: () => void,
): () => boolean {
  const check = (): boolean => {
    const message = validate(input.value);
    show(error, message);
    input.setAttribute("aria-invalid", String(message !== null));
    return message === null;
  };
  input.addEventListener("input", () => {
    check();
    onChange();
  });
  return check;
}

function download(image: Uint8Array<ArrayBuffer>, name: string): void {
  const url = URL.createObjectURL(new Blob([image], { type: "application/x-iso9660-image" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // Give the browser time to start the download before releasing the data.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Stylesheets of the themes that don't ship with the page, fetched the first
 * time they're used. The Default theme is part of style.css.
 */
const THEME_STYLESHEETS: Partial<Record<Theme, () => Promise<unknown>>> = {
  jukebox: () => import("./styles/theme-jukebox.css"),
  windoze: () => import("./styles/theme-windoze.css"),
};

/**
 * Wires the theme picker: shows the current theme (index.html's early script
 * may have restored a saved one), switches and remembers it on change. A
 * theme's stylesheet is loaded before switching to it, and the page shown
 * once it's ready. Storage is a convenience: without it, themes still switch.
 */
function setUpThemePicker(): void {
  const root = document.documentElement;
  const picker = element<HTMLSelectElement>(document, "#theme");
  let latest = 0; // If the user switches quickly, the last choice wins.

  const apply = async (theme: Theme): Promise<void> => {
    const request = ++latest;
    picker.value = theme;
    try {
      await THEME_STYLESHEETS[theme]?.();
    } catch {
      theme = DEFAULT_THEME; // Couldn't load it: fall back to the default.
      picker.value = theme;
    }
    if (request !== latest) return;
    root.dataset.theme = theme;
    root.classList.remove("theme-pending");
  };

  void apply(parseTheme(root.dataset.theme));
  picker.addEventListener("change", () => {
    const theme = parseTheme(picker.value);
    void apply(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage unavailable: the theme just isn't remembered.
    }
  });
}

/**
 * Plays the Jukebox theme's disco jingle. The audio context is created right
 * away, during the click, as some browsers only let audio start inside a
 * user gesture; the player itself is loaded on first use. Sound is a bonus:
 * if anything fails, the download has already happened, so stay silent.
 */
function playDiscoJingle(): void {
  let context: AudioContext;
  try {
    context = new AudioContext();
  } catch {
    return; // No Web Audio.
  }
  import("./sound.ts")
    .then((sound) => sound.playDiscoJingle(context))
    .catch(() => void context.close());
}

function main(): void {
  setUpThemePicker();
  const instanceId = element<HTMLInputElement>(document, "#instance-id");
  const hostname = element<HTMLInputElement>(document, "#hostname");
  const downloadButton = element<HTMLButtonElement>(document, "#download");
  const downloadError = element(document, "#download-error");
  const fileName = element<HTMLInputElement>(document, "#file-name");
  instanceId.value = DEFAULT_INSTANCE_ID;
  fileName.value = isoFileName(instanceId.value);

  // The file name follows the instance-id until the user types their own;
  // clearing it makes it follow again.
  let fileNameEdited = false;
  fileName.addEventListener("input", () => {
    fileNameEdited = fileName.value.trim() !== "";
  });
  fileName.addEventListener("change", () => {
    if (!fileNameEdited) fileName.value = isoFileName(instanceId.value);
  });
  instanceId.addEventListener("input", () => {
    if (!fileNameEdited) fileName.value = isoFileName(instanceId.value);
  });

  // Set below; the editors and fields call it on every change.
  let update = (): void => { };

  const instanceIdValid = setUpField(
    instanceId,
    element(document, "#instance-id-error"),
    instanceIdError,
    () => update(),
  );
  const hostnameValid = setUpField(
    hostname,
    element(document, "#hostname-error"),
    hostnameError,
    () => update(),
  );
  const editors = new Map<string, Editor>();
  for (const section of document.querySelectorAll<HTMLElement>("section.file")) {
    editors.set(section.dataset.file ?? "", setUpEditor(section, () => update()));
  }
  const editor = (name: string): Editor => {
    const found = editors.get(name);
    if (found === undefined) throw new Error(`missing editor: ${name}`);
    return found;
  };

  update = () => {
    show(downloadError, null);
    downloadButton.disabled = !(instanceIdValid() && hostnameValid());
  };

  downloadButton.addEventListener("click", () => {
    try {
      const files = seedFiles({
        metaData: { instanceId: instanceId.value, hostname: hostname.value },
        userData: editor("user-data").content() ?? "",
        networkConfig: editor("network-config").content(),
        vendorData: editor("vendor-data").content(),
      });
      download(buildSeedIso(files), fileName.value.trim() || isoFileName(instanceId.value));
      if (document.documentElement.dataset.theme === "jukebox") playDiscoJingle();
    } catch (error) {
      show(downloadError, `Couldn't build the image: ${(error as Error).message}`);
    }
  });

  update();
}

main();
