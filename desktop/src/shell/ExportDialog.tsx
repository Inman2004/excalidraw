import { useEffect, useMemo, useRef, useState } from "react";

import { CopyIconD, ExportIcon, Icon, ImageIcon, MoonIcon } from "../common/Icon";

import { MAX_EXPORT_SIDE, effectiveScale } from "../common/exportLimits";

import { requestFrame } from "./frames";
import { IN_TAURI, baseName, native, stripExt } from "./native";
import { setState, toast, useStore } from "./store";
import { Seg, Toggle } from "./ui/Controls";
import { Modal } from "./ui/Dialogs";

import type {
  ExportFormat,
  ExportInfo,
  ExportOptions,
  ExportResult,
} from "../common/protocol";

type Prefs = Pick<ExportOptions, "format" | "scale" | "background" | "dark" | "embed">;

const PREFS_KEY = "excalidraw-desktop:export";
const DEFAULTS: Prefs = { format: "png", scale: 2, background: true, dark: false, embed: false };

const loadPrefs = (): Prefs => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
  } catch {
    return DEFAULTS;
  }
};

const MIME: Record<ExportFormat, string> = {
  png: "image/png",
  svg: "image/svg+xml",
  jpeg: "image/jpeg",
};
const EXT: Record<ExportFormat, string> = { png: "png", svg: "svg", jpeg: "jpg" };

/**
 * Let the busy state reach the screen before the export starts: the editor
 * renders large exports on the shared main thread, which blocks painting.
 */
const paintFirst = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

const safeName = (name: string) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "drawing";

const resultBytes = (r: ExportResult) =>
  r.svg !== undefined ? new TextEncoder().encode(r.svg) : new Uint8Array(r.bytes ?? new ArrayBuffer(0));

const browserDownload = (bytes: Uint8Array, name: string, mime: string) => {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};

