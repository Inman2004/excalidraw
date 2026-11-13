import { useEffect, useRef, useState } from "react";

import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  AnnotateIcon,
  CloseIcon,
  FilesIcon,
  Icon,
  LayersIcon,
} from "../common/Icon";

import {
  COLORS,
  addCallout,
  addHighlight,
  addMarker,
  addMeasure,
  bringForward,
  calloutReportText,
  formatNumber,
  lockAsBackground,
  measureLabel,
  nextCalloutNumber,
  preloadImageSizes,
  sendToBack,
  unlockBackground,
} from "./annotate";
import {
  BoxIcon,
  CalloutIcon,
  EllipseIcon,
  HighlightIcon,
  LockIcon,
  MeasureIcon,
  UnlockIcon,
} from "./annotateIcons";

import type { AnnotateColor, AnnotateTool, Point } from "./annotate";

type Props = {
  api: ExcalidrawImperativeAPI;
  onExit: () => void;
};

const TOOLS: { id: AnnotateTool; label: string; hint: string; icon: typeof CalloutIcon }[] = [
  { id: "callout", label: "Callout", hint: "Click the spot, click where the label goes, type", icon: CalloutIcon },
  { id: "highlight", label: "Highlight", hint: "Drag over an area", icon: HighlightIcon },
  { id: "box", label: "Box", hint: "Drag to frame an area", icon: BoxIcon },
  { id: "ellipse", label: "Circle", hint: "Drag to circle an area", icon: EllipseIcon },
  { id: "measure", label: "Measure", hint: "Drag from one point to another", icon: MeasureIcon },
];

/** Scene point → frame-relative CSS px for the overlay preview. */
const toScreen = (api: ExcalidrawImperativeAPI, p: Point) => {
  const s = api.getAppState();
  const v = sceneCoordsToViewportCoords({ sceneX: p.x, sceneY: p.y }, s);
  return { x: v.x - s.offsetLeft, y: v.y - s.offsetTop };
};

const remember = {
  get: (key: string) => {
    try {
      return localStorage.getItem(`ann:${key}`);
    } catch {
      return null;
    }
  },
  set: (key: string, value: string) => {
    try {
      localStorage.setItem(`ann:${key}`, value);
    } catch {
      // per-viewer convenience only
    }
  },
};

/** Clipboard API first; falls back to a hidden textarea + execCommand. */
const copyText = async (text: string) => {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
};

