# 云文档套件 v2.3.0

本版本修复脑图连线与正文拖入预览问题，并增强手机网页预览入口及 NAS 导入诊断。

## 主要更新

- 脑图：导入 `.mm` 后按实际节点位置重绘；一级分支共用主干并采用轻圆角，单子节点连线保持水平直线；缩放、字体和节点尺寸变化后自动重新对齐。
- 拖入预览：文件拖入文档正文时优先插入预览；未知格式或转换失败时保留原始附件链接。
- 手机网页：开放 `browser-mobile` 加载以预览现有文档。手机 App 与桌面式拖放仍不支持，iOS/Android 真机尚未完整验证。
- NAS 诊断：区分上传、预览转换与插入失败，并识别思源文件接口异常或代理返回登录页的情况。

## 验证

- 86 项自动测试通过；隔离 Chrome 回归覆盖五分支、左右分支、后续直线、缩放及手机宽度渲染，浏览器异常为 0。
- TypeScript 类型检查、生产构建与安装包内容校验通过。
- 真实 iOS/Android 设备和用户 NAS 反向代理环境尚未验证。

---

# Cloud Document Suite v2.3.0

This release improves mind-map connectors and content-drop previews, with experimental mobile-browser previews and clearer NAS import diagnostics.

## Highlights

- FreeMind `.mm` connectors use measured node positions: one shared first-level trunk with soft corners, straight single-child links, and alignment updates after zoom, font, or size changes.
- Dropping a previewable file into document content inserts its preview; unknown formats and conversion failures retain the original attachment link.
- `browser-mobile` can load for existing-document previews. Native mobile apps and desktop drag-and-drop remain unsupported; physical iOS/Android devices are not fully verified.
- Upload, conversion, and insertion errors are differentiated, including SiYuan file API failures and NAS proxy login responses.

## Verification

- 86 automated tests and isolated Chrome interaction regressions passed with zero captured browser errors, including five-way branches, mixed directions, straight descendants, and mobile-width rendering.
- TypeScript checking, production packaging, and package-content verification passed. Physical mobile devices and user NAS proxy setups remain unverified.
