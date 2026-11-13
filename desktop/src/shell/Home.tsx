import { useEffect } from "react";

import {
  AnnotateIcon,
  AutosaveIcon,
  CloseIcon,
  HeartIcon,
  Icon,
  KeyboardIcon,
  MissingIcon,
  MoonIcon,
  NewDrawingIcon,
  OpenIcon,
  PinIcon,
  RecentIcon,
  RecoveryIcon,
  StarIcon,
  SunIcon,
  SystemIcon,
} from "../common/Icon";

import {
  annotateImages,
  hideHome,
  newTab,
  openDialog,
  removeRecent,
  runCommand,
  setThemePref,
  toggleAutosave,
  togglePinRecent,
  togglePinned,
} from "./controller";
import { parentName, stripExt } from "./native";
import { setState, useStore } from "./store";

import pkg from "../../package.json";

import "./home.css";

import type { ThemePref } from "./store";

const SHORTCUTS: [string, string][] = [
  ["Ctrl+T", "New tab"],
  ["Ctrl+O", "Open"],
  ["Ctrl+S", "Save"],
  ["Ctrl+Shift+S", "Save as"],
  ["Ctrl+W", "Close tab"],
  ["Ctrl+Shift+T", "Reopen closed tab"],
  ["Ctrl+Tab", "Next tab"],
  ["Ctrl+1…9", "Go to tab"],
  ["Alt+Shift+D", "Toggle dark mode"],
  ["Ctrl+/", "Command palette"],
];

const ActionCard = ({
  icon,
  title,
  hint,
  onClick,
  primary,
}: {
  icon: Parameters<typeof Icon>[0]["icon"];
  title: string;
  hint: string;
  onClick: () => void;
  primary?: boolean;
}) => (
  <button className={`dsk-action${primary ? " dsk-action--primary" : ""}`} onClick={onClick}>
    <span className="dsk-action__icon">
      <Icon icon={icon} size={30} />
    </span>
    <span className="dsk-action__title">{title}</span>
    <span className="dsk-action__hint">{hint}</span>
  </button>
);

const Segmented = ({ value }: { value: ThemePref }) => (
  <div className="dsk-seg" role="radiogroup" aria-label="Theme">
    {(
      [
        ["system", "System", SystemIcon],
        ["light", "Light", SunIcon],
        ["dark", "Dark", MoonIcon],
      ] as const
    ).map(([id, label, icon]) => (
      <button
        key={id}
        role="radio"
        aria-checked={value === id}
        className={`dsk-seg__opt${value === id ? " dsk-seg__opt--on" : ""}`}
        onClick={() => setThemePref(id)}
      >
        <Icon icon={icon} size={15} />
        {label}
      </button>
    ))}
  </div>
);

const Toggle = ({
  on,
  label,
  icon,
  onClick,
}: {
  on: boolean;
  label: string;
  icon: Parameters<typeof Icon>[0]["icon"];
  onClick: () => void;
}) => (
  <button className="dsk-toggle" role="switch" aria-checked={on} onClick={onClick}>
    <Icon icon={icon} />
    <span className="dsk-toggle__label">{label}</span>
    <span className={`dsk-toggle__track${on ? " dsk-toggle__track--on" : ""}`}>
      <span className="dsk-toggle__thumb" />
    </span>
  </button>
);

