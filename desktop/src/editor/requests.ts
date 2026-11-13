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

import { searchElements } from "../common/search";

import { calloutReportText, formatNumber } from "./annotate";

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
  const blob =
    o.format === "png"
      ? await exportScene({
          data,
          type: "png",
          config: { ...base, scale: o.scale, embedScene: o.embed },
        })
      : await exportScene({ data, type: "jpeg", config: { ...base, scale: o.scale } });
  return { bytes: await blobToBuffer(blob), width: 0, height: 0 };
};

// ------------------------------------------------------------------ callouts

type CalloutGroup = {
  groupId: string;
  n: number;
  rect?: ExcalidrawElement;
  text?: ExcalidrawElement;
  arrow?: ExcalidrawElement;
  all: ExcalidrawElement[];
};

const calloutGroups = (api: ExcalidrawImperativeAPI) => {
  const groups = new Map<string, CalloutGroup>();
  for (const el of api.getSceneElements()) {
    const n = (el.customData as any)?.annotation?.callout;
    const groupId = el.groupIds[el.groupIds.length - 1];
    if (typeof n !== "number" || !groupId) {
      continue;
    }
    const g = groups.get(groupId) ?? { groupId, n, all: [] };
    g.all.push(el);
    if (el.type === "rectangle") g.rect = el;
    if (el.type === "text") g.text = el;
    if (el.type === "arrow") g.arrow = el;
    groups.set(groupId, g);
  }
  return [...groups.values()].sort((a, b) => a.n - b.n);
};

const labelOf = (g: CalloutGroup) => {
  const raw = ((g.text as any)?.originalText ?? (g.text as any)?.text ?? "") as string;
  return raw.replace(/^\d+\s*/, "");
};

/**
 * Rebuild a callout's label box for new text/number: the container is
 * regenerated (same id, same centre) so its size fits the text.
 */
const rebuildLabel = (
  g: CalloutGroup,
  n: number,
  label: string,
): ExcalidrawElement[] => {
  if (!g.rect || !g.text) {
    return [];
  }
  const rect = g.rect as any;
  const oldText = g.text as any;
  const text = label.trim() ? `${formatNumber(n)}  ${label.trim()}` : formatNumber(n);
  const built = convertToExcalidrawElements([
    {
      type: "rectangle",
      id: rect.id,
      x: 0,
      y: 0,
      label: { text, fontSize: oldText.fontSize, strokeColor: oldText.strokeColor },
      strokeColor: rect.strokeColor,
      backgroundColor: rect.backgroundColor,
      fillStyle: rect.fillStyle,
      strokeWidth: rect.strokeWidth,
      roughness: rect.roughness,
      roundness: rect.roundness,
    },
  ]);
  const newRect = built.find((el) => el.type === "rectangle") as any;
  const newText = built.find((el) => el.type === "text") as any;
  const width = Math.max(newRect.width, (44 * oldText.fontSize) / 16);
  const height = Math.max(newRect.height, rect.height);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const annotation = { ...(rect.customData?.annotation ?? {}), callout: n };
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
    groupIds: oldText.groupIds,
    frameId: oldText.frameId,
    customData: { ...(oldText.customData ?? {}), annotation },
  };
  return [nextRect, newElementWith(oldText, { isDeleted: true }), nextText];
};

const applyChanges = (
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

const recolor = (g: CalloutGroup, stroke: string, fill: string) =>
  g.all.map((el) => {
    if (el.type === "rectangle") {
      return newElementWith(el, { strokeColor: stroke, backgroundColor: fill });
    }
    return newElementWith(el, { strokeColor: stroke });
  });

const renumber = (api: ExcalidrawImperativeAPI) => {
  const changed: ExcalidrawElement[] = [];
  calloutGroups(api).forEach((g, i) => {
    const n = i + 1;
    if (g.n === n) {
      return;
    }
    const rebuilt = rebuildLabel(g, n, labelOf(g));
    changed.push(...rebuilt);
    const touched = new Set(rebuilt.map((el) => el.id));
    for (const el of g.all) {
      if (!touched.has(el.id)) {
        changed.push(
          newElementWith(el, {
            customData: {
              ...(el.customData ?? {}),
              annotation: { ...((el.customData as any)?.annotation ?? {}), callout: n },
            },
          }),
        );
      }
    }
  });
  if (changed.length) {
    applyChanges(api, changed);
  }
  return changed.length > 0;
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
        number: formatNumber(g.n),
        label: labelOf(g),
        color: (g.rect ?? g.arrow ?? g.all[0]).strokeColor,
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
      return renumber(api);
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
