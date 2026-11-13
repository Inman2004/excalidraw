import { useEffect, useRef, useState } from "react";

import {
  CheckIcon,
  CloseIcon,
  ConflictIcon,
  ErrorIcon,
  HomeIcon,
  Icon,
  MissingIcon,
  PinIcon,
  PlusIcon,
} from "../common/Icon";

import {
  activateTab,
  closeTab,
  hideHome,
  showHome,
  moveTab,
  newTab,
  renameTab,
  resolveConflict,
  tabLabel,
  togglePinTab,
  togglePinned,
} from "./controller";
import { IN_TAURI } from "./native";
import { setState, useStore } from "./store";

import type { DocumentRecord, State, Tab } from "./store";

const statusText: Record<DocumentRecord["status"], string> = {
  clean: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  saved: "Saved",
  conflict: "Changed on disk — click to resolve",
  missing: "File moved or deleted",
  error: "Save failed",
};

const StatusGlyph = ({ doc }: { doc: DocumentRecord }) => {
  switch (doc.status) {
    case "dirty":
      return <span className="dsk-tab__dot" aria-label="Unsaved" />;
    case "saving":
      return <span className="dsk-tab__ring" aria-label="Saving" />;
    case "saved":
      return (
        <span className="dsk-tab__saved">
          <Icon icon={CheckIcon} size={14} />
        </span>
      );
    case "conflict":
      return (
        <button
          className="dsk-tab__alert"
          title="Resolve conflict"
          onClick={(e) => {
            e.stopPropagation();
            void resolveConflict(doc.docId);
          }}
        >
          <Icon icon={ConflictIcon} size={14} />
        </button>
      );
    case "missing":
      return (
        <span className="dsk-tab__alert">
          <Icon icon={MissingIcon} size={14} />
        </span>
      );
    case "error":
      return (
        <span className="dsk-tab__alert">
          <Icon icon={ErrorIcon} size={14} />
        </span>
      );
    default:
      return null;
  }
};

const RenameInput = ({ tab, initial }: { tab: Tab; initial: string }) => {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="dsk-tab__rename"
      value={value}
      aria-label="Rename"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => void renameTab(tab.tabId, value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") {
          void renameTab(tab.tabId, value);
        } else if (e.key === "Escape") {
          setState({ renamingTabId: null });
        }
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
};

