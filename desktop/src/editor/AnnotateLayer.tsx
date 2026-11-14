import { useEffect, useRef, useState } from "react";

import {
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { AutoArrange } from "./AutoArrange";

import {
  AnnotateIcon,
  CloseIcon,
  FilesIcon,
  Icon,
  LayersIcon,
} from "../common/Icon";

import {
  COLORS,
  DEFAULT_CALLOUT,
  addArrow,
  addCallout,
  addNumber,
  arrowPoints,
  calloutParts,
  addHighlight,
  addMarker,
  addMeasure,
  bringForward,
  calloutReportText,
  calloutText,
  labelColors,
  NUMBER_FORMATS,
  lockAsBackground,
  lockedImageCount,
  measureLabel,
  toggleImageLock,
  nextCalloutNumber,
  preloadImageSizes,
  sendToBack,
} from "./annotate";
import { calloutAt, docNumbering, setNumbering } from "./callouts";
import {
  BoxIcon,
  CalloutIcon,
  EllipseIcon,
  HighlightIcon,
  BackgroundIcon,
  LockIcon,
  MeasureIcon,
  NumberIcon,
  PairIcon,
  PlainArrowIcon,
  SelectIcon,
  UnlockIcon,
} from "./annotateIcons";

import type {
  AnnotateColor,
  AnnotateTool,
  ArrowHead,
  ArrowShape,
  CalloutOptions,
  LabelStyle,
  Numbering,
  Point,
  StrokeStyle,
} from "./annotate";

type Props = {
  api: ExcalidrawImperativeAPI;
  onExit: () => void;
};

const TOOLS: { id: AnnotateTool; label: string; hint: string; icon: typeof CalloutIcon }[] = [
  { id: "select", label: "Select", hint: "Click to select, drag handles to bend or move, double-click a label to edit it", icon: SelectIcon },
  { id: "callout", label: "Callout", hint: "Click the spot, click where the label goes, type", icon: CalloutIcon },
  { id: "arrow", label: "Arrow", hint: "Drag from the start to the tip", icon: PlainArrowIcon },
  { id: "number", label: "Number marker", hint: "Click to drop the next number", icon: NumberIcon },
  { id: "highlight", label: "Highlight", hint: "Drag over an area", icon: HighlightIcon },
  { id: "box", label: "Box", hint: "Drag to frame an area", icon: BoxIcon },
  { id: "ellipse", label: "Circle", hint: "Drag to circle an area", icon: EllipseIcon },
  { id: "measure", label: "Measure", hint: "Drag from one point to another", icon: MeasureIcon },
];

// small previews for the callout options (drawn, so they show the result)
const G = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
);
const TEXT_LINES = <path d="M8 11h8M8 14h5" />;

const STYLES: { id: LabelStyle; label: string; glyph: React.ReactNode }[] = [
  { id: "white", label: "White label, dark text", glyph: G(<><rect x="3.5" y="6" width="17" height="12" rx="3" fill="#fff" /><path d="M8 11h8M8 14h5" stroke="#1e1e1e" /></>) },
  { id: "plain", label: "No background (text only)", glyph: G(<path d="M7 8h10M12 8v9" strokeWidth="2" />) },
  { id: "tinted", label: "Tinted background", glyph: G(<><rect x="3.5" y="6" width="17" height="12" rx="3" fill="currentColor" fillOpacity="0.3" />{TEXT_LINES}</>) },
  { id: "outline", label: "Outline only", glyph: G(<><rect x="3.5" y="6" width="17" height="12" rx="3" />{TEXT_LINES}</>) },
];

const SHAPES: { id: ArrowShape; label: string; glyph: React.ReactNode }[] = [
  { id: "straight", label: "Straight arrow", glyph: G(<path d="M4 19 19 5" />) },
  { id: "curved", label: "Curved arrow", glyph: G(<path d="M4 19C6 9 12 5 19 5" />) },
  { id: "elbow", label: "Elbow arrow", glyph: G(<path d="M4 19h8V5h7" />) },
];

