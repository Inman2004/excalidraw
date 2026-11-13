// Document lifecycle: open, save (write queue + autosave), recovery, conflicts,
// tabs, editor-frame LRU and session persistence. All file I/O goes through
// `native` (Rust); frames only edit.
import { hashText } from "../common/protocol";

import {
  broadcast,
  hasFrame,
  listenToFrames,
  requestFrame,
  requestSnapshot,
  sendToFrame,
} from "./frames";
import { IN_TAURI, baseName, native, parentName, stripExt } from "./native";
import {
  getState,
  newId,
  resolvedTheme,
  setState,
  showDialog,
  toast,
  updateDoc,
} from "./store";

import type { FromFrame, Snapshot, ToFrame, ViewState } from "../common/protocol";
import type { DiskVersion } from "./native";
import type { DocumentRecord, Recent, State, Tab, ThemePref } from "./store";

const MAX_MOUNTED = 6;
const AUTOSAVE_DEBOUNCE_MS = 1500;
const AUTOSAVE_MAX_MS = 5000;
const CHECKPOINT_EVERY_MS = 5 * 60 * 1000;
const MAX_RECENTS = 20;
const MAX_CLOSED = 20;

// ------------------------------------------------------------------ per-doc runtime

type Runtime = {
  /** content handed to the frame on mount */
  pendingLoad: { json: string | null; view: ViewState | null; fromDisk: boolean } | null;
  latest: Snapshot | null;
  recoveryHash: string | null;
  recoveryChain: Promise<void>;
  saving: boolean;
  /** newest content waiting for the in-flight save */
  queued: { json: string; mode: SaveMode } | null;
  saveWaiters: ((ok: boolean) => void)[];
  autosaveTimer?: number;
  autosaveFirstAt: number | null;
  lastCheckpoint: number;
  historyToastPending: boolean;
  /** messages to send once the frame has loaded its scene */
  afterLoad: ToFrame[];
};

type SaveMode = "auto" | "manual" | "force";

const runtimes = new Map<string, Runtime>();
const rt = (docId: string): Runtime => {
  let r = runtimes.get(docId);
  if (!r) {
    r = {
      pendingLoad: null,
      latest: null,
      recoveryHash: null,
      recoveryChain: Promise.resolve(),
      saving: false,
      queued: null,
      saveWaiters: [],
      autosaveFirstAt: null,
      lastCheckpoint: Date.now(),
      historyToastPending: false,
      afterLoad: [],
    };
    runtimes.set(docId, r);
  }
  return r;
};

const docOf = (docId: string) => getState().docs[docId] as DocumentRecord | undefined;
const samePath = (a: string | null, b: string | null) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();
const docByPath = (path: string) =>
  Object.values(getState().docs).find((d) => samePath(d.path, path));
const tabOfDoc = (docId: string) => getState().tabs.find((t) => t.docId === docId);

const untitledName = () => {
  const used = new Set(Object.values(getState().docs).map((d) => d.displayName));
  for (let i = 1; ; i++) {
    const name = i === 1 ? "Untitled" : `Untitled ${i}`;
    if (!used.has(name)) {
      return name;
    }
  }
};

// ------------------------------------------------------------------ session

let sessionTimer: number | undefined;
const sessionJSON = () => {
  const s = getState();
  return JSON.stringify({
    version: 1,
    activeTabId: s.activeTabId,
    tabs: s.tabs,
    closed: s.closed,
    docs: Object.fromEntries(
      Object.values(s.docs).map((d) => [
        d.docId,
        {
          docId: d.docId,
          path: d.path,
          displayName: d.displayName,
          diskVersion: d.diskVersion,
          savedHash: d.savedHash,
          currentHash: d.currentHash,
          view: d.view,
          dirty: isUnsaved(d),
        },
      ]),
    ),
  });
};

export const scheduleSessionSave = () => {
  window.clearTimeout(sessionTimer);
  sessionTimer = window.setTimeout(() => {
    native.sessionSave(sessionJSON()).catch(() => {});
  }, 500);
};

const saveSessionNow = async () => {
  window.clearTimeout(sessionTimer);
  await native.sessionSave(sessionJSON());
};

const isUnsaved = (d: DocumentRecord) =>
  d.status === "dirty" ||
  d.status === "conflict" ||
  d.status === "error" ||
  (d.status === "saving" && d.currentHash !== d.savedHash) ||
  (d.status === "missing" && d.currentHash !== d.savedHash);

// ------------------------------------------------------------------ watcher + prefs

const syncWatcher = () => {
  const paths = Object.values(getState().docs)
    .map((d) => d.path)
    .filter((p): p is string => !!p);
  native.watchSet(paths).catch(() => {});
};

const savePrefs = () => {
  const s = getState();
  native
    .metaWrite(
      "prefs",
      JSON.stringify({ autosave: s.autosave, themePref: s.themePref, pinned: s.pinned }),
    )
    .catch(() => {});
};

export const pushMenuState = () => {
  const s = getState();
  broadcast({
    type: "menu-state",
    state: {
      autosave: s.autosave,
      pinned: s.pinned,
      themePref: s.themePref,
      recents: s.recents.slice(0, 12).map((r) => ({
        path: r.path,
        name: r.name,
        exists: s.recentsExist[r.path.toLowerCase()] ?? true,
      })),
    },
  });
};

const refreshRecentsExist = async () => {
  const recents = getState().recents;
  const exist = await native.pathsExist(recents.map((r) => r.path)).catch(() => null);
  if (exist) {
    setState({
      recentsExist: Object.fromEntries(recents.map((r, i) => [r.path.toLowerCase(), exist[i]])),
    });
    pushMenuState();
  }
};

const addRecent = (path: string) => {
  setState((s) => {
    const prev = s.recents.find((r) => samePath(r.path, path));
    const entry: Recent = {
      path,
      name: baseName(path),
      pinnedRecent: prev?.pinnedRecent ?? false,
      lastOpened: Date.now(),
    };
    const rest = s.recents.filter((r) => !samePath(r.path, path));
    const pinned = [entry, ...rest].filter((r) => r.pinnedRecent);
    const others = [entry, ...rest].filter((r) => !r.pinnedRecent);
    return {
      recents: [...pinned, ...others].slice(0, MAX_RECENTS),
      recentsExist: { ...s.recentsExist, [path.toLowerCase()]: true },
    };
  });
  native.metaWrite("recent-files", JSON.stringify(getState().recents)).catch(() => {});
  pushMenuState();
};

const renameRecent = (from: string, to: string) => {
  setState((s) => ({
    recents: s.recents.map((r) =>
      samePath(r.path, from) ? { ...r, path: to, name: baseName(to) } : r,
    ),
  }));
  native.metaWrite("recent-files", JSON.stringify(getState().recents)).catch(() => {});
  pushMenuState();
};

