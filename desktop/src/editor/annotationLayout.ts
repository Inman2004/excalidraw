// Auto layout for callouts: a deterministic arrangement of callout cards
// around the content they point at.
//
// What moves: callout label cards and their arrows' start points. What never
// moves: images, shapes, highlights, markers, measurements, arrow tips (the
// targets). The result is one undo step and stays ordinary Excalidraw
// elements. Positions are in scene coordinates, so zoom doesn't matter.
//
// Approach:
//  1. Callouts are found from their label card (see `calloutGroups`).
//  2. The "content" is what the targets sit on: non-callout elements that
//     contain a target (usually the screenshot), plus all targets.
//  3. Each card goes on a side: left/right columns, or top/bottom rows for
//     wide content, by where its target is; busy sides are rebalanced.
//  4. Along each side, cards keep their targets' order (so arrows don't
//     cross) and are packed with a fixed gap, each as close to level with its
//     target as the gap allows (clusters centred on their targets).
//  5. Cards in a column share one width; long text wraps at a maximum width.
//  6. Arrows leave from the middle of the card side facing the content.
// The same scene and settings always give the same result, and running it
// again changes nothing (it depends only on targets and text).
import {
  convertToExcalidrawElements,
  newElementWith,
} from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { arrowPoints, calloutText } from "./annotate";
import {
  annOf,
  applyChanges,
  calloutGroups,
  isNumbered,
  labelOf,
} from "./requests";

import type { CalloutGroup } from "./requests";

export type Density = "compact" | "balanced" | "spacious";

export type LayoutOptions = {
  density: Density;
  /** renumber 01, 02… in reading order; off by default (numbers may be cited) */
  renumber: boolean;
};

/** Spacing tokens in scene px at the default 16 px label text. */
const TOKENS: Record<Density, { offset: number; gap: number; padX: number; padY: number }> = {
  // offset: content edge → card; gap: card → card; pad: text → card edge
  compact: { offset: 32, gap: 8, padX: 10, padY: 6 },
  balanced: { offset: 48, gap: 16, padX: 12, padY: 10 },
  spacious: { offset: 72, gap: 24, padX: 14, padY: 14 },
};
/** Excalidraw's own padding inside a labelled shape */
const BOUND_TEXT_PADDING = 5;
const MAX_CARD_WIDTH = 300;
const MIN_CARD_WIDTH = 44;
const MIN_CARD_HEIGHT = 34;
/** room between a card and where its arrow starts */
const ARROW_GAP = 4;

type Side = "left" | "right" | "top" | "bottom";
type Pt = { x: number; y: number };
type Box = { minX: number; minY: number; maxX: number; maxY: number };

const tipOf = (g: CalloutGroup): Pt => {
  const a = g.arrow as any;
  const p = a.points[a.points.length - 1];
  return { x: a.x + p[0], y: a.y + p[1] };
};

const contains = (el: ExcalidrawElement, p: Pt) =>
  p.x >= el.x && p.x <= el.x + el.width && p.y >= el.y && p.y <= el.y + el.height;

const boundsOf = (els: readonly ExcalidrawElement[], pts: Pt[]): Box => {
  const xs = [...pts.map((p) => p.x), ...els.flatMap((el) => [el.x, el.x + el.width])];
  const ys = [...pts.map((p) => p.y), ...els.flatMap((el) => [el.y, el.y + el.height])];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
};

/**
 * A card rebuilt for `text` at `width` (null: natural single-line width).
 * The ids of the card and its text are kept, so bindings stay intact.
 */
const buildCard = (g: CalloutGroup, text: string, width: number | null) => {
  const rect = g.rect as any;
  const oldText = g.text as any;
  const built = convertToExcalidrawElements([
    {
      type: "rectangle",
      x: 0,
      y: 0,
      ...(width ? { width } : null),
      label: {
        text,
        fontSize: oldText.fontSize,
        fontFamily: oldText.fontFamily,
        strokeColor: oldText.strokeColor,
        textAlign: width ? "left" : "center",
      },
      strokeColor: rect.strokeColor,
      backgroundColor: rect.backgroundColor,
      fillStyle: rect.fillStyle,
      strokeWidth: rect.strokeWidth,
      roughness: rect.roughness,
      roundness: rect.roundness,
    },
  ]);
  const card = built.find((el) => el.type === "rectangle")!;
  const label = built.find((el) => el.type === "text")! as any;
  return { width: card.width, height: card.height, label };
};

/** Straight segments a→b and c→d cross (shared ends don't count). */
const crosses = (a: Pt, b: Pt, c: Pt, d: Pt) => {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
};

