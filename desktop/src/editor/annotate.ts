// Annotation element builders. Everything produced is plain Excalidraw
// elements tagged with `customData.annotation`, so files stay fully
// compatible with excalidraw.com. Callouts are not grouped: the arrow is
// bound to its label like any Excalidraw arrow, so both stay editable.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type AnnotateTool =
  | "select"
  | "callout"
  | "arrow"
  | "number"
  | "highlight"
  | "box"
  | "ellipse"
  | "measure";

export type AnnotateColor = { id: string; stroke: string; fill: string };

export const COLORS: AnnotateColor[] = [
  { id: "black", stroke: "#1e1e1e", fill: "#e9ecef" },
  { id: "red", stroke: "#e03131", fill: "#ffc9c9" },
  { id: "blue", stroke: "#1971c2", fill: "#a5d8ff" },
  { id: "green", stroke: "#2f9e44", fill: "#b2f2bb" },
  { id: "yellow", stroke: "#f08c00", fill: "#ffec99" },
];

/** white: white box, dark text · plain: text only · tinted: colour fill · outline: border only */
export type LabelStyle = "white" | "plain" | "tinted" | "outline";
export type ArrowShape = "straight" | "curved" | "elbow";
export type ArrowHead = "arrow" | "triangle" | "dot" | "bar" | "none";
export type StrokeStyle = "solid" | "dashed" | "dotted";
/** 1, 2, 3 · 01, 02, 03 · a, b, c · A, B, C · a custom pattern like "Step {n}" */
export type NumberFormat = "1" | "01" | "a" | "A" | "custom";

/** How callouts in a drawing are numbered. */
export type Numbering = { numbered: boolean; format: NumberFormat; template: string };

/** Defaults for new annotations; once made, they're edited natively. */
export type CalloutOptions = {
  style: LabelStyle;
  shape: ArrowShape;
  head: ArrowHead;
  numbered: boolean;
  format: NumberFormat;
  /** custom pattern: {n} 1, {01} 01, {a} a, {A} A; no token → number appended */
  template: string;
  /** line width in screen px (arrows, outlines, measure) */
  width: number;
  stroke: StrokeStyle;
};

export const DEFAULT_CALLOUT: CalloutOptions = {
  style: "white",
  shape: "straight",
  head: "triangle",
  numbered: true,
  format: "01",
  template: "Step {n}",
  width: 2,
  stroke: "solid",
};

const INK = "#111111";
const LABEL_BORDER = "#333333";
const HIGHLIGHT_YELLOW = "#ffd43b";

const nativeHead = (head: ArrowHead) =>
  head === "none" ? null : head === "dot" ? "circle" : head;

/** Label box and text colours for a style. */
export const labelColors = (style: LabelStyle, color: { stroke: string; fill: string }) => {
  switch (style) {
    case "plain":
      return { stroke: "transparent", background: "transparent", text: color.stroke };
    case "tinted":
      return { stroke: color.stroke, background: color.fill, text: INK };
    case "outline":
      return { stroke: color.stroke, background: "transparent", text: color.stroke };
    default:
      // white label: fixed neutral border; the arrow carries the colour
      return { stroke: LABEL_BORDER, background: "#ffffff", text: INK };
  }
};

/** 1 → a, 26 → z, 27 → aa (like spreadsheet columns). */
const letters = (n: number) => {
  let out = "";
  for (let v = Math.max(1, Math.floor(n)); v > 0; v = Math.floor((v - 1) / 26)) {
    out = String.fromCharCode(97 + ((v - 1) % 26)) + out;
  }
  return out;
};

/** The number part of a callout label, e.g. 3 → "03", "c", "Step 3". */
export const formatCalloutNumber = (n: number, format: NumberFormat = "01", template = "") => {
  switch (format) {
    case "1":
      return String(n);
    case "a":
      return letters(n);
    case "A":
      return letters(n).toUpperCase();
    case "custom": {
      const t = template.trim();
      if (!t) {
        return String(n);
      }
      const tokens: Record<string, string> = {
        "{n}": String(n),
        "{01}": String(n).padStart(2, "0"),
        "{a}": letters(n),
        "{A}": letters(n).toUpperCase(),
      };
      return /\{(n|01|a|A)\}/.test(t)
        ? t.replace(/\{(n|01|a|A)\}/g, (m) => tokens[m])
        : `${t} ${n}`;
    }
    default:
      return String(n).padStart(2, "0");
  }
};

