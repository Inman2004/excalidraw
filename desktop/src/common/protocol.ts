// Messages between the shell window and the per-tab editor iframes.
// Frames never touch Tauri: the shell owns documents, files and persistence.

export type Theme = "light" | "dark";

export type ViewState = { scrollX: number; scrollY: number; zoom: number };

export type LibraryItemsJSON = unknown[];

export type ShellCommand =
  | "new"
  | "open"
  | "save"
  | "saveAs"
  | "closeTab"
  | "reopenTab"
  | "nextTab"
  | "prevTab"
  | "gotoTab"
  | "recovery"
  | "toggleAutosave"
  | "togglePin"
  | "theme"
  | "openRecent"
  | "about"
  | "home"
  | "export"
  | "switcher"
  | "search"
  | "frames"
  | "present"
  | "history"
  | "templates"
  | "importLibrary"
  | "annotations"
  | "presentEnd"
  | "annotate";

export type ToFrame =
  | {
      type: "load";
      docId: string;
      /** plain `.excalidraw` JSON, or null for a new empty drawing */
      json: string | null;
      view: ViewState | null;
      name: string;
      theme: Theme;
      library: LibraryItemsJSON;
      /** the loaded content equals what is on disk */
      fromDisk: boolean;
    }
  | { type: "replace"; json: string; fromDisk: boolean }
  | { type: "theme"; theme: Theme }
  | { type: "name"; name: string }
  | { type: "library"; items: LibraryItemsJSON }
  | { type: "snapshot-request"; reqId: number }
  | { type: "focus" }
  | { type: "annotate-toggle" }
  | { type: "request"; reqId: number; req: FrameRequest }
  /** element skeletons (templates) converted and placed into an empty scene */
  | { type: "skeleton"; elements: unknown[] }
  | { type: "menu-state"; state: MenuState }
  | {
      type: "insert-images";
      files: { name: string; mime: string; dataURL: string }[];
      /** CSS px relative to the frame; negative = centre of the canvas */
      x: number;
      y: number;
      /** lock the images as background (annotate an image) */
      lock?: boolean;
      /** switch the editor into annotate mode afterwards */
      annotate?: boolean;
    };

export type MenuState = {
  autosave: boolean;
  pinned: boolean;
  themePref: "system" | Theme;
  recents: { path: string; name: string; exists: boolean }[];
};

export type Snapshot = {
  json: string;
  view: ViewState;
  /** Excalidraw scene version when serialized */
  version: number;
};

export type FromFrame =
  | { type: "ready" }
  | { type: "loaded"; baseline: Snapshot }
  | { type: "changed"; version: number }
  | { type: "snapshot"; snapshot: Snapshot; reqId?: number }
  | { type: "command"; command: ShellCommand; arg?: string | number }
  | { type: "theme-changed"; theme: Theme }
  | { type: "library-changed"; items: LibraryItemsJSON }
  | { type: "paste-image"; file: { name: string; mime: string; dataURL: string } }
  | { type: "reply"; reqId: number; ok: boolean; data?: unknown; error?: string }
  /** copy text with the native clipboard (iframes may not have access) */
  | { type: "copy-text"; text: string; label: string };

// ---------------------------------------------------------------------------
// request / reply: the shell asks a frame for something and awaits the answer

export type ExportFormat = "png" | "svg" | "jpeg";

export type ExportOptions = {
  format: ExportFormat;
  scope: "scene" | "selection" | "frame";
  frameId?: string;
  scale: number;
  background: boolean;
  dark: boolean;
  embed: boolean;
  /** small PNG for the dialog preview (format/scale ignored) */
  preview?: boolean;
};

export type FrameInfo = { id: string; name: string };

export type ExportInfo = {
  hasSelection: boolean;
  frames: FrameInfo[];
  name: string;
};

export type ExportResult = {
  /** PNG/JPEG bytes, or SVG markup */
  bytes?: ArrayBuffer;
  svg?: string;
  /** preview data URL */
  dataURL?: string;
  width: number;
  height: number;
};

export type SearchHit = {
  id: string;
  text: string;
  kind: "text" | "frame" | "label";
};

export type CalloutInfo = {
  groupId: string;
  number: string;
  label: string;
  color: string;
};

export type FrameRequest =
  | { op: "export-info" }
  | { op: "export"; options: ExportOptions }
  | { op: "search"; query: string }
  | { op: "reveal"; id: string }
  | { op: "frames"; thumbs?: boolean }
  | { op: "apply-frame-order"; ids: string[] }
  | { op: "present"; ids: string[] }
  | { op: "callouts" }
  | { op: "callout-edit"; groupId: string; label?: string; color?: string; remove?: boolean }
  | { op: "callout-reveal"; groupId: string; target?: boolean }
  | { op: "callouts-renumber" }
  | { op: "report" }
  /** render any scene JSON to a small PNG data URL (thumbnails) */
  | { op: "render"; json: string; max: number };

/** Fast non-crypto string hash (cyrb53) for change detection. */
export const hashText = (text: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
};

/** WebView keys that would reload the whole app (or toggle caret browsing): swallowed. */
export const isBrowserKey = (e: KeyboardEvent) => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  return (mod && key === "r") || e.key === "F7";
};

/** App shortcuts a frame forwards to the shell (keydown inside the canvas). */
export const shortcutToCommand = (
  e: KeyboardEvent,
): { command: ShellCommand; arg?: number } | null => {
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === "F5" && !mod && !e.altKey && !e.shiftKey) {
    return { command: "present" };
  }
  if (mod && e.altKey && !e.shiftKey) {
    if (key === "p") return { command: "switcher" };
    if (key === "enter") return { command: "present" };
    return null;
  }
  if (!mod || e.altKey) {
    return null;
  }
  if (key === "tab") {
    return { command: e.shiftKey ? "prevTab" : "nextTab" };
  }
  if (e.shiftKey) {
    if (key === "s") return { command: "saveAs" };
    if (key === "t") return { command: "reopenTab" };
    if (key === "e") return { command: "export" };
    if (key === "f") return { command: "search" };
    if (key === "h") return { command: "history" };
    if (key === "a") return { command: "annotate" };
    return null;
  }
  switch (key) {
    case "s":
      return { command: "save" };
    case "o":
      return { command: "open" };
    case "n":
    case "t":
      return { command: "new" };
    case "w":
      return { command: "closeTab" };
  }
  if (/^[1-9]$/.test(key)) {
    return { command: "gotoTab", arg: Number(key) };
  }
  return null;
};
