# Cloud Document Suite

Import, preview, create, edit, and export office documents and mind maps in SiYuan. The current release targets SiYuan Desktop on Windows.

![Feature preview](preview.png)

## Features

- Drag files from Windows Explorer onto a document or notebook in the document tree. The plugin uploads the source file and creates a same-named child document.
- Inline PDF preview with the original attachment retained.
- Editable Excel workbooks with multiple sheets, add/delete/rename sheet actions, autosave, and `.xlsx` export.
- `.docx` content conversion with the original attachment retained, plus a context-menu action for creating Word documents.
- XMind import for both modern `content.json` and legacy `content.xml` packages.
- Live FreeMind/Freeplane `.mm` editing with draggable nodes, autosave, and standards-compatible `.mm` export.
- Context-menu actions on documents and notebooks for creating mind maps, Word documents, and Excel workbooks.
- Collision-safe naming and sequential multi-file imports; one failed file does not stop the remaining queue.

Legacy `.doc` files and web-link previews are not supported yet.

## Install and develop

Download `package.zip` from GitHub Releases and extract it to `<SiYuan workspace>/data/plugins/siyuan-cloud-document-suite/`. Restart SiYuan and enable the plugin under Settings → Marketplace → Downloaded.

```powershell
pnpm install
pnpm build
```

The build creates both `dist/` and a marketplace-ready `package.zip`.

## Privacy

Document parsing and editing happen locally. The plugin does not intentionally send files to third-party services; attachments stay in the current SiYuan workspace.

## License

[MIT](LICENSE)
