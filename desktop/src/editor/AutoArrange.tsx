// The Auto button in the annotate bar: arranges callouts in one step, with a
// small menu for spacing and an explicit "renumber by reading order".
import { useEffect, useRef, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { autoArrange } from "./annotationLayout";

import type { Density } from "./annotationLayout";

const DENSITIES: { id: Density; label: string; hint: string }[] = [
  { id: "balanced", label: "Balanced", hint: "Default spacing" },
  { id: "compact", label: "Compact", hint: "Less whitespace" },
  { id: "spacious", label: "Spacious", hint: "More room for long notes" },
];

const loadDensity = (): Density => {
  try {
    const v = localStorage.getItem("ann:density");
    return DENSITIES.some((d) => d.id === v) ? (v as Density) : "balanced";
  } catch {
    return "balanced";
  }
};

/** Excalidraw's own undo, so the toast's Undo is exactly Ctrl+Z. */
const undo = () => {
  const root = document.querySelector<HTMLElement>(".excalidraw-container, .excalidraw");
  root?.focus({ preventScroll: true });
  root?.dispatchEvent(
    new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true, cancelable: true }),
  );
};

export const AutoArrange = ({ api }: { api: ExcalidrawImperativeAPI }) => {
  const [density, setDensity] = useState<Density>(loadDensity);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const wrap = useRef<HTMLDivElement>(null);

  // close the menu on an outside click
  useEffect(() => {
    if (!menu) {
      return;
    }
    const close = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) {
        setMenu(false);
      }
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [menu]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const run = (renumber = false, d = density) => {
    setMenu(false);
    const n = autoArrange(api, { density: d, renumber });
    window.clearTimeout(timer.current);
    setToast(
      n
        ? `${n} callout${n > 1 ? "s" : ""} arranged${renumber ? " and renumbered" : ""}`
        : "No callouts to arrange",
    );
    timer.current = window.setTimeout(() => setToast(null), n ? 6000 : 2500);
  };

  const pick = (d: Density) => {
    setDensity(d);
    try {
      localStorage.setItem("ann:density", d);
    } catch {
      // per-viewer convenience only
    }
    run(false, d);
  };

  return (
    <div className="ann-auto" ref={wrap}>
      <button
        className="ann-btn ann-btn--text ann-auto__main"
        title="Auto arrange callouts: aligned cards beside the content, even spacing, arrows that don't cross. Keeps the numbers."
        onClick={() => run()}
      >
        Auto
      </button>
      <button
        className="ann-btn ann-auto__more"
        title="Arrange options"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
      >
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {menu && (
        <div className="ann-menu" role="menu">
          {DENSITIES.map((d) => (
            <button
              key={d.id}
              role="menuitemradio"
              aria-checked={density === d.id}
              className={`ann-menu__item${density === d.id ? " ann-menu__item--on" : ""}`}
              onClick={() => pick(d.id)}
            >
              <span>{d.label}</span>
              <small>{d.hint}</small>
            </button>
          ))}
          <div className="ann-menu__sep" />
          <button role="menuitem" className="ann-menu__item" onClick={() => run(true)}>
            <span>Arrange and renumber</span>
            <small>01, 02… in reading order</small>
          </button>
        </div>
      )}
      {toast && (
        <div className="ann-toast" role="status">
          {toast}
          {toast.includes("arranged") && (
            <button
              onClick={() => {
                undo();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
};
