<div align="center">
  <img src="desktop/src-tauri/icons/128x128@2x.png" width="96" alt="Paperimo icon" />
  <h1>Paperimo</h1>
  <p><strong>The hand-drawn Excalidraw whiteboard, as a fast little Windows app.</strong><br/>
  Tabs like a text editor. Files that don't get lost. Screenshots you can mark up in seconds.</p>

  <p>
    <a href="https://github.com/Inman2004/excalidraw/releases/latest"><img alt="Download for Windows" src="https://img.shields.io/badge/Download-Windows%20installer-fbbf24?style=for-the-badge&logo=windows" /></a>
  </p>
  <p>
    <a href="https://github.com/Inman2004/excalidraw/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Inman2004/excalidraw?label=latest" /></a>
    <a href="LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-blue.svg" /></a>
  </p>
</div>

---

> **Unofficial.** Paperimo is an independent app built on the open-source
> [Excalidraw](https://github.com/excalidraw/excalidraw) engine. It is not affiliated with,
> endorsed by, or supported by the Excalidraw team. Please report problems here, not to them.

## Why this exists

I use [Excalidraw](https://excalidraw.com) every day. It's the quickest way I know to get an idea out of
my head and onto a screen. But living in a browser tab has some rough edges: drawings sit in browser storage
where one "clear site data" can wipe them, there's no proper Open/Save to real files, and juggling five
diagrams means five browser tabs that all look the same.

So I wrapped it in a desktop app that behaves the way Notepad or VS Code do. Open a `.excalidraw` file,
it shows up in a tab. Hit Ctrl+S, it's saved to that file. Close the app with unsaved changes and they're
all still there next time. **The drawing engine is the real Excalidraw, unmodified**, so everything you
already know still works and your files open fine on excalidraw.com too.

## Get it

1. Grab **`Paperimo_x.y.z_x64-setup.exe`** from the [latest release](https://github.com/Inman2004/excalidraw/releases/latest).
2. Run it. It installs per user, so you don't need admin rights.
3. Double-click any `.excalidraw` file and it opens right in the app.

> **Heads up:** the installer isn't code-signed yet, so Windows SmartScreen may say "Windows protected
> your PC". Click **More info → Run anyway**. Prefer to build it yourself? See [Build from source](#build-from-source).

It needs Windows 10 or 11 with the WebView2 runtime. Windows 11 already has it, and the installer fetches it on Windows 10 if it's missing.

**Updating:** there's no auto-update yet. Download the newest installer and run it over the old one; your
drawings, open tabs and settings stay put. What changed in each version is in the
[changelog](desktop/CHANGELOG.md).

## What you get

### 🗂️ Tabs, done properly
- Open as many drawings as you like, each in its own tab that sits right in the title bar, Chrome-style.
- **Ctrl+T** new, **Ctrl+W** close, **Ctrl+Shift+T** brings back the tab you just closed.
- **Ctrl+Tab** / **Ctrl+1…9** to hop around. Drag tabs to reorder, double-click to rename the file, right-click to pin.
- Each tab keeps its **own undo history**, even when you switch away and come back.

### 🛟 Your work doesn't vanish
- **Auto-save to disk** (on by default) writes your file a second or two after you stop drawing.
- **Crash-proof recovery.** Every change is also snapshotted about once a second. Pull the plug, and the
  next launch brings back every tab, saved or not. Leftovers show up in the **Recovery Center**.
- Saves are atomic: the app writes to a temp file and then swaps it in, so a crash mid-save never leaves you with half a file.
- **Edited the file somewhere else?** If you had no unsaved changes, the app quietly reloads it. If you did,
  it asks: keep yours, load theirs, or save yours as a copy.
- **File history** (Ctrl+Shift+H) keeps the last 10 versions of each file. Restoring opens the old
  version in a new tab, so nothing is overwritten until you decide. Each version shows a thumbnail, so you can spot the right one at a glance.

### ✍️ Mark up screenshots in seconds
Press **Ctrl+Shift+A** (or the **Annotate** button) and:
- **Callouts:** click the spot, click where the label goes, type, press Enter. You get a numbered label
  (`01`, `02`…) with an arrow pointing exactly where you clicked. It's grouped, so it moves and undoes as one piece.
- **Highlight**, **box**, **ellipse** and **measure** (it even reports real image pixels when you measure on a photo).
- Four colours, keys **1–5** to switch tools, **C** to cycle colours, hold **Space** to pan.
- **Ctrl+Shift+V** with a screenshot on your clipboard opens it in a new tab, locked as the background,
  with annotate mode already on.
- The **Callouts** panel lists every callout: rename, recolour, delete, renumber, or
  **copy them all as a text report** for a bug ticket or review email.

### 📤 Export without fuss
**Ctrl+Shift+E** opens a proper export dialog with a live preview:
PNG, SVG or JPEG; the whole drawing, just the selection, or a single frame; 1–4× scale; transparent or
solid background; dark mode; and optionally the scene embedded so the image opens again as an editable
drawing. Save it to a file or copy it straight to the clipboard.

### 🎞️ Present from your drawing
Draw a few **frames** (F), then press **F5**. The app goes fullscreen and steps through them one by one
with ← → or Space. The **Frames** panel lets you reorder slides without touching the drawing, or apply
that order to the file when you're happy.

### ⚡ Little things that add up
- **Ctrl+Alt+P:** jump to any open tab or recent file by typing part of its name or folder, with a little preview of each drawing.
- **Ctrl+Shift+F:** search text across *all* open drawings and jump straight to the match.
  (Ctrl+F still searches just the current one.)
- **Templates:** start from a flowchart, a wireframe (desktop and mobile frames), or an annotation board.
- **Drag and drop anything:** drawings open in tabs, `.excalidrawlib` files go into your library,
  images land exactly where you drop them.
- Your **library is shared** across every tab and kept between sessions.
- Light, dark, or follow Windows. **Always on top** for when you're sketching next to a video call.
- Every desktop command is also in Excalidraw's own command palette (**Ctrl+/**).
- No pop-up boxes anywhere. Every dialog is part of the app and matches Excalidraw's look.

## Keyboard cheat sheet

| Shortcut | What it does |
| --- | --- |
| Ctrl+T / Ctrl+N | New tab |
| Ctrl+O | Open files |
| Ctrl+S / Ctrl+Shift+S | Save / Save as |
| Ctrl+W / Ctrl+Shift+T | Close tab / reopen closed tab |
| Ctrl+Tab, Ctrl+1…9 | Switch tabs |
| Ctrl+Alt+P | Quick switch (tabs and recent files) |
| Ctrl+Shift+F | Find in all drawings |
| Ctrl+Shift+E | Export image |
| Ctrl+Shift+A | Annotate mode |
| Ctrl+Shift+V | Annotate the image on the clipboard |
| Ctrl+Shift+H | File history |
| F5 | Present frames |
| Ctrl+/ | Command palette |

## Build from source

You'll need [Node.js](https://nodejs.org) 20+, [Yarn](https://yarnpkg.com) (for the monorepo) and
[Rust](https://rustup.rs) with the MSVC toolchain.

```bash
git clone https://github.com/Inman2004/excalidraw.git
cd excalidraw
yarn install
cd desktop
npm ci            # installs the exact versions from package-lock.json
npx tauri dev     # run it
npx tauri build   # make the installer (src-tauri/target/release/bundle/nsis)
```

The app lives in [`desktop/`](desktop). It builds Excalidraw straight from this monorepo's source
(pinned commit `e1b7aacb3`) without changing a single line of it. Curious how it fits together, with
one isolated editor per tab, Rust-side file safety, and so on? See [`desktop/NOTES.md`](desktop/NOTES.md).

## Credits

- **[Excalidraw](https://github.com/excalidraw/excalidraw)**: the whole drawing experience. MIT licensed.
  All the credit for the canvas goes to that team; Paperimo just gives it a desktop home. "Excalidraw" is
  their name; Paperimo uses it only to say what it's built on and which files it opens.
- **[Solar Icons](https://www.figma.com/community/file/1166831539721848736)** by 480 Design, CC BY 4.0.
- **[Tauri](https://tauri.app)** for the tiny, fast native shell.
- Built with ♥ by **moon**.

Found a bug or have an idea? [Open an issue](https://github.com/Inman2004/excalidraw/issues). I'd love to hear how you use it.
