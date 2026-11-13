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
- The installer is not code-signed (needs a purchased certificate), so SmartScreen warns on
  first run.
- A physical drag from Explorer was not exercised end to end: Windows routes OLE drops to the
  window under the real cursor, which needs mouse control. The app side was verified with the
  exact `tauri://drag-drop` event Tauri emits for a native drop.

## Performance budgets — measured 2026-11-14
Release build (`tauri build`, NSIS), Windows 11, WebView2 157, same machine, driven over the
WebView2 debug port. Median / p95 of 5 runs unless noted. Memory is private bytes of the app
plus all of its WebView2 processes (browser, GPU, renderer, utilities).

| Budget | Median | p95 | Target |
| --- | --- | --- | --- |
| Start → window visible | 48 ms | 122 ms | — |
| Start → usable canvas (session restore, 1 tab) | 851 ms | 969 ms | ≤ 1.2 s ✅ |
| Open small drawing (20 shapes) | ~190 ms | 205 ms | — |
| Open 18 MB drawing (8 000 shapes + 11 MB image) | 738 ms | 901 ms | — |
| Tab switch, mounted | 10 ms | 20 ms | ≤ 50 ms ✅ |
| Tab switch, evicted (reload from recovery) | 216 ms | 225 ms | — |
| Callout: Enter → element in scene (upper bound) | 12 ms | 14 ms | ≤ 50 ms ✅ |
| Export 18 MB drawing, PNG 1× (23 MB file) | 880 ms | 967 ms (3 runs) | — |
| Export 18 MB drawing, PNG 2× (63 MB file) | 6.9 s | 16.8 s (3 runs) | — |

Memory: 242 MB with 1 tab at startup; 486 / 581 / 651 MB at 3 / 6 / 12 tabs (frames capped at
6 by the LRU, so 12 tabs cost little more than 6). Opening and closing the 18 MB drawing five
times peaks at 650 MB and settles back to 299 MB within 20 s (renderer 346 → 76 MB; the rest
is GPU texture cache): no leak.

Misses / notes: 2× PNG export of a very large drawing is slow (a ~12 000 × 8 000 px canvas
encoded to PNG by the WebView); the dialog shows a busy state meanwhile. Timings come from
`window.__dskMetrics` (startup and load) and in-page `performance.now()`.
