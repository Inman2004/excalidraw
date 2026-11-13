import { useEffect, useState } from "react";

import { Icon, RecoveryIcon, TrashIcon } from "../common/Icon";

import { discardRecovered, listOrphanRecovery, openRecovered } from "./controller";
import { Modal } from "./ui/Dialogs";
import { setState, useStore } from "./store";

import type { RecoveryEntry } from "./native";

const age = (ms: number) => {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleString();
};

const sceneSummary = (size: number) =>
  size > 1024 * 1024 ? `${(size / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;

/**
 * Snapshots that no open tab owns (e.g. after a crash before the session was
 * written). Opening one creates a separate unsaved tab; nothing on disk changes.
 */
export const RecoveryCenter = () => {
  const open = useStore((s) => s.recoveryOpen);
  const [entries, setEntries] = useState<RecoveryEntry[] | null>(null);

  useEffect(() => {
    if (open) {
      setEntries(null);
      listOrphanRecovery().then(setEntries);
    }
  }, [open]);

  if (!open) {
    return null;
  }
  const close = () => setState({ recoveryOpen: false });
  const remove = (id: string) => setEntries((list) => list?.filter((e) => e.id !== id) ?? null);

  return (
    <Modal
      title="Recovery Center"
      onClose={close}
      wide
      footer={
        <button className="dsk-btn dsk-btn--primary" data-autofocus onClick={close}>
          Done
        </button>
      }
    >
      <p className="dsk-muted">
        Unsaved drawings that no open tab owns. Opening one creates a new unsaved
        tab; your saved files are never changed.
      </p>
      {entries === null ? (
        <p className="dsk-muted">Looking for recovered drawings…</p>
      ) : entries.length === 0 ? (
        <p className="dsk-empty">Nothing to recover. Every unsaved drawing is open in a tab.</p>
      ) : (
        <table className="dsk-table">
          <thead>
            <tr>
              <th>Drawing</th>
              <th>Recovered</th>
              <th>Size</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries
              .sort((a, b) => b.modifiedMs - a.modifiedMs)
              .map((e) => (
                <tr key={e.id}>
                  <td>Unsaved drawing</td>
                  <td>{age(e.modifiedMs)}</td>
                  <td>{sceneSummary(e.size)}</td>
                  <td className="dsk-table__actions">
                    <button
                      className="dsk-btn dsk-btn--primary dsk-btn--small"
                      onClick={async () => {
                        await openRecovered(e.id);
                        remove(e.id);
                      }}
                    >
                      <Icon icon={RecoveryIcon} /> Open
                    </button>
                    <button
                      className="dsk-btn dsk-btn--danger dsk-btn--small"
                      onClick={async () => {
                        await discardRecovered(e.id);
                        remove(e.id);
                      }}
                    >
                      <Icon icon={TrashIcon} /> Discard
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
};