const TabItem = ({
  tab,
  doc,
  state,
  onDragStart,
}: {
  tab: Tab;
  doc: DocumentRecord;
  state: State;
  onDragStart: (e: React.PointerEvent, tabId: string) => void;
}) => {
  const active = !state.homeOpen && state.activeTabId === tab.tabId;
  const { name, hint } = tabLabel(state, doc);
  const renaming = state.renamingTabId === tab.tabId;
  return (
    <div
      role="tab"
      aria-selected={active}
      data-tab-id={tab.tabId}
      className={[
        "dsk-tab",
        active && "dsk-tab--active",
        tab.pinnedTab && "dsk-tab--pinned",
        doc.status === "missing" && "dsk-tab--missing",
      ]
        .filter(Boolean)
        .join(" ")}
      title={`${doc.path ?? "Not saved yet"}\n${statusText[doc.status]}`}
      onPointerDown={(e) => {
        if (e.button === 0) {
          onDragStart(e, tab.tabId);
        }
      }}
      onMouseDown={(e) => {
        if (e.button === 1) {
          e.preventDefault();
        }
      }}
      onAuxClick={(e) => {
        if (e.button === 1 && !tab.pinnedTab) {
          void closeTab(tab.tabId);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        togglePinTab(tab.tabId);
      }}
    >
      {tab.pinnedTab && (
        <span className="dsk-tab__pin">
          <Icon icon={PinIcon} size={14} />
        </span>
      )}
      {renaming ? (
        <RenameInput tab={tab} initial={name} />
      ) : (
        <span className="dsk-tab__label">
          <span className="dsk-tab__name">{name}</span>
          {hint && <span className="dsk-tab__hint">{hint}</span>}
        </span>
      )}
      <StatusGlyph doc={doc} />
      {!tab.pinnedTab && (
        <button
          className="dsk-tab__close"
          aria-label={`Close ${name}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            void closeTab(tab.tabId);
          }}
        >
          <Icon icon={CloseIcon} size={14} />
        </button>
      )}
    </div>
  );
};

/**
 * Pointer-based reordering: native file drag-and-drop is on in the desktop
 * build, which disables HTML5 drag events on Windows.
 */
const useTabDrag = () => {
  const drag = useRef<{ tabId: string; startX: number; moved: boolean } | null>(null);
  // double-click detected here: the browser's dblclick is unreliable because
  // the first click moves focus into the editor frame
  const lastClick = useRef<{ tabId: string; at: number } | null>(null);

  const onDragStart = (e: React.PointerEvent, tabId: string) => {
    drag.current = { tabId, startX: e.clientX, moved: false };
    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) {
        return;
      }
      if (!d.moved && Math.abs(ev.clientX - d.startX) < 6) {
        return;
      }
      d.moved = true;
      const els = Array.from(document.querySelectorAll<HTMLElement>("[data-tab-id]"));
      const over = els.findIndex((el) => {
        const r = el.getBoundingClientRect();
        return ev.clientX >= r.left && ev.clientX <= r.right;
      });
      const from = els.findIndex((el) => el.dataset.tabId === d.tabId);
      if (over >= 0 && over !== from) {
        moveTab(d.tabId, over);
      }
    };
    const onUp = () => {
      const d = drag.current;
      drag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (d && !d.moved) {
        const now = Date.now();
        const prev = lastClick.current;
        if (prev && prev.tabId === d.tabId && now - prev.at < 450) {
          lastClick.current = null;
          setState({ renamingTabId: d.tabId });
          return;
        }
        lastClick.current = { tabId: d.tabId, at: now };
        void activateTab(d.tabId);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return onDragStart;
};

export const TabBar = () => {
  const state = useStore((s) => s);
  const onDragStart = useTabDrag();
  return (
    <div className="dsk-tabbar" data-tauri-drag-region>
      <div className="dsk-tabs" role="tablist" data-tauri-drag-region>
        <div
          role="tab"
          aria-selected={state.homeOpen}
          aria-label="Home"
          title="Home"
          className={`dsk-tab dsk-tab--home${state.homeOpen ? " dsk-tab--active" : ""}`}
          onClick={() => (state.homeOpen ? hideHome() : showHome())}
        >
          <Icon icon={HomeIcon} size={17} />
        </div>
        {state.tabs.map((tab) => {
          const doc = state.docs[tab.docId];
          return doc ? (
            <TabItem key={tab.tabId} tab={tab} doc={doc} state={state} onDragStart={onDragStart} />
          ) : null;
        })}
        <button className="dsk-iconbtn dsk-newtab" title="New tab (Ctrl+T)" onClick={() => newTab()}>
          <Icon icon={PlusIcon} />
        </button>
      </div>
      <div className="dsk-drag" data-tauri-drag-region />
      <button
        className={`dsk-iconbtn${state.pinned ? " dsk-iconbtn--on" : ""}`}
        title={state.pinned ? "Always on top: on" : "Always on top: off"}
        aria-pressed={state.pinned}
        onClick={() => void togglePinned()}
      >
        <Icon icon={PinIcon} />
      </button>
      <WindowControls />
    </div>
  );
};

/** Minimise / maximise / close for the frameless (Chrome-style) window. */
const WindowControls = () => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!IN_TAURI) {
      return;
    }
    let unlisten: (() => void) | undefined;
    import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      setMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => setMaximized(await win.isMaximized()));
    });
    return () => unlisten?.();
  }, []);

  if (!IN_TAURI) {
    return null;
  }
  const win = () => import("@tauri-apps/api/window").then((m) => m.getCurrentWindow());
  const glyph = { width: 10, height: 10, viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: 1 };
  return (
    <div className="dsk-winctl">
      <button aria-label="Minimize" onClick={() => win().then((w) => w.minimize())}>
        <svg {...glyph}>
          <path d="M0 5.5h10" />
        </svg>
      </button>
      <button
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={() => win().then((w) => w.toggleMaximize())}
      >
        {maximized ? (
          <svg {...glyph}>
            <path d="M2.5 2.5V1.5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-1" />
            <rect x="0.5" y="2.5" width="7" height="7" rx="1" />
          </svg>
        ) : (
          <svg {...glyph}>
            <rect x="0.5" y="0.5" width="9" height="9" rx="1" />
          </svg>
        )}
      </button>
      <button
        className="dsk-winctl__close"
        aria-label="Close"
        onClick={() => win().then((w) => w.close())}
      >
        <svg {...glyph}>
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
};
