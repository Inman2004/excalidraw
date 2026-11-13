// Registry of editor iframes and the message channel to them.
import type { FrameRequest, FromFrame, Snapshot, ToFrame } from "../common/protocol";

type FrameEntry = {
  docId: string;
  win: Window | null;
  ready: boolean;
  /** messages queued until the frame says "ready" */
  queue: ToFrame[];
  element: HTMLIFrameElement | null;
};

const frames = new Map<string, FrameEntry>();
let reqSeq = 0;
const pendingSnapshots = new Map<number, (s: Snapshot | null) => void>();
const pendingReplies = new Map<
  number,
  { resolve: (data: any) => void; reject: (error: Error) => void }
>();

/** Ask a frame for something; rejects when the frame is gone, fails or is silent. */
export const requestFrame = <T = unknown>(
  docId: string,
  req: FrameRequest,
  timeoutMs = 30000,
) =>
  new Promise<T>((resolve, reject) => {
    const reqId = ++reqSeq;
    if (!sendToFrame(docId, { type: "request", reqId, req })) {
      reject(new Error("The drawing is not open"));
      return;
    }
    const timer = window.setTimeout(() => {
      pendingReplies.delete(reqId);
      reject(new Error("The drawing did not respond"));
    }, timeoutMs);
    pendingReplies.set(reqId, {
      resolve: (data) => {
        window.clearTimeout(timer);
        resolve(data as T);
      },
      reject: (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    });
  });

export const registerFrame = (docId: string, element: HTMLIFrameElement | null) => {
  if (!element) {
    frames.delete(docId);
    return;
  }
  const existing = frames.get(docId);
  if (existing && existing.element === element) {
    return;
  }
  frames.set(docId, {
    docId,
    win: element.contentWindow,
    ready: false,
    queue: existing?.queue ?? [],
    element,
  });
};

export const frameElement = (docId: string) => frames.get(docId)?.element ?? null;

export const sendToFrame = (docId: string, msg: ToFrame) => {
  const entry = frames.get(docId);
  if (!entry) {
    return false;
  }
  if (!entry.ready || !entry.win) {
    entry.queue.push(msg);
    return true;
  }
  entry.win.postMessage(msg, location.origin);
  return true;
};

export const broadcast = (msg: ToFrame, exceptDocId?: string) => {
  frames.forEach((f) => {
    if (f.docId !== exceptDocId) {
      sendToFrame(f.docId, msg);
    }
  });
};

export const hasFrame = (docId: string) => frames.has(docId);

/** A frame that is ready to work (prefers `preferred`), for render jobs. */
export const readyFrame = (preferred?: string | null) => {
  const p = preferred ? frames.get(preferred) : undefined;
  if (p?.ready) {
    return p.docId;
  }
  for (const f of frames.values()) {
    if (f.ready) {
      return f.docId;
    }
  }
  return null;
};

/** Fresh serialization of the editor; null when the frame is gone or silent. */
export const requestSnapshot = (docId: string, timeoutMs = 4000) =>
  new Promise<Snapshot | null>((resolve) => {
    const reqId = ++reqSeq;
    if (!sendToFrame(docId, { type: "snapshot-request", reqId })) {
      resolve(null);
      return;
    }
    const timer = window.setTimeout(() => {
      pendingSnapshots.delete(reqId);
      resolve(null);
    }, timeoutMs);
    pendingSnapshots.set(reqId, (snap) => {
      window.clearTimeout(timer);
      resolve(snap);
    });
  });

/** Identify the sending frame and route its message. */
export const listenToFrames = (
  handler: (docId: string, msg: FromFrame) => void,
) => {
  const onMessage = (event: MessageEvent<FromFrame>) => {
    if (event.origin !== location.origin) {
      return;
    }
    let entry: FrameEntry | undefined;
    frames.forEach((f) => {
      if (f.element?.contentWindow === event.source) {
        entry = f;
      }
    });
    if (!entry) {
      return;
    }
    const msg = event.data;
    if (msg.type === "ready") {
      entry.win = event.source as Window;
      entry.ready = true;
      const queued = entry.queue.splice(0);
      queued.forEach((m) => entry!.win!.postMessage(m, location.origin));
    }
    if (msg.type === "snapshot" && msg.reqId !== undefined) {
      pendingSnapshots.get(msg.reqId)?.(msg.snapshot);
      pendingSnapshots.delete(msg.reqId);
    }
    if (msg.type === "reply") {
      const pending = pendingReplies.get(msg.reqId);
      pendingReplies.delete(msg.reqId);
      if (msg.ok) {
        pending?.resolve(msg.data);
      } else {
        pending?.reject(new Error(msg.error || "Request failed"));
      }
      return;
    }
    handler(entry.docId, msg);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
};