export const NUMBER_FORMATS: { id: NumberFormat; label: string; sample: string }[] = [
  { id: "1", label: "1, 2, 3", sample: "1" },
  { id: "01", label: "01, 02, 03", sample: "01" },
  { id: "a", label: "a, b, c", sample: "a" },
  { id: "A", label: "A, B, C", sample: "A" },
  { id: "custom", label: "Custom", sample: "…" },
];

/** Label text and the number prefix it starts with ("" when not numbered). */
export const calloutText = (n: number, label: string, numbering: Numbering) => {
  const t = label.trim();
  const prefix = numbering.numbered
    ? formatCalloutNumber(n, numbering.format, numbering.template)
    : "";
  if (!prefix) {
    return { text: t || formatCalloutNumber(n, numbering.format, numbering.template), prefix };
  }
  return { text: t ? `${prefix}  ${t}` : prefix, prefix };
};

/**
 * Points of a callout arrow from `start` to `end`, relative to `start`.
 * Curved arrows get a bend point; elbow arrows go across, then down.
 */
export const arrowPoints = (shape: ArrowShape, start: Point, end: Point): [number, number][] => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (shape === "curved") {
    const bend = 0.2;
    return [
      [0, 0],
      [dx / 2 - dy * bend, dy / 2 + dx * bend],
      [dx, dy],
    ];
  }
  if (shape === "elbow") {
    return Math.abs(dx) >= Math.abs(dy)
      ? [[0, 0], [dx / 2, 0], [dx / 2, dy], [dx, dy]]
      : [[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]];
  }
  return [
    [0, 0],
    [dx, dy],
  ];
};

export type Point = { x: number; y: number };

type Skeleton = Parameters<typeof convertToExcalidrawElements>[0] extends
  | (infer T)[]
  | null
  ? T
  : never;

export const randomId = () => Math.random().toString(36).slice(2, 12);

const CLEAN = { roughness: 0, strokeWidth: 2 } as const;

/**
 * Annotations keep the same on-screen size at any zoom: sizes are given in
 * screen px and divided by the zoom.
 */
const screenScale = (api: ExcalidrawImperativeAPI) =>
  Math.min(8, Math.max(0.25, 1 / api.getAppState().zoom.value));

/** Next callout (or number marker) number: one more than the highest. */
export const nextCalloutNumber = (
  elements: readonly ExcalidrawElement[],
  key: "callout" | "number" = "callout",
) => {
  let max = 0;
  for (const el of elements) {
    const n = (el.customData as any)?.annotation?.[key];
    if (!el.isDeleted && typeof n === "number" && n > max) {
      max = n;
    }
  }
  return max + 1;
};

export function formatNumber(n: number) {
  return String(n).padStart(2, "0");
}

/** Arrow end to attach to whatever lies under `at` (like drawing a native arrow). */
type Bind = { side: "start" | "end"; at: Point };

const BINDABLE = new Set(["rectangle", "diamond", "ellipse", "image", "stickynote", "iframe", "embeddable"]);

/**
 * Topmost element an arrow end at `p` should stick to: one containing the
 * point (the arrow then keeps that exact spot, "inside"), or one whose edge
 * is within a few screen px (it then snaps to the outline, "orbit").
 */
const bindTargetAt = (
  api: ExcalidrawImperativeAPI,
  p: Point,
  exclude: Set<string>,
) => {
  const els = api.getSceneElements();
  const snap = 10 / api.getAppState().zoom.value;
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    const bindable =
      BINDABLE.has(el.type) || (el.type === "text" && !(el as any).containerId);
    if (!bindable || exclude.has(el.id) || el.isDeleted || el.angle || !el.width || !el.height) {
      continue;
    }
    const inside =
      p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height;
    const near =
      p.x >= el.x - snap && p.x <= el.x + el.width + snap &&
      p.y >= el.y - snap && p.y <= el.y + el.height + snap;
    if (inside || near) {
      return {
        el,
        binding: {
          elementId: el.id,
          mode: inside ? ("inside" as const) : ("orbit" as const),
          fixedPoint: [(p.x - el.x) / el.width, (p.y - el.y) / el.height] as [number, number],
        },
      };
    }
  }
  return null;
};

/**
 * Tag new elements and insert them as one undo step. Nothing is grouped:
 * related parts are bound (arrow to label, text to its container), so each
 * stays editable with Excalidraw's own tools. Arrow ends in `binds` stick to
 * the element under them, so they follow it when it moves.
 */
