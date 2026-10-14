# Cloud Document Suite

**English** | [简体中文](./README.zh-CN.md)

## Quick start · One minute

1. **Create**: Right-click a document or notebook in SiYuan's document tree → **创建文件 (Create file)**, then choose a spreadsheet, mind map, whiteboard, text file, or document. If the entry is missing, check the context menu's Plugins submenu.
2. **Edit**: Select a spreadsheet cell and type; double-click to edit existing content. Double-click a mind-map node to edit its text and press **Tab** to add a child. On a whiteboard, click a shape to select it, drag to move it, double-click to type, and hold **Space** while dragging to pan. Regular documents use SiYuan's editor and can be exported to Word/PDF.
3. **Save and sync**: Changes save automatically. Wait for the saved status before closing. Cross-device access also requires SiYuan's own data sync to finish: **saved does not mean synced to another device**. Resolve any save-failure, read-only, or conflict notice before closing.
4. **Export**: Right-click the corresponding document in the document tree → **导出文件 (Export file)** and choose an available format. You can also use the export button in the spreadsheet, mind-map, or whiteboard editor.

Tip: This plugin focuses on lightweight editing. Import simple spreadsheets and keep the originals of complex Excel files. PDF support is primarily for reading, not editing PDF body content.

[![Latest release](https://img.shields.io/github/v/release/verygoodwu/siyuan-cloud-document-suite?label=release)](https://github.com/verygoodwu/siyuan-cloud-document-suite/releases/latest)
[![License](https://img.shields.io/github/license/verygoodwu/siyuan-cloud-document-suite)](./LICENSE)

Import, preview, create, edit, and export documents, real text files, spreadsheets, mind maps, and whiteboards in SiYuan. Supports SiYuan Desktop on Windows/macOS and desktop browsers connected to Linux/Docker kernels. Text, Excel, FreeMind, and whiteboard edits are written back to SiYuan assets and update a document sync revision marker; local browser storage is used only for recovery.

![Feature preview](preview.png)

## What's new in v2.3.2

- Keeps the connector straight while editing a child mind-map node created with Tab.
- Recenters the mind map after exiting fullscreen with Escape.
- Explains right-drag canvas movement in the toolbar and shortcut dialog.

## Release highlights by series

- **v2.3.x**: Improved mind-map connectors and zoom alignment, document drop previews, NAS import diagnostics, macOS shortcut hints, and the latest mind-map fixes.
- **v2.2.x**: Refined spreadsheet, whiteboard, text editing, and save reliability, including stale whiteboard lock recovery.
- **v2.1.x**: Added editable whiteboards, real text-asset editing, lightweight PDF reading/export, and stronger NAS save/recovery protection.
- **v2.0.x**: Stabilized lightweight editing, clarified complex workbook limits, and improved save and import feedback.
- **v1.x**: Established import and preview for documents, spreadsheets, PDFs, XMind, and FreeMind, plus spreadsheet and mind-map editing.

[Read the condensed release history](./RELEASE_NOTES.md)
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

For NAS Docker deployments, desktop-browser imports upload files from the current computer into the SiYuan workspace on the NAS. Mobile-browser plugin loading is enabled for previewing existing documents, but iOS/Android devices have not yet been fully verified and desktop drag-and-drop import is unavailable there. If SiYuan itself reports an unsupported browser, use a browser supported by SiYuan. Native mobile app kernels remain unsupported.

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