export const removeRecent = (path: string) => {
  setState((s) => ({ recents: s.recents.filter((r) => !samePath(r.path, path)) }));
  native.metaWrite("recent-files", JSON.stringify(getState().recents)).catch(() => {});
  pushMenuState();
};

// ------------------------------------------------------------------ tabs + frames

const touchMounted = (docId: string) =>
  setState((s) => ({ mounted: [docId, ...s.mounted.filter((id) => id !== docId)] }));

/** Prepare content for a frame that is about to mount. */
const prepareLoad = async (doc: DocumentRecord) => {
  const r = rt(doc.docId);
  if (r.pendingLoad) {
    return;
  }
  const recovered = await native.recoveryRead(doc.docId).catch(() => null);
  if (recovered) {
    r.pendingLoad = { json: recovered, view: doc.view, fromDisk: false };
    return;
  }
  if (doc.path) {
    try {
      const opened = await native.docOpen(doc.path);
      updateDoc(doc.docId, { diskVersion: opened.version });
      r.pendingLoad = { json: opened.text, view: doc.view, fromDisk: true };
      return;
    } catch {
      updateDoc(doc.docId, { status: "missing" });
    }
  }
  r.pendingLoad = { json: null, view: doc.view, fromDisk: false };
};

/**
 * Called whenever a frame says "ready": first mount, or a reload (hot reload,
 * WebView renderer restart). A reload gets the tab's latest snapshot back.
 */
const frameMounted = (docId: string) => {
  const doc = docOf(docId);
  const r = rt(docId);
  if (!doc) {
    return;
  }
  if (!r.pendingLoad && r.latest) {
    r.pendingLoad = { json: r.latest.json, view: r.latest.view, fromDisk: false };
  }
  const s = getState();
  sendToFrame(docId, {
    type: "load",
    docId,
    json: r.pendingLoad?.json ?? null,
    view: r.pendingLoad?.view ?? doc.view,
    name: stripExt(doc.displayName),
    theme: resolvedTheme(s),
    library: s.library,
    fromDisk: r.pendingLoad?.fromDisk ?? false,
  });
  pushMenuState();
};

/** Snapshot → recovery (when needed) → unmount. Never drops unsaved work. */
const evict = async (docId: string) => {
  const doc = docOf(docId);
  if (!doc) {
    return;
  }
  const snap = await requestSnapshot(docId);
  if (snap) {
    handleSnapshot(docId, snap);
  }
  const fresh = docOf(docId);
  if (fresh && isUnsaved(fresh)) {
    try {
      await flushRecovery(docId, true);
    } catch {
      return; // keep it mounted rather than risk losing work
    }
  }
  const r = rt(docId);
  r.pendingLoad = null;
  setState((s) => ({ mounted: s.mounted.filter((id) => id !== docId) }));
  updateDoc(docId, { historyDiscarded: true });
  r.historyToastPending = true;
};

const enforceLRU = () => {
  const s = getState();
  const activeDocId = s.tabs.find((t) => t.tabId === s.activeTabId)?.docId;
  const extra = s.mounted.filter((id) => id !== activeDocId).slice(MAX_MOUNTED - 1);
  extra.forEach((id) => void evict(id));
};

export const activateTab = async (tabId: string) => {
  const s = getState();
  const tab = s.tabs.find((t) => t.tabId === tabId);
  if (!tab) {
    return;
  }
  const doc = docOf(tab.docId);
  if (!doc) {
    return;
  }
  setState((s2) => ({
    activeTabId: tabId,
    homeOpen: false,
    tabs: s2.tabs.map((t) => (t.tabId === tabId ? { ...t, lastActive: Date.now() } : t)),
    // an open drawer follows the active drawing; dialogs belong to their own
    panel:
      s2.panel && (s2.panel.kind === "frames" || s2.panel.kind === "annotations")
        ? { ...s2.panel, docId: doc.docId }
        : s2.panel,
  }));
  if (!getState().mounted.includes(doc.docId)) {
    // concurrent activations share one preparation: a second prepareLoad
    // finishing after the editor loaded would leave the tab "opening" forever
    let preparing = preparingLoads.get(doc.docId);
    if (!preparing) {
      setState((s2) => ({ loading: { ...s2.loading, [doc.docId]: true } }));
      preparing = prepareLoad(doc).finally(() => preparingLoads.delete(doc.docId));
      preparingLoads.set(doc.docId, preparing);
      watchLoading(doc.docId);
    }
    await preparing;
  }
  touchMounted(doc.docId);
  const r = rt(doc.docId);
  if (r.historyToastPending && hasFrame(doc.docId)) {
    toast("Undo history was cleared for this tab to free memory");
    r.historyToastPending = false;
  }
  sendToFrame(doc.docId, { type: "focus" });
  enforceLRU();
  updateTitle();
  scheduleSessionSave();
};

const addTab = (doc: DocumentRecord, activate = true) => {
  const tab: Tab = {
    tabId: newId("tab"),
    docId: doc.docId,
    pinnedTab: false,
    lastActive: Date.now(),
  };
  setState((s) => {
    const activeIndex = s.tabs.findIndex((t) => t.tabId === s.activeTabId);
    const tabs = [...s.tabs];
    tabs.splice(activeIndex >= 0 ? activeIndex + 1 : tabs.length, 0, tab);
    return { docs: { ...s.docs, [doc.docId]: doc }, tabs };
  });
  syncWatcher();
  if (activate) {
    void activateTab(tab.tabId);
  }
  scheduleSessionSave();
  return tab;
};

const blankDoc = (patch: Partial<DocumentRecord> = {}): DocumentRecord => ({
  docId: newId("doc"),
  path: null,
  displayName: untitledName(),
  diskVersion: null,
  savedHash: null,
  currentHash: null,
  status: "clean",
  view: null,
  historyDiscarded: false,
  ...patch,
});

export const newTab = () => {
  const doc = blankDoc();
  rt(doc.docId).pendingLoad = { json: null, view: null, fromDisk: false };
  addTab(doc);
};

export const updateTitle = () => {
  const s = getState();
  const tab = s.tabs.find((t) => t.tabId === s.activeTabId);
  const doc = tab && s.docs[tab.docId];
  const title = s.homeOpen
    ? "Home — Excalidraw"
    : doc
    ? `${isUnsaved(doc) ? "• " : ""}${stripExt(doc.displayName)} — Excalidraw`
    : "Excalidraw";
  document.title = title;
  if (IN_TAURI) {
    import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().setTitle(title).catch(() => {}),
    );
  }
};

// ------------------------------------------------------------------ frame messages

