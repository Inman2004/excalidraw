import { useEffect, useState } from "react";

import { HistoryClockIcon, Icon, NewDrawingIcon, TemplatesIcon } from "../common/Icon";

import annotationTemplate from "../../templates/annotation.json";
import flowchartTemplate from "../../templates/flowchart.json";
import wireframeTemplate from "../../templates/wireframe.json";

import { openTemplate, restoreBackup } from "./controller";
import { AnnotationNavigator, FrameNavigator } from "./Drawers";
import { ExportDialog } from "./ExportDialog";
import { baseName, native } from "./native";
import { setState, toast, useStore } from "./store";
import { GlobalSearch, QuickSwitcher } from "./Switchers";
import { Thumb, useThumbnail } from "./thumbnails";
import { Modal } from "./ui/Dialogs";

import type { BackupEntry } from "./native";

const close = () => setState({ panel: null });

const REASONS: Record<string, string> = {
  manual: "Saved",
  checkpoint: "Checkpoint while editing",
  conflict: "Before overwriting a change on disk",
  replaced: "Before being replaced",
  restore: "Before restoring an older version",
};

const ago = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

const kb = (n: number) =>
  n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

const BackupThumb = ({ path, id }: { path: string; id: string }) => (
  <Thumb
    className="dsk-thumb--lg"
    src={useThumbnail(`backup:${path.toLowerCase()}:${id}`, () =>
      native.backupRead(path, id).catch(() => null),
    )}
  />
);

const HistoryDialog = ({ docId }: { docId: string }) => {
  const doc = useStore((s) => s.docs[docId]);
  const [list, setList] = useState<BackupEntry[] | null>(null);

  useEffect(() => {
    if (!doc?.path) {
      setList([]);
      return;
    }
    native
      .backupList(doc.path)
      .then((l) => setList([...l].sort((a, b) => b.createdMs - a.createdMs)))
      .catch((e) => {
        toast(`Could not read the history: ${e}`, "error");
        setList([]);
      });
  }, [doc?.path]);

  const restore = async (b: BackupEntry) => {
    try {
      const when = new Date(b.createdMs);
      const label = `${when.toLocaleDateString()} ${when.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
      await restoreBackup(docId, b.id, label);
      close();
      toast("Opened the older version in a new tab. The file changes only if you save over it.", "success", 6000);
    } catch (e) {
      toast(`Could not open that version: ${e instanceof Error ? e.message : e}`, "error");
    }
  };

  return (
    <Modal
      title={`File history${doc?.path ? ` · ${baseName(doc.path)}` : ""}`}
      onClose={close}
      wide
      footer={
        <button className="dsk-btn dsk-btn--primary" data-autofocus onClick={close}>
          Close
        </button>
      }
    >
      {!doc?.path && (
        <p className="dsk-muted">History is kept for drawings saved to a file. Save this drawing first.</p>
      )}
      {doc?.path && list && list.length === 0 && (
        <p className="dsk-muted">
          No earlier versions yet. A version is kept each time a manual save changes the
          file, every 5 minutes of editing, and before the file is overwritten. The last 10
          are kept.
        </p>
      )}
      {list && list.length > 0 && (
        <table className="dsk-table">
          <thead>
            <tr>
              <th />
              <th>When</th>
              <th>Why</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.id}>
                <td className="dsk-table__thumb">
                  <BackupThumb path={doc!.path!} id={b.id} />
                </td>
                <td title={new Date(b.createdMs).toLocaleString()}>{ago(b.createdMs)}</td>
                <td>{REASONS[b.reason] ?? b.reason}</td>
                <td>{kb(b.size)}</td>
                <td className="dsk-table__actions">
                  <button className="dsk-btn" onClick={() => void restore(b)}>
                    <Icon icon={HistoryClockIcon} /> Open as new tab
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!list && <p className="dsk-muted">Loading…</p>}
    </Modal>
  );
};

type Template = { name: string; description: string; elements: unknown[] | null; art: string };

const TEMPLATES: Template[] = [
  { name: "Blank", description: "An empty canvas", elements: null, art: "blank" },
  { ...flowchartTemplate, art: "flow" },
  { ...annotationTemplate, art: "annotate" },
  { ...wireframeTemplate, art: "wire" },
];

/** Small line drawings for the template cards. */
const Art = ({ kind }: { kind: string }) => (
  <svg viewBox="0 0 120 72" className="dsk-tpl__art" aria-hidden>
    {kind === "blank" && <rect x="34" y="18" width="52" height="36" rx="6" strokeDasharray="4 4" />}
    {kind === "flow" && (
      <>
        <ellipse cx="60" cy="10" rx="16" ry="6" />
        <rect x="42" y="24" width="36" height="12" rx="3" />
        <path d="M60 46 l12 8 -12 8 -12 -8z" />
        <path d="M60 16v8M60 36v10M72 54h16" />
        <rect x="88" y="49" width="22" height="10" rx="3" />
      </>
    )}
    {kind === "annotate" && (
      <>
        <rect x="14" y="12" width="64" height="48" rx="3" strokeDasharray="4 3" />
        <rect x="86" y="14" width="22" height="9" rx="3" />
        <path d="M86 19 L56 34" />
        <circle cx="56" cy="34" r="2" />
        <rect x="86" y="44" width="22" height="9" rx="3" />
        <path d="M86 48 L40 50" />
      </>
    )}
    {kind === "wire" && (
      <>
        <rect x="8" y="8" width="72" height="56" rx="3" />
        <path d="M8 18h72" />
        <rect x="14" y="23" width="60" height="16" />
        <rect x="14" y="44" width="17" height="14" />
        <rect x="35" y="44" width="17" height="14" />
        <rect x="56" y="44" width="18" height="14" />
        <rect x="88" y="8" width="24" height="56" rx="4" />
        <rect x="92" y="18" width="16" height="12" />
      </>
    )}
  </svg>
);

const TemplateDialog = () => (
  <Modal title="New from template" onClose={close} wide>
    <div className="dsk-tpls">
      {TEMPLATES.map((t, i) => (
        <button
          key={t.name}
          className="dsk-tpl"
          data-autofocus={i === 0 ? true : undefined}
          onClick={() => {
            close();
            openTemplate(t.elements, t.elements ? t.name : "Untitled");
          }}
        >
          <Art kind={t.art} />
          <span className="dsk-tpl__name">
            <Icon icon={t.elements ? TemplatesIcon : NewDrawingIcon} /> {t.name}
          </span>
          <span className="dsk-tpl__desc">{t.description}</span>
        </button>
      ))}
    </div>
  </Modal>
);

/** Whichever tool panel is open (one at a time). */
export const PanelHost = () => {
  const panel = useStore((s) => s.panel);
  const docExists = useStore((s) => (s.panel?.docId ? !!s.docs[s.panel.docId] : true));
  if (!panel || !docExists) {
    return null;
  }
  switch (panel.kind) {
    case "export":
      return panel.docId ? <ExportDialog docId={panel.docId} /> : null;
    case "switcher":
      return <QuickSwitcher />;
    case "search":
      return <GlobalSearch />;
    case "frames":
      return panel.docId ? <FrameNavigator key={panel.docId} docId={panel.docId} /> : null;
    case "annotations":
      return panel.docId ? <AnnotationNavigator key={panel.docId} docId={panel.docId} /> : null;
    case "history":
      return panel.docId ? <HistoryDialog docId={panel.docId} /> : null;
    case "templates":
      return <TemplateDialog />;
  }
  return null;
};
