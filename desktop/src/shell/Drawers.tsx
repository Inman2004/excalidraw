import { useCallback, useEffect, useRef, useState } from "react";

import {
  CloseIcon,
  CopyIconD,
  Icon,
  PresentIcon,
  ReorderIcon,
  RecoveryIcon,
  TrashIcon,
} from "../common/Icon";

import { getFrameOrder, setFrameOrder, startPresentation, whenLoaded } from "./controller";
import { requestFrame } from "./frames";
import { native } from "./native";
import { setState, toast, useStore } from "./store";

import type { CalloutInfo, CalloutNumbering } from "../common/protocol";

type FrameRow = { id: string; name: string; thumb?: string };

const closePanel = () => setState({ panel: null });

/** Right-hand drawer over the canvas (shell side, Excalidraw island style). */
const Drawer = ({
  title,
  children,
  footer,
}: {
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target as HTMLElement)?.closest?.("input")) {
        closePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <aside className="dsk-drawer" aria-label={title}>
      <header className="dsk-drawer__head">
        <h2>{title}</h2>
        <button className="dsk-iconbtn" title="Close (Esc)" onClick={closePanel}>
          <Icon icon={CloseIcon} />
        </button>
      </header>
      <div className="dsk-drawer__body">{children}</div>
      {footer && <footer className="dsk-drawer__foot">{footer}</footer>}
    </aside>
  );
};

/**
 * Reorderable list with pointer dragging (HTML5 drag and drop is switched
 * off inside the page on Windows while native file drops are enabled).
 * Rows carry `data-reorder-id`; a drag starts after a few pixels, so plain
 * clicks still work.
 */
const useReorder = <T extends { id: string }>(
  items: T[],
  onChange: (next: T[]) => void,
  /** once per drag, with the final order */
  onDone: (final: T[]) => void,
) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const moveTo = (id: string, to: number) => {
    const list = itemsRef.current;
    const from = list.findIndex((i) => i.id === id);
    if (from < 0 || to < 0 || to >= list.length || from === to) {
      return null;
    }
    const next = list.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    itemsRef.current = next;
    onChange(next);
    return next;
  };
  const start = (id: string) => (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("input, textarea, select, [data-no-drag]")) {
      return;
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    let active = false;
    const move = (ev: PointerEvent) => {
      if (!active) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) {
          return;
        }
        active = true;
        setDragId(id);
      }
      ev.preventDefault();
      const over = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)
        ?.closest("[data-reorder-id]")
        ?.getAttribute("data-reorder-id");
      if (over && over !== id) {
        moveTo(id, itemsRef.current.findIndex((i) => i.id === over));
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!active) {
        return;
      }
      setDragId(null);
      onDone(itemsRef.current);
      // the click that ends a drag isn't a click on the row
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true, once: true });
      window.setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  /** keyboard / button moves: one step, saved right away */
  const step = (id: string, delta: number) => {
    const from = itemsRef.current.findIndex((i) => i.id === id);
    const next = moveTo(id, from + delta);
    if (next) {
      onDone(next);
    }
  };
  return { dragId, start, step };
};

// ------------------------------------------------------------------ frames

