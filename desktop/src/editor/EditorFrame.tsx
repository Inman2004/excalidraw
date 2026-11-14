import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CaptureUpdateAction,
  CommandPalette,
  convertToExcalidrawElements,
  Excalidraw,
  MainMenu,
  getSceneVersion,
  restoreAppState,
  restoreElements,
  serializeAsJSON,
} from "@excalidraw/excalidraw";

import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
  LibraryItems,
} from "@excalidraw/excalidraw/types";

import {
  AnnotateIcon,
  AutosaveIcon,
  CalloutListIcon,
  ExportIcon,
  FindAllIcon,
  FramesIcon,
  HistoryClockIcon,
  HomeIcon,
  LibraryIconD,
  PresentIcon,
  SwitchIcon,
  TemplatesIcon,
  CloseIcon,
  Icon,
  InfoIcon,
  MoonIcon,
  OpenIcon,
  PinIcon,
  PlusIcon,
  RecentIcon,
  RecoveryIcon,
  SaveAsIcon,
  SaveIcon,
  SunIcon,
  SystemIcon,
} from "../common/Icon";
import { isBrowserKey, shortcutToCommand } from "../common/protocol";

import { lockAsBackground } from "./annotate";
import { AnnotateLayer } from "./AnnotateLayer";
import { CalloutWatch } from "./CalloutWatch";
import { insertImages } from "./insertImages";
import { Presenter } from "./Presenter";
import { handleRequest } from "./requests";

import type {
  FromFrame,
  MenuState,
  ShellCommand,
  Snapshot,
  Theme,
  ToFrame,
  ViewState,
} from "../common/protocol";

const SNAPSHOT_DEBOUNCE_MS = 600;
const SNAPSHOT_MAX_INTERVAL_MS = 1000;

const post = (msg: FromFrame) => window.parent.postMessage(msg, location.origin);

type LoadMsg = Extract<ToFrame, { type: "load" }>;

const parseScene = (
  json: string | null,
  view: ViewState | null,
  library: unknown[],
): ExcalidrawInitialDataState => {
  const data = json ? JSON.parse(json) : {};
  return {
    elements: restoreElements(data.elements ?? [], null),
    appState: {
      ...restoreAppState(data.appState ?? {}, null),
      ...(view
        ? {
            scrollX: view.scrollX,
            scrollY: view.scrollY,
            zoom: { value: view.zoom as AppState["zoom"]["value"] },
          }
        : {}),
    },
    files: data.files ?? {},
    libraryItems: library as LibraryItems,
    scrollToContent: !view && !!json,
  };
};

const takeSnapshot = (api: ExcalidrawImperativeAPI): Snapshot => {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  return {
    json: serializeAsJSON(elements, appState, api.getFiles(), "local"),
    view: {
      scrollX: appState.scrollX,
      scrollY: appState.scrollY,
      zoom: appState.zoom.value,
    },
    version: getSceneVersion(api.getSceneElementsIncludingDeleted()),
  };
};

/** Menu commands: close Excalidraw's menu first so it can't sit behind a shell dialog. */
const runCommand = (command: ShellCommand, arg?: string | number) => {
  window.dispatchEvent(new Event("dsk-close-menu"));
  post({ type: "command", command, arg });
};

