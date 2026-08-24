# Cloud Document Suite

Import, preview, create, edit, and export office documents and mind maps in SiYuan. Supports SiYuan Desktop on Windows and desktop browsers connected to Linux/Docker kernels. Excel and FreeMind edits are written back to SiYuan assets and update a document sync revision marker; local browser storage is used only for recovery.

![Feature preview](preview.png)

## Changelog (short version)

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

Development will next focus on improving `.mm` and Excel support, including format compatibility, editing capabilities, data preservation, and large-file usability.

## Features

- Drag files from Windows Explorer onto a document or notebook in the document tree. The plugin uploads the source file and creates a same-named child document.
- Inline PDF preview with the original attachment retained.
- Editable Excel workbooks with multiple sheets, add/delete/rename sheet actions, automatic SiYuan asset persistence, and `.xlsx` export.
- `.docx` content conversion with the original attachment retained, plus a context-menu action for creating Word documents.
- XMind import for both modern `content.json` and legacy `content.xml` packages.
- Live FreeMind/Freeplane `.mm` editing with draggable nodes, automatic SiYuan asset persistence, and standards-compatible `.mm` export.
- Context-menu actions on documents and notebooks for creating mind maps, Word documents, and Excel workbooks.
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