const handleSnapshot = (docId: string, snap: Snapshot) => {
  const doc = docOf(docId);
  if (!doc) {
    return;
  }
  const r = rt(docId);
  r.latest = snap;
  const hash = hashText(snap.json);
  const patch: Partial<DocumentRecord> = { currentHash: hash, view: snap.view };
  if (!doc.path) {
    patch.status = hasElements(snap.json) ? "dirty" : "clean";
  } else if (doc.status === "dirty" && hash === doc.savedHash) {
    patch.status = "clean"; // undone back to the saved state
  }
  updateDoc(docId, patch);
  const fresh = docOf(docId)!;
  if (isUnsaved(fresh)) {
    void flushRecovery(docId).catch(() => {});
  } else if (!fresh.path && r.recoveryHash) {
    // an untitled drawing that became empty again has nothing to recover
    void dropRecovery(docId);
  }
  if (fresh.path && getState().autosave && fresh.status === "dirty") {
    scheduleAutosave(docId);
  }
  updateTitle();
  scheduleSessionSave();
};

const preparingLoads = new Map<string, Promise<unknown>>();

/**
 * Safety net: an editor that answers but whose "loaded" message was missed
 * (e.g. its page reloaded mid-handshake) is treated as loaded.
 */
const watchLoading = (docId: string) => {
  window.setTimeout(async () => {
    if (!getState().loading[docId] || !hasFrame(docId)) {
      return;
    }
    const snap = await requestSnapshot(docId, 3000);
    if (snap && getState().loading[docId]) {
      onLoaded(docId, snap);
    } else if (getState().loading[docId]) {
      watchLoading(docId);
    }
  }, 6000);
};

/** The editor has its scene: settle status, flush queued work, drop the overlay. */
const onLoaded = (docId: string, baseline: Snapshot) => {
  const doc = docOf(docId);
  if (!doc) {
    return;
  }
  const r = rt(docId);
  const hash = hashText(baseline.json);
  r.latest = baseline;
  const fromDisk = r.pendingLoad?.fromDisk ?? false;
  if (fromDisk) {
    updateDoc(docId, {
      currentHash: hash,
      savedHash: hash,
      status: doc.status === "missing" ? "missing" : "clean",
      view: baseline.view,
    });
  } else {
    const status = !doc.path
      ? hasElements(baseline.json)
        ? "dirty"
        : "clean"
      : doc.status === "conflict" || doc.status === "missing"
      ? doc.status
      : hash === doc.savedHash
      ? "clean"
      : "dirty";
    updateDoc(docId, { currentHash: hash, status, view: baseline.view });
  }
  r.pendingLoad = null;
  r.afterLoad.splice(0).forEach((m) => sendToFrame(docId, m));
  loadWaiters.get(docId)?.splice(0).forEach((fn) => fn());
  setState((s2) => {
    const loading = { ...s2.loading };
    delete loading[docId];
    return { loading };
  });
  // the first focus request may have arrived before the editor existed
  if (getState().tabs.find((t) => t.tabId === getState().activeTabId)?.docId === docId) {
    sendToFrame(docId, { type: "focus" });
  }
  updateTitle();
};

const onFrameMessage = (docId: string, msg: FromFrame) => {
  const doc = docOf(docId);
  if (!doc) {
    return;
  }
  switch (msg.type) {
    case "ready":
      frameMounted(docId);
      break;
    case "loaded":
      onLoaded(docId, msg.baseline);
      break;
    case "changed":
      if (doc.status === "clean" || doc.status === "saved") {
        updateDoc(docId, { status: "dirty" });
        updateTitle();
      }
      break;
    case "snapshot":
      if (msg.reqId === undefined) {
        handleSnapshot(docId, msg.snapshot);
      }
      break;
    case "command":
      void runCommand(msg.command, msg.arg, docId);
      break;
    case "theme-changed":
      setThemePref(msg.theme);
      break;
    case "copy-text":
      native
        .copyText(msg.text)
        .catch((e) => toast(`Copy failed: ${e}`, "error"));
      break;
    case "paste-image":
      openImageTab(msg.file);
      break;
    case "library-changed":
      setState({ library: msg.items });
      native.metaWrite("library", JSON.stringify(msg.items)).catch(() => {});
      broadcast({ type: "library", items: msg.items }, docId);
      break;
  }
};

const hasElements = (json: string) => {
  try {
    return (JSON.parse(json).elements ?? []).length > 0;
  } catch {
    return true;
  }
};

// ------------------------------------------------------------------ recovery

/** Coalesced, ordered recovery writes; skipped when content is unchanged. */
const flushRecovery = (docId: string, mustSucceed = false) => {
  const r = rt(docId);
  const run = async () => {
    const snap = r.latest;
    if (!snap) {
      return;
    }
    const hash = hashText(snap.json);
    if (hash === r.recoveryHash) {
      return;
    }
    await native.recoveryWrite(docId, snap.json);
    r.recoveryHash = hash;
  };
  const p = r.recoveryChain.then(run, run);
  r.recoveryChain = p.catch(() => {});
  return mustSucceed ? p : p.catch(() => {});
};

const dropRecovery = (docId: string) => {
  rt(docId).recoveryHash = null;
  return native.recoveryDelete(docId).catch(() => {});
};

// ------------------------------------------------------------------ saving

const scheduleAutosave = (docId: string) => {
  const r = rt(docId);
  const now = Date.now();
  r.autosaveFirstAt ??= now;
  window.clearTimeout(r.autosaveTimer);
  const delay = Math.max(
    0,
    Math.min(AUTOSAVE_DEBOUNCE_MS, AUTOSAVE_MAX_MS - (now - r.autosaveFirstAt)),
  );
  r.autosaveTimer = window.setTimeout(() => {
    r.autosaveFirstAt = null;
    const doc = docOf(docId);
    if (doc?.path && doc.status === "dirty" && r.latest) {
      void enqueueSave(docId, r.latest.json, "auto");
    }
  }, delay);
};

/**
 * One write in flight per document; only the newest pending content is kept.
 * A write marks the doc saved only if nothing changed while it was running.
 */
const enqueueSave = (docId: string, json: string, mode: SaveMode) =>
  new Promise<boolean>((resolve) => {
    const r = rt(docId);
    r.saveWaiters.push(resolve);
    const prevMode = r.queued?.mode;
    r.queued = {
      json,
      mode: prevMode === "force" || prevMode === "manual" ? prevMode : mode,
    };
    if (mode === "force" || mode === "manual") {
      r.queued.mode = mode;
    }
    if (!r.saving) {
      void drainSaves(docId);
    }
  });