export const Home = () => {
  const recents = useStore((s) => s.recents);
  const exist = useStore((s) => s.recentsExist);
  const themePref = useStore((s) => s.themePref);
  const autosave = useStore((s) => s.autosave);
  const pinned = useStore((s) => s.pinned);
  const hasTabs = useStore((s) => s.tabs.length > 0);

  // Esc returns to the open drawing
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && hasTabs && !document.querySelector(".dsk-backdrop")) {
        hideHome();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasTabs]);

  return (
    <div className="dsk-home">
      <div className="dsk-home__inner">
        <header className="dsk-home__hero">
          <img className="dsk-home__logo" src="/favicon.svg" alt="" />
          <h1>Excalidraw Desktop</h1>
          <p className="dsk-muted">Sketch, annotate and keep your drawings — right on your computer.</p>
        </header>

        <section className="dsk-actions" aria-label="Quick actions">
          <ActionCard primary icon={NewDrawingIcon} title="New drawing" hint="Ctrl+T" onClick={() => newTab()} />
          <ActionCard icon={OpenIcon} title="Open file" hint="Ctrl+O · .excalidraw" onClick={() => void openDialog()} />
          <ActionCard icon={AnnotateIcon} title="Annotate an image" hint="PNG, JPG, WebP, SVG" onClick={() => void annotateImages()} />
          <ActionCard icon={RecoveryIcon} title="Recover drawings" hint="Unsaved work" onClick={() => setState({ recoveryOpen: true })} />
        </section>
        <p className="dsk-home__drop dsk-muted">…or drop files anywhere on this window</p>

        <div className="dsk-home__grid">
          <section className="dsk-panel">
            <h2>
              <Icon icon={RecentIcon} /> Recent files
            </h2>
            {recents.length === 0 ? (
              <p className="dsk-empty">Files you open or save will show up here.</p>
            ) : (
              <ul className="dsk-recents">
                {recents.slice(0, 10).map((r) => {
                  const missing = exist[r.path.toLowerCase()] === false;
                  return (
                    <li key={r.path} className={missing ? "dsk-recent--missing" : undefined}>
                      <button
                        className="dsk-recent__open"
                        title={r.path}
                        onClick={() => void runCommand("openRecent", r.path)}
                      >
                        <Icon icon={missing ? MissingIcon : NewDrawingIcon} />
                        <span className="dsk-recent__name">{stripExt(r.name)}</span>
                        <span className="dsk-recent__dir">{parentName(r.path)}</span>
                      </button>
                      <button
                        className={`dsk-recent__btn${r.pinnedRecent ? " dsk-recent__btn--on" : ""}`}
                        title={r.pinnedRecent ? "Unpin" : "Pin to top"}
                        onClick={() => togglePinRecent(r.path)}
                      >
                        <Icon icon={StarIcon} size={15} />
                      </button>
                      <button
                        className="dsk-recent__btn"
                        title="Remove from list"
                        onClick={() => removeRecent(r.path)}
                      >
                        <Icon icon={CloseIcon} size={15} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <div className="dsk-home__side">
            <section className="dsk-panel">
              <h2>Options</h2>
              <div className="dsk-option">
                <span>Theme</span>
                <Segmented value={themePref} />
              </div>
              <Toggle on={autosave} label="Auto-save to disk" icon={AutosaveIcon} onClick={toggleAutosave} />
              <Toggle on={pinned} label="Always on top" icon={PinIcon} onClick={() => void togglePinned()} />
            </section>

            <section className="dsk-panel">
              <h2>
                <Icon icon={KeyboardIcon} /> Shortcuts
              </h2>
              <dl className="dsk-keys">
                {SHORTCUTS.map(([k, label]) => (
                  <div key={k}>
                    <dt>{label}</dt>
                    <dd>
                      <kbd>{k}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </div>

        <footer className="dsk-credits">
          <p className="dsk-credits__made">
            Made with <Icon icon={HeartIcon} size={14} /> by <strong>{pkg.author}</strong>
          </p>
          <p>
            Drawing engine{" "}
            <strong>Excalidraw</strong>{" "}
            by the Excalidraw contributors (MIT) · build{" "}
            <code>{String(pkg.excalidrawCommit).slice(0, 9)}</code>
          </p>
          <p>
            Icons{" "}
            <strong>Solar Icons</strong>{" "}
            by 480 Design (CC BY 4.0) · Built with Tauri · Version {pkg.version}
          </p>
        </footer>
      </div>
    </div>
  );
};