const commit = (
  api: ExcalidrawImperativeAPI,
  created: readonly ExcalidrawElement[],
  annotation: Record<string, unknown>,
  binds: Bind[] = [],
) => {
  const tagged = created.map((el) => ({
    ...el,
    customData: { ...(el.customData ?? {}), annotation },
  })) as ExcalidrawElement[];
  const arrow = tagged.find((el) => el.type === "arrow") as any;
  const touched = new Map<string, ExcalidrawElement>();
  if (arrow) {
    const own = new Set(tagged.map((el) => el.id));
    for (const b of binds) {
      const key = b.side === "start" ? "startBinding" : "endBinding";
      if (arrow[key]) {
        continue; // already bound (a callout's label)
      }
      const hit = bindTargetAt(api, b.at, own);
      if (!hit) {
        continue;
      }
      arrow[key] = hit.binding;
      const target = touched.get(hit.el.id) ?? hit.el;
      touched.set(
        hit.el.id,
        newElementWith(target, {
          boundElements: [...(target.boundElements ?? []), { id: arrow.id, type: "arrow" }],
        }),
      );
    }
  }
  const scene = api.getSceneElementsIncludingDeleted().map((el) => touched.get(el.id) ?? el);
  api.updateScene({
    elements: [...scene, ...tagged],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return tagged;
};

/**
 * Callout: a label at `labelAt` with an arrow pointing at `target`. The arrow
 * is bound to the label, so it follows it and keeps its own handles.
 */
export const addCallout = (
  api: ExcalidrawImperativeAPI,
  target: Point,
  labelAt: Point,
  text: string,
  color: AnnotateColor,
  opts: CalloutOptions = DEFAULT_CALLOUT,
) => {
  const n = nextCalloutNumber(api.getSceneElements());
  const { text: labelText, prefix } = calloutText(n, text, opts);
  const rectId = randomId();
  const sc = screenScale(api);
  const fontSize = Math.round(16 * sc);
  const ink = labelColors(opts.style, color);
  const labelStyle = {
    strokeColor: ink.stroke,
    backgroundColor: ink.background,
    fillStyle: "solid" as const,
    roundness: { type: 3 as const },
    ...CLEAN,
    strokeWidth: (opts.style === "white" ? 1 : 2) * sc,
  };
  const label = { text: labelText, fontSize, strokeColor: ink.text };

  // measure the label first so it can be centred on the second click
  const probe = convertToExcalidrawElements([
    { type: "rectangle", x: 0, y: 0, label, ...labelStyle },
  ]);
  const box = probe.find((el) => el.type === "rectangle")!;
  const width = Math.max(box.width, 44 * sc);
  const height = Math.max(box.height, 34 * sc);
  const x = labelAt.x - width / 2;
  const y = labelAt.y - height / 2;

  // start the arrow where the line to the target leaves the label box
  const dx = target.x - labelAt.x;
  const dy = target.y - labelAt.y;
  let start = labelAt;
  if (opts.shape === "elbow") {
    // leave from the side facing the target
    start = Math.abs(dx) >= Math.abs(dy)
      ? { x: labelAt.x + Math.sign(dx) * (width / 2 + 4 * sc), y: labelAt.y }
      : { x: labelAt.x, y: labelAt.y + Math.sign(dy) * (height / 2 + 4 * sc) };
  } else {
    const t = Math.min(
      dx ? width / 2 / Math.abs(dx) : Infinity,
      dy ? height / 2 / Math.abs(dy) : Infinity,
    );
    const gap = 4 * sc;
    const len = Math.hypot(dx, dy) || 1;
    if (Number.isFinite(t) && t < 1) {
      start = { x: labelAt.x + dx * t + (dx / len) * gap, y: labelAt.y + dy * t + (dy / len) * gap };
    }
  }
  const points = arrowPoints(opts.shape, start, target);

  const skeletons: Skeleton[] = [
    { type: "rectangle", id: rectId, x, y, width, height, label, ...labelStyle },
    {
      type: "arrow",
      x: start.x,
      y: start.y,
      width: target.x - start.x,
      height: target.y - start.y,
      points: points as any,
      start: { id: rectId },
      ...arrowLook(api, color, opts),
    } as Skeleton,
  ];
  // `id` links the parts (label, its text, arrow) even after editing
  const annotation = {
    callout: n,
    id: randomId(),
    numbered: opts.numbered,
    format: opts.format,
    template: opts.template,
    prefix,
    style: opts.style,
  };
  return commit(api, convertToExcalidrawElements(skeletons), annotation, [{ side: "end", at: target }]);
};

/** Native arrow properties for the chosen defaults. */
const arrowLook = (
  api: ExcalidrawImperativeAPI,
  color: AnnotateColor,
  opts: CalloutOptions,
) => ({
  strokeColor: color.stroke,
  startArrowhead: null,
  endArrowhead: nativeHead(opts.head) as any,
  roundness: opts.shape === "curved" ? { type: 2 as const } : null,
  ...(opts.shape === "elbow" ? { elbowed: true } : null),
  strokeStyle: opts.stroke,
  ...CLEAN,
  strokeWidth: opts.width * screenScale(api),
});

/** A plain arrow from `a` to `b`, exactly like one drawn with the arrow tool. */
export const addArrow = (
  api: ExcalidrawImperativeAPI,
  a: Point,
  b: Point,
  color: AnnotateColor,
  opts: CalloutOptions,
) =>
  commit(
    api,
    convertToExcalidrawElements([
      {
        type: "arrow",
        x: a.x,
        y: a.y,
        width: b.x - a.x,
        height: b.y - a.y,
        points: arrowPoints(opts.shape, a, b) as any,
        ...arrowLook(api, color, opts),
      } as Skeleton,
    ]),
    { arrow: true },
    [
      { side: "start", at: a },
      { side: "end", at: b },
    ],
  );

/** Numbered marker: a filled circle with the next number, centred on `p`. */
export const addNumber = (
  api: ExcalidrawImperativeAPI,
  p: Point,
  color: AnnotateColor,
  format: NumberFormat = "1",
) => {
  const markerFormat = format === "custom" || format === "01" ? "1" : format;
  const n = nextCalloutNumber(api.getSceneElements(), "number");
  const sc = screenScale(api);
  const size = 32 * sc;
  return commit(
    api,
    convertToExcalidrawElements([
      {
        type: "ellipse",
        x: p.x - size / 2,
        y: p.y - size / 2,
        width: size,
        height: size,
        strokeColor: color.stroke,
        backgroundColor: color.stroke,
        fillStyle: "solid",
        ...CLEAN,
        strokeWidth: 1 * sc,
        label: { text: formatCalloutNumber(n, markerFormat), fontSize: Math.round(16 * sc), strokeColor: "#ffffff" },
      },
    ]),
    { number: n, format: markerFormat },
  );
};

const rectFrom = (a: Point, b: Point) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});

