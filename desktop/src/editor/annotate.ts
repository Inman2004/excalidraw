// Annotation element builders. Everything produced is plain Excalidraw
// elements (grouped, tagged with `customData.annotation`), so files stay
// fully compatible with excalidraw.com.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
} from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type AnnotateTool = "callout" | "highlight" | "box" | "ellipse" | "measure";

export type AnnotateColor = { id: string; stroke: string; fill: string };

export const COLORS: AnnotateColor[] = [
  { id: "red", stroke: "#e03131", fill: "#ffc9c9" },
  { id: "blue", stroke: "#1971c2", fill: "#a5d8ff" },
  { id: "green", stroke: "#2f9e44", fill: "#b2f2bb" },
  { id: "yellow", stroke: "#f08c00", fill: "#ffec99" },
];

export type Point = { x: number; y: number };

type Skeleton = Parameters<typeof convertToExcalidrawElements>[0] extends
  | (infer T)[]
  | null
  ? T
  : never;

const randomId = () => Math.random().toString(36).slice(2, 12);

const CLEAN = { roughness: 0, strokeWidth: 2 } as const;

/**
 * Annotations keep the same on-screen size at any zoom: sizes are given in
 * screen px and divided by the zoom.
 */
const screenScale = (api: ExcalidrawImperativeAPI) =>
  Math.min(8, Math.max(0.25, 1 / api.getAppState().zoom.value));

/** Next callout number: one more than the highest recognised callout. */
export const nextCalloutNumber = (elements: readonly ExcalidrawElement[]) => {
  let max = 0;
  for (const el of elements) {
    const n = (el.customData as any)?.annotation?.callout;
    if (!el.isDeleted && typeof n === "number" && n > max) {
      max = n;
    }
  }
  return max + 1;
};

export const formatNumber = (n: number) => String(n).padStart(2, "0");

/** Tag all new elements as one annotation group and insert as one undo step. */
const commit = (
  api: ExcalidrawImperativeAPI,
  created: readonly ExcalidrawElement[],
  annotation: Record<string, unknown>,
) => {
  const groupId = randomId();
  const tagged = created.map((el) => ({
    ...el,
    groupIds: [groupId],
    customData: { ...(el.customData ?? {}), annotation },
  })) as ExcalidrawElement[];
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...tagged],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  return tagged;
};

/**
 * Numbered callout: a rounded label at `labelAt`, with an arrow bound to it
 * pointing at `target`. Returns the inserted elements.
 */
export const addCallout = (
  api: ExcalidrawImperativeAPI,
  target: Point,
  labelAt: Point,
  text: string,
  color: AnnotateColor,
) => {
  const n = nextCalloutNumber(api.getSceneElements());
  const labelText = text.trim() ? `${formatNumber(n)}  ${text.trim()}` : formatNumber(n);
  const rectId = randomId();
  const sc = screenScale(api);
  const fontSize = Math.round(16 * sc);
  const labelStyle = {
    strokeColor: color.stroke,
    backgroundColor: color.fill,
    fillStyle: "solid" as const,
    roundness: { type: 3 as const },
    ...CLEAN,
    strokeWidth: 2 * sc,
  };

  // measure the label first so it can be centred on the second click
  const probe = convertToExcalidrawElements([
    { type: "rectangle", x: 0, y: 0, label: { text: labelText, fontSize }, ...labelStyle },
  ]);
  const box = probe.find((el) => el.type === "rectangle")!;
  const width = Math.max(box.width, 44 * sc);
  const height = Math.max(box.height, 34 * sc);
  const x = labelAt.x - width / 2;
  const y = labelAt.y - height / 2;

  // start the arrow where the line to the target leaves the label box
  const dx = target.x - labelAt.x;
  const dy = target.y - labelAt.y;
  const t = Math.min(
    dx ? width / 2 / Math.abs(dx) : Infinity,
    dy ? height / 2 / Math.abs(dy) : Infinity,
  );
  const gap = 4 * sc;
  const len = Math.hypot(dx, dy) || 1;
  const start = Number.isFinite(t) && t < 1
    ? { x: labelAt.x + dx * t + (dx / len) * gap, y: labelAt.y + dy * t + (dy / len) * gap }
    : labelAt;

  const skeletons: Skeleton[] = [
    {
      type: "rectangle",
      id: rectId,
      x,
      y,
      width,
      height,
      label: { text: labelText, fontSize },
      ...labelStyle,
    },
    {
      type: "arrow",
      x: start.x,
      y: start.y,
      width: target.x - start.x,
      height: target.y - start.y,
      strokeColor: color.stroke,
      endArrowhead: "triangle",
      start: { id: rectId },
      ...CLEAN,
      strokeWidth: 2 * sc,
    },
  ];
  return commit(api, convertToExcalidrawElements(skeletons), { callout: n });
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
        backgroundColor: color.fill,
        fillStyle: "solid",
        opacity: 45,
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
        ...CLEAN,
        strokeWidth: 3 * screenScale(api),
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

/** Dimension line with its length: image pixels when on an image, else canvas px. */
export const addMeasure = (
  api: ExcalidrawImperativeAPI,
  a: Point,
  b: Point,
  color: AnnotateColor,
) => {
  const sc = screenScale(api);
  const dist = Math.hypot(b.x - a.x, b.y - a.y);
  const label = measureLabel(api, a, b);
  const fontSize = Math.round(16 * sc);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // offset the label perpendicular to the line so it never covers it
  const len = dist || 1;
  const nx = -(b.y - a.y) / len;
  const ny = (b.x - a.x) / len;
  const off = 20 * sc;
  const probe = convertToExcalidrawElements([
    { type: "rectangle", x: 0, y: 0, label: { text: label, fontSize } },
  ]).find((el) => el.type === "rectangle")!;
  // clear the line: half the pill's height plus a small gap
  const offset = Math.max(off, probe.height / 2 + 10 * sc);
  const pill = {
    width: probe.width,
    height: probe.height,
    x: mid.x + nx * offset - probe.width / 2,
    y: mid.y + ny * offset - probe.height / 2,
  };
  return commit(
    api,
    convertToExcalidrawElements([
      {
        type: "arrow",
        x: a.x,
        y: a.y,
        width: b.x - a.x,
        height: b.y - a.y,
        strokeColor: color.stroke,
        startArrowhead: "bar",
        endArrowhead: "bar",
        ...CLEAN,
        strokeWidth: 2 * sc,
      },
      {
        // a small filled pill keeps the length readable on busy images
        type: "rectangle",
        x: pill.x,
        y: pill.y,
        width: pill.width,
        height: pill.height,
        label: { text: label, fontSize },
        strokeColor: color.stroke,
        backgroundColor: color.fill,
        fillStyle: "solid",
        roundness: { type: 3 },
        ...CLEAN,
        strokeWidth: 1 * sc,
      },
    ]),
    { measure: label },
  );
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
