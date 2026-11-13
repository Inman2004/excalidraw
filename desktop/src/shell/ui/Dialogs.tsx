import { useEffect, useRef } from "react";

import { useStore } from "../store";

import type { DialogRequest } from "../store";

/** Excalidraw-styled modal; focus-trapped, Esc = cancel, Enter = primary. */
export const Modal = ({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        el?.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input, [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? focusables()[0])?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === "Tab") {
        const list = focusables();
        if (!list.length) {
          return;
        }
        const i = list.indexOf(document.activeElement as HTMLElement);
        const next = e.shiftKey ? (i <= 0 ? list.length - 1 : i - 1) : (i + 1) % list.length;
        e.preventDefault();
        list[next].focus();
      }
    };
    el?.addEventListener("keydown", onKey);
    return () => {
      el?.removeEventListener("keydown", onKey);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="dsk-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className={`dsk-modal${wide ? " dsk-modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h2 className="dsk-modal__title">{title}</h2>
        <div className="dsk-modal__body">{children}</div>
        {footer && <div className="dsk-modal__footer">{footer}</div>}
      </div>
    </div>
  );
};

const ConfirmDialog = ({ dialog }: { dialog: DialogRequest }) => {
  const primary = dialog.buttons.find((b) => b.kind === "primary");
  return (
    <Modal
      title={dialog.title}
      onClose={() => dialog.resolve(dialog.cancelId)}
      footer={dialog.buttons.map((b) => (
        <button
          key={b.id}
          className={`dsk-btn dsk-btn--${b.kind ?? "default"}`}
          data-autofocus={b === primary ? true : undefined}
          onClick={() => dialog.resolve(b.id)}
        >
          {b.label}
        </button>
      ))}
    >
      <p>{dialog.body}</p>
    </Modal>
  );
};

/** Shows the oldest pending dialog; the rest wait their turn. */
export const DialogHost = () => {
  const dialog = useStore((s) => s.dialogs[0]);
  return dialog ? <ConfirmDialog key={dialog.id} dialog={dialog} /> : null;
};
