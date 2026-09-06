# Cloud Document Suite

**English** | [简体中文](./README.zh-CN.md)

[![Latest release](https://img.shields.io/github/v/release/verygoodwu/siyuan-cloud-document-suite?label=release)](https://github.com/verygoodwu/siyuan-cloud-document-suite/releases/latest)
[![License](https://img.shields.io/github/license/verygoodwu/siyuan-cloud-document-suite)](./LICENSE)

Import, preview, create, edit, and export documents, real text files, spreadsheets, mind maps, and whiteboards in SiYuan. Supports SiYuan Desktop on Windows and desktop browsers connected to Linux/Docker kernels. Text, Excel, FreeMind, and whiteboard edits are written back to SiYuan assets and update a document sync revision marker; local browser storage is used only for recovery.

![Feature preview](preview.png)

## What's new in v2.1.11

- Adds real TXT/HTML and common source/configuration file editing while keeping original attachment formats.
- Adds a lightweight Chromium PDF reader and SiYuan-style direct PDF export for plugin-created documents.
- Adds type-aware export actions for documents, spreadsheets, mind maps, whiteboards, PDF, and XMind files.
- Unifies shortcuts, view restoration, save feedback, recovery downloads, and narrow-window layouts across editors.
- Adds NAS-safe per-kernel edit leases, two-phase document creation, byte verification, and explicit 404 recovery without synchronized debug files.

This public release includes the work developed in v2.1.5–v2.1.11. See the [complete release history](./RELEASE_NOTES.md) for details.

## Changelog (short version)

- **v2.1.11**: Adds non-synchronized edit leases shared by browser sessions on one NAS/Linux/Docker kernel, byte-verifies uploaded assets, and marks plugin documents through initializing/ready creation phases. Verified browser backups can explicitly restore a missing 404 asset, while diagnostics no longer update the synchronized `drop-debug.json` file. This release also publishes the text editor, PDF workflow, type-aware exports, and unified editor experience developed in v2.1.5–v2.1.10.
- **v2.1.10 (local development)**: Replaces the automatic Windows print dialog for document PDF export with a SiYuan-style PDF preview and Electron `printToPDF` flow. Desktop export now supports page size, margins, scale, landscape, embedded resources, title, subdocument, watermark, and pagination settings.
- **v2.1.9 (local development)**: Unifies shortcuts, operation feedback, and save-failure recovery across text, spreadsheet, mind-map, whiteboard, and PDF views. It restores cursor/scroll, active sheet/selection, mind-map viewport/selection, and requested PDF page; adds whiteboard node search; offers one-click undo for structural actions; and improves filenames and narrow-window toolbar behavior without new heavy dependencies.
- **v2.1.8 (local development)**: Adds a lightweight PDF shell around Chromium's native viewer with reload, open/download, print, fullscreen, file-size reporting, and missing/corrupt-file states. The text editor gains current-match numbering, replace-count confirmation, line/character/selection statistics, save timestamps, recovery download, save retry, asset-path actions, exact-extension export labels, responsive overflow, and save flushing when an editor is hidden. Text, spreadsheet, whiteboard, mind-map, and PDF views now expose working fullscreen controls. Menu promotion keeps the standard plugin-submenu fallback when SiYuan's native layout changes.
- **v2.1.7 (local development)**: Improves the lightweight text editor with current-line highlighting, go-to-line, two/four-space indentation, Shift+Tab outdent, reload-from-asset, remembered preferences, and a side-by-side sandboxed HTML preview, without adding a heavy editor dependency.
- **v2.1.6 (local development)**: Adds a real text-asset editor with TXT/HTML creation, common text-file import, autosave, recovery, conflict protection, BOM/newline preservation, find/replace, and sandboxed HTML preview with scripts disabled.
- **v2.1.5 (local development)**: Renames the document action to “New document (exportable to Word/PDF)”. A plugin-owned “Export file” submenu now sits directly below the top-level “Create file” item and uses plugin type markers to show the matching Word/PDF, `.mm`, `.xlsx`, whiteboard SVG/PNG, original PDF, or XMind action. Legacy unmarked documents are detected from their embedded editor or attachment.
- **v2.1.4**: Completes two whiteboard interaction batches: click-or-drag four-way quick create, a 5 px drag threshold, collision-aware contextual toolbar, natural pan/zoom, alignment and equal-gap snapping, connector target highlighting and endpoint reconnection, connector labels, Alt-drag duplication, and zoom-to-selection. Existing board files remain compatible.
- **v2.1.3**: First public whiteboard release, including all capabilities developed in v2.1.0–v2.1.2. Splits the text editor into a centered overlay and native editable inner element, fixing unreliable empty-node input, alignment, and duplicate double-click initialization. The whiteboard is isolated from existing spreadsheet, mind-map, Word, and import flows, with real-browser input and persistence coverage.
- **v2.1.2 (local development)**: Completes whiteboard text-entry behavior for immediate editing after creation, double-click, Enter/F2, and direct typing; fixes creation/edit timing and PNG export for boards containing text; and adds a full whiteboard test matrix. This build has not been pushed or submitted to the marketplace.
- **v2.1.1 (local development)**: Fixes vertically misaligned whiteboard text editing and repeated clicks or double-clicks being misclassified as blank-canvas creation. Adds real-browser regression coverage.
- **v2.1.0 (local development)**: Adds a Feishu-inspired editable whiteboard with an infinite canvas, text, sticky notes, common shapes, connectors, freehand drawing, images, marquee selection, alignment and distribution, grouping, sections, layer ordering, built-in templates, automatic layout, undo/redo, automatic SiYuan persistence, recovery, conflict protection, and SVG/PNG export.

- **v1.9.2**: Restores each branch's original collapse state after search, coalesces mind-map render/decorate work for smoother large maps, makes Tab/Enter/Shift+Enter/Ctrl+Enter create-and-edit shortcuts consistently undoable, and lets Escape leave branch focus while restoring the previous viewport.
- **v1.9.1**: Adds a searchable mind-map outline with canvas selection linking, direct editing after Tab, reliable keyboard undo, discoverable shortcut help, Ctrl+/ branch toggling, Ctrl+Home root navigation, safe branch focus with an always-visible exit, and steadier Chinese long-text input.
- **v1.9.0**: Stabilizes the lightweight spreadsheet workspace with post-write SHA-256 verification, export round-trip checks for sheets/formulas/merges/view state, visible save-failure blocking, duplicate-export protection, and narrow-window layout cleanup.
- **v1.8.5**: Refines spreadsheet editing with direct-type replacement, F2/double-click in-cell editing, Escape cancellation, selection count/sum/average, keyboard-driven formula suggestions, and merged-cell-aware navigation. A full 500×50 selection statistics test remains lightweight without a Worker.
- **v1.8.4**: Adds find/replace and replace-all with case, selection, and formula-source options; recognizes strict dates and RMB input; adds formula hints and concise error explanations; improves Home/End and Ctrl+Arrow navigation; and reports large paste progress/results without adding a Worker.
- **v1.8.3**: Adds row and column insertion/deletion, Shift/drag range selection, context-menu actions, and keyboard shortcuts. Formulas, cross-sheet references, merged ranges, dimensions, freezes, filters, and chart ranges move with the structure, with workbook-aware undo/redo, recovery, and save round-trip coverage.
- **v1.8.2**: Improves lightweight spreadsheet input by storing numbers and percentages as numeric cells while preserving leading-zero identifiers as text; adds draggable row heights and column widths, auto-fit on double click, undo/recovery support, and XLSX round-trip coverage.
- **v1.8.1**: Refined mind-map alignment, collapse controls, editing and viewport stability; expanded spreadsheet editing and formatting; promoted file creation to the top-level document-tree menu; fixed versioned editor dependencies; and reduced the transparent marketplace icon below the Bazaar size limit.
- **v1.8.0**: Added spreadsheet range selection, copy/paste, undo/redo, keyboard navigation, current-sheet search, lightweight formula calculation and dependency refresh, plus a cleaner marketplace icon.
- **v1.7.0**: Refined the default `.mm` hierarchy view with Feishu-style orthogonal branches, placeholder nodes, and formatting; removed summaries/custom links; prevented new mind maps and spreadsheets from reusing stale assets; and expanded deletion, conflict, and recovery safeguards.
- **v1.6.8**: Mind-map tasks now toggle a gray strikethrough state directly, with a saved hierarchy view and corrected task-circle/underline rendering.
- **v1.6.7**: Eliminated the resize flash when opening spreadsheets or mind maps.
- **v1.6.6**: Made spreadsheet and mind-map workspaces fit the active editor panel.
- **v1.6.5**: Removed outer borders, shadows, and remaining visual edges.
- **v1.6.4**: Improved Excel data preservation, `.mm` field preservation, security, and cache refreshes.
- **v1.6.3**: Restored Excel gridlines and improved responsive editor layouts.
- **v1.6.2**: Fixed `digest`, attachment timestamp, and consecutive auto-save issues.
- **v1.6.1**: Added document sync revision markers.
- **v1.6.0**: Began writing Excel and `.mm` edits back to SiYuan assets.
- **v1.5.0**: Improved mind-map direction, formatting, task states, and asset cache busting.
- **v1.4.2**: Fixed spreadsheet row and column expansion feedback.
- **v1.4.1**: Added Linux/Docker and `browser-desktop` support.
- **v1.4.0**: Introduced office document, spreadsheet, PDF, XMind, and FreeMind import and preview.

## Next

Development continues to focus on a lightweight, polished editing experience inside SiYuan. Complex Excel compatibility, multi-user collaboration, server accounts, and heavyweight editor engines remain intentionally outside the current scope.

## Features

- Drag files from Windows Explorer onto a document or notebook in the document tree. The plugin uploads the source file and creates a same-named child document.
- Lightweight PDF shell backed by Chromium's native viewer, with reload, original-file actions, print, fullscreen, and explicit missing/corrupt-file feedback without PDF.js.
- Real editing for TXT, HTML, CSS, JavaScript, JSON, XML, YAML, logs, and common source/configuration text files, including autosave, recovery download, conflict protection, match navigation, replacement confirmation, status statistics, newline preservation, exact-extension export, and script-disabled split HTML preview.
- Editable Excel workbooks with multiple sheets, add/delete/rename sheet actions, range copy/paste, row/column insertion, deletion and resizing, undo/redo, keyboard navigation, find/replace, common formula calculation, automatic SiYuan asset persistence, and `.xlsx` export.
- `.docx` content conversion with the original attachment retained, plus lightweight SiYuan-block documents that export as Word or through a SiYuan-style PDF preview on desktop, with manual browser printing as a fallback.
- XMind import for both modern `content.json` and legacy `content.xml` packages.
- Live FreeMind/Freeplane `.mm` editing with draggable nodes, automatic SiYuan asset persistence, and standards-compatible `.mm` export.
- Editable whiteboards with text, sticky notes, shapes, images, freehand drawing, labeled reconnectable connectors, snapping, click-or-drag quick creation, zoom/pan and zoom-to-selection, Alt-drag duplication, undo/redo, automatic SiYuan persistence, and SVG/PNG export.
- Context-menu actions on documents and notebooks for creating whiteboards, mind maps, Word documents, TXT/HTML files, and Excel workbooks.
- Collision-safe naming and sequential multi-file imports; one failed file does not stop the remaining queue.

Legacy `.doc` files and web-link previews are not supported yet.

For NAS Docker deployments, open SiYuan in a desktop browser. Files are uploaded from the current computer into the SiYuan workspace on the NAS. Mobile browser frontends are not supported yet.

## Install and develop

Download `package.zip` from GitHub Releases and extract it to `<SiYuan workspace>/data/plugins/siyuan-cloud-document-suite/`. Restart SiYuan and enable the plugin under Settings → Marketplace → Downloaded.

```powershell
pnpm install
pnpm build
```

The build creates both `dist/` and a marketplace-ready `package.zip`.

## Privacy

Document parsing and editing happen locally. The plugin does not intentionally send files to third-party services; attachments stay in the current SiYuan workspace.

## Feature requests and bug reports

If you would like to request a feature or report a problem, please email [wujiaqi8868@gamil.com](mailto:wujiaqi8868@gamil.com). I will review the request and decide whether it fits Cloud Document Suite based on its usefulness, implementation cost, and the overall direction of the plugin.

Cloud Document Suite is under active development. I am gradually adding more features and fixing reported bugs. Feedback and suggestions from users and fellow developers are always welcome.

## License

[MIT](LICENSE)
