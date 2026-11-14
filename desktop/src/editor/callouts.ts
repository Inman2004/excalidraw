// Callouts as a unit: finding them in a scene, editing their labels,
// changing their order and how they're numbered. Used by the inline label
// editor, the annotate palette and the shell's Callouts drawer.
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";

import { syncMovedIndices } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { DEFAULT_CALLOUT, calloutText } from "./annotate";

import type { NumberFormat, Numbering, Point } from "./annotate";

export type CalloutGroup = {
  groupId: string;
  n: number;
  rect?: ExcalidrawElement;
  text?: ExcalidrawElement;
  arrow?: ExcalidrawElement;
  all: ExcalidrawElement[];
};

export const annOf = (el: ExcalidrawElement) => (el.customData as any)?.annotation ?? {};

/**
 * Callouts are found from their label box. Its text is the bound label, and
 * its arrow is the tagged arrow bound to it (or, in files made before
 * callouts were ungrouped, the tagged arrow in the same group).
 */
export const calloutGroups = (api: ExcalidrawImperativeAPI) => {
  const els = api.getSceneElements();
  const tagged = els.filter((el) => typeof annOf(el).callout === "number");
  const groups: CalloutGroup[] = [];
  for (const rect of tagged) {
    if (rect.type !== "rectangle") {
      continue;
    }
    const legacyGroup = rect.groupIds[rect.groupIds.length - 1];
    const text = tagged.find((el) => el.type === "text" && (el as any).containerId === rect.id);
    const arrow = tagged.find(
      (el) =>
        el.type === "arrow" &&
        ((el as any).startBinding?.elementId === rect.id ||
          (!!legacyGroup && el.groupIds.includes(legacyGroup))),
    );
    const all = [rect, text, arrow].filter(Boolean) as ExcalidrawElement[];
    groups.push({ groupId: rect.id, n: annOf(rect).callout, rect, text, arrow, all });
  }
  // stable: equal numbers keep their scene order
  return groups.sort((x, y) => x.n - y.n);
};

/** How a callout is numbered (files from 0.1.1 and earlier: 01, 02…). */
export const numberingOf = (g: CalloutGroup): Numbering => {
  const a = annOf(g.rect ?? g.all[0]);
  return {
    numbered: a.numbered !== false,
    format: (a.format as NumberFormat) ?? "01",
    template: a.template ?? DEFAULT_CALLOUT.template,
  };
};

export const isNumbered = (g: CalloutGroup) => numberingOf(g).numbered;

const rawText = (g: CalloutGroup) =>
  ((g.text as any)?.originalText ?? (g.text as any)?.text ?? "") as string;

/** The number shown on a callout, e.g. "03" or "c". */
export const prefixOf = (g: CalloutGroup) => {
  const a = annOf(g.rect ?? g.all[0]);
  if (a.numbered === false) {
    return "";
  }
  if (typeof a.prefix === "string") {
    return a.prefix;
  }
  return calloutText(g.n, "", numberingOf(g)).prefix;
};

/** The label without its number. */
export const labelOf = (g: CalloutGroup) => {
  const raw = rawText(g);
  if (!isNumbered(g)) {
    return raw;
  }
  const prefix = prefixOf(g);
  if (prefix && raw.startsWith(prefix)) {
    return raw.slice(prefix.length).replace(/^[ \t]+/, "");
  }
  // older files had no stored prefix; their numbers were digits
  if (typeof annOf(g.rect ?? g.all[0]).prefix !== "string") {
    return raw.replace(/^\d+\s*/, "");
  }
  return raw; // the number was edited away by hand
};

/** The drawing's numbering, taken from its most recent callout. */
export const docNumbering = (api: ExcalidrawImperativeAPI): Numbering | null => {
  const groups = calloutGroups(api).filter(isNumbered);
  return groups.length ? numberingOf(groups[groups.length - 1]) : null;
};

/** Topmost callout whose label box contains `p` (scene coordinates). */
export const calloutAt = (api: ExcalidrawImperativeAPI, p: Point) => {
  const groups = calloutGroups(api);
  const order = new Map(api.getSceneElements().map((el, i) => [el.id, i]));
  let best: CalloutGroup | null = null;
  for (const g of groups) {
    const r = g.rect;
    if (!r) {
      continue;
    }
    const pad = 2;
    if (
      p.x >= r.x - pad && p.x <= r.x + r.width + pad &&
      p.y >= r.y - pad && p.y <= r.y + r.height + pad &&
      (!best || (order.get(r.id) ?? 0) > (order.get(best.rect!.id) ?? 0))
    ) {
      best = g;
    }
  }
  return best;
};

