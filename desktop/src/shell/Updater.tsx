// In-app updates: checks GitHub for a newer signed release (shortly after
// start, then every few hours, and on "Check for updates…"), and offers it in
// the app's own dialog. Installing saves every tab first, because the Windows
// installer closes the app without going through the normal close path.
import { useEffect, useRef, useState } from "react";

import { flushAll } from "./controller";
import { toast } from "./store";
import { Modal } from "./ui/Dialogs";

import type { Update } from "@tauri-apps/plugin-updater";

const IN_TAURI = "__TAURI_INTERNALS__" in window;
const FIRST_CHECK_MS = 8_000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const SKIP_KEY = "dsk:update-skip";

type Phase =
  | { kind: "offer"; update: Update }
  | { kind: "downloading"; update: Update; got: number; total: number | null }
  | { kind: "installing"; update: Update }
  | { kind: "failed"; update: Update; message: string };

const skipped = () => {
  try {
    return localStorage.getItem(SKIP_KEY);
  } catch {
    return null;
  }
};

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Release notes are Markdown; show them as plain lines. */
const plainNotes = (body?: string) =>
  (body ?? "")
    .split("\n")
    .map((line) => line.replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/`/g, ""))
    .filter((line, i, all) => line.trim() || (i > 0 && all[i - 1].trim()))
    .slice(0, 18)
    .join("\n")
    .trim();

export const Updater = () => {
  const [phase, setPhase] = useState<Phase | null>(null);
  const busy = useRef(false);

  const check = async (manual: boolean) => {
    if (!IN_TAURI || busy.current) {
      if (manual && !IN_TAURI) {
        toast("Updates are available in the installed app");
      }
      return;
    }
    busy.current = true;
    try {
      const { check: checkForUpdate } = await import("@tauri-apps/plugin-updater");
      const update = await checkForUpdate();
      if (!update) {
        if (manual) {
          toast("Paperimo is up to date", "success");
        }
      } else if (manual || skipped() !== update.version) {
        setPhase({ kind: "offer", update });
      }
    } catch (error) {
      if (manual) {
        toast(`Couldn't check for updates: ${String(error)}`, "error", 6000);
      }
    } finally {
      busy.current = false;
    }
  };

  useEffect(() => {
    const onManual = () => void check(true);
    window.addEventListener("dsk-check-updates", onManual);
    const first = window.setTimeout(() => void check(false), FIRST_CHECK_MS);
    const every = window.setInterval(() => void check(false), EVERY_MS);
    return () => {
      window.removeEventListener("dsk-check-updates", onManual);
      window.clearTimeout(first);
      window.clearInterval(every);
    };
  }, []);

  if (!phase) {
    return null;
  }
  const { update } = phase;

  const install = async () => {
    try {
      let got = 0;
      let total: number | null = null;
      setPhase({ kind: "downloading", update, got, total });
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          got += event.data.chunkLength;
        }
        setPhase({ kind: "downloading", update, got, total });
      });
      setPhase({ kind: "installing", update });
      // the installer closes the app: save every tab and the session first
      await flushAll();
      await update.install();
      // only reached where the installer doesn't exit the app itself
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    } catch (error) {
      setPhase({ kind: "failed", update, message: String(error) });
    }
  };

  const later = () => setPhase(null);
  const skip = () => {
    try {
      localStorage.setItem(SKIP_KEY, update.version);
    } catch {
      // per-user convenience only
    }
    setPhase(null);
  };

  const working = phase.kind === "downloading" || phase.kind === "installing";
  const notes = plainNotes(update.body);
  const pct =
    phase.kind === "downloading" && phase.total ? Math.min(100, (phase.got / phase.total) * 100) : null;

  return (
    <Modal
      title={`Paperimo ${update.version} is available`}
      onClose={working ? () => {} : later}
      footer={
        working ? null : (
          <>
            <button className="dsk-btn" onClick={skip}>
              Skip this version
            </button>
            <button className="dsk-btn" onClick={later}>
              Later
            </button>
            <button className="dsk-btn dsk-btn--primary" data-autofocus onClick={() => void install()}>
              {phase.kind === "failed" ? "Try again" : "Install and restart"}
            </button>
          </>
        )
      }
    >
      <p className="dsk-muted">
        You have {update.currentVersion}. Your tabs and unsaved work are kept; Paperimo restarts when
        the update is installed.
      </p>
      {notes && <pre className="dsk-update__notes">{notes}</pre>}
      {phase.kind === "downloading" && (
        <div className="dsk-update__progress" role="progressbar" aria-valuenow={pct ?? undefined}>
          <div className="dsk-update__bar">
            <span style={{ width: pct === null ? "35%" : `${pct}%` }} className={pct === null ? "dsk-update__bar--busy" : ""} />
          </div>
          <span className="dsk-muted">
            Downloading… {mb(phase.got)}
            {phase.total ? ` of ${mb(phase.total)}` : ""}
          </span>
        </div>
      )}
      {phase.kind === "installing" && <p className="dsk-muted">Saving your work and installing…</p>}
      {phase.kind === "failed" && <p className="dsk-update__error">The update failed: {phase.message}</p>}
    </Modal>
  );
};