const HEADS: { id: ArrowHead; label: string; glyph: React.ReactNode }[] = [
  { id: "triangle", label: "Triangle head", glyph: G(<><path d="M3 12h11" /><path d="M13 7l7 5-7 5z" fill="currentColor" /></>) },
  { id: "arrow", label: "Arrow head", glyph: G(<path d="M3 12h16M14 7l5 5-5 5" />) },
  { id: "dot", label: "Dot", glyph: G(<><path d="M3 12h12" /><circle cx="17.5" cy="12" r="3" fill="currentColor" /></>) },
  { id: "bar", label: "Bar", glyph: G(<path d="M3 12h16M19 7v10" />) },
  { id: "none", label: "No head", glyph: G(<path d="M3 12h18" />) },
];

const WIDTHS: { id: number; label: string; glyph: React.ReactNode }[] = [1, 2, 4, 6].map((w) => ({
  id: w,
  label: `Line width ${w} px`,
  glyph: G(<path d="M4 12h16" strokeWidth={Math.min(w, 5) + 0.4} strokeLinecap="butt" />),
}));

const STROKES: { id: StrokeStyle; label: string; glyph: React.ReactNode }[] = [
  { id: "solid", label: "Solid line", glyph: G(<path d="M4 12h16" strokeWidth="2" />) },
  { id: "dashed", label: "Dashed line", glyph: G(<path d="M4 12h16" strokeWidth="2" strokeDasharray="4 3" strokeLinecap="butt" />) },
  { id: "dotted", label: "Dotted line", glyph: G(<path d="M4 12h16" strokeWidth="2" strokeDasharray="0.1 4" />) },
];

/** Which defaults each tool uses. */
const TOOL_OPTIONS: Partial<Record<AnnotateTool, (keyof CalloutOptions)[]>> = {
  callout: ["style", "shape", "head", "width", "stroke", "numbered"],
  arrow: ["shape", "head", "width", "stroke"],
  box: ["width", "stroke"],
  ellipse: ["width", "stroke"],
  measure: ["width", "stroke"],
};

const loadOptions = (): CalloutOptions => {
  try {
    return { ...DEFAULT_CALLOUT, ...JSON.parse(localStorage.getItem("ann:callout") ?? "{}") };
  } catch {
    return DEFAULT_CALLOUT;
  }
};

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

/** The shell copies with the native clipboard (an iframe may be refused). */
const copyText = async (text: string) => {
  window.parent.postMessage({ type: "copy-text", text, label: "Callout report" }, location.origin);
  return true;
};

/** Shift: square / circle for areas, 45° steps for the measure line. */
const constrain = (tool: AnnotateTool, a: Point, b: Point, shift: boolean): Point => {
  if (!shift) {
    return b;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (tool === "measure" || tool === "arrow") {
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    const len = Math.hypot(dx, dy);
    return { x: a.x + Math.cos(angle) * len, y: a.y + Math.sin(angle) * len };
  }
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: a.x + Math.sign(dx || 1) * side, y: a.y + Math.sign(dy || 1) * side };
};

/**
 * Excalidraw handles its shortcuts (undo, delete, …) only while focus is
 * inside the editor; the overlay would otherwise leave focus on the page.
 */
