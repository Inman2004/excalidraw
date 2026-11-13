import { useCallback, useEffect, useRef, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { sceneFrames } from "./requests";

type Saved = Pick<
  AppState,
  "viewModeEnabled" | "zenModeEnabled" | "scrollX" | "scrollY" | "zoom" | "frameRendering"
>;

/**
 * Presentation: one frame per step in the given order (all of the drawing
 * when it has no frames), view mode, no UI. ←/→/Space/Esc.
 */
export const Presenter = ({
  api,
  ids,
  onExit,
}: {
  api: ExcalidrawImperativeAPI;
  ids: string[];
  onExit: () => void;
}) => {
  const [slides] = useState<(ExcalidrawElement | null)[]>(() => {
    const frames = sceneFrames(api);
    const byId = new Map(frames.map((f) => [f.id, f]));
    const ordered = ids.map((id) => byId.get(id)).filter(Boolean) as ExcalidrawElement[];
    // frames missing from the given order are appended in scene order
    frames.forEach((f) => !ordered.includes(f) && ordered.push(f));
    return ordered.length ? ordered : [null];
  });
  const [index, setIndex] = useState(0);
  const [hud, setHud] = useState(true);
  const hudTimer = useRef<number | undefined>(undefined);
  const saved = useRef<Saved | null>(null);

  const show = useCallback(
    (i: number, animate = true) => {
      const slide = slides[i];
      api.setViewport({
        target: slide ?? api.getSceneElements(),
        fit: "contain",
        animation: animate,
      });
      setHud(true);
      window.clearTimeout(hudTimer.current);
      hudTimer.current = window.setTimeout(() => setHud(false), 1800);
    },
    [api, slides],
  );

  // enter / leave presentation state
  useEffect(() => {
    const s = api.getAppState();
    saved.current = {
      viewModeEnabled: s.viewModeEnabled,
      zenModeEnabled: s.zenModeEnabled,
      scrollX: s.scrollX,
      scrollY: s.scrollY,
      zoom: s.zoom,
      frameRendering: s.frameRendering,
    };
    api.selection.clear();
    api.updateScene({
      appState: {
        viewModeEnabled: true,
        zenModeEnabled: true,
        openMenu: null,
        openSidebar: null,
        frameRendering: { enabled: true, name: false, outline: false, clip: true },
      },
    });
    document.body.classList.add("dsk-presenting");
    return () => {
      document.body.classList.remove("dsk-presenting");
      // cancel a running slide animation, or it would override the restore
      api.setViewport(null);
      const restore = saved.current;
      if (restore) {
        api.updateScene({ appState: restore as any });
        requestAnimationFrame(() =>
          api.updateScene({
            appState: { scrollX: restore.scrollX, scrollY: restore.scrollY, zoom: restore.zoom },
          }),
        );
      }
    };
  }, [api]);

  useEffect(() => {
    // wait one frame so view mode applies before the first fit
    const id = requestAnimationFrame(() => show(index, index !== 0));
    return () => cancelAnimationFrame(id);
  }, [index, show]);

  // refit when the window changes size (entering / leaving fullscreen)
  useEffect(() => {
    let t: number | undefined;
    const onResize = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => show(index, false), 120);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [index, show]);

  useEffect(() => {
    const go = (delta: number) =>
      setIndex((i) => Math.min(slides.length - 1, Math.max(0, i + delta)));
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      let handled = true;
      if (k === "ArrowRight" || k === "ArrowDown" || k === " " || k === "PageDown" || k === "Enter") {
        go(1);
      } else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp" || k === "Backspace") {
        go(-1);
      } else if (k === "Home") {
        setIndex(0);
      } else if (k === "End") {
        setIndex(slides.length - 1);
      } else if (k === "Escape" || k === "F5") {
        onExit();
      } else {
        handled = false;
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [slides.length, onExit]);

  const slide = slides[index];
  return (
    <div
      className="dsk-present"
      onMouseMove={() => {
        setHud(true);
        window.clearTimeout(hudTimer.current);
        hudTimer.current = window.setTimeout(() => setHud(false), 1800);
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setIndex((i) => Math.min(slides.length - 1, i + 1));
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      }}
    >
      <div className={`dsk-present__hud${hud ? " dsk-present__hud--on" : ""}`}>
        <button onClick={() => setIndex((i) => Math.max(0, i - 1))} disabled={index === 0} aria-label="Previous">
          ‹
        </button>
        <span>
          {index + 1} / {slides.length}
          {slide && <em>{(slide as any).name || `Frame ${index + 1}`}</em>}
        </span>
        <button
          onClick={() => setIndex((i) => Math.min(slides.length - 1, i + 1))}
          disabled={index === slides.length - 1}
          aria-label="Next"
        >
          ›
        </button>
        <button className="dsk-present__exit" onClick={onExit}>
          Exit
        </button>
      </div>
    </div>
  );
};