const DesktopMenu = ({ menu }: { menu: MenuState }) => (
  <MainMenu>
    <MainMenu.Item
      icon={<Icon icon={PlusIcon} />}
      onSelect={() => runCommand("new")}
      shortcut="Ctrl+T"
    >
      New tab
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={OpenIcon} />}
      onSelect={() => runCommand("open")}
      shortcut="Ctrl+O"
    >
      Open…
    </MainMenu.Item>
    {menu.recents.length > 0 && (
      <MainMenu.Sub>
        <MainMenu.Sub.Trigger icon={<Icon icon={RecentIcon} />}>
          Open recent
        </MainMenu.Sub.Trigger>
        <MainMenu.Sub.Content>
          {menu.recents.map((r) => (
            <MainMenu.Item
              key={r.path}
              onSelect={() => runCommand("openRecent", r.path)}
              title={r.path}
              className={r.exists ? undefined : "desktop-recent--missing"}
            >
              {r.name}
            </MainMenu.Item>
          ))}
        </MainMenu.Sub.Content>
      </MainMenu.Sub>
    )}
    <MainMenu.Item
      icon={<Icon icon={SaveIcon} />}
      onSelect={() => runCommand("save")}
      shortcut="Ctrl+S"
    >
      Save
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={SaveAsIcon} />}
      onSelect={() => runCommand("saveAs")}
      shortcut="Ctrl+Shift+S"
    >
      Save as…
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={AutosaveIcon} />}
      onSelect={() => runCommand("toggleAutosave")}
    >
      Auto-save to disk: {menu.autosave ? "On" : "Off"}
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={CloseIcon} />}
      onSelect={() => runCommand("closeTab")}
      shortcut="Ctrl+W"
    >
      Close tab
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={ExportIcon} />}
      onSelect={() => runCommand("export")}
      shortcut="Ctrl+Shift+E"
    >
      Export image…
    </MainMenu.Item>
    <MainMenu.Separator />
    <MainMenu.Item
      icon={<Icon icon={SwitchIcon} />}
      onSelect={() => runCommand("switcher")}
      shortcut="Ctrl+Alt+P"
    >
      Quick switch…
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={FindAllIcon} />}
      onSelect={() => runCommand("search")}
      shortcut="Ctrl+Shift+F"
    >
      Find in all drawings…
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={FramesIcon} />}
      onSelect={() => runCommand("frames")}
    >
      Frames…
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={PresentIcon} />}
      onSelect={() => runCommand("present")}
      shortcut="F5"
    >
      Present
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={CalloutListIcon} />}
      onSelect={() => runCommand("annotations")}
    >
      Callouts…
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={HistoryClockIcon} />}
      onSelect={() => runCommand("history")}
      shortcut="Ctrl+Shift+H"
    >
      File history…
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={TemplatesIcon} />}
      onSelect={() => runCommand("templates")}
    >
      New from template…
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={LibraryIconD} />}
      onSelect={() => runCommand("importLibrary")}
    >
      Import library…
    </MainMenu.Item>
    <MainMenu.Separator />
    <MainMenu.DefaultItems.CommandPalette />
    <MainMenu.DefaultItems.SearchMenu />
    <MainMenu.DefaultItems.Help />
    <MainMenu.DefaultItems.ClearCanvas />
    <MainMenu.Separator />
    <MainMenu.Sub>
      <MainMenu.Sub.Trigger
        icon={
          <Icon
            icon={
              menu.themePref === "dark"
                ? MoonIcon
                : menu.themePref === "light"
                ? SunIcon
                : SystemIcon
            }
          />
        }
      >
        Theme
      </MainMenu.Sub.Trigger>
      <MainMenu.Sub.Content>
        {(["system", "light", "dark"] as const).map((pref) => (
          <MainMenu.Item
            key={pref}
            icon={
              <Icon
                icon={
                  pref === "dark" ? MoonIcon : pref === "light" ? SunIcon : SystemIcon
                }
              />
            }
            selected={menu.themePref === pref}
            onSelect={() => runCommand("theme", pref)}
          >
            {pref === "system" ? "System" : pref === "light" ? "Light" : "Dark"}
          </MainMenu.Item>
        ))}
      </MainMenu.Sub.Content>
    </MainMenu.Sub>
    <MainMenu.Item
      icon={<Icon icon={PinIcon} />}
      onSelect={() => runCommand("togglePin")}
    >
      Always on top: {menu.pinned ? "On" : "Off"}
    </MainMenu.Item>
    <MainMenu.Item
      icon={<Icon icon={RecoveryIcon} />}
      onSelect={() => runCommand("recovery")}
    >
      Recovery Center…
    </MainMenu.Item>
    <MainMenu.Item icon={<Icon icon={InfoIcon} />} onSelect={() => runCommand("about")}>
      About
    </MainMenu.Item>
    <MainMenu.DefaultItems.ChangeCanvasBackground />
  </MainMenu>
);