export const FrameNavigator = ({ docId }: { docId: string }) => {
  const [frames, setFrames] = useState<FrameRow[] | null>(null);
  const [natural, setNatural] = useState<string[]>([]);
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useStore((s) => s.docs[docId]?.status);

  const load = useCallback(async () => {
    try {
      // the drawing may still be loading (e.g. right after a tab switch)
      await whenLoaded(docId);
      const rows = await requestFrame<FrameRow[]>(docId, { op: "frames", thumbs: true });
      setError(null);
      const order = await getFrameOrder(docId);
      setNatural(rows.map((r) => r.id));
      if (order?.length) {
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = order.map((id) => byId.get(id)).filter(Boolean) as FrameRow[];
        rows.forEach((r) => !order.includes(r.id) && ordered.push(r));
        setFrames(ordered);
        setCustom(ordered.some((r, i) => r.id !== rows[i]?.id));
      } else {
        setFrames(rows);
        setCustom(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [docId]);

  useEffect(() => {
    void load();
  }, [load, status]);

  const reorder = useReorder(
    frames ?? [],
    (next) => {
      setFrames(next);
      setCustom(next.some((r, i) => r.id !== natural[i]));
    },
    // persist once, when the drag ends
    (final) => {
      const isCustom = final.some((r, i) => r.id !== natural[i]);
      void setFrameOrder(docId, isCustom ? final.map((r) => r.id) : null);
    },
  );

  const apply = async () => {
    if (!frames) {
      return;
    }
    await requestFrame(docId, { op: "apply-frame-order", ids: frames.map((f) => f.id) });
    await setFrameOrder(docId, null);
    toast("Frame order applied to the drawing", "success");
    await load();
  };

  const reset = async () => {
    await setFrameOrder(docId, null);
    await load();
  };

  return (
    <Drawer
      title="Frames"
      footer={
        <>
          <button
            className="dsk-btn dsk-btn--primary"
            disabled={!frames}
            onClick={() => void startPresentation(docId)}
          >
            <Icon icon={PresentIcon} /> Present
          </button>
          {custom && (
            <>
              <button className="dsk-btn" title="Reorder the frames inside the drawing itself" onClick={() => void apply()}>
                <Icon icon={ReorderIcon} /> Apply order
              </button>
              <button className="dsk-btn" title="Back to the drawing's own order" onClick={() => void reset()}>
                <Icon icon={RecoveryIcon} />
              </button>
            </>
          )}
        </>
      }
    >
      {error && <p className="dsk-muted">{error}</p>}
      {frames && frames.length === 0 && (
        <p className="dsk-muted">
          This drawing has no frames. Add frames with the frame tool (F) to split it
          into slides; Present then shows one frame per step. Without frames, Present
          shows the whole drawing.
        </p>
      )}
      {frames && frames.length > 0 && (
        <>
          <p className="dsk-drawer__note">
            {custom
              ? "Local order: kept on this computer only, not saved in the file."
              : "Drag to reorder. The order is kept on this computer only."}
          </p>
          <ol className="dsk-frames-list">
            {frames.map((f, i) => (
              <li
                key={f.id}
                data-reorder-id={f.id}
                className={reorder.dragId === f.id ? "dsk-frames-list--drag" : undefined}
                onPointerDown={reorder.start(f.id)}
                onKeyDown={(e) => {
                  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
                    e.preventDefault();
                    reorder.step(f.id, e.key === "ArrowUp" ? -1 : 1);
                  }
                }}
              >
                <button
                  className="dsk-frame-card"
                  onClick={() => void requestFrame(docId, { op: "reveal", id: f.id })}
                  title="Show this frame (drag or Alt+↑/↓ to reorder)"
                >
                  <span className="dsk-frame-card__n">{i + 1}</span>
                  <span className="dsk-frame-card__thumb">
                    {f.thumb ? <img src={f.thumb} alt="" draggable={false} /> : null}
                  </span>
                  <span className="dsk-frame-card__name">{f.name}</span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {!frames && !error && <p className="dsk-muted">Loading frames…</p>}
    </Drawer>
  );
};

// ---------------------------------------------------------------- callouts

const SWATCHES = [
  { id: "black", stroke: "#1e1e1e", fill: "#e9ecef" },
  { id: "red", stroke: "#e03131", fill: "#ffc9c9" },
  { id: "blue", stroke: "#1971c2", fill: "#a5d8ff" },
  { id: "green", stroke: "#2f9e44", fill: "#b2f2bb" },
  { id: "yellow", stroke: "#f08c00", fill: "#ffec99" },
];

const CalloutRow = ({
  docId,
  c,
  index,
  count,
  dragging,
  onChanged,
  onStart,
  onStep,
}: {
  docId: string;
  c: CalloutInfo;
  index: number;
  count: number;
  dragging: boolean;
  onChanged: () => void;
  onStart: (e: React.PointerEvent) => void;
  onStep: (delta: number) => void;
}) => {
  const [label, setLabel] = useState(c.label);
  const saved = useRef(c.label);
  useEffect(() => {
    setLabel(c.label);
    saved.current = c.label;
  }, [c.label]);

  const edit = async (patch: { label?: string; color?: string; remove?: boolean }) => {
    try {
      await requestFrame(docId, { op: "callout-edit", groupId: c.groupId, ...patch });
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };

  const commit = () => {
    if (label !== saved.current) {
      saved.current = label;
      void edit({ label });
    }
  };

  return (
    <li
      className={`dsk-callout${dragging ? " dsk-callout--drag" : ""}`}
      data-reorder-id={c.groupId}
      onPointerDown={onStart}
    >
      <span className="dsk-callout__grip" title="Drag to change the order (or Alt+↑/↓ in the label)" aria-hidden>
        ⋮⋮
      </span>
      <button
        className="dsk-callout__n"
        style={{ background: c.color }}
        title="Show the callout (double-click: the point it marks)"
        onClick={() => void requestFrame(docId, { op: "callout-reveal", groupId: c.groupId })}
        onDoubleClick={() =>
          void requestFrame(docId, { op: "callout-reveal", groupId: c.groupId, target: true })
        }
      >
        {c.number}
      </button>
      <input
        className="dsk-callout__label"
        value={label}
        placeholder="(no label)"
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setLabel(saved.current);
            (e.target as HTMLInputElement).blur();
          } else if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
            e.preventDefault();
            commit();
            onStep(e.key === "ArrowUp" ? -1 : 1);
          }
        }}
      />
      <span className="dsk-callout__swatches">
        {SWATCHES.map((s) => (
          <button
            key={s.id}
            className={`dsk-callout__swatch${c.color === s.stroke ? " dsk-callout__swatch--on" : ""}`}
            style={{ background: s.stroke }}
            title={`Make ${s.id}`}
            aria-label={`Make ${s.id}`}
            onClick={() => void edit({ color: `${s.stroke}|${s.fill}` })}
          />
        ))}
        <span className="dsk-callout__moves">
          <button className="dsk-callout__move" title="Move up" aria-label="Move up" disabled={index === 0} onClick={() => onStep(-1)}>
            ↑
          </button>
          <button className="dsk-callout__move" title="Move down" aria-label="Move down" disabled={index === count - 1} onClick={() => onStep(1)}>
            ↓
          </button>
        </span>
      </span>
      <button className="dsk-iconbtn" title="Delete callout" onClick={() => void edit({ remove: true })}>
        <Icon icon={TrashIcon} />
      </button>
    </li>
  );
};

const FORMATS: { id: CalloutNumbering["format"] | "off"; label: string }[] = [
  { id: "off", label: "No numbers" },
  { id: "1", label: "1, 2, 3" },
  { id: "01", label: "01, 02, 03" },
  { id: "a", label: "a, b, c" },
  { id: "A", label: "A, B, C" },
  { id: "custom", label: "Custom pattern" },
];

/** Numbering for all callouts in the drawing. */
const NumberingPicker = ({
  docId,
  value,
  onChanged,
}: {
  docId: string;
  value: CalloutNumbering | null;
  onChanged: () => void;
}) => {
  const [template, setTemplate] = useState(value?.template || "Step {n}");
  const [choice, setChoice] = useState<string | null>(null);
  useEffect(() => {
    if (value?.template) setTemplate(value.template);
    setChoice(null);
  }, [value?.template, value?.format, value?.numbered]);
  if (!value) {
    return null;
  }
  const apply = async (numbering: CalloutNumbering) => {
    try {
      await requestFrame(docId, { op: "callouts-numbering", numbering });
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  };
  const selected = choice ?? (value.numbered ? value.format : "off");
  return (
    <div className="dsk-numbering">
      <label>
        Numbering
        <select
          value={selected}
          onChange={(e) => {
            const id = e.target.value as (typeof FORMATS)[number]["id"];
            if (id === "custom") {
              setChoice("custom"); // wait for the pattern
              if (template.trim()) void apply({ numbered: true, format: "custom", template });
              return;
            }
            void apply(id === "off" ? { ...value, numbered: false } : { numbered: true, format: id, template });
          }}
        >
          {FORMATS.map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {selected === "custom" && (
        <input
          className="dsk-numbering__tpl"
          value={template}
          aria-label="Custom numbering pattern"
          title="{n} → 1 · {01} → 01 · {a} → a · {A} → A"
          placeholder="Step {n}"
          onChange={(e) => setTemplate(e.target.value)}
          onBlur={() =>
            template.trim() &&
            (template !== value.template || value.format !== "custom") &&
            void apply({ numbered: true, format: "custom", template })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      )}
    </div>
  );
};

export const AnnotationNavigator = ({ docId }: { docId: string }) => {
  const [list, setList] = useState<CalloutInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // refresh when the drawing changes (e.g. callouts added in annotate mode)
  const hash = useStore((s) => s.docs[docId]?.currentHash);

  const load = useCallback(() => {
    whenLoaded(docId)
      .then(() => requestFrame<CalloutInfo[]>(docId, { op: "callouts" }))
      .then((l) => {
        setList(l);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [docId]);

  useEffect(() => {
    load();
  }, [load, hash]);

  const [numbering, setNumbering] = useState<CalloutNumbering | null>(null);
  useEffect(() => {
    requestFrame<CalloutNumbering | null>(docId, { op: "callouts-numbering-info" })
      .then(setNumbering)
      .catch(() => {});
  }, [docId, hash, list]);
  // gaps or duplicates: offer to renumber 1…n
  const gaps = !!list && list.some((c, i) => c.n !== i + 1);
  const reorder = useReorder(
    (list ?? []).map((c) => ({ ...c, id: c.groupId })),
    (next) => setList(next),
    (final) =>
      void requestFrame(docId, { op: "callouts-reorder", ids: final.map((c) => c.groupId) })
        .then(load)
        .catch((e) => toast(e instanceof Error ? e.message : String(e), "error")),
  );

  const copyReport = async () => {
    try {
      const text = await requestFrame<string>(docId, { op: "report" });
      await native.copyText(text);
      toast("Callout report copied", "success");
    } catch (e) {
      toast(`Copy failed: ${e instanceof Error ? e.message : e}`, "error");
    }
  };

  return (
    <Drawer
      title="Callouts"
      footer={
        list && list.length > 0 ? (
          <>
            <button className="dsk-btn dsk-btn--primary" onClick={() => void copyReport()}>
              <Icon icon={CopyIconD} /> Copy report
            </button>
            <button
              className="dsk-btn"
              title="Arrange the callout cards beside the drawing: aligned, evenly spaced, arrows that don't cross (keeps the numbers)"
              onClick={() =>
                void requestFrame(docId, { op: "callouts-arrange" }).then(load)
              }
            >
              Auto arrange
            </button>
            {gaps && (
              <button
                className="dsk-btn"
                title="Number the callouts in order, without gaps"
                onClick={() =>
                  void requestFrame(docId, { op: "callouts-renumber" }).then(load)
                }
              >
                <Icon icon={ReorderIcon} /> Renumber
              </button>
            )}
          </>
        ) : undefined
      }
    >
      {error && <p className="dsk-muted">{error}</p>}
      {list && list.length === 0 && (
        <p className="dsk-muted">
          No callouts yet. Turn on Annotate (Ctrl+Shift+A), click the spot to point at,
          then click where the label goes and type.
        </p>
      )}
      {list && list.length > 0 && (
        <>
          <NumberingPicker docId={docId} value={numbering} onChanged={load} />
          <ul className="dsk-callouts">
            {list.map((c, i) => (
              <CalloutRow
                key={c.groupId}
                docId={docId}
                c={c}
                index={i}
                count={list.length}
                dragging={reorder.dragId === c.groupId}
                onChanged={load}
                onStart={reorder.start(c.groupId)}
                onStep={(d) => reorder.step(c.groupId, d)}
              />
            ))}
          </ul>
        </>
      )}
    </Drawer>
  );
};
