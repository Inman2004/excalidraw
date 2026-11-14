# Changelog

All notable changes to Paperimo. Versions follow [semantic versioning](https://semver.org).

## 0.1.0 — first public release

The first release of Paperimo: a notepad-like Windows app for the Excalidraw drawing engine.

### Documents and tabs
- Tabs in the title bar: new, close, reopen closed tab, reorder by dragging, rename the file inline,
  pin, Ctrl+Tab and Ctrl+1…9. Every tab keeps its own undo history.
- Auto-save to disk, crash recovery about once a second, atomic saves, and a Recovery Center for
  anything left over.
- Files changed by another program reload when you have no unsaved changes; otherwise you choose
  to keep yours, load theirs or save yours as a copy.
- File history: the last 10 versions of each file, with thumbnails; restoring opens a new tab.
- Session restore, recent files, drag and drop for drawings, libraries and images, and
  double-clicking `.excalidraw` files opens them in the running app.

### Annotation
- Annotate mode (Ctrl+Shift+A): select, callout, arrow, number marker, highlight, box, ellipse
  and measure. Everything it makes is an ordinary Excalidraw element, edited with Excalidraw's
  own handles and style panel; the Select tool (V) does that without leaving annotate mode.
- Callouts: a white label (dark text, thin grey border) with an arrow attached to it, so the
  arrow can be bent, re-pointed and restyled, and follows the label when it moves. Label
  styles: white, text only, tinted, outline. Arrows: straight, curved or elbow; triangle,
  arrow, dot, bar or no head; 1–6 px; solid, dashed or dotted. Multi-line labels
  (Shift+Enter), numbering on or off, black ink by default (white in dark mode).
- "Select callout pair" selects a label with its arrow; deleting a label offers to delete its
  arrow too. One undo removes a whole callout.
- Auto arrange (the Auto button in annotate mode, or the Callouts panel): callout cards line up
  in aligned columns beside the screenshot (rows above and below when the sides are full),
  evenly spaced, matched widths, long text wrapped, arrows that don't cross. Targets and
  everything else stay put, numbers are kept ("Arrange and renumber" renumbers in reading
  order), and it's one undo step. Balanced, Compact or Spacious.
- Ctrl+Shift+V turns a screenshot on the clipboard into a new tab ready to annotate.
- Callouts panel: rename, recolour, delete, renumber and copy all labels as a report.

### Export and presentation
- Export dialog (Ctrl+Shift+E): PNG, SVG or JPEG; everything, the selection or one frame;
  1–4× scale; background, dark mode and embedded scene; save or copy to the clipboard.
- Frames panel and full-screen presentation (F5), with a local slide order you can apply to the file.

### Finding things
- Quick switcher with previews (Ctrl+Alt+P), search across all open drawings (Ctrl+Shift+F),
  templates, and every desktop command in Excalidraw's command palette (Ctrl+/).

### Notes
- Unofficial app, not affiliated with Excalidraw. The installer is not code-signed yet, so
  Windows SmartScreen may warn on first install.
- Builds made before the rename (named "Excalidraw" in the Start menu) can be uninstalled after
  installing Paperimo; Paperimo copies their tabs, recovery data and backups on first start.
