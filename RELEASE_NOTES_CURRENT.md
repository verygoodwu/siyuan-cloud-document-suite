# 云文档套件 v2.3.3

- PDF 导出预览防止旧请求覆盖，设置更新期间暂停导出；失败可重试，打印前等待图片与字体，并避免重复提交。

- 修复插件接管 PDF 拖放后使用浏览器预览，导致无法使用思源批注功能的问题。
- 正文中仅拖入 PDF 时保留思源原生拖放行为；文档树和混合导入中的 PDF 使用标准附件链接。
- 旧版浏览器 PDF 嵌入保留兼容，不自动改写已有文档；可在更新后重新导入。
- 拖放避让数据库附件、只读区域和查询嵌入，文档树识别限定在实际文件树内。
- 修复桌面连接远程内核时 PDF 导出无响应，改为浏览器打印预览。
- 支持思源 3.8.8 的标题分页能力，并兼容旧版缺少该能力的情况；开发 SDK 同步至官方示例使用的 1.2.8。

---

# Cloud Document Suite v2.3.3

- Prevents stale PDF previews and duplicate exports, adds preview retry, and waits for images and fonts before browser printing.

- Preserves SiYuan's native PDF drop handling and annotation reader for PDF-only editor drops.
- Uses normal PDF asset links for document-tree and mixed-file imports.
- Keeps legacy browser PDF embeds readable; existing documents are not automatically rewritten.
- Leaves database assets, readonly areas, and embedded queries to SiYuan's native handling.
- Routes remote-kernel PDF exports to browser print preview and detects host heading-page-break support.
- Aligns the development SDK with the official sample's 1.2.8 declaration.
