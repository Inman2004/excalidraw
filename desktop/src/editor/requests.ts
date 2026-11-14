// Shell → frame requests (export, search, frames, callouts). Everything
// works on the live scene through Excalidraw's public API.
import {
  CaptureUpdateAction,
  restoreElements,
  convertToExcalidrawElements,
  exportScene,
  newElementWith,
} from "@excalidraw/excalidraw";

import { syncMovedIndices } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { effectiveScale } from "../common/exportLimits";
import { searchElements } from "../common/search";

import { autoArrange } from "./annotationLayout";

import { calloutReportText, labelColors } from "./annotate";
import {
  annOf,
  applyChanges,
  calloutGroups,
  labelOf,
  moveCallout,
  numberingOf,
  prefixOf,
  rebuildLabel,
  reorderCallouts,
  setNumbering,
} from "./callouts";

import type { CalloutGroup } from "./callouts";

import type {
  CalloutInfo,
  ExportInfo,
  ExportOptions,
  ExportResult,
  FrameRequest,
} from "../common/protocol";

type Ctx = {
  startPresentation: (ids: string[]) => void;
};

const isFrame = (el: ExcalidrawElement) => el.type === "frame" || el.type === "magicframe";

const frameName = (el: ExcalidrawElement, index: number) =>
  (el as any).name || `Frame ${index + 1}`;

/** Frames in natural scene order. */
export const sceneFrames = (api: ExcalidrawImperativeAPI) =>
  api.getSceneElements().filter(isFrame);

const selectionIds = (api: ExcalidrawImperativeAPI) => {
  const all = api.getSceneElements();
  const sel = api.getAppState().selectedElementIds;
  const ids = new Set(Object.keys(sel).filter((k) => sel[k]));
  for (const el of all) {
    // labels of selected containers, children of selected frames
    if ((el.type === "text" && (el as any).containerId && ids.has((el as any).containerId)) ||
      (el.frameId && ids.has(el.frameId))) {
      ids.add(el.id);
    }
  }
  return ids;
};

const blobToBuffer = (blob: Blob) => blob.arrayBuffer();

const canvasPreview = (canvas: HTMLCanvasElement, max = 720) => {
  const ratio = Math.min(1, max / Math.max(canvas.width, canvas.height));
  if (ratio === 1) {
    return canvas.toDataURL("image/png");
  }
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(canvas.width * ratio));
  small.height = Math.max(1, Math.round(canvas.height * ratio));
  const ctx = small.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(canvas, 0, 0, small.width, small.height);
  return small.toDataURL("image/png");
};

const runExport = async (
  api: ExcalidrawImperativeAPI,
  o: ExportOptions,
): Promise<ExportResult> => {
  let elements = api.getSceneElements();
  let frame: ExcalidrawElement | null = null;
  if (o.scope === "selection") {
    const ids = selectionIds(api);
    elements = elements.filter((el) => ids.has(el.id));
  } else if (o.scope === "frame") {
    frame = elements.find((el) => el.id === o.frameId && isFrame(el)) ?? null;
    if (!frame) {
      throw new Error("That frame no longer exists");
    }
  }
  if (!elements.length) {
    throw new Error("Nothing to export");
  }
  const data = {
    elements,
    appState: api.getAppState() as any,
    files: api.getFiles(),
  };
  const base = {
    theme: o.dark ? ("dark" as const) : ("light" as const),
    // JPEG has no transparency: it always gets the background
    canvasBackgroundColor:
      o.background || o.format === "jpeg" ? undefined : (false as const),
    exportingFrame: frame as any,
    padding: frame ? 0 : 10,
  };
  if (o.preview) {
    const canvas = await exportScene({ data, type: "canvas", config: { ...base, scale: 1 } });
    return {
      dataURL: canvasPreview(canvas),
      width: canvas.width,
      height: canvas.height,
    };
  }
  if (o.format === "svg") {
    const svg = await exportScene({
      data,
      type: "svg",
      config: { ...base, scale: o.scale, embedScene: o.embed },
    });
    return {
      svg: svg.outerHTML,
      width: Number(svg.getAttribute("width")) || 0,
      height: Number(svg.getAttribute("height")) || 0,
    };
  }
  // raster exports are capped (canvas size limit, encode time)
  const scale = (w: number, h: number) => effectiveScale(w, h, o.scale);
  const blob =
    o.format === "png"
      ? await exportScene({
          data,
          type: "png",
          config: { ...base, scale, embedScene: o.embed },
        })
      : await exportScene({ data, type: "jpeg", config: { ...base, scale } });
  return { bytes: await blobToBuffer(blob), width: 0, height: 0 };
};

// ------------------------------------------------------------------ callouts

const recolor = (g: CalloutGroup, stroke: string, fill: string) => {
  const ink = labelColors(annOf(g.rect ?? g.all[0]).style ?? "tinted", { stroke, fill });
  return g.all.map((el) => {
    if (el.type === "rectangle") {
      return newElementWith(el, { strokeColor: ink.stroke, backgroundColor: ink.background });
    }
    if (el.type === "text") {
      return newElementWith(el, { strokeColor: ink.text });
    }
    return newElementWith(el, { strokeColor: stroke });
  });
};

// ------------------------------------------------------------------ dispatch