const drainSaves = async (docId: string) => {
  const r = rt(docId);
  r.saving = true;
  let ok = true;
  while (r.queued) {
    const { json, mode } = r.queued;
    r.queued = null;
    const doc = docOf(docId);
    if (!doc?.path) {
      ok = false;
      break;
    }
    const hash = hashText(json);
    updateDoc(docId, { status: "saving" });
    try {
      if (mode === "manual" || mode === "force") {
        await native.backupCreate(doc.path, mode === "force" ? "conflict" : "manual");
        r.lastCheckpoint = Date.now();
      } else if (Date.now() - r.lastCheckpoint > CHECKPOINT_EVERY_MS) {
        await native.backupCreate(doc.path, "checkpoint");
        r.lastCheckpoint = Date.now();
      }
      const res = await native.docSave(doc.path, json, doc.diskVersion, mode === "force");
      if (res.kind === "conflict") {
        updateDoc(docId, { status: "conflict" });
        ok = false;
        r.queued = null;
        break;
      }
      const current = docOf(docId)!;
      const upToDate = current.currentHash === hash || current.currentHash === null;
      updateDoc(docId, {
        diskVersion: res.version,
        savedHash: hash,
        status: upToDate ? "saved" : "dirty",
        error: undefined,
      });
      if (upToDate) {
        void dropRecovery(docId);
        window.setTimeout(() => {
          if (docOf(docId)?.status === "saved") {
            updateDoc(docId, { status: "clean" });
          }
        }, 1400);
      }
    } catch (error) {
      updateDoc(docId, { status: "error", error: String(error) });
      ok = false;
      r.queued = null;
      toast(`Could not save ${doc.displayName}: ${error}`, "error", 6000);
      break;
    }
  }
  r.saving = false;
  updateTitle();
  scheduleSessionSave();
  r.saveWaiters.splice(0).forEach((w) => w(ok));
};

const freshSnapshot = async (docId: string) => {
  if (hasFrame(docId)) {
    const snap = await requestSnapshot(docId);
    if (snap) {
      handleSnapshot(docId, snap);
      return snap;
    }
  }
  const r = rt(docId);
  if (r.latest) {
    return r.latest;
  }
  const recovered = await native.recoveryRead(docId).catch(() => null);
  return recovered
    ? { json: recovered, view: docOf(docId)?.view ?? { scrollX: 0, scrollY: 0, zoom: 1 }, version: 0 }
    : null;
};

export const saveDoc = async (docId: string): Promise<boolean> => {
  const doc = docOf(docId);
  if (!doc) {
    return false;
  }
  if (!doc.path || doc.status === "missing") {
    return saveDocAs(docId);
  }
  if (doc.status === "conflict") {
    return resolveConflict(docId);
  }
  const snap = await freshSnapshot(docId);
  if (!snap) {
    return false;
  }
  const ok = await enqueueSave(docId, snap.json, "manual");
  if (ok) {
    toast(`Saved ${doc.displayName}`, "success", 1800);
  } else if (docOf(docId)?.status === "conflict") {
    return resolveConflict(docId);
  }
  return ok;
};

/** Pick a target; enforce one-record-per-path and explicit overwrite. */
const pickSaveTarget = async (doc: DocumentRecord): Promise<string | null> => {
  for (;;) {
    const picked = await native.pickSave(
      doc.path ?? `${stripExt(doc.displayName)}.excalidraw`,
    );
    if (!picked) {
      return null;
    }
    const target = await native.docCanonical(picked);
    const other = docByPath(target);
    if (other && other.docId !== doc.docId) {
      const answer = await showDialog({
        title: "File already open",
        body: `"${baseName(target)}" is open in another tab. Saving over it here would give two tabs the same file.`,
        buttons: [
          { id: "switch", label: "Switch to it" },
          { id: "again", label: "Choose another name", kind: "primary" },
        ],
        cancelId: "cancel",
      });
      if (answer === "switch") {
        const tab = tabOfDoc(other.docId);
        if (tab) {
          void activateTab(tab.tabId);
        }
        return null;
      }
      if (answer === "again") {
        continue;
      }
      return null;
    }
    return target;
  }
};

export const saveDocAs = async (docId: string): Promise<boolean> => {
  const doc = docOf(docId);
  if (!doc) {
    return false;
  }
  if (!IN_TAURI) {
    toast("Saving to disk needs the desktop app", "error");
    return false;
  }
  const target = await pickSaveTarget(doc);
  if (!target) {
    return false;
  }
  const isSelf = samePath(target, doc.path);
  let expected: DiskVersion | null = isSelf ? doc.diskVersion : null;
  const existing = await native.docVersion(target).catch(() => null);
  if (existing && !isSelf) {
    // the OS picker already asked "replace?"; this is our own versioned confirm
    const answer = await showDialog({
      title: "Replace file?",
      body: `"${baseName(target)}" already exists. Replace it with this drawing? A backup of the current file is kept in File history.`,
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "replace", label: "Replace", kind: "danger" },
      ],
      cancelId: "cancel",
    });
    if (answer !== "replace") {
      return false;
    }
    await native.backupCreate(target, "replaced").catch(() => {});
    expected = existing;
  }
  const snap = await freshSnapshot(docId);
  if (!snap) {
    return false;
  }
  const oldPath = doc.path;
  updateDoc(docId, {
    path: target,
    displayName: baseName(target),
    diskVersion: expected,
    savedHash: null,
    status: "dirty",
  });
  const ok = await enqueueSave(docId, snap.json, "manual");
  if (!ok) {
    updateDoc(docId, {
      path: oldPath,
      displayName: doc.displayName,
      diskVersion: doc.diskVersion,
      savedHash: doc.savedHash,
      status: "dirty",
    });
    syncWatcher();
    return false;
  }
  sendToFrame(docId, { type: "name", name: stripExt(baseName(target)) });
  addRecent(target);
  syncWatcher();
  toast(`Saved ${baseName(target)}`, "success", 1800);
  return true;
};

// ------------------------------------------------------------------ conflicts & watcher

export const resolveConflict = async (docId: string): Promise<boolean> => {
  const doc = docOf(docId);
  if (!doc?.path) {
    return false;
  }
  const answer = await showDialog({
    title: "File changed on disk",
    body: `"${doc.displayName}" was changed by another program while it has unsaved changes here.`,
    buttons: [
      { id: "theirs", label: "Load theirs" },
      { id: "saveas", label: "Save mine as…" },
      { id: "mine", label: "Keep mine", kind: "primary" },
    ],
    cancelId: "cancel",
  });
  if (answer === "mine") {
    const snap = await freshSnapshot(docId);
    if (!snap) {
      return false;
    }
    updateDoc(docId, { status: "dirty" });
    const ok = await enqueueSave(docId, snap.json, "force");
    if (ok) {
      toast(`Saved ${doc.displayName} (the other version is in File history)`, "success");
    }
    return ok;
  }
  if (answer === "theirs") {
    await reloadFromDisk(docId);
    return true;
  }
  if (answer === "saveas") {
    updateDoc(docId, { status: "dirty" });
    return saveDocAs(docId);
  }
  return false;
};