const paletteItem = (
  label: string,
  command: ShellCommand,
  icon: Parameters<typeof Icon>[0]["icon"],
  shortcut: string | null = null,
  keywords: string[] = [],
) => ({
  label,
  category: "Desktop",
  icon: <Icon icon={icon} />,
  shortcut,
  keywords,
  perform: () => runCommand(command),
});

/** Desktop commands in Excalidraw's own command palette (Ctrl+/). */
const PALETTE_ITEMS = [
  paletteItem("New tab", "new", PlusIcon, "Ctrl+T", ["drawing", "untitled"]),
  paletteItem("Open file…", "open", OpenIcon, "Ctrl+O", ["load"]),
  paletteItem("Save", "save", SaveIcon, "Ctrl+S"),
  paletteItem("Save as…", "saveAs", SaveAsIcon, "Ctrl+Shift+S"),
  paletteItem("Export image…", "export", ExportIcon, "Ctrl+Shift+E", ["png", "svg", "jpeg", "clipboard"]),
  paletteItem("Close tab", "closeTab", CloseIcon, "Ctrl+W"),
  paletteItem("Reopen closed tab", "reopenTab", RecentIcon, "Ctrl+Shift+T"),
  paletteItem("Quick switch…", "switcher", SwitchIcon, "Ctrl+Alt+P", ["tabs", "recent"]),
  paletteItem("Find in all drawings…", "search", FindAllIcon, "Ctrl+Shift+F", ["search", "text"]),
  paletteItem("Frames…", "frames", FramesIcon, null, ["slides", "order"]),
  paletteItem("Present", "present", PresentIcon, "F5", ["slideshow", "presentation"]),
  paletteItem("Callouts…", "annotations", CalloutListIcon, null, ["annotations", "report"]),
  paletteItem("File history…", "history", HistoryClockIcon, "Ctrl+Shift+H", ["backup", "restore", "version"]),
  paletteItem("New from template…", "templates", TemplatesIcon, null, ["flowchart", "wireframe"]),
  paletteItem("Import library…", "importLibrary", LibraryIconD, null, ["excalidrawlib"]),
  paletteItem("Recovery Center…", "recovery", RecoveryIcon, null, ["restore", "unsaved"]),
  paletteItem("Toggle auto-save", "toggleAutosave", AutosaveIcon),
  paletteItem("Toggle always on top", "togglePin", PinIcon, null, ["pin"]),
  paletteItem("Home", "home", HomeIcon, null, ["start"]),
  paletteItem("About Paperimo", "about", InfoIcon),
];

