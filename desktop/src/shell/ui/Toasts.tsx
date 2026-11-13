import { CheckIcon, ErrorIcon, Icon, InfoIcon } from "../../common/Icon";
import { setState, useStore } from "../store";

export const Toasts = () => {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="dsk-toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`dsk-toast dsk-toast--${t.kind}`}
          onClick={() =>
            setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) }))
          }
        >
          <Icon icon={t.kind === "error" ? ErrorIcon : t.kind === "success" ? CheckIcon : InfoIcon} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
};