const reloadFromDisk = async (docId: string) => {
  const doc = docOf(docId);
  if (!doc?.path) {
    return;
  }
  try {
    const opened = await native.docOpen(doc.path);
    updateDoc(docId, { diskVersion: opened.version, status: "clean" });
    const r = rt(docId);
    if (hasFrame(docId)) {
      r.pendingLoad = { json: opened.text, view: null, fromDisk: true };
      sendToFrame(docId, { type: "replace", json: opened.text, fromDisk: true });
    } else {
      r.pendingLoad = null;
    }
    await dropRecovery(docId);
  } catch (error) {
    toast(`Could not reload ${doc.displayName}: ${error}`, "error");
  }
};

const onDiskChange = async (path: string, kind: "modified" | "removed") => {
  const doc = docByPath(path);
  if (!doc) {
    return;
  }
  if (kind === "removed") {
    updateDoc(doc.docId, { status: "missing" });
    toast(`${doc.displayName} was moved or deleted on disk`, "error", 5000);
    return;
  }
  const version = await native.docVersion(path).catch(() => null);
  if (!version || (doc.diskVersion && version.sha256 === doc.diskVersion.sha256)) {
    if (doc.status === "missing" && version) {
      updateDoc(doc.docId, { status: isUnsaved(doc) ? "dirty" : "clean" });
    }
    return;
  }
  if (isUnsaved(doc) || doc.status === "saving") {
    updateDoc(doc.docId, { status: "conflict" });
    toast(`${doc.displayName} changed on disk — click its tab icon to resolve`, "error", 6000);
  } else {
    await reloadFromDisk(doc.docId);
    toast(`Reloaded ${doc.displayName} from disk`);
  }
};

// ------------------------------------------------------------------ open & import

export const openPaths = async (paths: string[]) => {
  for (const raw of paths) {
    const lower = raw.toLowerCase();
    try {
      if (lower.endsWith(".excalidrawlib")) {
        await importLibrary(raw);
        continue;
      }
      const canonical = await native.docCanonical(raw);
      const existing = docByPath(canonical);
      if (existing) {
        const tab = tabOfDoc(existing.docId);
        if (tab) {
          await activateTab(tab.tabId);
        }
        continue;
      }
      const opened = await native.docOpen(canonical);
      const parsed = JSON.parse(opened.text);
      if (parsed?.type !== "excalidraw") {
        throw new Error("not an Excalidraw drawing");
      }
      if (lower.endsWith(".json")) {
        // plain JSON scenes are imported as a new untitled drawing
        const doc = blankDoc({ displayName: stripExt(baseName(canonical)) });
        rt(doc.docId).pendingLoad = { json: opened.text, view: null, fromDisk: false };
        addTab(doc);
        continue;
      }
      const doc = blankDoc({
        path: opened.canonical,
        displayName: baseName(opened.canonical),
        diskVersion: opened.version,
      });
      rt(doc.docId).pendingLoad = { json: opened.text, view: null, fromDisk: true };
      addTab(doc);
      addRecent(opened.canonical);
    } catch (error) {
      toast(`Could not open ${baseName(raw)}: ${error instanceof Error ? error.message : error}`, "error", 6000);
    }
  }
};

export const importLibrary = async (path: string) => {
  const opened = await native.docOpen(path);
  const data = JSON.parse(opened.text);
  const items: unknown[] = data.libraryItems ?? data.library ?? [];
  if (!Array.isArray(items) || data.type !== "excalidrawlib") {
    throw new Error("not an Excalidraw library");
  }
  const existing = getState().library as { id?: string }[];
  const ids = new Set(existing.map((i) => i.id));
  const merged = [...existing, ...items.filter((i: any) => !ids.has(i?.id))];
  setState({ library: merged });
  native.metaWrite("library", JSON.stringify(merged)).catch(() => {});
  broadcast({ type: "library", items: merged });
  toast(`Added ${items.length} library item${items.length === 1 ? "" : "s"}`, "success");
};

export const openDialog = async () => {
  if (!IN_TAURI) {
    toast("Opening files needs the desktop app", "error");
    return;
  }
  const paths = await native.pickOpen();
  await openPaths(paths);
};

/** Library picker (menu / palette). */
export const importLibraryDialog = async () => {
  if (!IN_TAURI) {
    toast("Importing libraries needs the desktop app", "error");
    return;
  }
  const paths = await native.pickOpen([{ name: "Excalidraw library", extensions: ["excalidrawlib"] }]);
  for (const p of paths) {
    try {
      await importLibrary(p);
    } catch (error) {
      toast(`Could not import ${baseName(p)}: ${error instanceof Error ? error.message : error}`, "error", 6000);
    }
  }
};

/** A scene (template, backup, …) opened as a new unsaved tab. */
export const openSceneAsNewTab = (json: string | null, name: string) => {
  const doc = blankDoc({ displayName: name });
  rt(doc.docId).pendingLoad = { json, view: null, fromDisk: false };
  addTab(doc);
  return doc.docId;
};

// ------------------------------------------------------- loaded / reveal

const loadWaiters = new Map<string, (() => void)[]>();

/** Resolves once the document's editor has its scene. */
export const whenLoaded = (docId: string) =>
  new Promise<void>((resolve) => {
    if (hasFrame(docId) && !getState().loading[docId] && rt(docId).latest && !rt(docId).pendingLoad) {
      resolve();
      return;
    }
    const list = loadWaiters.get(docId) ?? [];
    list.push(resolve);
    loadWaiters.set(docId, list);
  });

/** Switch to a document's tab and show one element in it. */
export const revealInDoc = async (docId: string, elementId: string) => {
  const tab = tabOfDoc(docId);
  if (!tab) {
    return;
  }
  await activateTab(tab.tabId);
  await whenLoaded(docId);
  await requestFrame(docId, { op: "reveal", id: elementId }).catch((error) =>
    toast(String(error.message ?? error), "error"),
  );
};

/** The newest known JSON of a document, mounted or not. */
export const docSceneJSON = async (docId: string): Promise<string | null> => {
  const r = rt(docId);
  if (r.latest) {
    return r.latest.json;
  }
  if (r.pendingLoad?.json) {
    return r.pendingLoad.json;
  }
  const fromRecovery = await native.recoveryRead(docId).catch(() => null);
  if (fromRecovery) {
    return fromRecovery;
  }
  const doc = docOf(docId);
  if (doc?.path) {
    return (await native.docOpen(doc.path).catch(() => null))?.text ?? null;
  }
  return null;
};

/** New untitled tab built from template skeletons (null = blank). */
export const openTemplate = (elements: unknown[] | null, name: string) => {
  const doc = blankDoc({ displayName: name });
  const r = rt(doc.docId);
  r.pendingLoad = { json: null, view: null, fromDisk: false };
  if (elements?.length) {
    r.afterLoad.push({ type: "skeleton", elements });
  }
  addTab(doc);
};

