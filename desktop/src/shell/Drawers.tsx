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

import type { CalloutInfo } from "../common/protocol";

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

/** Reorderable list with pointer dragging. */
const useReorder = <T extends { id: string }>(
  items: T[],
  onChange: (next: T[]) => void,
  /** once per drag, with the final order */
  onDone: (final: T[]) => void,
) => {
  const [dragId, setDragId] = useState<string | null>(null);
  const onDragStart = (id: string) => (e: React.DragEvent) => {
    setDragId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", id);
  };
  const onDragOver = (id: string) => (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragId || dragId === id) {
      return;
    }
    const from = items.findIndex((i) => i.id === dragId);
    const to = items.findIndex((i) => i.id === id);
    if (from < 0 || to < 0) {
      return;
    }
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  const onDragEnd = () => {
    if (dragId) {
      onDone(items);
    }
    setDragId(null);
  };
  return { dragId, onDragStart, onDragOver, onDragEnd };
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
                draggable
                className={reorder.dragId === f.id ? "dsk-frames-list--drag" : undefined}
                onDragStart={reorder.onDragStart(f.id)}
                onDragOver={reorder.onDragOver(f.id)}
                onDragEnd={reorder.onDragEnd}
              >
                <button
                  className="dsk-frame-card"
                  onClick={() => void requestFrame(docId, { op: "reveal", id: f.id })}
                  title="Show this frame"
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
  { id: "red", stroke: "#e03131", fill: "#ffc9c9" },
  { id: "blue", stroke: "#1971c2", fill: "#a5d8ff" },
  { id: "green", stroke: "#2f9e44", fill: "#b2f2bb" },
  { id: "yellow", stroke: "#f08c00", fill: "#ffec99" },
];

const CalloutRow = ({
  docId,
  c,
  onChanged,
}: {
  docId: string;
  c: CalloutInfo;
  onChanged: () => void;
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
    <li className="dsk-callout">
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
      </span>
      <button className="dsk-iconbtn" title="Delete callout" onClick={() => void edit({ remove: true })}>
        <Icon icon={TrashIcon} />
      </button>
    </li>
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

  const gaps = !!list && list.some((c, i) => Number(c.number) !== i + 1);

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
            {gaps && (
              <button
                className="dsk-btn"
                title="Number the callouts 01, 02, … without gaps"
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
        <ul className="dsk-callouts">
          {list.map((c) => (
            <CalloutRow key={c.groupId} docId={docId} c={c} onChanged={load} />
          ))}
        </ul>
      )}
    </Drawer>
  );
};
