// Text search over plain Excalidraw elements; shared by the editor (live
// scene) and the shell (JSON of drawings that are not mounted).
import type { SearchHit } from "./protocol";

type El = {
  id: string;
  type: string;
  isDeleted?: boolean;
  text?: string;
  originalText?: string;
  containerId?: string | null;
  name?: string | null;
  link?: string | null;
};

const MAX_HITS = 50;

export const snippet = (text: string, index: number, length: number) => {
  const flat = text.replace(/\s+/g, " ");
  const start = Math.max(0, index - 24);
  const end = Math.min(flat.length, index + length + 40);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
};

export const searchElements = (elements: readonly El[], query: string): SearchHit[] => {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  const hits: SearchHit[] = [];
  for (const el of elements) {
    if (el.isDeleted) {
      continue;
    }
    let text: string | null = null;
    let kind: SearchHit["kind"] = "text";
    if (el.type === "text") {
      text = el.originalText ?? el.text ?? "";
      kind = el.containerId ? "label" : "text";
    } else if (el.type === "frame" || el.type === "magicframe") {
      text = el.name ?? "";
      kind = "frame";
    } else if (el.link) {
      text = el.link;
    }
    if (!text) {
      continue;
    }
    const i = text.toLowerCase().indexOf(q);
    if (i >= 0) {
      // a bound label reveals its container
      hits.push({ id: el.containerId || el.id, text: snippet(text, i, q.length), kind });
      if (hits.length >= MAX_HITS) {
        break;
      }
    }
  }
  return hits;
};