/**
 * Restore a backup: the file's current version is backed up first, then the
 * backup opens as a new unsaved tab. The original changes only when saved.
 */
export const restoreBackup = async (docId: string, backupId: string, label: string) => {
  const doc = docOf(docId);
  if (!doc?.path) {
    return;
  }
  const text = await native.backupRead(doc.path, backupId);
  await native.backupCreate(doc.path, "restore").catch(() => null);
  openSceneAsNewTab(text, `${stripExt(baseName(doc.path))} (${label})`);
};

// ------------------------------------------------------------ frame order

/** Local frame order (AppData only, never written into the drawing). */
let frameOrders: Record<string, string[]> | null = null;

const frameOrderKey = (docId: string) => {
  const doc = docOf(docId);
  return doc?.path ? `path:${doc.path.toLowerCase()}` : `doc:${docId}`;
};

const loadFrameOrders = async () => {
  if (!frameOrders) {
    frameOrders = await readJSON<Record<string, string[]>>(native.metaRead("frame-order"), {});
  }
  return frameOrders;
};

export const getFrameOrder = async (docId: string) =>
  (await loadFrameOrders())[frameOrderKey(docId)] ?? null;

export const setFrameOrder = async (docId: string, ids: string[] | null) => {
  const all = await loadFrameOrders();
  const key = frameOrderKey(docId);
  if (ids) {
    all[key] = ids;
  } else {
    delete all[key];
  }
  native.metaWrite("frame-order", JSON.stringify(all)).catch(() => {});
};

// ----------------------------------------------------------- presentation

let presentedFullscreen = false;

export const startPresentation = async (docId: string) => {
  if (getState().presenting) {
    await endPresentation();
    return;
  }
  const order = (await getFrameOrder(docId)) ?? [];
  setState({ presenting: docId, panel: null });
  try {
    if (IN_TAURI) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const win = getCurrentWindow();
      if (!(await win.isFullscreen())) {
        await win.setFullscreen(true);
        presentedFullscreen = true;
      }
    }
    await requestFrame(docId, { op: "present", ids: order });
  } catch (error) {
    await endPresentation();
    toast(`Could not start the presentation: ${error instanceof Error ? error.message : error}`, "error");
  }
};

export const endPresentation = async () => {
  setState({ presenting: null });
  if (IN_TAURI && presentedFullscreen) {
    presentedFullscreen = false;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setFullscreen(false).catch(() => {});
  }
};

// ------------------------------------------------------------------ home

export const showHome = () => {
  setState({ homeOpen: true, renamingTabId: null, panel: null });
  updateTitle();
};

/** Back to the drawing that was active before Home was opened. */
export const hideHome = () => {
  const s = getState();
  if (s.activeTabId && s.tabs.some((t) => t.tabId === s.activeTabId)) {
    void activateTab(s.activeTabId);
  } else if (s.tabs[0]) {
    void activateTab(s.tabs[0].tabId);
  }
};

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

const toDataURL = (bytes: Uint8Array, mime: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }));
  });

/** New tab with one image, centred, locked as background, annotate mode on. */
export const openImageTab = (file: { name: string; mime: string; dataURL: string }) => {
  const doc = blankDoc({ displayName: file.name.replace(/\.[^.]+$/, "") || untitledName() });
  const r = rt(doc.docId);
  r.pendingLoad = { json: null, view: null, fromDisk: false };
  r.afterLoad.push({
    type: "insert-images",
    files: [file],
    x: -1,
    y: -1,
    lock: true,
    annotate: true,
  });
  addTab(doc);
};

/** Opens each picked image in its own new tab, ready to annotate. */
export const annotateImages = async (paths?: string[]) => {
  if (!IN_TAURI) {
    toast("Opening images needs the desktop app", "error");
    return;
  }
  const picked = paths ?? (await native.pickImages());
  for (const path of picked) {
    const mime = IMAGE_MIME[path.split(".").pop()?.toLowerCase() ?? ""];
    if (!mime) {
      continue;
    }
    try {
      const dataURL = await toDataURL(await native.docReadBytes(path), mime);
      openImageTab({ name: baseName(path), mime, dataURL });
    } catch (error) {
      toast(`Could not open ${baseName(path)}: ${error}`, "error");
    }
  }
};

export const togglePinRecent = (path: string) => {
  setState((s) => {
    const recents = s.recents.map((r) =>
      samePath(r.path, path) ? { ...r, pinnedRecent: !r.pinnedRecent } : r,
    );
    return {
      recents: [...recents.filter((r) => r.pinnedRecent), ...recents.filter((r) => !r.pinnedRecent)],
    };
  });
  native.metaWrite("recent-files", JSON.stringify(getState().recents)).catch(() => {});
  pushMenuState();
};

// ------------------------------------------------------------------ closing tabs

export const closeTab = async (tabId: string, opts: { skipPinned?: boolean } = {}) => {
  const s = getState();
  const tab = s.tabs.find((t) => t.tabId === tabId);
  if (!tab || (opts.skipPinned && tab.pinnedTab)) {
    return;
  }
  const doc = docOf(tab.docId);
  if (!doc) {
    return;
  }
  if (hasFrame(doc.docId)) {
    const snap = await requestSnapshot(doc.docId);
    if (snap) {
      handleSnapshot(doc.docId, snap);
    }
  }
  const fresh = docOf(doc.docId)!;
  if (isUnsaved(fresh)) {
    const answer = await showDialog({
      title: "Save changes?",
      body: `Do you want to save the changes to "${fresh.displayName}"?`,
      buttons: [
        { id: "cancel", label: "Cancel" },
        { id: "discard", label: "Don't save", kind: "danger" },
        { id: "save", label: "Save", kind: "primary" },
      ],
      cancelId: "cancel",
    });
    if (answer === "cancel") {
      return;
    }
    if (answer === "save" && !(await saveDoc(fresh.docId))) {
      return;
    }
  }
  removeTab(tabId);
};

const removeTab = (tabId: string) => {
  const s = getState();
  const index = s.tabs.findIndex((t) => t.tabId === tabId);
  const tab = s.tabs[index];
  if (!tab) {
    return;
  }
  const doc = s.docs[tab.docId];
  const tabs = s.tabs.filter((t) => t.tabId !== tabId);
  const docs = { ...s.docs };
  delete docs[tab.docId];
  const closed = doc?.path
    ? [{ path: doc.path, displayName: doc.displayName }, ...s.closed.filter((c) => !samePath(c.path, doc.path))].slice(0, MAX_CLOSED)
    : s.closed;
  let nextActive = s.activeTabId;
  if (s.activeTabId === tabId) {
    const neighbour = tabs[Math.min(index, tabs.length - 1)];
    nextActive = neighbour?.tabId ?? null;
  }
  setState({
    tabs,
    docs,
    closed,
    mounted: s.mounted.filter((id) => id !== tab.docId),
    activeTabId: nextActive,
  });
  void dropRecovery(tab.docId);
  runtimes.delete(tab.docId);
  syncWatcher();
  if (!tabs.length) {
    showHome();
  } else if (nextActive) {
    void activateTab(nextActive);
  }
  scheduleSessionSave();
};