/**
 * Pack items along one axis: each wants its centre at `want`, items keep
 * their order, never overlap, and sit `gap` apart. Overlapping runs merge
 * into a cluster centred on the average of its wishes (least total shift).
 */
const pack = (items: { want: number; size: number }[], gap: number) => {
  type Cluster = { first: number; count: number; start: number; size: number };
  const clusters: Cluster[] = [];
  items.forEach((it, i) => {
    clusters.push({ first: i, count: 1, start: it.want - it.size / 2, size: it.size });
    while (clusters.length > 1) {
      const b = clusters[clusters.length - 1];
      const a = clusters[clusters.length - 2];
      if (a.start + a.size + gap <= b.start) {
        break;
      }
      const first = a.first;
      const count = a.count + b.count;
      let offset = 0;
      let wish = 0;
      for (let j = first; j < first + count; j++) {
        wish += items[j].want - (offset + items[j].size / 2);
        offset += items[j].size + gap;
      }
      clusters.splice(-2, 2, { first, count, start: wish / count, size: offset - gap });
    }
  });
  const starts: number[] = [];
  for (const c of clusters) {
    let at = c.start;
    for (let j = c.first; j < c.first + c.count; j++) {
      starts[j] = at;
      at += items[j].size + gap;
    }
  }
  return starts;
};

type Placed = {
  g: CalloutGroup;
  side: Side;
  tip: Pt;
  text: string;
  width: number;
  height: number;
  label: any;
  x: number;
  y: number;
};