/** Translucent filled box, like a highlighter pen. */
export const addHighlight = (
  api: ExcalidrawImperativeAPI,
  a: Point,
  b: Point,
  color: AnnotateColor,
) =>
  commit(
    api,
    convertToExcalidrawElements([
      {
        type: "rectangle",
        ...rectFrom(a, b),
        strokeColor: "transparent",
        // black ink would make a grey smear: highlight in yellow instead
        backgroundColor: color.id === "black" ? HIGHLIGHT_YELLOW : color.fill,
        fillStyle: "solid",
        opacity: 40,
        roundness: { type: 3 },
        ...CLEAN,
      },
    ]),
    { highlight: true },
  );

/** Outline rectangle or ellipse around an area. */
export const addMarker = (
  api: ExcalidrawImperativeAPI,
  a: Point,
  b: Point,
  shape: "box" | "ellipse",
  color: AnnotateColor,
  opts: CalloutOptions = DEFAULT_CALLOUT,
) =>
  commit(
    api,
    convertToExcalidrawElements([
      {
        type: shape === "box" ? "rectangle" : "ellipse",
        ...rectFrom(a, b),
        strokeColor: color.stroke,
        backgroundColor: "transparent",
        roundness: shape === "box" ? { type: 3 } : null,
        strokeStyle: opts.stroke,
        ...CLEAN,
        strokeWidth: Math.max(opts.width, 2) * screenScale(api),
      },
    ]),
    { marker: shape },
  );

/** Natural pixel size of image files, loaded once per file. */
const naturalSizes = new Map<string, { width: number; height: number }>();

export const preloadImageSizes = (api: ExcalidrawImperativeAPI) => {
  const files = api.getFiles();
  for (const el of api.getSceneElements()) {
    const fileId = el.type === "image" ? el.fileId : null;
    const file = fileId ? files[fileId] : null;
    if (!fileId || !file || naturalSizes.has(fileId)) {
      continue;
    }
    const img = new Image();
    img.onload = () =>
      naturalSizes.set(fileId, { width: img.naturalWidth, height: img.naturalHeight });
    img.src = file.dataURL;
  }
};