export const EditorFrame = () => {
  const [load, setLoad] = useState<LoadMsg | null>(null);
  const [theme, setTheme] = useState<Theme>("light");
  const [menu, setMenu] = useState<MenuState>({
    autosave: true,
    pinned: false,
    themePref: "system",
    recents: [],
  });
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [annotating, setAnnotating] = useState(false);
  const [presenting, setPresenting] = useState<string[] | null>(null);
  const presentingRef = useRef(false);
  presentingRef.current = !!presenting;
  const shiftPaste = useRef(false);
  const baselineSent = useRef(false);
  const lastVersion = useRef<number | null>(null);
  const debounceTimer = useRef<number | undefined>(undefined);
  const firstPendingAt = useRef<number | null>(null);
  const lastLibraryJSON = useRef<string>("[]");

  const flushSnapshot = useCallback(() => {
    window.clearTimeout(debounceTimer.current);
    firstPendingAt.current = null;
    const api = apiRef.current;
    if (api) {
      post({ type: "snapshot", snapshot: takeSnapshot(api) });
    }
  }, []);

  // trailing debounce + max interval: continuous edits still snapshot every 1 s
  const scheduleSnapshot = useCallback(() => {
    const now = performance.now();
    firstPendingAt.current ??= now;
    window.clearTimeout(debounceTimer.current);
    const waited = now - firstPendingAt.current;
    const delay = Math.max(
      0,
      Math.min(SNAPSHOT_DEBOUNCE_MS, SNAPSHOT_MAX_INTERVAL_MS - waited),
    );
    debounceTimer.current = window.setTimeout(() => {
      const run = () => flushSnapshot();
      if ("requestIdleCallback" in window) {
        requestIdleCallback(run, { timeout: 200 });
      } else {
        run();
      }
    }, delay);
  }, [flushSnapshot]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<ToFrame>) => {
      if (event.origin !== location.origin || event.source !== window.parent) {
        return;
      }
      const msg = event.data;
      const api = apiRef.current;
      switch (msg.type) {
        case "load":
          baselineSent.current = false;
          lastVersion.current = null;
          lastLibraryJSON.current = JSON.stringify(msg.library);
          setTheme(msg.theme);
          setLoad(msg);
          break;
        case "replace":
          if (api) {
            const data = parseScene(msg.json, null, []);
            const fileState = data.appState as Partial<AppState>;
            // only the drawing's own settings come from the file; UI state
            // (theme, tool, menus, view) stays as the user has it
            api.updateScene({
              elements: data.elements as any,
              appState: {
                viewBackgroundColor: fileState.viewBackgroundColor,
                gridSize: fileState.gridSize,
                gridStep: fileState.gridStep,
                gridModeEnabled: fileState.gridModeEnabled,
              } as any,
            });
            if (data.files) {
              api.addFiles(Object.values(data.files as BinaryFiles));
            }
            api.history.clear();
            requestAnimationFrame(() => {
              const snap = takeSnapshot(api);
              lastVersion.current = snap.version;
              post({ type: "loaded", baseline: snap });
            });
          }
          break;
        case "theme":
          setTheme(msg.theme);
          break;
        case "name":
          api?.updateScene({ appState: { name: msg.name } });
          break;
        case "library":
          lastLibraryJSON.current = JSON.stringify(msg.items);
          api?.updateLibrary({ libraryItems: msg.items as LibraryItems });
          break;
        case "snapshot-request":
          if (api) {
            window.clearTimeout(debounceTimer.current);
            firstPendingAt.current = null;
            post({ type: "snapshot", snapshot: takeSnapshot(api), reqId: msg.reqId });
          }
          break;
        case "skeleton":
          if (api) {
            const els = convertToExcalidrawElements(msg.elements as any);
            // appended, never replacing: a template only ever fills an empty tab,
            // but nothing on the canvas may be lost if that ever changes
            api.updateScene({
              elements: [...api.getSceneElementsIncludingDeleted(), ...els],
              captureUpdate: CaptureUpdateAction.NEVER,
            });
            api.history.clear();
            requestAnimationFrame(() =>
              api.setViewport({ target: els, fit: "scale-down", animation: false }),
            );
          }
          break;
        case "annotate-toggle":
          setAnnotating((on) => !on);
          break;
        case "request":
          if (!api) {
            post({ type: "reply", reqId: msg.reqId, ok: false, error: "The drawing is still loading" });
            break;
          }
          handleRequest(api, msg.req, {
            startPresentation: (ids) => {
              setAnnotating(false);
              setPresenting(ids);
            },
          }).then(
            (data) => post({ type: "reply", reqId: msg.reqId, ok: true, data }),
            (error) =>
              post({
                type: "reply",
                reqId: msg.reqId,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              }),
          );
          break;
        case "focus":
          api?.refresh();
          (document.querySelector(".excalidraw") as HTMLElement | null)?.focus();
          break;
        case "menu-state":
          setMenu(msg.state);
          break;
        case "insert-images":
          if (api) {
            void insertImages(api, msg.files, msg.x, msg.y).then((ids) => {
              if (msg.lock && ids.length) {
                lockAsBackground(api, ids);
              }
              if (msg.annotate) {
                setAnnotating(true);
              }
            });
          }
          break;
      }
    };
    window.addEventListener("message", onMessage);
    post({ type: "ready" });
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // app shortcuts pressed inside the canvas go to the shell
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isBrowserKey(event)) {
        event.preventDefault();
        return;
      }
      if (presentingRef.current) {
        return; // the presenter owns the keyboard
      }
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && event.shiftKey && !event.altKey && key === "a") {
        event.preventDefault();
        event.stopPropagation();
        setAnnotating((on) => !on);
        return;
      }
      // Ctrl+Shift+V with an image on the clipboard: annotate it in a new tab
      // (decided in the paste event, which carries the clipboard contents)
      shiftPaste.current = mod && event.shiftKey && !event.altKey && key === "v";
      const hit = shortcutToCommand(event);
      if (hit) {
        event.preventDefault();
        event.stopPropagation();
        post({ type: "command", command: hit.command, arg: hit.arg });
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!shiftPaste.current) {
        return;
      }
      shiftPaste.current = false;
      const file = Array.from(event.clipboardData?.files ?? []).find((f) =>
        f.type.startsWith("image/"),
      );
      if (!file) {
        return; // no image: Excalidraw's own paste runs as usual
      }
      event.preventDefault();
      event.stopPropagation();
      const reader = new FileReader();
      reader.onload = () =>
        post({
          type: "paste-image",
          file: { name: file.name || "Pasted image", mime: file.type, dataURL: reader.result as string },
        });
      reader.readAsDataURL(file);
    };
    window.addEventListener("paste", onPaste, { capture: true });
    return () => window.removeEventListener("paste", onPaste, { capture: true });
  }, []);

  useEffect(() => {
    const close = () => apiRef.current?.updateScene({ appState: { openMenu: null } });
    window.addEventListener("dsk-close-menu", close);
    return () => window.removeEventListener("dsk-close-menu", close);
  }, []);

  // flush pending edits when the frame is about to go away
  useEffect(() => {
    const onHide = () => {
      if (firstPendingAt.current !== null) {
        flushSnapshot();
      }
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [flushSnapshot]);

  if (!load) {
    return null;
  }

  return (
    <Excalidraw
      key={load.docId}
      initialData={parseScene(load.json, load.view, load.library)}
      name={load.name}
      theme={theme}
      onExcalidrawAPI={(next) => {
        apiRef.current = next;
        setApi(next);
      }}
      renderTopRightUI={() => (
        <>
          <button
            className={`ann-toggle${annotating ? " ann-toggle--on" : ""}`}
            title="Annotate (Ctrl+Shift+A)"
            aria-pressed={annotating}
            onClick={() => setAnnotating((on) => !on)}
          >
            <Icon icon={AnnotateIcon} size={18} />
            Annotate
          </button>
          {presenting &&
            api &&
            createPortal(
              <Presenter
                api={api}
                ids={presenting}
                onExit={() => {
                  setPresenting(null);
                  post({ type: "command", command: "presentEnd" });
                }}
              />,
              document.querySelector(".excalidraw") ?? document.body,
            )}
          {api &&
            createPortal(
              <CalloutWatch api={api} />,
              document.querySelector(".excalidraw") ?? document.body,
            )}
          {annotating &&
            api &&
            // portal to the editor root: the top-right slot is a containing
            // block, which would trap the fixed overlay and palette inside it
            createPortal(
              <AnnotateLayer
                api={api}
                onExit={() => setAnnotating(false)}
              />,
              document.querySelector(".excalidraw") ?? document.body,
            )}
        </>
      )}
      onThemeChange={(next) => {
        if (next === "light" || next === "dark") {
          post({ type: "theme-changed", theme: next });
        }
      }}
      onLibraryChange={(items) => {
        const json = JSON.stringify(items);
        if (json !== lastLibraryJSON.current) {
          lastLibraryJSON.current = json;
          post({ type: "library-changed", items: items as unknown[] });
        }
      }}
      onChange={(elements) => {
        const api = apiRef.current;
        if (!api) {
          return;
        }
        const version = getSceneVersion(elements);
        if (!baselineSent.current) {
          baselineSent.current = true;
          lastVersion.current = version;
          // the first serialization is the baseline the shell compares against
          requestAnimationFrame(() =>
            post({ type: "loaded", baseline: takeSnapshot(api) }),
          );
          return;
        }
        if (version !== lastVersion.current) {
          lastVersion.current = version;
          post({ type: "changed", version });
        }
        scheduleSnapshot();
      }}
      UIOptions={{
        canvasActions: {
          loadScene: false,
          saveToActiveFile: false,
          export: false,
          toggleTheme: true,
        },
      }}
    >
      <DesktopMenu menu={menu} />
      <CommandPalette customCommandPaletteItems={PALETTE_ITEMS} />
    </Excalidraw>
  );
};
