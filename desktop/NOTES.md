# Excalidraw Desktop — engineering notes

Engine: Excalidraw monorepo source at `e1b7aacb3` (2026-10-18). Not modified.

## P0 gate — multiple mounted editors (2026-11-13) → **FAIL**, single-editor fallback adopted

Prototype: 2 `<Excalidraw>` instances, inactive one `display:none` + `inert`, `api.refresh()` on
activation. Tested in Chromium (browser pane), same code path as WebView2.

| Check | Result |
| --- | --- |
| Undo history survives A → B → A | Pass (Ctrl+Z in A undid A's rectangle; redo enabled; B untouched) |
| Scene isolation | Pass (A and B elements independent) |
| Offsets after unhide / resize while hidden | Pass (`refresh()` picks up the new 900×621 size; a drawn element landed exactly at the computed scene point) |
| Per-instance appState (openSidebar, openDialog, form factor) | Pass (not shared) |
| **Shared Jotai UI state** | **Fail.** `editorJotaiStore` (`packages/excalidraw/editor-jotai.ts:18`) is module-level. Opening *Reset the canvas* in A renders **two** confirm dialogs (`activeConfirmDialogAtom`), and both portal outside the hidden container, so the hidden editor's dialog is visible too. Confirming in that dialog clears the *other* tab's canvas → data-loss risk. Other shared transient atoms: `overwriteConfirmStateAtom`, `activeEyeDropperAtom`, `convertElementTypePopupAtom`, `cursorHintAtom`, `searchQueryAtom`, `isLibraryMenuOpenAtom`, `isSidebarDockedAtom`. |
| Memory | Not measured: the architecture was rejected before this step. |

One unexplained stale frame was seen once (A briefly showed B's selected ellipse); it did not
reproduce in 2 further attempts.

**First decision:** one mounted `<Excalidraw key={docId}>`, remounted per tab (undo resets on switch).

**Superseded (2026-11-13): one same-origin iframe per tab.** Each tab's editor runs in its own
`editor.html` iframe, so each has its own JS realm and its own Jotai store; the leak above can't
happen and undo history survives tab switches. Up to `MAX_MOUNTED = 6` frames stay alive (LRU);
an evicted frame is serialized to recovery first and reloads from it (undo resets only then).
Inactive frames are `inert`. Frames are rendered in a fixed order, because moving an iframe in the DOM
reloads it. Frames never call Tauri; all file I/O and persistence go through the shell over
`postMessage` (`src/common/protocol.ts`), including request/reply (`requestFrame`) for export,
search, frames, callouts and presentation.

## Module map
- Shell (`src/shell`): tabs, documents, persistence, dialogs, tool panels (Export, Quick switch,
  Find in all drawings, Frames drawer, Callouts drawer, File history, Templates).
- Editor (`src/editor`): Excalidraw host, annotate layer, `requests.ts` (frame-side handlers),
  `Presenter.tsx`.
- Rust (`src-tauri/src`): `docs` (atomic, version-checked writes), `backup`, `session`, `watch`.
- Templates (`templates/*.json`): element skeletons converted by `convertToExcalidrawElements`.

## Known gaps
- Quick switcher shows no thumbnails (spec item; deprioritised).
- File history lists versions without thumbnails.
- Performance budgets below are not yet measured.

## Performance budgets
(to be measured: median + p95 of 5 runs, same machine)