/** Where the segment from the box centre towards `to` leaves the box, plus a gap. */
const edgePoint = (
  box: { x: number; y: number; width: number; height: number },
  to: Point,
  gap: number,
) => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const dx = to.x - cx;
  const dy = to.y - cy;
  const t = Math.min(
    dx ? box.width / 2 / Math.abs(dx) : Infinity,
    dy ? box.height / 2 / Math.abs(dy) : Infinity,
  );
  if (!Number.isFinite(t) || t >= 1) {
    return null; // the next point is inside the box
  }
  const len = Math.hypot(dx, dy) || 1;
  return { x: cx + dx * t + (dx / len) * gap, y: cy + dy * t + (dy / len) * gap };
};

/**
 * Rebuild a callout's label box for new text/number: the container is
 * regenerated (same id, same centre) so its size fits the text, and the
 * arrow's start moves to the new box edge.
 */
export const rebuildLabel = (
  g: CalloutGroup,
  n: number,
  label: string,
  numbering: Numbering = numberingOf(g),
): ExcalidrawElement[] => {
  if (!g.rect || !g.text) {
    return [];
  }
  const rect = g.rect as any;
  const oldText = g.text as any;
  const { text, prefix } = calloutText(n, label, numbering);
  const built = convertToExcalidrawElements([
    {
      type: "rectangle",
      id: rect.id,
      x: 0,
      y: 0,
      label: {
        text,
        fontSize: oldText.fontSize,
        fontFamily: oldText.fontFamily,
        strokeColor: oldText.strokeColor,
        textAlign: oldText.textAlign,
      },
      strokeColor: rect.strokeColor,
      backgroundColor: rect.backgroundColor,
      fillStyle: rect.fillStyle,
      strokeWidth: rect.strokeWidth,
      roughness: rect.roughness,
      roundness: rect.roundness,
    },
  ], { regenerateIds: false });
  const newRect = built.find((el) => el.type === "rectangle") as any;
  const newText = built.find((el) => el.type === "text") as any;
  const minW = (44 * oldText.fontSize) / 16;
  const minH = (34 * oldText.fontSize) / 16;
  const width = Math.max(newRect.width, minW);
  const height = Math.max(newRect.height, minH);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const annotation = {
    ...(rect.customData?.annotation ?? {}),
    callout: n,
    numbered: numbering.numbered,
    format: numbering.format,
    template: numbering.template,
    prefix,
  };
  const arrows = (rect.boundElements ?? []).filter((b: any) => b.type === "arrow");
  const nextRect = {
    ...rect,
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    boundElements: [{ type: "text", id: newText.id }, ...arrows],
    customData: { ...(rect.customData ?? {}), annotation },
    version: rect.version + 1,
    versionNonce: Math.floor(Math.random() * 2 ** 31),
    updated: Date.now(),
  };
  const nextText = {
    ...newText,
    x: cx - newText.width / 2,
    y: cy - newText.height / 2,
    containerId: rect.id,
    groupIds: oldText.groupIds,
    frameId: oldText.frameId,
    customData: { ...(oldText.customData ?? {}), annotation },
  };
  const out: ExcalidrawElement[] = [nextRect, newElementWith(oldText, { isDeleted: true }), nextText];

  // keep the arrow leaving from the (resized) box edge; elbow arrows are
  // routed by Excalidraw and left alone
  const arrow = g.arrow as any;
  if (arrow && !arrow.elbowed && arrow.startBinding?.elementId === rect.id && arrow.points.length >= 2) {
    const abs = arrow.points.map(([x, y]: [number, number]) => ({ x: arrow.x + x, y: arrow.y + y }));
    const start = edgePoint(nextRect, abs[1], (4 * oldText.fontSize) / 16);
    if (start) {
      abs[0] = start;
      const points = abs.map((q: Point) => [q.x - start.x, q.y - start.y]);
      const xs = points.map((q: number[]) => q[0]);
      const ys = points.map((q: number[]) => q[1]);
      out.push(
        newElementWith(arrow, {
          x: start.x,
          y: start.y,
          points,
          width: Math.max(...xs) - Math.min(...xs),
          height: Math.max(...ys) - Math.min(...ys),
          customData: { ...(arrow.customData ?? {}), annotation },
        } as any),
      );
    } else {
      out.push(newElementWith(arrow, { customData: { ...(arrow.customData ?? {}), annotation } } as any));
    }
  }
  return out;
};

