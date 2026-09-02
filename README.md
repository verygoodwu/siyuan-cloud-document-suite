# Cloud Document Suite

Import, preview, create, edit, and export office documents, mind maps, and whiteboards in SiYuan. Supports SiYuan Desktop on Windows and desktop browsers connected to Linux/Docker kernels. Excel, FreeMind, and whiteboard edits are written back to SiYuan assets and update a document sync revision marker; local browser storage is used only for recovery.

![Feature preview](preview.png)

## Changelog (short version)

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

Development focuses on lightweight editing experiences inside SiYuan. The next whiteboard steps are box selection, multi-object layout, sections, and templates; complex Excel compatibility remains intentionally deferred.

## Features

- Drag files from Windows Explorer onto a document or notebook in the document tree. The plugin uploads the source file and creates a same-named child document.
- Inline PDF preview with the original attachment retained.
- Editable Excel workbooks with multiple sheets, add/delete/rename sheet actions, range copy/paste, row/column insertion, deletion and resizing, undo/redo, keyboard navigation, find/replace, common formula calculation, automatic SiYuan asset persistence, and `.xlsx` export.
- `.docx` content conversion with the original attachment retained, plus a context-menu action for creating Word documents.
- XMind import for both modern `content.json` and legacy `content.xml` packages.
- Live FreeMind/Freeplane `.mm` editing with draggable nodes, automatic SiYuan asset persistence, and standards-compatible `.mm` export.
- Editable whiteboards with text, sticky notes, shapes, images, freehand drawing, node-bound connectors, zoom/pan, quick creation, undo/redo, automatic SiYuan persistence, and SVG/PNG export.
- Context-menu actions on documents and notebooks for creating whiteboards, mind maps, Word documents, and Excel workbooks.
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
