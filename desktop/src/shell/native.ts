// Thin wrappers over the Rust commands. In a plain browser (vite preview) a
// localStorage-backed fallback keeps the UI usable for visual checks.
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";

export const IN_TAURI = isTauri();

export type DiskVersion = { mtimeNs: string; size: number; sha256: string };
export type OpenedDoc = { canonical: string; text: string; version: DiskVersion };
export type SaveResult =
  | { kind: "saved"; canonical: string; version: DiskVersion }
  | { kind: "conflict"; current: DiskVersion | null };
export type RecoveryEntry = { id: string; modifiedMs: number; size: number };
export type BackupEntry = { id: string; createdMs: number; reason: string; size: number };

const LS = "excalidraw-desktop:";
const ls = {
  get: (k: string) => {
    try {
      return localStorage.getItem(LS + k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string) => {
    try {
      localStorage.setItem(LS + k, v);
    } catch {
      // storage full: best effort in browser mode
    }
  },
  del: (k: string) => {
    try {
      localStorage.removeItem(LS + k);
    } catch {
      // ignore
    }
  },
};

const unsupported = (what: string) =>
  Promise.reject(new Error(`${what} needs the desktop app`));

export const native = {
  launchFiles: () => (IN_TAURI ? invoke<string[]>("launch_files") : Promise.resolve([])),

  docOpen: (path: string) =>
    IN_TAURI ? invoke<OpenedDoc>("doc_open", { path }) : unsupported("Opening files"),

  docCanonical: (path: string) =>
    IN_TAURI ? invoke<string>("doc_canonical", { path }) : Promise.resolve(path),

  docVersion: (path: string) =>
    IN_TAURI ? invoke<DiskVersion | null>("doc_version", { path }) : Promise.resolve(null),

  docSave: (path: string, text: string, expected: DiskVersion | null, force: boolean) =>
    IN_TAURI
      ? invoke<SaveResult>("doc_save", { path, text, expected, force })
      : unsupported("Saving files"),

  /** Large binary writes (exports): raw IPC body, options in headers. */
  docSaveBytes: (
    path: string,
    bytes: Uint8Array,
    expected: DiskVersion | null,
    force: boolean,
  ) =>
    IN_TAURI
      ? invoke<SaveResult>("doc_save_bytes", bytes, {
          headers: {
            "x-path": encodeURIComponent(path),
            "x-force": force ? "1" : "0",
            "x-expected": expected ? encodeURIComponent(JSON.stringify(expected)) : "null",
          },
        })
      : unsupported("Exporting files"),

  docReadBytes: (path: string) =>
    IN_TAURI
      ? invoke<ArrayBuffer>("doc_read_bytes", { path }).then((b) => new Uint8Array(b))
      : unsupported("Reading files"),

  docRename: (from: string, to: string) =>
    IN_TAURI ? invoke<string>("doc_rename", { from, to }) : unsupported("Renaming files"),

  pathsExist: (paths: string[]) =>
    IN_TAURI
      ? invoke<boolean[]>("paths_exist", { paths })
      : Promise.resolve(paths.map(() => false)),

  backupCreate: (path: string, reason: string) =>
    IN_TAURI
      ? invoke<string | null>("backup_create", { path, reason })
      : Promise.resolve(null),

  backupList: (path: string) =>
    IN_TAURI ? invoke<BackupEntry[]>("backup_list", { path }) : Promise.resolve([]),

  backupRead: (path: string, id: string) =>
    IN_TAURI ? invoke<string>("backup_read", { path, id }) : unsupported("Backups"),

  sessionLoad: () =>
    IN_TAURI ? invoke<string | null>("session_load") : Promise.resolve(ls.get("session")),

  sessionSave: (json: string) =>
    IN_TAURI
      ? invoke<void>("session_save", { json })
      : Promise.resolve(ls.set("session", json)),

  recoveryWrite: (id: string, text: string) =>
    IN_TAURI
      ? invoke<void>("recovery_write", { id, text })
      : Promise.resolve(ls.set(`recovery:${id}`, text)),

  recoveryRead: (id: string) =>
    IN_TAURI
      ? invoke<string | null>("recovery_read", { id })
      : Promise.resolve(ls.get(`recovery:${id}`)),

  recoveryDelete: (id: string) =>
    IN_TAURI
      ? invoke<void>("recovery_delete", { id })
      : Promise.resolve(ls.del(`recovery:${id}`)),

  recoveryList: (): Promise<RecoveryEntry[]> => {
    if (IN_TAURI) {
      return invoke<RecoveryEntry[]>("recovery_list");
    }
    const out: RecoveryEntry[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)!;
        if (key.startsWith(`${LS}recovery:`)) {
          out.push({
            id: key.slice(`${LS}recovery:`.length),
            modifiedMs: Date.now(),
            size: localStorage.getItem(key)!.length,
          });
        }
      }
    } catch {
      // ignore
    }
    return Promise.resolve(out);
  },

  metaRead: (name: string) =>
    IN_TAURI
      ? invoke<string | null>("meta_read", { name })
      : Promise.resolve(ls.get(`meta:${name}`)),

  metaWrite: (name: string, json: string) =>
    IN_TAURI
      ? invoke<void>("meta_write", { name, json })
      : Promise.resolve(ls.set(`meta:${name}`, json)),

  watchSet: (paths: string[]) =>
    IN_TAURI ? invoke<void>("watch_set", { paths }) : Promise.resolve(),

  pickOpen: async (
    filters = [{ name: "Excalidraw", extensions: ["excalidraw", "json", "excalidrawlib"] }],
  ): Promise<string[]> => {
    if (!IN_TAURI) {
      return [];
    }
    const picked = await openDialog({ multiple: true, directory: false, filters });
    return picked ? (Array.isArray(picked) ? picked : [picked]) : [];
  },

  pickImages: async (): Promise<string[]> => {
    if (!IN_TAURI) {
      return [];
    }
    const picked = await openDialog({
      multiple: true,
      directory: false,
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "webp", "gif", "svg"] }],
    });
    return picked ? (Array.isArray(picked) ? picked : [picked]) : [];
  },

  /** PNG bytes → system clipboard as an image */
  copyImage: async (png: Uint8Array) => {
    if (IN_TAURI) {
      const { writeImage } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeImage(png);
      return;
    }
    await navigator.clipboard.write([
      new ClipboardItem({ "image/png": new Blob([png as BlobPart], { type: "image/png" }) }),
    ]);
  },

  copyText: async (text: string) => {
    if (IN_TAURI) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return;
    }
    await navigator.clipboard.writeText(text);
  },

  pickSave: async (defaultPath: string, ext = "excalidraw"): Promise<string | null> => {
    if (!IN_TAURI) {
      return null;
    }
    const picked = await saveDialog({
      defaultPath,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!picked) {
      return null;
    }
    return new RegExp(`\\.${ext}$`, "i").test(picked) ? picked : `${picked}.${ext}`;
  },
};

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
export const parentName = (path: string) => {
  const parts = path.split(/[\\/]/);
  return parts.length > 1 ? parts[parts.length - 2] : "";
};
export const stripExt = (name: string) => name.replace(/\.(excalidraw|json)$/i, "");
