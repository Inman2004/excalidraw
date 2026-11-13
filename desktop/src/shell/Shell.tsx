import { useEffect, useRef, useState } from "react";

import { shortcutToCommand } from "../common/protocol";

import {
  flushAll,
  hasSaveErrors,
  onDocChangedEvent,
  openPaths,
  runCommand,
  setSystemTheme,
  startup,
} from "./controller";
import { frameElement, registerFrame, sendToFrame } from "./frames";
import { IN_TAURI, baseName, native } from "./native";
import { Home } from "./Home";
import { PanelHost } from "./Panels";
import { RecoveryCenter } from "./RecoveryCenter";
import { activeDoc, resolvedTheme, setState, showDialog, toast, useStore } from "./store";
import { TabBar } from "./TabBar";
import { DialogHost, Modal } from "./ui/Dialogs";
import { Toasts } from "./ui/Toasts";

import pkg from "../../package.json";

const IMAGE_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
};

const extOf = (path: string) => path.split(".").pop()?.toLowerCase() ?? "";

const dropHintFor = (paths: string[]) => {
  const docs = paths.filter((p) => /\.(excalidraw|json)$/i.test(p)).length;
  const libs = paths.filter((p) => /\.excalidrawlib$/i.test(p)).length;
  const images = paths.filter((p) => IMAGE_EXT[extOf(p)]).length;
  const parts = [
    docs && `open ${docs} drawing${docs > 1 ? "s" : ""} in new tabs`,
    libs && `add ${libs} librar${libs > 1 ? "ies" : "y"}`,
    images && `insert ${images} image${images > 1 ? "s" : ""} here`,
  ].filter(Boolean);
  return parts.length ? `Drop to ${parts.join(", ")}` : "These files can't be opened here";
};

const bytesToDataURL = (bytes: Uint8Array, mime: string) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes as BlobPart], { type: mime }));
  });

/** Routes native file drops: drawings → tabs, libraries → library, images → canvas. */
const handleNativeDrop = async (paths: string[], cssX: number, cssY: number) => {
  const docPaths = paths.filter((p) => /\.(excalidraw|json|excalidrawlib)$/i.test(p));
  const imagePaths = paths.filter((p) => IMAGE_EXT[extOf(p)]);
  if (docPaths.length) {
    await openPaths(docPaths);
  }
  const doc = activeDoc((await import("./store")).getState());
  if (imagePaths.length && doc) {
    const frame = frameElement(doc.docId);
    const rect = frame?.getBoundingClientRect();
    const files = [];
    for (const p of imagePaths) {
      try {
        const bytes = await native.docReadBytes(p);
        files.push({ name: baseName(p), mime: IMAGE_EXT[extOf(p)], dataURL: await bytesToDataURL(bytes, IMAGE_EXT[extOf(p)]) });
      } catch (error) {
        toast(`Could not read ${baseName(p)}: ${error}`, "error");
      }
    }
    if (files.length) {
      sendToFrame(doc.docId, {
        type: "insert-images",
        files,
        x: cssX - (rect?.left ?? 0),
        y: cssY - (rect?.top ?? 0),
      });
    }
  }
  const unsupported = paths.length - docPaths.length - imagePaths.length;
  if (unsupported > 0) {
    toast(`${unsupported} file${unsupported > 1 ? "s" : ""} skipped: not a drawing, library or image`, "error");
  }
};

const FrameHost = () => {
  const mounted = useStore((s) => s.mounted);
  const activeDocId = useStore((s) =>
    s.homeOpen ? undefined : s.tabs.find((t) => t.tabId === s.activeTabId)?.docId,
  );
  // one stable ref callback per frame: an inline callback would unregister and
  // re-register the frame on every render, resetting its "ready" state
  const refs = useRef(new Map<string, (el: HTMLIFrameElement | null) => void>());
  const refFor = (docId: string) => {
    let cb = refs.current.get(docId);
    if (!cb) {
      cb = (el) => {
        registerFrame(docId, el);
        if (!el) {
          refs.current.delete(docId);
        }
      };
      refs.current.set(docId, cb);
    }
    return cb;
  };
  // `mounted` is most-recently-used first; rendering in that order would move
  // iframe nodes on every tab switch, and a moved iframe reloads (losing undo).
  // A fixed order (first time mounted) keeps every frame where it is.
  const order = useRef<string[]>([]);
  order.current = [
    ...order.current.filter((id) => mounted.includes(id)),
    ...mounted.filter((id) => !order.current.includes(id)),
  ];
  const loading = useStore((s) => (activeDocId ? !!s.loading[activeDocId] : false));
  return (
    <div className="dsk-frames">
      {loading && (
        <div className="dsk-loading" role="status">
          <span className="dsk-tab__ring" /> Opening drawing…
        </div>
      )}
      {order.current.map((docId) => (
        <iframe
          key={docId}
          title="Drawing"
          src={`editor.html#${docId}`}
          className={`dsk-frame${docId === activeDocId ? " dsk-frame--active" : ""}`}
          // inactive frames keep their editor (and undo history) alive but get no input
          inert={docId !== activeDocId}
          tabIndex={docId !== activeDocId ? -1 : undefined}
          allow="clipboard-read; clipboard-write"
          ref={refFor(docId)}
        />
      ))}
    </div>
  );
};

