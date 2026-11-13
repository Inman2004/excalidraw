// Small drawing previews for the quick switcher and file history. Rendered
// by an open editor frame (the shell carries no drawing engine), cached for
// the session, and made one at a time when the app is idle.
import { useEffect, useState } from "react";

import { readyFrame, requestFrame } from "./frames";
import { getState } from "./store";

const MAX = 160;
const cache = new Map<string, Promise<string | null>>();
let queue: Promise<unknown> = Promise.resolve();

const idle = () =>
  new Promise<void>((resolve) =>
    "requestIdleCallback" in window
      ? requestIdleCallback(() => resolve(), { timeout: 400 })
      : setTimeout(resolve, 30),
  );

/** Thumbnail for `key`, rendered from the JSON `load` returns (null = none). */
export const thumbnail = (key: string, load: () => Promise<string | null>) => {
  let hit = cache.get(key);
  if (!hit) {
    hit = (queue = queue.then(async () => {
      await idle();
      const s = getState();
      const active = s.tabs.find((t) => t.tabId === s.activeTabId)?.docId;
      const frame = readyFrame(active);
      if (!frame) {
        return null;
      }
      const json = await load();
      if (!json) {
        return null;
      }
      return requestFrame<string | null>(frame, { op: "render", json, max: MAX }, 15000);
    }).catch(() => null)) as Promise<string | null>;
    cache.set(key, hit);
    // a failed render may succeed later (e.g. once a frame exists)
    hit.then((v) => v === null && cache.delete(key));
  }
  return hit;
};

export const useThumbnail = (key: string | null, load: () => Promise<string | null>) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    if (key) {
      thumbnail(key, load).then((v) => alive && setSrc(v));
    }
    return () => {
      alive = false;
    };
    // `load` is recreated on every render; the key identifies the content
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return src;
};

export const Thumb = ({ src, className }: { src: string | null; className?: string }) => (
  <span className={`dsk-thumb${className ? ` ${className}` : ""}`} aria-hidden>
    {src ? <img src={src} alt="" draggable={false} /> : null}
  </span>
);
