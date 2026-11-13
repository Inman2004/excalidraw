import { useEffect, useRef, useState } from "react";

import { Icon } from "../common/Icon";

type IconType = Parameters<typeof Icon>[0]["icon"];

export type PaletteItem = {
  key: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: IconType;
  /** shown instead of the icon (e.g. a thumbnail) */
  media?: React.ReactNode;
  badge?: string;
  group?: string;
  disabled?: boolean;
  onPick: () => void;
};

/** Floating search list (quick switcher, search across drawings). */
export const Palette = ({
  placeholder,
  query,
  onQuery,
  items,
  empty,
  onClose,
  busy,
  label,
}: {
  placeholder: string;
  query: string;
  onQuery: (q: string) => void;
  items: PaletteItem[];
  empty: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
  label: string;
}) => {
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const previous = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previous.current = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous.current?.focus?.();
  }, []);

  useEffect(() => setActive(0), [query, items.length]);

  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const pick = (i: number) => {
    const item = items[i];
    if (item && !item.disabled) {
      onClose();
      item.onPick();
    }
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  let lastGroup: string | undefined;
  return (
    <div
      className="dsk-backdrop dsk-backdrop--top"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="dsk-palette" role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey}>
        <div className="dsk-palette__search">
          <input
            ref={input}
            value={query}
            placeholder={placeholder}
            spellCheck={false}
            onChange={(e) => onQuery(e.target.value)}
            role="combobox"
            aria-expanded="true"
            aria-controls="dsk-palette-list"
          />
          {busy && <span className="dsk-tab__ring" />}
        </div>
        <div className="dsk-palette__list" id="dsk-palette-list" role="listbox" ref={list}>
          {items.length === 0 && <div className="dsk-palette__empty">{empty}</div>}
          {items.map((item, i) => {
            const header = item.group && item.group !== lastGroup ? item.group : null;
            lastGroup = item.group;
            return (
              <div key={item.key}>
                {header && <div className="dsk-palette__group">{header}</div>}
                <button
                  data-index={i}
                  role="option"
                  aria-selected={i === active}
                  disabled={item.disabled}
                  className={`dsk-palette__item${i === active ? " dsk-palette__item--active" : ""}`}
                  onMouseMove={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  {item.media ?? (item.icon && <Icon icon={item.icon} />)}
                  <span className="dsk-palette__text">
                    <span className="dsk-palette__title">{item.title}</span>
                    {item.subtitle && <span className="dsk-palette__sub">{item.subtitle}</span>}
                  </span>
                  {item.badge && <span className="dsk-palette__badge">{item.badge}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="dsk-palette__foot">
          <span>↑↓ to move</span>
          <span>Enter to open</span>
          <span>Esc to close</span>
        </div>
      </div>
    </div>
  );
};

/** Subsequence fuzzy score: higher is better, null = no match. */
export const fuzzyScore = (text: string, query: string): number | null => {
  const t = text.toLowerCase();
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) {
    return 0;
  }
  const direct = t.indexOf(q);
  if (direct >= 0) {
    // contiguous match; earlier and at word start is better
    const wordStart = direct === 0 || /[\s\\/._-]/.test(t[direct - 1]);
    return 1000 - direct + (wordStart ? 200 : 0);
  }
  let score = 0;
  let ti = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) {
      return null;
    }
    run = found === ti ? run + 1 : 0;
    score += 10 + run * 5 - Math.min(found - ti, 10);
    ti = found + 1;
  }
  return score;
};

/** Wrap the matching part of a label in <mark>. */
export const highlight = (text: string, query: string) => {
  const q = query.trim();
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) {
    return text;
  }
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
};
