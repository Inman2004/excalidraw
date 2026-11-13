import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  viewportCoordsToSceneCoords,
} from "@excalidraw/excalidraw";

import type { FileId } from "@excalidraw/element/types";
import type {
  BinaryFileData,
  DataURL,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";

const MAX_SIDE = 1200; // scene px, like Excalidraw's own image insertion cap

const naturalSize = (dataURL: string) =>
  new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("unreadable image"));
    img.src = dataURL;
  });

const fileIdFor = async (dataURL: string) => {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(dataURL),
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("") as FileId;
};

/**
 * Inserts dropped images centred on (x, y) — frame-relative CSS px — stacking
 * several images diagonally. Selects them and records one undo step.
 */
export const insertImages = async (
  api: ExcalidrawImperativeAPI,
  files: { name: string; mime: string; dataURL: string }[],
  x: number,
  y: number,
) => {
  const appState = api.getAppState();
  // negative coordinates mean "centre of the visible canvas"
  const center = viewportCoordsToSceneCoords(
    {
      clientX: x < 0 ? appState.offsetLeft + appState.width / 2 : x,
      clientY: y < 0 ? appState.offsetTop + appState.height / 2 : y,
    },
    appState,
  );
  const binaries: BinaryFileData[] = [];
  const skeletons: Parameters<typeof convertToExcalidrawElements>[0] = [];

  let offset = 0;
  for (const file of files) {
    try {
      const size = await naturalSize(file.dataURL);
      const scale = Math.min(1, MAX_SIDE / Math.max(size.width, size.height));
      const width = size.width * scale;
      const height = size.height * scale;
      const id = await fileIdFor(file.dataURL);
      binaries.push({
        id,
        dataURL: file.dataURL as DataURL,
        mimeType: file.mime as BinaryFileData["mimeType"],
        created: Date.now(),
      });
      skeletons.push({
        type: "image",
        fileId: id,
        x: center.x - width / 2 + offset,
        y: center.y - height / 2 + offset,
        width,
        height,
      });
      offset += 24 / appState.zoom.value;
    } catch {
      // unreadable image: skipped; the shell already filtered by extension
    }
  }
  if (!skeletons.length) {
    return [];
  }
  api.addFiles(binaries);
  const created = convertToExcalidrawElements(skeletons);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.selection.select(created.map((el) => el.id));
  if (x < 0) {
    // opened for annotation: show the whole image
    requestAnimationFrame(() =>
      api.setViewport({ target: created, fit: "scale-down" }),
    );
  }
  return created.map((el) => el.id);
};