/**
 * Distance in the image's own pixels when both points lie on the same
 * unrotated image (respecting crop and resize); null otherwise.
 */
export const imagePixelDistance = (
  api: ExcalidrawImperativeAPI,
  a: Point,
  b: Point,
) => {
  const inside = (el: ExcalidrawElement, p: Point) =>
    p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height;
  const images = api
    .getSceneElements()
    .filter((el) => el.type === "image" && !el.angle && inside(el, a) && inside(el, b));
  const img = images[images.length - 1] as any; // topmost
  if (!img?.fileId) {
    return null;
  }
  // crop.width/height are in natural pixels; without crop, the whole image
  const natural = img.crop
    ? { width: img.crop.width, height: img.crop.height }
    : naturalSizes.get(img.fileId);
  if (!natural || !img.width || !img.height) {
    return null;
  }
  const sx = natural.width / img.width;
  const sy = natural.height / img.height;
  return Math.hypot((b.x - a.x) * sx, (b.y - a.y) * sy);
};

export const measureLabel = (api: ExcalidrawImperativeAPI, a: Point, b: Point) => {
  const onImage = imagePixelDistance(api, a, b);
  return onImage !== null
    ? `${Math.round(onImage)} px on image`
    : `${Math.round(Math.hypot(b.x - a.x, b.y - a.y))} px`;
};

/**
 * Dimension line: a native arrow with bar ends and its length as the arrow's
 * own label, so both endpoints stay draggable and the label rides along.
 */
export const addMeasure = (
  api: ExcalidrawImperativeAPI,
  a: Point,
  b: Point,
  color: AnnotateColor,
  opts: CalloutOptions = DEFAULT_CALLOUT,
) => {
  const sc = screenScale(api);
  const label = measureLabel(api, a, b);
  return commit(
    api,
    convertToExcalidrawElements([
      {
        type: "arrow",
        x: a.x,
        y: a.y,
        width: b.x - a.x,
        height: b.y - a.y,
        points: [
          [0, 0],
          [b.x - a.x, b.y - a.y],
        ] as any,
        strokeColor: color.stroke,
        startArrowhead: "bar",
        endArrowhead: "bar",
        roundness: null,
        strokeStyle: opts.stroke,
        ...CLEAN,
        strokeWidth: opts.width * sc,
        label: { text: label, fontSize: Math.round(16 * sc), strokeColor: color.stroke },
      } as Skeleton,
    ]),
    { measure: label },
  );
};

/**
 * All parts of the callouts touching `ids`: label box, its text and arrow.
 * Parts are linked by binding, or by the shared annotation id.
 */
export const calloutParts = (api: ExcalidrawImperativeAPI, ids: Iterable<string>) => {
  const els = api.getSceneElements();
  const byId = new Map(els.map((el) => [el.id, el]));
  const tagged = els.filter((el) => typeof (el.customData as any)?.annotation?.callout === "number");
  const rects = new Set<string>();
  for (const id of ids) {
    const el = byId.get(id);
    if (!el || typeof (el.customData as any)?.annotation?.callout !== "number") {
      continue;
    }
    if (el.type === "rectangle") rects.add(el.id);
    else if (el.type === "text" && (el as any).containerId) rects.add((el as any).containerId);
    else if (el.type === "arrow") {
      const bound = (el as any).startBinding?.elementId;
      const cid = (el.customData as any).annotation.id;
      const rect =
        (bound && byId.get(bound)) ||
        tagged.find((r) => r.type === "rectangle" && cid && (r.customData as any).annotation.id === cid);
      if (rect) rects.add(rect.id);
    }
  }
  const out: string[] = [];
  for (const rid of rects) {
    out.push(rid);
    for (const el of tagged) {
      if ((el.type === "text" && (el as any).containerId === rid) ||
          (el.type === "arrow" && (el as any).startBinding?.elementId === rid)) {
        out.push(el.id);
      }
    }
  }
  return out;
};

// ------------------------------------------------------------- layering

const reorder = (
  api: ExcalidrawImperativeAPI,
  next: ExcalidrawElement[],
) =>
  api.updateScene({
    elements: next,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });

const selectedIds = (api: ExcalidrawImperativeAPI) =>
  new Set(Object.keys(api.getAppState().selectedElementIds));

