# 云文档套件 v2.2.0

本版本集中改善思源内的操作手感、保存安全性和轻量性能，不扩大复杂 Office 兼容范围。

## 主要更新

- 表格：统一只读能力边界；工作表增删改名可撤销；保存冲突可下载恢复副本、读取远端或确认覆盖；内部对话框提供校验与焦点恢复。
- 白板：完善取消与失焦恢复、只读浏览、右键菜单、自由连接端点及键盘操作；连续视图变化合并保存，撤销历史增加内存预算。
- 文本：缓存行索引和字节统计，降低大文本移动光标时的重复全文计算。
- 共享体验：编辑器跟随思源主题，明确不可用原因和保存反馈，不新增 Worker、依赖或轮询任务。
- 编辑锁：页面关闭时使用可继续完成的安全解锁请求；快速重开短暂复查旧锁，同时不覆盖仍有效的其他页面锁。

## 验证

- 84 项自动测试通过。
- 27 组独立 Chrome 交互检查及原有 24 组白板全功能回归通过，浏览器异常为 0。
- 验证表格实际字节保存与冲突处置、文本 Unicode 输入、白板保存合并、主题切换、快速重开及有效外部锁保护。
- TypeScript 类型检查、生产构建和安装包内容校验通过。

---

# Cloud Document Suite v2.2.0

This release focuses on interaction quality, persistence safety, and lightweight performance inside SiYuan without expanding complex Office compatibility.

## Highlights

- Spreadsheet read-only boundaries, workbook history, validated dialogs, conflict recovery, remote reload, and confirmed overwrite.
- Whiteboard cancellation, read-only navigation, context actions, free connector endpoints, coalesced viewport saves, and bounded history memory.
- Cached text line/size metrics and live SiYuan theme inheritance without new dependencies or polling.
- Safe unload-time lease release and bounded reopen rechecks without stealing active locks.

## Verification

- 84 automated tests passed.
- 27 isolated Chrome interaction checks and the existing 24-group whiteboard browser suite passed with zero captured browser errors.
- TypeScript checking, production packaging, and package-content verification passed.
