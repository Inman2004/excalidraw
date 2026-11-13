import { useEffect, useMemo, useRef, useState } from "react";

import { FilesIcon, FramesIcon, MissingIcon, RecentIcon, TextIcon } from "../common/Icon";
import { searchElements } from "../common/search";

import { activateTab, docSceneJSON, openPaths, revealInDoc, tabLabel } from "./controller";
import { hasFrame, requestFrame } from "./frames";
import { native } from "./native";
import { Palette, fuzzyScore, highlight } from "./Palette";
import { Thumb, useThumbnail } from "./thumbnails";
import { getState, setState, useStore } from "./store";

import type { PaletteItem } from "./Palette";
import type { SearchHit } from "../common/protocol";

const close = () => setState({ panel: null });

const DocThumb = ({ docId, hash }: { docId: string; hash: string }) => (
  <Thumb src={useThumbnail(`doc:${docId}:${hash}`, () => docSceneJSON(docId))} />
);

const FileThumb = ({ path }: { path: string }) => (
  <Thumb
    src={useThumbnail(`file:${path.toLowerCase()}`, () =>
      native.docOpen(path).then((o) => o.text, () => null),
    )}
  />
);

/** Ctrl+Alt+P: open tabs and recent files by name or folder. */
export const QuickSwitcher = () => {
  const [query, setQuery] = useState("");
  const tabs = useStore((s) => s.tabs);
  const docs = useStore((s) => s.docs);
  const recents = useStore((s) => s.recents);
  const exist = useStore((s) => s.recentsExist);
  const activeTabId = useStore((s) => s.activeTabId);

  const items = useMemo(() => {
    const s = getState();
    const openPathsSet = new Set<string>();
    const rows: (PaletteItem & { score: number })[] = [];
    tabs.forEach((t) => {
      const doc = docs[t.docId];
      if (!doc) {
        return;
      }
      if (doc.path) {
        openPathsSet.add(doc.path.toLowerCase());
      }
      const name = tabLabel(s, doc).name;
      const hay = `${name} ${doc.path ?? ""}`;
      const score = fuzzyScore(hay, query);
      if (score === null) {
        return;
      }
      rows.push({
        key: `tab:${t.tabId}`,
        group: "Open tabs",
        icon: FilesIcon,
        media: <DocThumb docId={doc.docId} hash={doc.currentHash ?? ""} />,
        title: highlight(name, query),
        subtitle: doc.path ?? "Not saved yet",
        badge: t.tabId === activeTabId ? "current" : doc.status === "dirty" ? "unsaved" : undefined,
        // keep tab order when there is no query
        score: query ? score + 50 : 10000 - rows.length,
        onPick: () => void activateTab(t.tabId),
      });
    });
    recents.forEach((r, i) => {
      if (openPathsSet.has(r.path.toLowerCase())) {
        return;
      }
      const score = fuzzyScore(`${r.name} ${r.path}`, query);
      if (score === null) {
        return;
      }
      const missing = exist[r.path.toLowerCase()] === false;
      rows.push({
        key: `recent:${r.path}`,
        group: "Recent files",
        icon: missing ? MissingIcon : RecentIcon,
        media: missing ? undefined : <FileThumb path={r.path} />,
        title: highlight(r.name, query),
        subtitle: r.path,
        badge: missing ? "missing" : r.pinnedRecent ? "pinned" : undefined,
        disabled: missing,
        score: query ? score : 5000 - i,
        onPick: () => void openPaths([r.path]),
      });
    });
    // groups stay together; best match first within each
    return rows.sort((a, b) =>
      a.group === b.group ? b.score - a.score : a.group === "Open tabs" ? -1 : 1,
    );
  }, [query, tabs, docs, recents, exist, activeTabId]);

  return (
    <Palette
      label="Quick switch"
      placeholder="Go to a tab or recent file…"
      query={query}
      onQuery={setQuery}
      items={items}
      empty="No tab or recent file matches"
      onClose={close}
    />
  );
};

type DocHits = { docId: string; name: string; hits: SearchHit[] };

/** Ctrl+Shift+F: text, labels and frame names across all open drawings. */
export const GlobalSearch = () => {
  const [query, setQuery] = useState(() => sessionStorage.getItem("dsk:search") ?? "");
  const [results, setResults] = useState<DocHits[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    try {
      sessionStorage.setItem("dsk:search", query);
    } catch {
      // convenience only
    }
    const q = query.trim();
    const mine = ++seq.current;
    if (q.length < 2) {
      setResults([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = window.setTimeout(async () => {
      const s = getState();
      const out: DocHits[] = [];
      for (const tab of s.tabs) {
        const doc = s.docs[tab.docId];
        if (!doc) {
          continue;
        }
        let hits: SearchHit[] = [];
        try {
          if (hasFrame(doc.docId) && !s.loading[doc.docId]) {
            hits = await requestFrame<SearchHit[]>(doc.docId, { op: "search", query: q }, 5000);
          } else {
            const json = await docSceneJSON(doc.docId);
            hits = json ? searchElements(JSON.parse(json).elements ?? [], q) : [];
          }
        } catch {
          hits = [];
        }
        if (hits.length) {
          out.push({ docId: doc.docId, name: tabLabel(s, doc).name, hits });
        }
      }
      if (mine === seq.current) {
        setResults(out);
        setBusy(false);
      }
    }, 200);
    return () => window.clearTimeout(t);
  }, [query]);

  const items: PaletteItem[] = results.flatMap((r) =>
    r.hits.map((h, i) => ({
      key: `${r.docId}:${h.id}:${i}`,
      group: `${r.name} · ${r.hits.length} match${r.hits.length === 1 ? "" : "es"}`,
      icon: h.kind === "frame" ? FramesIcon : TextIcon,
      title: highlight(h.text, query),
      subtitle: h.kind === "frame" ? "Frame name" : h.kind === "label" ? "Shape label" : undefined,
      onPick: () => void revealInDoc(r.docId, h.id),
    })),
  );

  return (
    <Palette
      label="Find in all drawings"
      placeholder="Find text in all open drawings…"
      query={query}
      onQuery={setQuery}
      items={items}
      busy={busy}
      empty={
        query.trim().length < 2
          ? "Type at least two characters. Ctrl+F searches only this drawing."
          : busy
          ? "Searching…"
          : `Nothing found for "${query.trim()}"`
      }
      onClose={close}
    />
  );
};
