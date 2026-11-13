// Shell state: documents (identity + disk state) and tabs (UI). Scenes are
// never held here; they live in editor frames, recovery files or on disk.
import { useSyncExternalStore } from "react";

import type { Theme, ViewState } from "../common/protocol";
import type { DiskVersion } from "./native";

export type PanelKind =
  | "export"
  | "switcher"
  | "search"
  | "frames"
  | "history"
  | "templates"
  | "annotations";
export type Panel = { kind: PanelKind; docId: string | null };

export type DocumentStatus =
  | "clean"
  | "dirty"
  | "saving"
  | "saved"
  | "conflict"
  | "missing"
  | "error";

export type DocumentRecord = {
  docId: string;
  /** canonical absolute path; one record per path */
  path: string | null;
  displayName: string;
  diskVersion: DiskVersion | null;
  savedHash: string | null;
  currentHash: string | null;
  status: DocumentStatus;
  view: ViewState | null;
  /** editor was unmounted at least once: undo history is gone */
  historyDiscarded: boolean;
  error?: string;
};

export type Tab = { tabId: string; docId: string; pinnedTab: boolean; lastActive: number };

export type Recent = { path: string; name: string; pinnedRecent: boolean; lastOpened: number };

export type ThemePref = "system" | Theme;

export type DialogButton = { id: string; label: string; kind?: "primary" | "danger" | "default" };

export type DialogRequest = {
  id: number;
  title: string;
  body: string;
  buttons: DialogButton[];
  /** button id returned on Esc / backdrop */
  cancelId: string;
  resolve: (id: string) => void;
};

export type Toast = { id: number; message: string; kind: "info" | "error" | "success" };

export type State = {
  ready: boolean;
  docs: Record<string, DocumentRecord>;
  tabs: Tab[];
  activeTabId: string | null;
  /** docIds with a live editor frame, most recently used first */
  mounted: string[];
  closed: { path: string; displayName: string }[];
  recents: Recent[];
  recentsExist: Record<string, boolean>;
  autosave: boolean;
  themePref: ThemePref;
  systemTheme: Theme;
  pinned: boolean;
  library: unknown[];
  dialogs: DialogRequest[];
  toasts: Toast[];
  dropHint: string | null;
  recoveryOpen: boolean;
  /** the open tool panel (export, switcher, search, …), bound to a document */
  panel: Panel | null;
  /** a drawing is being presented (shell chrome hidden) */
  presenting: string | null;
  renamingTabId: string | null;
  /** the Home start page is showing instead of a drawing */
  homeOpen: boolean;
  /** docIds whose editor frame has not reported "loaded" yet */
  loading: Record<string, boolean>;
};

const initial: State = {
  ready: false,
  docs: {},
  tabs: [],
  activeTabId: null,
  mounted: [],
  closed: [],
  recents: [],
  recentsExist: {},
  autosave: true,
  themePref: "system",
  systemTheme: "light",
  pinned: false,
  library: [],
  dialogs: [],
  toasts: [],
  dropHint: null,
  recoveryOpen: false,
  panel: null,
  presenting: null,
  renamingTabId: null,
  homeOpen: false,
  loading: {},
};

let state = initial;
const listeners = new Set<() => void>();

export const getState = () => state;

export const setState = (patch: Partial<State> | ((s: State) => Partial<State>)) => {
  const next = typeof patch === "function" ? patch(state) : patch;
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useStore = <T,>(select: (s: State) => T): T =>
  useSyncExternalStore(subscribe, () => select(state));

export const updateDoc = (docId: string, patch: Partial<DocumentRecord>) =>
  setState((s) =>
    s.docs[docId] ? { docs: { ...s.docs, [docId]: { ...s.docs[docId], ...patch } } } : {},
  );

export const resolvedTheme = (s: State): Theme =>
  s.themePref === "system" ? s.systemTheme : s.themePref;

export const activeDoc = (s: State) => {
  const tab = s.tabs.find((t) => t.tabId === s.activeTabId);
  return tab ? s.docs[tab.docId] ?? null : null;
};

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// ---------------------------------------------------------------- dialogs & toasts

let dialogSeq = 0;

/** In-app dialog; resolves with the clicked button id (never a native popup). */
export const showDialog = (opts: Omit<DialogRequest, "id" | "resolve">) =>
  new Promise<string>((resolve) => {
    const id = ++dialogSeq;
    setState((s) => ({
      dialogs: [
        ...s.dialogs,
        {
          ...opts,
          id,
          resolve: (answer) => {
            setState((s2) => ({ dialogs: s2.dialogs.filter((d) => d.id !== id) }));
            resolve(answer);
          },
        },
      ],
    }));
  });

let toastSeq = 0;
export const toast = (message: string, kind: Toast["kind"] = "info", ms = 3200) => {
  const id = ++toastSeq;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, kind }] }));
  window.setTimeout(
    () => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    ms,
  );
};