export const handleRequest = async (
  api: ExcalidrawImperativeAPI,
  req: FrameRequest,
  ctx: Ctx,
): Promise<unknown> => {
  switch (req.op) {
    case "export-info": {
      const info: ExportInfo = {
        hasSelection: selectionIds(api).size > 0,
        frames: sceneFrames(api).map((f, i) => ({ id: f.id, name: frameName(f, i) })),
        name: api.getName(),
      };
      return info;
    }
    case "export":
      return runExport(api, req.options);
    case "search":
      return searchElements(api.getSceneElements() as any, req.query);
    case "reveal": {
      const el = api.getSceneElements().find((e) => e.id === req.id);
      if (!el) {
        throw new Error("That element no longer exists");
      }
      api.selection.select([el.id]);
      api.setViewport({ target: el, fit: "scale-down", animation: true });
      return true;
    }
    case "frames": {
      const frames = sceneFrames(api);
      const out = [];
      for (const [i, f] of frames.entries()) {
        let thumb: string | undefined;
        if (req.thumbs) {
          try {
            const canvas = await exportScene({
              data: { elements: api.getSceneElements(), files: api.getFiles(), appState: api.getAppState() as any },
              type: "canvas",
              config: {
                exportingFrame: f as any,
                padding: 0,
                maxWidthOrHeight: 240,
                theme: api.getAppState().theme,
              },
            });
            thumb = canvas.toDataURL("image/png");
          } catch {
            thumb = undefined;
          }
        }
        out.push({ id: f.id, name: frameName(f, i), thumb });
      }
      return out;
    }
    case "apply-frame-order": {
      // move each frame, together with its children, into the requested
      // order; everything else keeps its place
      const all = api.getSceneElementsIncludingDeleted();
      const order = req.ids.filter((id) => all.some((el) => el.id === id && isFrame(el)));
      const inBlock = (el: ExcalidrawElement) =>
        order.includes(el.id) || (!!el.frameId && order.includes(el.frameId));
      const firstAt = all.findIndex(inBlock);
      if (firstAt < 0) {
        return false;
      }
      const blocks = order.map((id) => all.filter((el) => el.id === id || el.frameId === id));
      const rest = all.filter((el) => !inBlock(el));
      const before = all.slice(0, firstAt).filter((el) => !inBlock(el));
      const after = rest.slice(before.length);
      // moved elements are copies so the live scene isn't mutated before the
      // update; they get fractional indices that match the new order
      const moved = blocks.flat().map((el) => ({ ...el }) as ExcalidrawElement);
      const next = [...before, ...moved, ...after];
      syncMovedIndices(next, new Map(moved.map((el) => [el.id, el])) as any);
      api.updateScene({
        elements: next.map((el) =>
          moved.includes(el) ? newElementWith(el, { index: el.index }, true) : el,
        ),
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      return true;
    }
    case "present":
      ctx.startPresentation(req.ids);
      return true;
    case "callouts": {
      const list: CalloutInfo[] = calloutGroups(api).map((g) => ({
        groupId: g.groupId,
        number: prefixOf(g) || "·",
        label: labelOf(g),
        numbered: numberingOf(g).numbered,
        n: g.n,
        // the arrow carries the colour; a text-only label has no border
        color: (g.arrow ?? g.rect ?? g.all[0]).strokeColor,
      }));
      return list;
    }
    case "callout-edit": {
      const g = calloutGroups(api).find((c) => c.groupId === req.groupId);
      if (!g) {
        throw new Error("That callout no longer exists");
      }
      if (req.remove) {
        applyChanges(api, g.all.map((el) => newElementWith(el, { isDeleted: true })));
        return true;
      }
      let changed: ExcalidrawElement[] = [];
      if (req.color) {
        const [stroke, fill] = req.color.split("|");
        changed = recolor(g, stroke, fill);
        // recolour first so a following label rebuild keeps the new colours
        g.rect = changed.find((el) => el.type === "rectangle") ?? g.rect;
        g.text = changed.find((el) => el.type === "text") ?? g.text;
      }
      if (req.label !== undefined) {
        const rebuilt = rebuildLabel(g, g.n, req.label);
        const ids = new Set(rebuilt.map((el) => el.id));
        changed = [...changed.filter((el) => !ids.has(el.id)), ...rebuilt];
      }
      applyChanges(api, changed);
      return true;
    }
    case "callout-reveal": {
      const g = calloutGroups(api).find((c) => c.groupId === req.groupId);
      if (!g) {
        throw new Error("That callout no longer exists");
      }
      api.selection.select(g.all.map((el) => el.id));
      if (req.target && g.arrow) {
        const a = g.arrow as any;
        const tip = a.points[a.points.length - 1];
        const x = a.x + tip[0];
        const y = a.y + tip[1];
        api.setViewport({
          target: [x - 120, y - 120, x + 120, y + 120] as any,
          fit: "none",
          animation: true,
        });
      } else {
        api.setViewport({ target: g.all, fit: "scale-down", animation: true });
      }
      return true;
    }
    case "callouts-renumber":
      return reorderCallouts(api, null);
    case "callouts-reorder":
      return reorderCallouts(api, req.ids);
    case "callout-move":
      return moveCallout(api, req.groupId, req.to);
    case "callouts-numbering":
      return setNumbering(api, req.numbering);
    case "callouts-numbering-info": {
      const groups = calloutGroups(api);
      return groups.length ? numberingOf(groups[groups.length - 1]) : null;
    }
    case "callouts-arrange":
      return autoArrange(api, { density: req.density ?? "balanced", renumber: !!req.renumber });
    case "report":
      return calloutReportText(api.getSceneElements());
    case "render": {
      const data = JSON.parse(req.json);
      const elements = restoreElements(data.elements ?? [], null).filter((el) => !el.isDeleted);
      if (!elements.length) {
        return null;
      }
      const canvas = await exportScene({
        data: { elements: elements as any, appState: data.appState ?? {}, files: data.files ?? {} },
        type: "canvas",
        config: { maxWidthOrHeight: req.max, padding: 8 },
      });
      return canvas.toDataURL("image/png");
    }
  }
};