export const applyChanges = (
  api: ExcalidrawImperativeAPI,
  changed: ExcalidrawElement[],
) => {
  const byId = new Map(changed.map((el) => [el.id, el]));
  const all = api.getSceneElementsIncludingDeleted();
  const next: ExcalidrawElement[] = [];
  for (const el of all) {
    next.push(byId.get(el.id) ?? el);
    byId.delete(el.id);
  }
  // brand-new elements (regenerated labels) go right after their container
  const added: ExcalidrawElement[] = [];
  byId.forEach((el) => {
    const container = (el as any).containerId;
    const i = next.findIndex((e) => e.id === container);
    next.splice(i >= 0 ? i + 1 : next.length, 0, el);
    added.push(el);
  });
  // give inserted elements a fractional index that fits their new position
  if (added.length) {
    syncMovedIndices(next, new Map(added.map((el) => [el.id, el])) as any);
  }
  api.updateScene({ elements: next, captureUpdate: CaptureUpdateAction.IMMEDIATELY });
};

/** Changes that give `g` number `n` and `numbering`, or none if it has them. */
const renumbered = (g: CalloutGroup, n: number, numbering: Numbering, label = labelOf(g)) => {
  const cur = numberingOf(g);
  const same =
    g.n === n &&
    cur.numbered === numbering.numbered &&
    cur.format === numbering.format &&
    (numbering.format !== "custom" || cur.template === numbering.template) &&
    label === labelOf(g);
  if (same && typeof annOf(g.rect ?? g.all[0]).prefix === "string") {
    return [];
  }
  return rebuildLabel(g, n, label, numbering);
};

/**
 * Number the callouts 1…n in the order of `ids` (callouts not listed follow
 * in their current order), with `numbering` or each one's own. One undo step.
 */
export const reorderCallouts = (
  api: ExcalidrawImperativeAPI,
  ids: string[] | null,
  numbering?: Numbering,
) => {
  const groups = calloutGroups(api);
  const byId = new Map(groups.map((g) => [g.groupId, g]));
  const ordered = [
    ...(ids ?? []).map((id) => byId.get(id)).filter(Boolean),
    ...groups.filter((g) => !ids?.includes(g.groupId)),
  ] as CalloutGroup[];
  const changed = ordered.flatMap((g, i) => renumbered(g, i + 1, numbering ?? numberingOf(g)));
  if (changed.length) {
    applyChanges(api, changed);
  }
  return changed.length > 0;
};

/** Move one callout to position `to` (1-based); the others close up. */
export const moveCallout = (api: ExcalidrawImperativeAPI, groupId: string, to: number) => {
  const ids = calloutGroups(api).map((g) => g.groupId);
  const from = ids.indexOf(groupId);
  if (from < 0) {
    return false;
  }
  const target = Math.max(0, Math.min(ids.length - 1, to - 1));
  ids.splice(from, 1);
  ids.splice(target, 0, groupId);
  return reorderCallouts(api, ids);
};

/** Use `numbering` for every callout in the drawing, keeping their numbers. */
export const setNumbering = (api: ExcalidrawImperativeAPI, numbering: Numbering) => {
  const changed = calloutGroups(api).flatMap((g) => renumbered(g, g.n, numbering));
  if (changed.length) {
    applyChanges(api, changed);
  }
  return changed.length > 0;
};

/** New label text for one callout. */
export const editCalloutLabel = (api: ExcalidrawImperativeAPI, groupId: string, label: string) => {
  const g = calloutGroups(api).find((c) => c.groupId === groupId);
  if (!g) {
    return false;
  }
  if (label === labelOf(g)) {
    return false;
  }
  applyChanges(api, rebuildLabel(g, g.n, label));
  return true;
};