const focusEditor = () =>
  window.setTimeout(() => {
    const el = document.querySelector<HTMLElement>(".excalidraw-container, .excalidraw");
    if (el && !el.contains(document.activeElement)) {
      el.focus({ preventScroll: true });
    }
  }, 0);

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
  const [opts, setOpts] = useState<CalloutOptions>(loadOptions);
  const setOpt = (patch: Partial<CalloutOptions>) =>
    setOpts((o) => {
      const next = { ...o, ...patch };
      remember.set("callout", JSON.stringify(next));
      return next;
    });
  const [color, setColor] = useState<AnnotateColor>(
    () => COLORS.find((c) => c.id === remember.get("colour")) ?? COLORS[0],
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const labelPending = useRef(false);
  labelPending.current = !!labelAt;
  // latest label text, readable synchronously from key handlers
  const textRef = useRef("");
  textRef.current = text;
  const commitRef = useRef<() => void>(() => {});

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
    labelPending.current = false;
    textRef.current = "";
    setText("");
    dragging.current = false;
  };

  useEffect(reset, [tool]);
  useEffect(() => remember.set("tool", tool), [tool]);
  useEffect(() => remember.set("colour", color.id), [color]);
  useEffect(() => preloadImageSizes(api), [api]);

  // keys while annotating (not while typing a label)
  useEffect(() => {
    const typing = () => {
      const tag = document.activeElement?.tagName;
      return tag === "INPUT" || tag === "TEXTAREA";
    };
    const onDown = (e: KeyboardEvent) => {
      shift.current = e.shiftKey;
      if (typing() || e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      // a label is waiting but its input has no focus yet (the editor grabs
      // focus after the click): keystrokes go into the label, not to tools
      if (labelPending.current) {
        let handled = true;
        if (e.key.length === 1) {
          textRef.current += e.key;
          setText(textRef.current);
        } else if (e.key === "Backspace") {
          textRef.current = textRef.current.slice(0, -1);
          setText(textRef.current);
        } else if (e.key === "Enter" && e.shiftKey) {
          textRef.current += "\n";
          setText(textRef.current);
        } else if (e.key === "Enter") {
          commitRef.current();
        } else {
          handled = false; // Escape and the rest: handled elsewhere
        }
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          inputRef.current?.focus();
        }
        return;
      }
      const n = Number(e.key);
      if (tool === "select") {
        // digits pick an annotate tool; every other key is Excalidraw's
        // (delete, arrow keys, shortcuts) while editing the selection
        if (n >= 1 && n < TOOLS.length) {
          e.preventDefault();
          e.stopPropagation();
          setTool(TOOLS[n].id);
        }
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        setPassThrough(true);
        return;
      }
      if (n >= 1 && n < TOOLS.length) {
        e.preventDefault();
        e.stopPropagation();
        setTool(TOOLS[n].id);
      } else if (e.key.toLowerCase() === "v") {
        e.preventDefault();
        e.stopPropagation();
        setTool("select");
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
  }, [tool]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape while editing a label's text belongs to Excalidraw
      if (e.key === "Escape" && document.activeElement?.tagName !== "TEXTAREA") {
        e.preventDefault();
        e.stopPropagation();
        if (anchor || labelAt) {
          reset();
        } else if (tool === "select" && Object.keys(api.getAppState().selectedElementIds).length) {
          api.selection.clear();
        } else {
          onExit();
        }
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [anchor, labelAt, onExit, tool, api]);

  const isDrag = tool !== "callout" && tool !== "number" && tool !== "select";

  const finishDrag = (a: Point, b: Point) => {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4 / api.getAppState().zoom.value) {
      return; // a click, not a drag
    }
    if (tool === "highlight") addHighlight(api, a, b, color);
    else if (tool === "arrow") addArrow(api, a, b, color, opts);
    else if (tool === "box" || tool === "ellipse") addMarker(api, a, b, tool, color, opts);
    else if (tool === "measure") addMeasure(api, a, b, color, opts);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || labelAt) {
      return;
    }
    const p = toScene(api, e.clientX, e.clientY);
    // clicks on an existing label don't make a new callout or marker:
    // a double-click there edits the label instead
    if ((tool === "callout" || tool === "number") && calloutAt(api, p)) {
      e.preventDefault();
      if (e.detail < 2) {
        notify("Double-click a label to edit it");
      }
      return;
    }
    if (tool === "number") {
      addNumber(api, p, color, current.format);
      focusEditor();
      return;
    }
    if (isDrag) {
      focusEditor();
      dragging.current = true;
      overlay.current?.setPointerCapture(e.pointerId);
      setAnchor(p);
      setPointer(p);
      return;
    }
    if (!anchor) {
      focusEditor();
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
      addCallout(api, anchor, labelAt, textRef.current, color, { ...opts, ...numbering() });
    }
    reset();
    focusEditor();
  };
  commitRef.current = commitCallout;

  /** one numbering per drawing: new callouts follow the existing ones */
  const numbering = (): Numbering =>
    docNumbering(api) ?? { numbered: opts.numbered, format: opts.format, template: opts.template };
  const current = numbering();
  const lockedImages = lockedImageCount(api);
  const next = calloutText(nextCalloutNumber(api.getSceneElements()), "", { ...current, numbered: true }).prefix;

  const chooseNumbering = (patch: Partial<Numbering>) => {
    const n = { ...current, ...patch };
    setOpt(n);
    if (setNumbering(api, n)) {
      const count = api.getSceneElements().filter((el) => el.type === "rectangle" && typeof (el.customData as any)?.annotation?.callout === "number").length;
      notify(
        n.numbered
          ? `${count} callout${count === 1 ? "" : "s"} now numbered ${calloutText(1, "", n).prefix}, ${calloutText(2, "", n).prefix}…`
          : `Numbers hidden on ${count} callout${count === 1 ? "" : "s"}`,
      );
    }
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
      const pts = arrowPoints(opts.shape, b, a).map(([x, y]) => [b.x + x, b.y + y]);
      // the curve passes through its middle point, like Excalidraw's
      const d =
        opts.shape === "curved"
          ? `M${pts[0][0]} ${pts[0][1]} Q${2 * pts[1][0] - (pts[0][0] + pts[2][0]) / 2} ${2 * pts[1][1] - (pts[0][1] + pts[2][1]) / 2} ${pts[2][0]} ${pts[2][1]}`
          : `M${pts.map((p) => p.join(" ")).join(" L")}`;
      const ink = labelColors(opts.style, color);
      const ghost = !labelAt && (
        <g opacity={0.85}>
          <rect
            x={b.x - 28}
            y={b.y - 17}
            width={56}
            height={34}
            rx={8}
            fill={ink.background === "transparent" ? "none" : ink.background}
            stroke={ink.stroke === "transparent" ? stroke : ink.stroke}
            strokeDasharray={ink.stroke === "transparent" ? "4 4" : undefined}
          />
          <text x={b.x} y={b.y + 5} textAnchor="middle" fontSize={14} fontWeight={600} fill={ink.text}>
            {opts.numbered ? next : "Aa"}
          </text>
        </g>
      );
      return (
        <>
          <path d={d} fill="none" stroke={stroke} strokeWidth={opts.width} strokeDasharray={labelAt ? undefined : "6 5"} />
          {ghost}
          <circle cx={a.x} cy={a.y} r={5} fill={stroke} />
          <circle cx={a.x} cy={a.y} r={11} fill="none" stroke={stroke} strokeOpacity={0.35} strokeWidth={2} />
        </>
      );
    }
    if (tool === "arrow") {
      const pts = arrowPoints(opts.shape, a, b).map(([x, y]) => [a.x + x, a.y + y]);
      const d =
        opts.shape === "curved"
          ? `M${pts[0][0]} ${pts[0][1]} Q${2 * pts[1][0] - (pts[0][0] + pts[2][0]) / 2} ${2 * pts[1][1] - (pts[0][1] + pts[2][1]) / 2} ${pts[2][0]} ${pts[2][1]}`
          : `M${pts.map((p) => p.join(" ")).join(" L")}`;
      return (
        <path d={d} fill="none" stroke={stroke} strokeWidth={opts.width} strokeDasharray={opts.stroke === "dashed" ? "8 6" : opts.stroke === "dotted" ? "1 5" : undefined} strokeLinecap="round" />
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
  const activeTool = TOOLS.find((t) => t.id === tool)!;
  const step =
    tool === "select"
      ? activeTool.hint
      : tool === "callout"
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
        className={`ann-overlay${passThrough || tool === "select" ? " ann-overlay--through" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <svg className="ann-preview">{preview()}</svg>
      </div>

      {labelScreen && (
        <textarea
          ref={inputRef}
          className="ann-input"
          rows={Math.min(8, text.split("\n").length)}
          wrap="soft"
          style={(() => {
            const ink = labelColors(opts.style, color);
            const bare = ink.stroke === "transparent";
            return {
              left: labelScreen.x,
              top: labelScreen.y,
              borderColor: bare ? color.stroke : ink.stroke,
              borderStyle: bare ? "dashed" : "solid",
              background: ink.background === "transparent" ? undefined : ink.background,
              color: ink.background === "transparent" ? ink.text : "#1e1e1e",
            };
          })()}
          value={text}
          placeholder={opts.numbered ? `${next}  Label… (Shift+Enter: new line)` : "Label… (Shift+Enter: new line)"}
          onChange={(e) => {
            textRef.current = e.target.value;
            setText(e.target.value);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault(); // Shift+Enter adds a line
              commitCallout();
            } else if (e.key === "Escape") {
              reset();
            }
          }}
          // the editor may grab focus after the click: keep typing here
          onBlur={() => window.setTimeout(() => inputRef.current?.focus(), 0)}
        />
      )}

      <div className="ann-dock">
      <div className="ann-step" aria-live="polite">
        <Icon icon={AnnotateIcon} size={15} /> {stepText}
      </div>

      {TOOL_OPTIONS[tool] && (
        <div className="ann-options" role="toolbar" aria-label="Defaults for new annotations">
          {TOOL_OPTIONS[tool]!.map((key, i) => (
            <span key={key} className="ann-group">
              {i > 0 && <span className="ann-sep" />}
              {key === "style" && (
                <>
              {STYLES.map((o) => (
                <button
                  key={o.id}
                  className={`ann-btn ann-btn--sm${opts.style === o.id ? " ann-btn--on" : ""}`}
                  title={o.label}
                  aria-label={o.label}
                  aria-pressed={opts.style === o.id}
                  onClick={() => setOpt({ style: o.id })}
                >
                  {o.glyph}
                </button>
              ))}
                </>
              )}
              {key === "shape" && (
                <>
              {SHAPES.map((o) => (
                <button
                  key={o.id}
                  className={`ann-btn ann-btn--sm${opts.shape === o.id ? " ann-btn--on" : ""}`}
                  title={o.label}
                  aria-label={o.label}
                  aria-pressed={opts.shape === o.id}
                  onClick={() => setOpt({ shape: o.id })}
                >
                  {o.glyph}
                </button>
              ))}
                </>
              )}
              {key === "head" && (
                <>
              {HEADS.map((o) => (
                <button
                  key={o.id}
                  className={`ann-btn ann-btn--sm${opts.head === o.id ? " ann-btn--on" : ""}`}
                  title={o.label}
                  aria-label={o.label}
                  aria-pressed={opts.head === o.id}
                  onClick={() => setOpt({ head: o.id })}
                >
                  {o.glyph}
                </button>
              ))}
                </>
              )}
              {key === "width" && (
                <>
              {WIDTHS.map((o) => (
                <button
                  key={o.id}
                  className={`ann-btn ann-btn--sm${opts.width === o.id ? " ann-btn--on" : ""}`}
                  title={o.label}
                  aria-label={o.label}
                  aria-pressed={opts.width === o.id}
                  onClick={() => setOpt({ width: o.id })}
                >
                  {o.glyph}
                </button>
              ))}
                </>
              )}
              {key === "stroke" && (
                <>
              {STROKES.map((o) => (
                <button
                  key={o.id}
                  className={`ann-btn ann-btn--sm${opts.stroke === o.id ? " ann-btn--on" : ""}`}
                  title={o.label}
                  aria-label={o.label}
                  aria-pressed={opts.stroke === o.id}
                  onClick={() => setOpt({ stroke: o.id })}
                >
                  {o.glyph}
                </button>
              ))}
                </>
              )}
              {key === "numbered" && (
                <NumberingMenu value={current} onChange={chooseNumbering} />
              )}
            </span>
          ))}
        </div>
      )}

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
            data-ink={c.id}
            style={{ background: c.stroke }}
            title={`${c.id === "black" ? "black (white in dark mode)" : c.id} (C cycles colours)`}
            aria-label={`${c.id} colour`}
            onClick={() => setColor(c)}
          />
        ))}
        <span className="ann-sep" />
        <button
          className={`ann-btn${lockedImages ? " ann-btn--on" : ""}`}
          title={
            lockedImages
              ? `Image position locked (${lockedImages}). Click to unlock, or select another image to lock it too`
              : "Lock image position (the selected image, or the only one) so it can't move while you annotate"
          }
          aria-pressed={lockedImages > 0}
          onClick={() => {
            const r = toggleImageLock(api);
            setTick((t) => t + 1);
            notify(
              !r
                ? "Select an image to lock its position"
                : r.action === "locked"
                ? `Image position locked${r.count > 1 ? ` (${r.count} images)` : ""}. Click again to unlock`
                : `Image position unlocked${r.count > 1 ? ` (${r.count} images)` : ""}`,
            );
          }}
        >
          <Icon icon={lockedImages ? LockIcon : UnlockIcon} size={18} />
        </button>
        <button
          className="ann-btn"
          title="Lock as background: send the selected image (or the only one) to the back and lock it"
          onClick={() => {
            const n = lockAsBackground(api);
            setTick((t) => t + 1);
            notify(n ? `Locked ${n} image${n > 1 ? "s" : ""} as background` : "Select an image first");
          }}
        >
          <Icon icon={BackgroundIcon} size={18} />
        </button>
        <button className="ann-btn" title="Send selection to back" onClick={() => sendToBack(api)}>
          <Icon icon={LayersIcon} size={18} />
        </button>
        <button className="ann-btn ann-btn--flip" title="Bring selection forward" onClick={() => bringForward(api)}>
          <Icon icon={LayersIcon} size={18} />
        </button>
        <AutoArrange api={api} />
        <button
          className="ann-btn"
          title="Select callout pair: label and arrow together, to move them as one"
          onClick={() => {
            const ids = calloutParts(api, Object.keys(api.getAppState().selectedElementIds));
            if (!ids.length) {
              notify("Select a callout's label or arrow first");
              return;
            }
            setTool("select");
            api.selection.select(ids);
          }}
        >
          <Icon icon={PairIcon} size={18} />
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
            await copyText(report);
            notify(`Copied ${report.split("\n").length} callout labels`);
          }}
        >
          <Icon icon={FilesIcon} size={18} />
        </button>
        <span className="ann-sep" />
        <button className="ann-btn" title="Done (Esc)" onClick={onExit}>
          <Icon icon={CloseIcon} size={18} />
        </button>
      </div>
      </div>
    </>
  );
};

/** Off · 1 · 01 · a · A · custom pattern, for the whole drawing. */
const NumberingMenu = ({
  value,
  onChange,
}: {
  value: Numbering;
  onChange: (patch: Partial<Numbering>) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [template, setTemplate] = useState(value.template);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => setTemplate(value.template), [value.template]);
  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", close, { capture: true });
    return () => window.removeEventListener("pointerdown", close, { capture: true });
  }, [open]);
  const sample = !value.numbered
    ? "Off"
    : value.format === "custom"
    ? calloutText(1, "", value).prefix
    : NUMBER_FORMATS.find((f) => f.id === value.format)?.sample ?? "01";
  const applyTemplate = () => {
    if (template.trim()) {
      onChange({ numbered: true, format: "custom", template });
    }
  };
  return (
    <span ref={ref} className="ann-num-anchor">
      <button
        className={`ann-btn ann-btn--sm ann-btn--text${value.numbered ? " ann-btn--on" : ""}`}
        title="Numbering for this drawing's callouts"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {sample.length > 6 ? `${sample.slice(0, 5)}…` : sample} ▾
      </button>
      {open && (
        <div className="ann-num" role="menu" onKeyDown={(e) => e.stopPropagation()}>
          <button
            role="menuitemradio"
            aria-checked={!value.numbered}
            className={`ann-num__item${!value.numbered ? " ann-num__item--on" : ""}`}
            onClick={() => {
              onChange({ numbered: false });
              setOpen(false);
            }}
          >
            <span className="ann-num__sample">—</span> No numbers
          </button>
          {NUMBER_FORMATS.filter((f) => f.id !== "custom").map((f) => {
            const on = value.numbered && value.format === f.id;
            return (
              <button
                key={f.id}
                role="menuitemradio"
                aria-checked={on}
                className={`ann-num__item${on ? " ann-num__item--on" : ""}`}
                onClick={() => {
                  onChange({ numbered: true, format: f.id });
                  setOpen(false);
                }}
              >
                <span className="ann-num__sample">{f.sample}</span> {f.label}
              </button>
            );
          })}
          <div className="ann-num__custom">
            <input
              value={template}
              aria-label="Custom numbering pattern"
              placeholder="Step {n}"
              onChange={(e) => setTemplate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  applyTemplate();
                  setOpen(false);
                } else if (e.key === "Escape") {
                  setOpen(false);
                }
              }}
            />
            <button
              className={`ann-num__item${value.numbered && value.format === "custom" ? " ann-num__item--on" : ""}`}
              onClick={() => {
                applyTemplate();
                setOpen(false);
              }}
            >
              <span className="ann-num__sample">{calloutText(1, "", { numbered: true, format: "custom", template }).prefix || "…"}</span>
              Use custom
            </button>
            <span className="ann-num__note">{"{n} 1 · {01} 01 · {a} a · {A} A"}</span>
          </div>
        </div>
      )}
    </span>
  );
};