/** Shift: square / circle for areas, 45° steps for the measure line. */
const constrain = (tool: AnnotateTool, a: Point, b: Point, shift: boolean): Point => {
  if (!shift) {
    return b;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (tool === "measure") {
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const len = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side };
};

const toScene = (api: ExcalidrawImperativeAPI, clientX: number, clientY: number): Point =>
  viewportCoordsToSceneCoords({ clientX, clientY }, api.getAppState());

export const AnnotateLayer = ({ api, onExit }: Props) => {
  // confirmations show in the hint pill (Excalidraw's toast sits behind the palette)
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);
  const notify = (message: string) => {
    setFlash(message);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2500);
  };
  const [tool, setTool] = useState<AnnotateTool>(
    () => (TOOLS.find((t) => t.id === remember.get("tool"))?.id ?? "callout"),
  );
  const [color, setColor] = useState<AnnotateColor>(
    () => COLORS.find((c) => c.id === remember.get("color")) ?? COLORS[0],
  );
  /** Space held: clicks pass through to the canvas (pan, select, move) */
  const [passThrough, setPassThrough] = useState(false);
  const shift = useRef(false);
  /** first point (callout target or drag start), scene coords */
  const [anchor, setAnchor] = useState<Point | null>(null);
  /** live pointer position, scene coords */
  const [pointer, setPointer] = useState<Point | null>(null);
  /** callout: label position awaiting text */
  const [labelAt, setLabelAt] = useState<Point | null>(null);
  const [text, setText] = useState("");
  const [, setTick] = useState(0);
  const dragging = useRef(false);
  const overlay = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // focus the label input once it appears (after the editor settles focus)
  useEffect(() => {
    if (labelAt) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 30);
      return () => window.clearTimeout(id);
    }
  }, [labelAt]);

  // keep the preview glued to the canvas while zooming / panning
  useEffect(() => api.onScrollChange(() => setTick((t) => t + 1)), [api]);

  const reset = () => {
    setAnchor(null);
    setPointer(null);
    setLabelAt(null);
    setText("");
    dragging.current = false;
  };

  useEffect(reset, [tool]);
  useEffect(() => remember.set("tool", tool), [tool]);
  useEffect(() => remember.set("color", color.id), [color]);
  useEffect(() => preloadImageSizes(api), [api]);

  // keys while annotating (not while typing a label)
  useEffect(() => {
    const typing = () => document.activeElement?.tagName === "INPUT";
    const onDown = (e: KeyboardEvent) => {
      shift.current = e.shiftKey;
      if (typing() || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setPassThrough(true);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= TOOLS.length) {
        e.preventDefault();
        e.stopPropagation();
        setTool(TOOLS[n - 1].id);
      } else if (e.key.toLowerCase() === "c") {
        e.preventDefault();
        e.stopPropagation();
        setColor((c) => COLORS[(COLORS.indexOf(c) + 1) % COLORS.length]);
      }
    };
    const onUp = (e: KeyboardEvent) => {
      shift.current = e.shiftKey;
      if (e.code === "Space") {
        setPassThrough(false);
      }
    };
    window.addEventListener("keydown", onDown, { capture: true });
    window.addEventListener("keyup", onUp, { capture: true });
    return () => {
      window.removeEventListener("keydown", onDown, { capture: true });
      window.removeEventListener("keyup", onUp, { capture: true });
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (anchor || labelAt) {
          reset();
        } else {
          onExit();
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [anchor, labelAt, onExit]);

  const isDrag = tool !== "callout";

  const finishDrag = (a: Point, b: Point) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4 / api.getAppState().zoom.value) {
      return; // a click, not a drag
    }
    if (tool === "highlight") addHighlight(api, a, b, color);
    else if (tool === "box" || tool === "ellipse") addMarker(api, a, b, tool, color);
    else if (tool === "measure") addMeasure(api, a, b, color);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || labelAt) {
      return;
    }
    const p = toScene(api, e.clientX, e.clientY);
    if (isDrag) {
      dragging.current = true;
      overlay.current?.setPointerCapture(e.pointerId);
      setAnchor(p);
      setPointer(p);
      return;
    }
    if (!anchor) {
      setAnchor(p); // click 1: what the arrow points at
      setPointer(p);
    } else {
      e.preventDefault(); // keep focus off the canvas
      setLabelAt(p); // click 2: where the label goes
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!labelAt) {
      const p = toScene(api, e.clientX, e.clientY);
      setPointer(anchor && isDrag ? constrain(tool, anchor, p, e.shiftKey) : p);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (isDrag && dragging.current && anchor) {
      dragging.current = false;
      const p = toScene(api, e.clientX, e.clientY);
      preloadImageSizes(api);
      finishDrag(anchor, constrain(tool, anchor, p, e.shiftKey));
      setAnchor(null);
    }
  };

  // wheel/pinch still zooms and pans the canvas underneath
  const onWheel = (e: React.WheelEvent) => {
    const canvas = document.querySelector<HTMLCanvasElement>(".excalidraw__canvas.interactive");
    canvas?.dispatchEvent(
      new WheelEvent("wheel", {
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        clientX: e.clientX,
        clientY: e.clientY,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  };

  const commitCallout = () => {
    if (anchor && labelAt) {
      addCallout(api, anchor, labelAt, text, color);
    }
    reset();
  };

  // ------------------------------------------------------------ preview
  const preview = () => {
    if (!anchor || !pointer) {
      return null;
    }
    const a = toScreen(api, anchor);
    const b = toScreen(api, labelAt ?? pointer);
    const stroke = color.stroke;
    if (tool === "callout") {
      return (
        <>
          <line x1={b.x} y1={b.y} x2={a.x} y2={a.y} stroke={stroke} strokeWidth={2} strokeDasharray={labelAt ? undefined : "6 5"} />
          <circle cx={a.x} cy={a.y} r={5} fill={stroke} />
          <circle cx={a.x} cy={a.y} r={11} fill="none" stroke={stroke} strokeOpacity={0.35} strokeWidth={2} />
        </>
      );
    }
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (tool === "highlight") {
      return <rect x={x} y={y} width={w} height={h} rx={6} fill={color.fill} fillOpacity={0.5} />;
    }
    if (tool === "box") {
      return <rect x={x} y={y} width={w} height={h} rx={8} fill="none" stroke={stroke} strokeWidth={3} />;
    }
    if (tool === "ellipse") {
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={stroke} strokeWidth={3} />;
    }
    const label = measureLabel(api, anchor, pointer);
    return (
      <>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={2} />
        <text x={(a.x + b.x) / 2 + 8} y={(a.y + b.y) / 2 - 8} fill={stroke} fontSize={13} fontWeight={600}>
          {label}
        </text>
      </>
    );
  };

  const labelScreen = labelAt ? toScreen(api, labelAt) : null;
  const next = formatNumber(nextCalloutNumber(api.getSceneElements()));
  const activeTool = TOOLS.find((t) => t.id === tool)!;
  const step =
    tool === "callout"
      ? labelAt
        ? "Type the label, Enter to place it"
        : anchor
        ? "Now click where the label should go"
        : `Click the spot to point at (callout ${next})`
      : activeTool.hint;
  const stepText = flash ?? (passThrough ? "Space held: pan, select or move items" : step);

  return (
    <>
      <div
        ref={overlay}
        className={`ann-overlay${passThrough ? " ann-overlay--through" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="ann-preview">{preview()}</svg>
      </div>

      {labelScreen && (
        <input
          ref={inputRef}
          className="ann-input"
          style={{ left: labelScreen.x, top: labelScreen.y, borderColor: color.stroke }}
          value={text}
          placeholder={`${next}  Label…`}
          onChange={(e) => setText(e.target.value)}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              commitCallout();
            } else if (e.key === "Escape") {
              reset();
            }
          }}
          // the editor may grab focus after the click: keep typing here
          onBlur={() => window.setTimeout(() => inputRef.current?.focus(), 0)}
        />
      )}

      <div className="ann-step" aria-live="polite">
        <Icon icon={AnnotateIcon} size={15} /> {stepText}
      </div>

      <div className="ann-palette" role="toolbar" aria-label="Annotate">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            className={`ann-btn${tool === t.id ? " ann-btn--on" : ""}`}
            title={`${t.label} — ${t.hint}`}
            aria-pressed={tool === t.id}
            onClick={() => setTool(t.id)}
          >
            <Icon icon={t.icon} size={18} />
          </button>
        ))}
        <span className="ann-sep" />
        {COLORS.map((c) => (
          <button
            key={c.id}
            className={`ann-swatch${color.id === c.id ? " ann-swatch--on" : ""}`}
            style={{ background: c.stroke }}
            title={`${c.id} (C cycles colours)`}
            aria-label={`${c.id} colour`}
            onClick={() => setColor(c)}
          />
        ))}
        <span className="ann-sep" />
        <button
          className="ann-btn"
          title="Lock image as background (selected image, or the only image)"
          onClick={() => {
            const n = lockAsBackground(api);
            notify(n ? `Locked ${n} image${n > 1 ? "s" : ""} as background` : "Select an image to lock first");
          }}
        >
          <Icon icon={LockIcon} size={18} />
        </button>
        <button
          className="ann-btn"
          title="Unlock background images"
          onClick={() => {
            const n = unlockBackground(api);
            notify(n ? `Unlocked ${n} image${n > 1 ? "s" : ""}` : "No locked images");
          }}
        >
          <Icon icon={UnlockIcon} size={18} />
        </button>
        <button className="ann-btn" title="Send selection to back" onClick={() => sendToBack(api)}>
          <Icon icon={LayersIcon} size={18} />
        </button>
        <button className="ann-btn ann-btn--flip" title="Bring selection forward" onClick={() => bringForward(api)}>
          <Icon icon={LayersIcon} size={18} />
        </button>
        <button
          className="ann-btn"
          title="Copy all callout labels as a list"
          onClick={async () => {
            const report = calloutReportText(api.getSceneElements());
            if (!report) {
              notify("No callouts yet");
              return;
            }
            try {
              await navigator.clipboard.writeText(report);
              notify(`Copied ${report.split("\n").length} callout labels`);
            } catch {
              notify("Could not copy to the clipboard");
            }
          }}
        >
          <Icon icon={FilesIcon} size={18} />
        </button>
        <span className="ann-sep" />
        <button className="ann-btn" title="Done (Esc)" onClick={onExit}>
          <Icon icon={CloseIcon} size={18} />
        </button>
      </div>
    </>
  );
};