export const reopenClosedTab = async () => {
  const [first, ...rest] = getState().closed;
  if (!first) {
    return;
  }
  setState({ closed: rest });
  await openPaths([first.path]);
};

// ------------------------------------------------------------------ tab ops

export const cycleTab = (delta: number) => {
  const s = getState();
  if (!s.tabs.length) {
    return;
  }
  const i = s.tabs.findIndex((t) => t.tabId === s.activeTabId);
  const next = s.tabs[(i + delta + s.tabs.length) % s.tabs.length];
  void activateTab(next.tabId);
};

export const gotoTab = (n: number) => {
  const s = getState();
  const tab = n === 9 ? s.tabs[s.tabs.length - 1] : s.tabs[n - 1];
  if (tab) {
    void activateTab(tab.tabId);
  }
};

export const moveTab = (tabId: string, toIndex: number) => {
  setState((s) => {
    const tabs = [...s.tabs];
    const from = tabs.findIndex((t) => t.tabId === tabId);
    if (from < 0) {
      return {};
    }
    const [tab] = tabs.splice(from, 1);
    // pinned tabs stay left of unpinned ones
    const pinnedCount = tabs.filter((t) => t.pinnedTab).length;
    const bounded = tab.pinnedTab
      ? Math.min(toIndex, pinnedCount)
      : Math.max(toIndex, pinnedCount);
    tabs.splice(Math.max(0, Math.min(bounded, tabs.length)), 0, tab);
    return { tabs };
  });
  scheduleSessionSave();
};

export const togglePinTab = (tabId: string) => {
  setState((s) => {
    const tabs = s.tabs.map((t) => (t.tabId === tabId ? { ...t, pinnedTab: !t.pinnedTab } : t));
    return { tabs: [...tabs.filter((t) => t.pinnedTab), ...tabs.filter((t) => !t.pinnedTab)] };
  });
  scheduleSessionSave();
};

