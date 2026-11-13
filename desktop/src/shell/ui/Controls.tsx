import { Icon } from "../../common/Icon";

import "../home.css";

type IconType = Parameters<typeof Icon>[0]["icon"];

/** Segmented control in Excalidraw's island style. */
export const Seg = <T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { id: T; label: string; icon?: IconType; disabled?: boolean }[];
  onChange: (id: T) => void;
  label: string;
}) => (
  <div className="dsk-seg" role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button
        key={String(o.id)}
        role="radio"
        aria-checked={value === o.id}
        disabled={o.disabled}
        className={`dsk-seg__opt${value === o.id ? " dsk-seg__opt--on" : ""}`}
        onClick={() => onChange(o.id)}
      >
        {o.icon && <Icon icon={o.icon} size={15} />}
        {o.label}
      </button>
    ))}
  </div>
);

export const Toggle = ({
  on,
  label,
  icon,
  onClick,
  disabled,
  hint,
}: {
  on: boolean;
  label: string;
  icon?: IconType;
  onClick: () => void;
  disabled?: boolean;
  hint?: string;
}) => (
  <button
    className="dsk-toggle"
    role="switch"
    aria-checked={on}
    disabled={disabled}
    title={hint}
    onClick={onClick}
  >
    {icon && <Icon icon={icon} />}
    <span className="dsk-toggle__label">{label}</span>
    <span className={`dsk-toggle__track${on ? " dsk-toggle__track--on" : ""}`}>
      <span className="dsk-toggle__thumb" />
    </span>
  </button>
);