const AboutDialog = ({ onClose }: { onClose: () => void }) => (
  <Modal
    title="About Excalidraw Desktop"
    onClose={onClose}
    footer={
      <button className="dsk-btn dsk-btn--primary" data-autofocus onClick={onClose}>
        Close
      </button>
    }
  >
    <p>Version {pkg.version}</p>
    <p className="dsk-muted">
      Drawing engine: Excalidraw (MIT), source commit{" "}
      <code>{String(pkg.excalidrawCommit).slice(0, 9)}</code>
    </p>
    <p className="dsk-muted">
      Interface icons: Solar Icons by 480 Design, licensed under CC BY 4.0.
    </p>
    <p className="dsk-muted">Made by {pkg.author}.</p>
  </Modal>
);

export const Shell = () => {
  const ready = useStore((s) => s.ready);
  const theme = useStore(resolvedTheme);
  const dropHint = useStore((s) => s.dropHint);
  const homeOpen = useStore((s) => s.homeOpen);
  const presenting = useStore((s) => !!s.presenting);
  const [about, setAbout] = useState(false);
  const closing = useRef(false);

  useEffect(() => {
    let stop: (() => void) | undefined;
    startup().then((fn) => {
      stop = fn;
    });
    return () => stop?.();
  }, []);

  // system theme
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setSystemTheme(mq.matches);
    const on = (e: MediaQueryListEvent) => setSystemTheme(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // shortcuts while focus is in the shell (tab bar, dialogs)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector(".dsk-backdrop")) {
        return; // a dialog owns the keyboard
      }
      const hit = shortcutToCommand(e);
      if (hit) {
        e.preventDefault();
        void runCommand(hit.command, hit.arg);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // About lives in the shell; frames ask for it through the "about" command
  useEffect(() => {
    const open = () => setAbout(true);
    window.addEventListener("dsk-about", open);
    return () => window.removeEventListener("dsk-about", open);
  }, []);

  // native: file drops, second-instance files, watcher events, close lifecycle
  useEffect(() => {
    if (!IN_TAURI) {
      return;
    }
    const unlisteners: Promise<() => void>[] = [];
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const { getCurrentWebview } = await import("@tauri-apps/api/webview");
      const win = getCurrentWindow();

      unlisteners.push(listen<string[]>("open-files", (e) => void openPaths(e.payload)));
      unlisteners.push(
        listen<{ path: string; kind: "modified" | "removed" }>("doc-changed", (e) =>
          void onDocChangedEvent(e.payload),
        ),
      );
      unlisteners.push(
        getCurrentWebview().onDragDropEvent(async (event) => {
          const p = event.payload;
          if (p.type === "enter") {
            setState({ dropHint: dropHintFor(p.paths) });
          } else if (p.type === "leave") {
            setState({ dropHint: null });
          } else if (p.type === "drop") {
            setState({ dropHint: null });
            const scale = await win.scaleFactor();
            await handleNativeDrop(p.paths, p.position.x / scale, p.position.y / scale);
          }
        }),
      );
      unlisteners.push(
        win.onCloseRequested(async (event) => {
          if (closing.current) {
            return;
          }
          event.preventDefault();
          if (hasSaveErrors()) {
            const answer = await showDialog({
              title: "Some changes could not be saved",
              body: "At least one file failed to save. Its changes are kept in recovery and will come back next time, but the file on disk is out of date.",
              buttons: [
                { id: "stay", label: "Stay", kind: "primary" },
                { id: "quit", label: "Quit anyway", kind: "danger" },
              ],
              cancelId: "stay",
            });
            if (answer !== "quit") {
              return;
            }
          }
          closing.current = true;
          try {
            await flushAll();
          } finally {
            await win.destroy();
          }
        }),
      );
    })();
    return () => {
      unlisteners.forEach((u) => u.then((fn) => fn()).catch(() => {}));
    };
  }, []);

  return (
    <div className={`dsk-root${presenting ? " dsk-root--presenting" : ""}`}>
      {!presenting && <TabBar />}
      <div className="dsk-stage">
        {ready && <FrameHost />}
        {ready && homeOpen && <Home />}
      </div>
      {dropHint && (
        <div className="dsk-drop">
          <div className="dsk-drop__card">{dropHint}</div>
        </div>
      )}
      {ready && <PanelHost />}
      <RecoveryCenter />
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      <DialogHost />
      <Toasts />
    </div>
  );
};
