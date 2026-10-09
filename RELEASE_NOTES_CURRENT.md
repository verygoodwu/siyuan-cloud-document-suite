# 云文档套件 v2.3.1

本版本新增 macOS 桌面端平台声明与 Command 快捷键提示，并完成 Apple Silicon Mac 上的主要编辑与 PDF 导出验证。

## 主要更新

- Mac 平台：在思源内核和后端声明中新增 `darwin`，支持加载插件。
- 快捷键提示：文本、表格、脑图和白板在 Mac 上显示 ⌘；重做显示 ⌘⇧Z，Windows 保留 Ctrl 提示。
- 打包与校验：新快捷键模块纳入正式包并使用发布版本缓存标识；安装校验自动读取项目版本，避免硬编码旧版本。
- 保留真实附件保存、冲突检测、附件缺失恢复、编辑租约和 HTML 沙箱边界；不增加依赖。

## 验证范围

- Apple Silicon Mac、思源 3.8.6：插件加载和创建菜单；TXT 的 Command 保存/查找、中文文本粘贴及保存回读；脑图 Tab 新增后直接编辑、双击定位、Command 撤销/重做；PDF 中文预览、原生目录选择、取消后再次导出、实际生成及窗口关闭。
- 86 项自动测试、TypeScript 类型检查、生产构建、包结构/版本/缓存占位符校验通过。
- 生产依赖审计报告 1 项中等风险：`mammoth → argparse → sprintf-js`（GHSA-hp3w-g68c-fv3c）。官方注册表暂无可安装修复版；该链路用于 Mammoth 命令行，插件未调用，生产 bundle 未包含 argparse/sprintf-js。
- 仍未完成：中文输入法候选全过程、实体触控板手势、Mac 拖放、完整表格/白板界面回归、保存故障实机注入、Intel Mac；本次未进行 Windows/Linux 实机回归。不要将上述有限验证视为所有平台和交互已全面验证。

---

# Cloud Document Suite v2.3.1

This release adds macOS platform declarations and Command shortcut hints, with core editing and PDF export verified on an Apple Silicon Mac.

## Highlights

- Adds `darwin` to kernel and backend declarations so SiYuan can load the plugin on macOS.
- Text, spreadsheet, mind-map, and whiteboard editors display ⌘ shortcuts on Mac, including ⌘⇧Z for redo; Windows retains Ctrl hints.
- Packages the shared shortcut module with release-version cache URLs. Installation verification reads the project version instead of a hard-coded value.
- Preserves real-asset saving, conflict detection, missing-asset recovery, edit leases, and HTML sandbox boundaries, without new dependencies.

## Verification scope

- Apple Silicon Mac with SiYuan 3.8.6: plugin loading and creation menus; TXT Command save/find, pasted Chinese text and save/reload; mind-map Tab creation/editing, double-click alignment and Command undo/redo; Chinese PDF preview, native directory selection, cancellation/retry, PDF generation and window closure.
- 86 automated tests, TypeScript checking, production build, and package structure/version/cache-placeholder checks passed.
- Production dependency audit reports one moderate advisory in `mammoth → argparse → sprintf-js` (GHSA-hp3w-g68c-fv3c). No patched version is available from the registry; this is Mammoth CLI code, unused by the plugin and absent from the production bundle.
- Still unverified: native Chinese IME composition, physical trackpad gestures, Mac drag/drop, full spreadsheet/whiteboard UI regressions, on-device save fault injection, and Intel Macs. Windows/Linux were not tested on physical devices in this release.
