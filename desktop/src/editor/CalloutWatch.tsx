// When a callout's label is deleted on its own, its arrow is left behind
// (Excalidraw unbinds it). Offer to delete that arrow too; never do it silently.
import { useEffect, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  getSceneVersion,
  newElementWith,
} from "@excalidraw/excalidraw";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

const isCalloutArrow = (el: ExcalidrawElement) =>
  el.type === "arrow" && typeof (el.customData as any)?.annotation?.callout === "number";

export const CalloutWatch = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [orphan, setOrphan] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    /** label id → id of the arrow bound to it, from the previous change */
    let pairs = new Map<string, string>();
    let lastVersion = -1;
    const unsubscribe = api.onChange((elements) => {
      const version = getSceneVersion(elements);
      if (version === lastVersion) {
        return;
      }
      lastVersion = version;
      const live = new Set<string>();
      const next = new Map<string, string>();
      for (const el of elements) {
        if (el.isDeleted) {
          continue;
        }
        live.add(el.id);
        const bound = (el as any).startBinding?.elementId;
        if (bound && isCalloutArrow(el)) {
          next.set(bound, el.id);
        }
      }
      for (const [label, arrow] of pairs) {
        if (!live.has(label) && live.has(arrow)) {
          setOrphan(arrow);
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setOrphan(null), 15000);
        }
      }
      // the label came back (undo): nothing to offer any more
      setOrphan((id) => (id && [...next.values()].includes(id) ? null : id));
      pairs = next;
    });
    return () => {
      unsubscribe();
      window.clearTimeout(timer.current);
    };
  }, [api]);

  if (!orphan) {
    return null;
  }
  const deleteArrow = () => {
    api.updateScene({
      elements: api
        .getSceneElementsIncludingDeleted()
        .map((el) => (el.id === orphan ? newElementWith(el, { isDeleted: true }) : el)),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    setOrphan(null);
  };
  return (
    <div className="ann-ask" role="alertdialog" aria-label="Callout label deleted">
      Label deleted. Delete its arrow too?
      <button className="ann-ask__primary" onClick={deleteArrow}>
        Delete arrow
      </button>
      <button onClick={() => setOrphan(null)}>Keep</button>
    </div>
  );
};