export const ExportDialog = ({ docId }: { docId: string }) => {
  const doc = useStore((s) => s.docs[docId]);
  const [info, setInfo] = useState<ExportInfo | null>(null);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const [scope, setScope] = useState<ExportOptions["scope"]>("scene");
  const [frameId, setFrameId] = useState<string>("");
  const [preview, setPreview] = useState<ExportResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "copy" | null>(null);
  const previewSeq = useRef(0);

  const close = () => setState({ panel: null });

  useEffect(() => {
    requestFrame<ExportInfo>(docId, { op: "export-info" })
      .then((i) => {
        setInfo(i);
        if (i.hasSelection) {
          setScope("selection");
        }
        if (i.frames.length) {
          setFrameId(i.frames[0].id);
        }
      })
      .catch((e) => setPreviewError(String(e.message ?? e)));
  }, [docId]);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // per-viewer convenience only
    }
  }, [prefs]);

  const options: ExportOptions = useMemo(
    () => ({
      ...prefs,
      // JPEG has no transparency; PNG/SVG only can embed the scene
      background: prefs.format === "jpeg" ? true : prefs.background,
      embed: prefs.format === "jpeg" ? false : prefs.embed,
      scope,
      frameId: scope === "frame" ? frameId : undefined,
    }),
    [prefs, scope, frameId],
  );

  // live preview (scale 1, downsized)
  useEffect(() => {
    if (!info) {
      return;
    }
    const seq = ++previewSeq.current;
    const t = window.setTimeout(() => {
      requestFrame<ExportResult>(docId, { op: "export", options: { ...options, preview: true } })
        .then((r) => {
          if (seq === previewSeq.current) {
            setPreview(r);
            setPreviewError(null);
          }
        })
        .catch((e) => {
          if (seq === previewSeq.current) {
            setPreview(null);
            setPreviewError(String(e.message ?? e));
          }
        });
    }, 120);
    return () => window.clearTimeout(t);
  }, [docId, info, options.scope, options.frameId, options.background, options.dark]);

  const baseFileName = () => {
    if (scope === "frame") {
      const f = info?.frames.find((x) => x.id === frameId);
      if (f) {
        return safeName(f.name);
      }
    }
    return safeName(stripExt(doc?.path ? baseName(doc.path) : doc?.displayName ?? "drawing"));
  };

  const run = async () => {
    await paintFirst();
    const r = await requestFrame<ExportResult>(docId, { op: "export", options }, 120000);
    return resultBytes(r);
  };

  const save = async () => {
    setBusy("save");
    try {
      const ext = EXT[options.format];
      const name = `${baseFileName()}.${ext}`;
      if (!IN_TAURI) {
        browserDownload(await run(), name, MIME[options.format]);
        close();
        return;
      }
      const folder = doc?.path ? doc.path.replace(/[\\/][^\\/]*$/, "") : null;
      const target = await native.pickSave(folder ? `${folder}\\${name}` : name, ext);
      if (!target) {
        return;
      }
      const bytes = await run();
      // the OS save dialog already asked about replacing an existing file
      await native.docSaveBytes(target, bytes, null, true);
      toast(`Exported ${baseName(target)}`, "success");
      close();
    } catch (error) {
      toast(`Export failed: ${error instanceof Error ? error.message : error}`, "error", 6000);
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    setBusy("copy");
    try {
      await paintFirst();
      const r = await requestFrame<ExportResult>(docId, { op: "export", options }, 120000);
      if (options.format === "svg") {
        await native.copyText(r.svg ?? "");
      } else {
        await native.copyImage(new Uint8Array(r.bytes ?? new ArrayBuffer(0)));
      }
      toast(`Copied ${options.format.toUpperCase()} to the clipboard`, "success");
      close();
    } catch (error) {
      toast(`Copy failed: ${error instanceof Error ? error.message : error}`, "error", 6000);
    } finally {
      setBusy(null);
    }
  };

  const set = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));
  // what will actually be written (PNG/JPEG are capped; see exportLimits)
  const scaleUsed =
    preview && options.format !== "svg"
      ? effectiveScale(preview.width, preview.height, options.scale)
      : options.scale;
  const capped = scaleUsed < options.scale - 1e-6;
  const pxW = preview ? Math.round(preview.width * scaleUsed) : 0;
  const pxH = preview ? Math.round(preview.height * scaleUsed) : 0;

  return (
    <Modal
      title="Export image"
      onClose={close}
      wide
      footer={
        <>
          {options.format !== "jpeg" && (
            <button className="dsk-btn" disabled={!!busy || !preview} onClick={() => void copy()}>
              <Icon icon={CopyIconD} />
              {busy === "copy" ? "Copying…" : `Copy ${options.format.toUpperCase()}`}
            </button>
          )}
          <button
            className="dsk-btn dsk-btn--primary"
            data-autofocus
            disabled={!!busy || !preview}
            onClick={() => void save()}
          >
            <Icon icon={ExportIcon} />
            {busy === "save" ? "Exporting…" : "Save…"}
          </button>
        </>
      }
    >
      <div className="dsk-export">
        <div className={`dsk-export__preview${options.dark ? " dsk-export__preview--dark" : ""}`}>
          {preview?.dataURL ? (
            <img src={preview.dataURL} alt="Export preview" />
          ) : (
            <span className="dsk-muted">{previewError ?? "Rendering preview…"}</span>
          )}
          {preview && (
            <span
              className={`dsk-export__size${capped ? " dsk-export__size--capped" : ""}`}
              title={
                capped
                  ? `Very large drawing: reduced to fit the ${MAX_EXPORT_SIDE.toLocaleString()} px / 100 megapixel image limit. Use SVG for unlimited size.`
                  : undefined
              }
            >
              {pxW.toLocaleString()} × {pxH.toLocaleString()} px
              {capped && " · reduced to fit"}
            </span>
          )}
        </div>
        <div className="dsk-export__opts">
          <div className="dsk-field">
            <span>Format</span>
            <Seg
              label="Format"
              value={prefs.format}
              onChange={(format) => set({ format })}
              options={[
                { id: "png", label: "PNG" },
                { id: "svg", label: "SVG" },
                { id: "jpeg", label: "JPEG" },
              ]}
            />
          </div>
          <div className="dsk-field">
            <span>Content</span>
            <Seg
              label="Content"
              value={scope}
              onChange={setScope}
              options={[
                { id: "scene", label: "Everything" },
                { id: "selection", label: "Selection", disabled: !info?.hasSelection },
                { id: "frame", label: "Frame", disabled: !info?.frames.length },
              ]}
            />
          </div>
          {scope === "frame" && info && (
            <div className="dsk-field">
              <span>Frame</span>
              <select
                className="dsk-select"
                value={frameId}
                onChange={(e) => setFrameId(e.target.value)}
              >
                {info.frames.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="dsk-field">
            <span>Scale</span>
            <Seg
              label="Scale"
              value={prefs.scale}
              onChange={(scale) => set({ scale })}
              options={[1, 2, 3, 4].map((n) => ({ id: n, label: `${n}×` }))}
            />
          </div>
          <Toggle
            on={options.background}
            label="Background"
            icon={ImageIcon}
            disabled={prefs.format === "jpeg"}
            hint={prefs.format === "jpeg" ? "JPEG always has a background" : undefined}
            onClick={() => set({ background: !prefs.background })}
          />
          <Toggle
            on={prefs.dark}
            label="Dark mode"
            icon={MoonIcon}
            onClick={() => set({ dark: !prefs.dark })}
          />
          <Toggle
            on={options.embed}
            label="Embed scene"
            icon={ExportIcon}
            disabled={prefs.format === "jpeg"}
            hint="The image can be opened again as an editable drawing"
            onClick={() => set({ embed: !prefs.embed })}
          />
        </div>
      </div>
    </Modal>
  );
};