/**
 * Lock image(s) and send them to the back: `ids` when given (just inserted),
 * else the selected images, else the only image in the drawing.
 */
export const lockAsBackground = (api: ExcalidrawImperativeAPI, ids?: string[]) => {
  const all = api.getSceneElementsIncludingDeleted();
  const sel = ids ? new Set(ids) : selectedIds(api);
  let images = all.filter((el) => el.type === "image" && !el.isDeleted && sel.has(el.id));
  if (!images.length) {
    const live = all.filter((el) => el.type === "image" && !el.isDeleted);
    images = live.length === 1 ? live : [];
  }
  if (!images.length) {
    return 0;
  }
  const lockIds = new Set(images.map((el) => el.id));
  const locked = images.map((el) => ({ ...el, locked: true }));
  reorder(api, [...locked, ...all.filter((el) => !lockIds.has(el.id))] as ExcalidrawElement[]);
  api.selection.clear();
  return images.length;
};

/** Unlock every locked image (locked items can't be selected to unlock them). */
export const unlockBackground = (api: ExcalidrawImperativeAPI) => {
  const all = api.getSceneElementsIncludingDeleted();
  let count = 0;
  const next = all.map((el) => {
    if (el.type === "image" && el.locked && !el.isDeleted) {
      count++;
      return { ...el, locked: false };
    }
    return el;
  });
  if (count) {
    reorder(api, next as ExcalidrawElement[]);
  }
  return count;
};

/**
 * Lock or unlock image positions, keeping their stacking order. Selected
 * images get locked; with no image selected, locked images are unlocked
 * (a locked image can't be selected), or the only image is locked.
 */
export const toggleImageLock = (
  api: ExcalidrawImperativeAPI,
): { action: "locked" | "unlocked"; count: number } | null => {
  const all = api.getSceneElementsIncludingDeleted();
  const live = all.filter((el) => el.type === "image" && !el.isDeleted);
  const sel = selectedIds(api);
  let ids = new Set(live.filter((el) => sel.has(el.id) && !el.locked).map((el) => el.id));
  let lock = true;
  if (!ids.size) {
    const locked = live.filter((el) => el.locked);
    if (locked.length) {
      ids = new Set(locked.map((el) => el.id));
      lock = false;
    } else if (live.length === 1) {
      ids = new Set([live[0].id]);
    }
  }
  if (!ids.size) {
    return null;
  }
  reorder(
    api,
    all.map((el) => (ids.has(el.id) ? { ...el, locked: lock } : el)) as ExcalidrawElement[],
  );
  if (lock) {
    api.selection.clear();
  }
  return { action: lock ? "locked" : "unlocked", count: ids.size };
};

export const lockedImageCount = (api: ExcalidrawImperativeAPI) =>
  api.getSceneElements().filter((el) => el.type === "image" && el.locked).length;

export const sendToBack = (api: ExcalidrawImperativeAPI) => {
  const all = api.getSceneElementsIncludingDeleted();
  const sel = selectedIds(api);
  if (!sel.size) {
    return;
  }
  reorder(api, [...all.filter((el) => sel.has(el.id)), ...all.filter((el) => !sel.has(el.id))]);
};

export const bringForward = (api: ExcalidrawImperativeAPI) => {
  const all = [...api.getSceneElementsIncludingDeleted()];
  const sel = selectedIds(api);
  if (!sel.size) {
    return;
  }
  // move each selected element one step up, starting from the top
  for (let i = all.length - 2; i >= 0; i--) {
    if (sel.has(all[i].id) && !sel.has(all[i + 1].id)) {
      [all[i], all[i + 1]] = [all[i + 1], all[i]];
    }
  }
  reorder(api, all);
};

/** "01  Header alignment" lines, in number order. */
export const calloutReportText = (elements: readonly ExcalidrawElement[]) =>
  calloutReport(elements)
    .map((r) => r.text)
    .join("\n");

/** Callout labels in number order, e.g. for copying as a report. */
export const calloutReport = (elements: readonly ExcalidrawElement[]) => {
  const rows: { n: number; text: string }[] = [];
  for (const el of elements) {
    const n = (el.customData as any)?.annotation?.callout;
    if (el.isDeleted || typeof n !== "number" || el.type !== "text") {
      continue;
    }
    rows.push({ n, text: (el as any).originalText ?? (el as any).text ?? "" });
  }
  return rows.sort((a, b) => a.n - b.n);
};