/** Inline rename: untitled → display name only; saved docs → rename on disk. */
export const renameTab = async (tabId: string, rawName: string) => {
  setState({ renamingTabId: null });
  const tab = getState().tabs.find((t) => t.tabId === tabId);
  const doc = tab && docOf(tab.docId);
  const name = rawName.trim().replace(/[\\/:*?"<>|]/g, "");
  if (!doc || !name || stripExt(doc.displayName) === name) {
    return;
  }
  if (!doc.path) {
    updateDoc(doc.docId, { displayName: name });
    sendToFrame(doc.docId, { type: "name", name });
    scheduleSessionSave();
    updateTitle();
    return;
  }
  const dir = doc.path.slice(0, doc.path.length - baseName(doc.path).length);
  const target = `${dir}${name}.excalidraw`;
  const other = docByPath(target);
  if (other && other.docId !== doc.docId) {
    toast(`"${name}.excalidraw" is already open in another tab`, "error");
    return;
  }
  try {
    const renamed = await native.docRename(doc.path, target);
    const version = await native.docVersion(renamed);
    renameRecent(doc.path, renamed);
    updateDoc(doc.docId, { path: renamed, displayName: baseName(renamed), diskVersion: version });
    sendToFrame(doc.docId, { type: "name", name });
    syncWatcher();
    updateTitle();
    scheduleSessionSave();
  } catch (error) {
    toast(
      String(error).includes("exists")
        ? `A file named "${name}.excalidraw" already exists in that folder`
        : `Could not rename: ${error}`,
      "error",
    );
  }
};

/** Labels, adding the parent folder when two tabs share a file name. */
export const tabLabel = (s: State, doc: DocumentRecord) => {
  const name = stripExt(doc.displayName);
  if (!doc.path) {
    return { name, hint: "" };
  }
  const clash = Object.values(s.docs).some(
    (d) => d.docId !== doc.docId && d.path && baseName(d.path).toLowerCase() === baseName(doc.path!).toLowerCase(),
  );
  return { name, hint: clash ? parentName(doc.path) : "" };
};

// ------------------------------------------------------------------ prefs

export const setThemePref = (pref: ThemePref) => {
  setState({ themePref: pref });
  broadcast({ type: "theme", theme: resolvedTheme(getState()) });
  savePrefs();
  pushMenuState();
};

export const setSystemTheme = (dark: boolean) => {
  setState({ systemTheme: dark ? "dark" : "light" });
  broadcast({ type: "theme", theme: resolvedTheme(getState()) });
};

export const toggleAutosave = () => {
  setState((s) => ({ autosave: !s.autosave }));
  savePrefs();
  pushMenuState();
  toast(`Auto-save to disk ${getState().autosave ? "on" : "off"}`);
};

export const togglePinned = async () => {
  const pinned = !getState().pinned;
  if (IN_TAURI) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setAlwaysOnTop(pinned).catch(() => {});
  }
  setState({ pinned });
  savePrefs();
  pushMenuState();
};

// ------------------------------------------------------------------ commands

export const runCommand = async (
  command: string,
  arg?: string | number,
  fromDocId?: string,
) => {
  const s = getState();
  const activeDocId =
    fromDocId ?? s.tabs.find((t) => t.tabId === s.activeTabId)?.docId ?? null;
  switch (command) {
    case "new":
      newTab();
      break;
    case "open":
      await openDialog();
      break;
    case "save":
      if (activeDocId) {
        await saveDoc(activeDocId);
      }
      break;
    case "saveAs":
      if (activeDocId) {
        await saveDocAs(activeDocId);
      }
      break;
    case "closeTab":
      if (s.activeTabId) {
        await closeTab(s.activeTabId, { skipPinned: true });
      }
      break;
    case "reopenTab":
      await reopenClosedTab();
      break;
    case "nextTab":
      cycleTab(1);
      break;
    case "prevTab":
      cycleTab(-1);
      break;
    case "gotoTab":
      gotoTab(Number(arg));
      break;
    case "recovery":
      setState({ recoveryOpen: true });
      break;
    case "about":
      window.dispatchEvent(new Event("dsk-about"));
      break;
    case "home":
      showHome();
      break;
    case "toggleAutosave":
      toggleAutosave();
      break;
    case "togglePin":
      await togglePinned();
      break;
    case "theme":
      setThemePref(arg as ThemePref);
      break;
    case "export":
    case "frames":
    case "annotations":
    case "history":
      if (activeDocId && !s.homeOpen) {
        setState({ panel: { kind: command, docId: activeDocId } });
      } else {
        toast("Open a drawing first", "error");
      }
      break;
    case "switcher":
    case "search":
    case "templates":
      setState({ panel: { kind: command, docId: activeDocId } });
      break;
    case "present":
      if (activeDocId && !s.homeOpen) {
        await startPresentation(activeDocId);
      }
      break;
    case "importLibrary":
      await importLibraryDialog();
      break;
    case "annotate":
      if (activeDocId && !s.homeOpen) {
        sendToFrame(activeDocId, { type: "annotate-toggle" });
        sendToFrame(activeDocId, { type: "focus" });
      }
      break;
    case "presentEnd":
      await endPresentation();
      break;
    case "openRecent":
      if (typeof arg === "string") {
        if (s.recentsExist[arg.toLowerCase()] === false) {
          const answer = await showDialog({
            title: "File not found",
            body: `"${baseName(arg)}" no longer exists at ${arg}.`,
            buttons: [
              { id: "keep", label: "Keep in list" },
              { id: "remove", label: "Remove from list", kind: "primary" },
            ],
            cancelId: "keep",
          });
          if (answer === "remove") {
            removeRecent(arg);
          }
        } else {
          await openPaths([arg]);
        }
      }
      break;
  }
};

// ------------------------------------------------------------------ startup & shutdown

type SessionFile = {
  version: 1;
  activeTabId: string | null;
  tabs: Tab[];
  closed: State["closed"];
  docs: Record<
    string,
    Pick<DocumentRecord, "docId" | "path" | "displayName" | "diskVersion" | "savedHash" | "currentHash" | "view"> & {
      dirty: boolean;
    }
  >;
};

const readJSON = async <T,>(p: Promise<string | null>, fallback: T): Promise<T> => {
  try {
    const text = await p;
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
};

export const startup = async () => {
  const stop = listenToFrames(onFrameMessage);

  const [prefs, recents, library] = await Promise.all([
    readJSON<{ autosave?: boolean; themePref?: ThemePref; pinned?: boolean }>(native.metaRead("prefs"), {}),
    readJSON<Recent[]>(native.metaRead("recent-files"), []),
    readJSON<unknown[]>(native.metaRead("library"), []),
  ]);
  let session: SessionFile | null = null;
  try {
    const text = await native.sessionLoad();
    session = text ? (JSON.parse(text) as SessionFile) : null;
  } catch {
    toast("The previous session file was damaged and has been set aside", "error", 6000);
  }

  const docs: Record<string, DocumentRecord> = {};
  const tabs: Tab[] = [];
  if (session?.version === 1) {
    for (const tab of session.tabs ?? []) {
      const d = session.docs?.[tab.docId];
      if (!d) {
        continue;
      }
      docs[d.docId] = {
        docId: d.docId,
        path: d.path,
        displayName: d.displayName,
        diskVersion: d.diskVersion,
        savedHash: d.savedHash,
        currentHash: d.currentHash,
        status: d.dirty ? "dirty" : "clean",
        view: d.view,
        historyDiscarded: false,
      };
      tabs.push(tab);
    }
  }

  setState({
    ready: true,
    docs,
    tabs,
    closed: session?.closed ?? [],
    recents,
    library,
    autosave: prefs.autosave ?? true,
    themePref: prefs.themePref ?? "system",
    pinned: false,
  });
  if (prefs.pinned) {
    void togglePinned();
  }

  const launch = await native.launchFiles().catch(() => [] as string[]);
  const activeId =
    session?.activeTabId && tabs.some((t) => t.tabId === session!.activeTabId)
      ? session.activeTabId
      : tabs[0]?.tabId;
  if (activeId && !launch.length) {
    await activateTab(activeId);
  }
  if (launch.length) {
    await openPaths(launch);
  }
  if (!getState().tabs.length) {
    showHome();
  }

  // after first paint: watcher, recents, disk drift check, orphan recovery
  window.setTimeout(async () => {
    syncWatcher();
    void refreshRecentsExist();
    for (const doc of Object.values(getState().docs)) {
      if (!doc.path) {
        continue;
      }
      const version = await native.docVersion(doc.path).catch(() => null);
      if (!version) {
        updateDoc(doc.docId, { status: "missing" });
      } else if (doc.diskVersion && version.sha256 !== doc.diskVersion.sha256) {
        if (isUnsaved(doc)) {
          updateDoc(doc.docId, { status: "conflict" });
        } else if (getState().mounted.includes(doc.docId)) {
          await reloadFromDisk(doc.docId);
        } else {
          updateDoc(doc.docId, { diskVersion: version });
        }
      }
    }
    const orphans = await listOrphanRecovery();
    if (orphans.length) {
      setState({ recoveryOpen: true });
    }
  }, 400);

  return stop;
};

/** Recovery snapshots no open tab owns; empty ones are deleted silently. */
export const listOrphanRecovery = async () => {
  const entries = await native.recoveryList().catch(() => []);
  const known = new Set(Object.keys(getState().docs));
  const orphans = [];
  for (const entry of entries.filter((e) => !known.has(e.id))) {
    const text = await native.recoveryRead(entry.id).catch(() => null);
    if (!text || !hasElements(text)) {
      await native.recoveryDelete(entry.id).catch(() => {});
      continue;
    }
    orphans.push(entry);
  }
  return orphans;
};

export const openRecovered = async (id: string) => {
  const text = await native.recoveryRead(id);
  if (!text) {
    toast("That recovery snapshot could not be read", "error");
    return;
  }
  const doc = blankDoc({ displayName: `Recovered ${untitledName()}` });
  rt(doc.docId).pendingLoad = { json: text, view: null, fromDisk: false };
  addTab(doc);
  // the snapshot now belongs to the new tab; the orphan file is removed
  await native.recoveryWrite(doc.docId, text).catch(() => {});
  await native.recoveryDelete(id).catch(() => {});
};

export const discardRecovered = (id: string) => native.recoveryDelete(id).catch(() => {});

/** Window close: flush everything, then persist the session. */
export const flushAll = async () => {
  const s = getState();
  await Promise.all(
    s.mounted.map(async (docId) => {
      const snap = await requestSnapshot(docId, 2000);
      if (snap) {
        handleSnapshot(docId, snap);
      }
      const doc = docOf(docId);
      if (doc && isUnsaved(doc)) {
        await flushRecovery(docId, true).catch(() => {});
      }
    }),
  );
  // wait for in-flight saves
  await Promise.all(
    [...runtimes.entries()]
      .filter(([, r]) => r.saving)
      .map(
        ([, r]) => new Promise<void>((res) => r.saveWaiters.push(() => res())),
      ),
  );
  await saveSessionNow();
};

export const hasSaveErrors = () =>
  Object.values(getState().docs).some((d) => d.status === "error");

export const onDocChangedEvent = (payload: { path: string; kind: "modified" | "removed" }) =>
  onDiskChange(payload.path, payload.kind);