export const autoArrange = (
  api: ExcalidrawImperativeAPI,
  opts: LayoutOptions = { density: "balanced", renumber: false },
) => {
  const groups = calloutGroups(api).filter((g) => g.rect && g.text && g.arrow);
  if (!groups.length) {
    return 0;
  }
  const tok = TOKENS[opts.density];
  // scale tokens with the label text size (labels are made at screen size)
  const k = ((groups[0].text as any).fontSize ?? 16) / 16;
  const offset = tok.offset * k;
  const gap = tok.gap * k;
  const padY = tok.padY * k;
  const padX = tok.padX * k;

  // ---- content: what the targets point into
  const tips = groups.map(tipOf);
  const parts = new Set(groups.flatMap((g) => g.all.map((el) => el.id)));
  const others = api.getSceneElements().filter((el) => !parts.has(el.id) && !el.isDeleted);
  const hosts = others.filter((el) => tips.some((t) => contains(el, t)));
  const box = boundsOf(hosts.length ? hosts : others, tips);
  // keep cards clear of every other annotation lying over the content too
  const covering = others.filter(
    (el) => el.x < box.maxX && el.x + el.width > box.minX && el.y < box.maxY && el.y + el.height > box.minY,
  );
  const area = boundsOf(covering, tips);
  const cx = (area.minX + area.maxX) / 2;
  const cy = (area.minY + area.maxY) / 2;
  const wide = area.maxX - area.minX > 2 * (area.maxY - area.minY);

  // ---- sides by target position, then rebalance a much busier side
  const sides: Record<Side, CalloutGroup[]> = { left: [], right: [], top: [], bottom: [] };
  const [a, b]: [Side, Side] = wide ? ["top", "bottom"] : ["left", "right"];
  groups.forEach((g, i) => {
    const t = tips[i];
    sides[wide ? (t.y < cy ? a : b) : t.x < cx ? a : b].push(g);
  });
  // a card changes side only when its side can't fit beside the content
  // (moving it costs a long arrow across the content)
  const dist = (g: CalloutGroup) => (wide ? Math.abs(tipOf(g).y - cy) : Math.abs(tipOf(g).x - cx));
  const extent = (col: CalloutGroup[]) =>
    col.reduce((sum, g) => {
      const c = buildCard(g, (g.text as any).originalText ?? (g.text as any).text, null);
      return sum + (wide ? c.width + 2 * padX : Math.max(MIN_CARD_HEIGHT * k, c.label.height + 2 * padY)) + gap;
    }, -gap);
  const room = (wide ? area.maxX - area.minX : area.maxY - area.minY) * 1.15;
  for (;;) {
    const [from, to] = sides[a].length > sides[b].length ? [sides[a], sides[b]] : [sides[b], sides[a]];
    if (from.length - to.length < 2 || extent(from) <= room) {
      break;
    }
    // the card whose target is nearest the middle changes side
    const i = from.reduce((best, g, j) => (dist(g) < dist(from[best]) ? j : best), 0);
    to.push(from.splice(i, 1)[0]);
  }
  // still too many for a side: the cards whose targets lie nearest the other
  // two edges go into a row there (top/bottom beside columns, or the reverse)
  const [c, e]: [Side, Side] = wide ? ["left", "right"] : ["top", "bottom"];
  const edgeDist = (g: CalloutGroup) => {
    const t = tipOf(g);
    return wide
      ? Math.min(t.x - area.minX, area.maxX - t.x)
      : Math.min(t.y - area.minY, area.maxY - t.y);
  };
  // rows only take what fits across the content; columns absorb the rest
  const across = (row: CalloutGroup[]) =>
    row.reduce((sum, g) => {
      const card = buildCard(g, (g.text as any).originalText ?? (g.text as any).text, null);
      return sum + (wide ? Math.max(MIN_CARD_HEIGHT * k, card.label.height + 2 * padY) : card.label.width + 2 * padX) + gap;
    }, -gap);
  const span = wide ? area.maxY - area.minY : area.maxX - area.minX;
  // always relieve the longest column first, so both end up similar
  const skipped = new Set<CalloutGroup>();
  for (;;) {
    const open = [a, b]
      .map((side) => sides[side])
      .filter((col) => col.length > 1 && extent(col) > room && col.some((g) => !skipped.has(g)));
    if (!open.length) {
      break;
    }
    const col = open.reduce((x, y) => (extent(y) > extent(x) ? y : x));
    const g = col
      .filter((x) => !skipped.has(x))
      .reduce((best, x) => (edgeDist(x) < edgeDist(best) ? x : best));
    const t = tipOf(g);
    const row = sides[wide ? (t.x < cx ? c : e) : t.y < cy ? c : e];
    if (across([...row, g]) > span) {
      skipped.add(g); // its row is full
      continue;
    }
    row.push(g);
    col.splice(col.indexOf(g), 1);
  }
  const all: Side[] = [a, b, c, e];

  // ---- reading order (also the numbering when renumbering)
  const along = (side: Side) => (side === "left" || side === "right" ? "y" : "x");
  for (const side of all) {
    const axis = along(side);
    sides[side].sort((p, q) => tipOf(p)[axis] - tipOf(q)[axis] || tipOf(p)[axis === "y" ? "x" : "y"] - tipOf(q)[axis === "y" ? "x" : "y"]);
  }
  const order = [c, a, b, e].flatMap((side) => sides[side]);
  const textOf = (g: CalloutGroup) =>
    opts.renumber && isNumbered(g)
      ? calloutText(order.indexOf(g) + 1, labelOf(g), true)
      : ((g.text as any).originalText ?? (g.text as any).text);

  // ---- card sizes: one width per column, wrapping at the maximum
  const placed: Placed[] = [];
  for (const side of all) {
    const col = sides[side];
    if (!col.length) {
      continue;
    }
    // natural width: one line of text plus the side padding
    const natural = col.map(
      (g) => buildCard(g, textOf(g), null).label.width + 2 * padX,
    );
    const shared = Math.min(MAX_CARD_WIDTH * k, Math.max(MIN_CARD_WIDTH * k, ...natural));
    col.forEach((g, i) => {
      // columns share a width; in rows each card keeps its own (capped)
      const width = along(side) === "y" ? shared : Math.min(MAX_CARD_WIDTH * k, Math.max(MIN_CARD_WIDTH * k, natural[i]));
      // lay the text out for the inner width (card minus padding on both
      // sides); Excalidraw adds its own small padding, so allow for it
      const card = buildCard(g, textOf(g), width - 2 * padX + 2 * BOUND_TEXT_PADDING * k);
      const height = Math.max(MIN_CARD_HEIGHT * k, card.label.height + 2 * padY, card.height);
      placed.push({ g, side, tip: tipOf(g), text: textOf(g), width, height, label: card.label, x: 0, y: 0 });
    });
  }

  // ---- positions along each side, then swap neighbours whose arrows cross
  const startOf = (p: Placed): Pt => {
    switch (p.side) {
      case "left":
        return { x: p.x + p.width + ARROW_GAP * k, y: p.y + p.height / 2 };
      case "right":
        return { x: p.x - ARROW_GAP * k, y: p.y + p.height / 2 };
      case "top":
        return { x: p.x + p.width / 2, y: p.y + p.height + ARROW_GAP * k };
      default:
        return { x: p.x + p.width / 2, y: p.y - ARROW_GAP * k };
    }
  };
  /** where each side's cards line up; rows stay within the content's width
   *  (they only take what fits there), so they never meet the columns */
  const line: Record<Side, number> = {
    left: area.minX - offset,
    right: area.maxX + offset,
    top: area.minY - offset,
    bottom: area.maxY + offset,
  };
  const layoutSide = (row: Placed[], side: Side) => {
    const vertical = along(side) === "y";
    const starts = pack(
      row.map((p) => ({ want: vertical ? p.tip.y : p.tip.x, size: vertical ? p.height : p.width })),
      gap,
    );
    // keep the run inside the content's span when it fits there, so arrows
    // run straight in instead of cutting across corners and other cards
    const lo = vertical ? area.minY : area.minX;
    const hi = vertical ? area.maxY : area.maxX;
    const total = row.reduce((sum, p) => sum + (vertical ? p.height : p.width) + gap, -gap);
    if (row.length && total <= hi - lo) {
      let floor = lo;
      row.forEach((p, i) => {
        starts[i] = Math.max(starts[i], floor);
        floor = starts[i] + (vertical ? p.height : p.width) + gap;
      });
      let ceil = hi;
      for (let i = row.length - 1; i >= 0; i--) {
        const size = vertical ? row[i].height : row[i].width;
        starts[i] = Math.min(starts[i], ceil - size);
        ceil = starts[i] - gap;
      }
    }
    row.forEach((p, i) => {
      if (vertical) {
        p.y = starts[i];
        p.x = side === "left" ? line.left - p.width : line.right;
      } else {
        p.x = starts[i];
        p.y = side === "top" ? line.top - p.height : line.bottom;
      }
    });
  };
  for (const side of all) {
    const row = placed.filter((p) => p.side === side);
    layoutSide(row, side);
    // a few deterministic passes: swapping crossing neighbours removes most
    // crossings that target order alone can't (targets at different depths)
    for (let pass = 0; pass < row.length; pass++) {
      let swapped = false;
      for (let i = 0; i + 1 < row.length; i++) {
        if (crosses(startOf(row[i]), row[i].tip, startOf(row[i + 1]), row[i + 1].tip)) {
          [row[i], row[i + 1]] = [row[i + 1], row[i]];
          layoutSide(row, side);
          swapped = true;
        }
      }
      if (!swapped) {
        break;
      }
    }
  }

  // ---- write the changes: card, its text, its arrow
  const changed: ExcalidrawElement[] = [];
  for (const p of placed) {
    const rect = p.g.rect as any;
    const old = p.g.text as any;
    changed.push(newElementWith(rect, { x: p.x, y: p.y, width: p.width, height: p.height }));
    changed.push({
      ...p.label,
      id: old.id,
      containerId: rect.id,
      // the label was laid out in a card at 0,0: keep its offset
      x: p.x + padX,
      y: p.y + (p.height - p.label.height) / 2,
      groupIds: old.groupIds,
      frameId: old.frameId,
      index: old.index,
      customData: old.customData,
      version: old.version + 1,
      versionNonce: Math.floor(Math.random() * 2 ** 31),
      updated: Date.now(),
    } as ExcalidrawElement);

    const arrow = p.g.arrow as any;
    const start = startOf(p);
    const dx = p.tip.x - start.x;
    const dy = p.tip.y - start.y;
    const vertical = along(p.side) === "y";
    const points: [number, number][] = arrow.elbowed
      ? vertical
        ? [[0, 0], [dx / 2, 0], [dx / 2, dy], [dx, dy]]
        : [[0, 0], [0, dy / 2], [dx, dy / 2], [dx, dy]]
      : arrowPoints(arrow.roundness?.type === 2 && arrow.points.length > 2 ? "curved" : "straight", start, p.tip);
    const xs = points.map((q) => q[0]);
    const ys = points.map((q) => q[1]);
    const fixedPoint =
      p.side === "left" ? [1, 0.5] : p.side === "right" ? [0, 0.5] : p.side === "top" ? [0.5, 1] : [0.5, 0];
    changed.push(
      newElementWith(arrow, {
        x: start.x,
        y: start.y,
        points: points as any,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        ...(arrow.elbowed ? { fixedSegments: null } : null),
        startBinding: {
          ...(arrow.startBinding ?? {}),
          elementId: rect.id,
          fixedPoint,
          mode: arrow.startBinding?.mode ?? "orbit",
        },
      } as any),
    );

    if (opts.renumber && isNumbered(p.g)) {
      const n = order.indexOf(p.g) + 1;
      for (let i = changed.length - 3; i < changed.length; i++) {
        const el = changed[i] as any;
        changed[i] = { ...el, customData: { ...el.customData, annotation: { ...annOf(el), callout: n } } };
      }
    }
  }
  applyChanges(api, changed);
  return placed.length;
};
