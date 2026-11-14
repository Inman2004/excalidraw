// Inline editor for a callout's label. Double-clicking a callout label (or
// pressing Enter with one selected) opens it in place of Excalidraw's own
// text editing, so the number stays separate from the words: the label is
// edited on its own and the number is changed with the order buttons.
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  calloutAt,
  calloutGroups,
  editCalloutLabel,
  labelOf,
  moveCallout,
  prefixOf,
} from "./callouts";
import { calloutParts } from "./annotate";

type Editing = { groupId: string; text: string };

/** Let other parts of the editor (the annotate palette) open the editor. */
export const openCalloutEditor = (groupId: string) =>
  window.dispatchEvent(new CustomEvent("callout-edit", { detail: groupId }));

const isTyping = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
};

export const CalloutEditor = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [editing, setEditing] = useState<Editing | null>(null);
  const [, setTick] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const editingRef = useRef<Editing | null>(null);
  editingRef.current = editing;

  const open = (groupId: string) => {
    const g = calloutGroups(api).find((c) => c.groupId === groupId);
    if (!g?.text) {
      return;
    }
    api.selection.clear();
    setEditing({ groupId, text: labelOf(g) });
  };

  const save = () => {
    const e = editingRef.current;
    if (e) {
      editCalloutLabel(api, e.groupId, e.text);
    }
    setEditing(null);
    editingRef.current = null;
    focusCanvas();
  };

  const cancel = () => {
    setEditing(null);
    editingRef.current = null;
    focusCanvas();
  };

  // double-click a label: our editor instead of Excalidraw's raw text edit
  useEffect(() => {
    const onDbl = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.(".excalidraw__canvas, .ann-overlay")) {
        return;
      }
      const p = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, api.getAppState());
      const g = calloutAt(api, p);
      if (!g || g.rect?.locked) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      open(g.groupId);
    };
    // Enter on a selected callout (Excalidraw would edit its raw text)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || isTyping() || editingRef.current) {
        return;
      }
      const s = api.getAppState();
      if (s.editingTextElement || (s as any).selectedLinearElement?.isEditing) {
        return;
      }
      const sel = Object.keys(s.selectedElementIds).filter((id) => s.selectedElementIds[id]);
      if (!sel.length) {
        return;
      }
      const parts = new Set(calloutParts(api, sel));
      const groups = calloutGroups(api).filter((g) => g.rect && parts.has(g.rect.id));
      // only when the selection is one callout (its label, arrow, or both)
      if (groups.length !== 1 || !sel.every((id) => parts.has(id))) {
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      open(groups[0].groupId);
    };
    const onOpen = (e: Event) => open((e as CustomEvent<string>).detail);
    window.addEventListener("dblclick", onDbl, { capture: true });
    window.addEventListener("keydown", onKey, { capture: true });
    window.addEventListener("callout-edit", onOpen);
    return () => {
      window.removeEventListener("dblclick", onDbl, { capture: true });
      window.removeEventListener("keydown", onKey, { capture: true });
      window.removeEventListener("callout-edit", onOpen);
    };
  }, [api]);

  // follow the label while zooming/panning; close if it disappears (undo)
  useEffect(() => {
    if (!editing) {
      return;
    }
    const a = api.onScrollChange(() => setTick((t) => t + 1));
    const b = api.onChange(() => {
      if (!calloutGroups(api).some((g) => g.groupId === editingRef.current?.groupId)) {
        setEditing(null);
      } else {
        setTick((t) => t + 1);
      }
    });
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 30);
    return () => {
      a();
      b();
      window.clearTimeout(id);
    };
  }, [api, editing?.groupId]);

  // keep the editor inside the window (labels near an edge)
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) {
      return;
    }
    el.style.translate = "";
    const r = el.getBoundingClientRect();
    const m = 8;
    const dx = r.left < m ? m - r.left : r.right > innerWidth - m ? innerWidth - m - r.right : 0;
    const dy = r.top < m ? m - r.top : r.bottom > innerHeight - m ? innerHeight - m - r.bottom : 0;
    if (dx || dy) {
      el.style.translate = `${dx}px ${dy}px`;
    }
  });

  if (!editing) {
    return null;
  }
  const groups = calloutGroups(api);
  const index = groups.findIndex((g) => g.groupId === editing.groupId);
  const g = groups[index];
  if (!g?.rect) {
    return null;
  }
  const s = api.getAppState();
  const r = g.rect;
  const tl = sceneCoordsToViewportCoords({ sceneX: r.x, sceneY: r.y }, s);
  const br = sceneCoordsToViewportCoords({ sceneX: r.x + r.width, sceneY: r.y + r.height }, s);
  const prefix = prefixOf(g);
  const move = (to: number) => {
    // keep the typed text: save it with the move as separate undo steps
    const e = editingRef.current!;
    editCalloutLabel(api, e.groupId, e.text);
    moveCallout(api, e.groupId, to);
    inputRef.current?.focus();
  };

  return (
    <div
      ref={boxRef}
      className="callout-edit"
      style={{
        left: (tl.x + br.x) / 2 - s.offsetLeft,
        top: (tl.y + br.y) / 2 - s.offsetTop,
        minWidth: Math.max(220, br.x - tl.x + 24),
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {prefix && (
        <div className="callout-edit__order" role="group" aria-label="Order">
          <button
            title="Move earlier (Alt+↑)"
            aria-label="Move earlier"
            disabled={index <= 0}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => move(index)}
          >
            ‹
          </button>
          <span className="callout-edit__n" title={`Callout ${index + 1} of ${groups.length}`}>
            {prefix}
          </span>
          <button
            title="Move later (Alt+↓)"
            aria-label="Move later"
            disabled={index >= groups.length - 1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => move(index + 2)}
          >
            ›
          </button>
        </div>
      )}
      <textarea
        ref={inputRef}
        className="callout-edit__text"
        rows={Math.min(8, Math.max(1, editing.text.split("\n").length))}
        value={editing.text}
        placeholder="Label…"
        onChange={(e) => setEditing({ ...editing, text: e.target.value })}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          } else if (e.altKey && e.key === "ArrowUp" && index > 0) {
            e.preventDefault();
            move(index);
          } else if (e.altKey && e.key === "ArrowDown" && index < groups.length - 1) {
            e.preventDefault();
            move(index + 2);
          }
        }}
        onBlur={save}
      />
      <div className="callout-edit__hint">Enter to save · Shift+Enter new line · Esc to cancel</div>
    </div>
  );
};

const focusCanvas = () =>
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(".excalidraw-container, .excalidraw");
    el?.focus({ preventScroll: true });
  }, 0);
