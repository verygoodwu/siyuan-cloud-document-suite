# Cloud Document Suite v2.1.12

This release publishes all work developed in v2.1.5–v2.1.12 and keeps the plugin focused on a lightweight SiYuan-native editing experience.

## Highlights

- Edit real TXT, HTML, CSS, JavaScript, JSON, XML, YAML, log, and common configuration files with autosave, recovery, conflict protection, and safe HTML preview.
- Read PDF files through Chromium's native viewer and export plugin-created documents through a SiYuan-style direct PDF workflow.
- Use type-aware export actions for Word/PDF documents, `.xlsx`, `.mm`, whiteboard SVG/PNG, PDF, and XMind files.
- Keep shortcuts, view restoration, save feedback, recovery downloads, fullscreen behavior, and narrow-window layouts consistent across editors.
- Prevent same-kernel browser sessions on NAS/Linux/Docker from editing the same attachment simultaneously with non-synchronized temporary leases.
- Verify uploaded bytes, complete document creation in `initializing`/`ready` phases, and offer explicit restoration when a missing attachment has a verified browser backup.
- Stop writing the synchronized `drop-debug.json` diagnostic file.
- Resolve all mind-map submodule version placeholders during packaging so upgraded desktop and NAS browsers cannot reuse stale shared modules.

## Verification

- 76 automated tests passed.
- TypeScript type checking and production packaging passed.
- The installed 34-file package matched the release build byte for byte after SiYuan synchronization.
- Real SiYuan regression verified the 404 recovery state and automatic read-only mode in a second editor page.

---

# 云文档套件 v2.1.12

本次正式发布包含 v2.1.5–v2.1.12 开发阶段的全部功能，继续保持轻量、面向思源原生使用场景的产品定位。

## 重点更新

- 可直接编辑真实 TXT、HTML、CSS、JavaScript、JSON、XML、YAML、日志和常见配置文件，支持自动保存、恢复、冲突保护及安全 HTML 预览。
- PDF 使用 Chromium 原生阅读器；插件创建的文档可通过思源式专用流程直接导出 PDF。
- 导出菜单根据文件标签显示 Word/PDF、`.xlsx`、`.mm`、白板 SVG/PNG、PDF 或 XMind 等对应格式。
- 统一各编辑器的快捷键、视图恢复、保存反馈、恢复副本、全屏行为和窄窗口布局。
- NAS/Linux/Docker 同一思源内核的多个浏览器页面使用非同步临时编辑锁，避免同时覆盖同一附件。
- 新建附件执行逐字节校验，文档经过 `initializing`、`ready` 两阶段创建；附件丢失且存在浏览器安全副本时可明确恢复。
- 停止生成会参与同步的 `drop-debug.json` 诊断文件。
- 打包时完整替换脑图子模块版本标识，避免桌面端和 NAS 浏览器升级后继续复用旧公共模块。

## 验证结果

- 76 项自动测试全部通过。
- TypeScript 类型检查与正式构建通过。
- 思源同步后，安装目录 34 个文件与正式构建逐字节一致。
- 已在真实思源页面验证 404 恢复状态和第二编辑页面自动只读。
