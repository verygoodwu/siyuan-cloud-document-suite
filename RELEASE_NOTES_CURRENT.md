# Cloud Document Suite v2.1.13

This maintenance release fixes mind-map node editing alignment across nested branches and zoom levels.

## Changes

- Fix shifted editing overlays when double-clicking mind-map nodes at different depths or on translated branches.
- Use one rendered-coordinate alignment path for mouse editing, keyboard-created nodes, and direct typing.
- Keep the editing overlay and connector synchronized when the input grows or the canvas is zoomed.
- Preserve the v2.1.12 NAS edit leases, 404 recovery, two-phase creation, text editing, PDF, and type-aware export features.

## Verification

- 77 automated tests passed.
- TypeScript type checking and production packaging passed.
- The installed 34-file package matched the release build byte for byte.
- Real SiYuan regression covered first-, second-, and third-level nodes plus 70% canvas zoom; vertical position error was 0 px at normal zoom and approximately 0.001 px at 70% zoom.
- No browser console errors or warnings were reported.

---

# 云文档套件 v2.1.13

本次维护版本修复脑图不同层级分支和缩放状态下的节点编辑框对齐问题。

## 更新内容

- 修复双击不同层级或经过布局位移的脑图节点时，编辑框偏离原节点的问题。
- 鼠标编辑、键盘新建后编辑和直接键入统一使用实际渲染坐标定位。
- 输入框增长或画布缩放时，编辑框和连接线继续与原节点保持同步。
- 保留 v2.1.12 的 NAS 编辑锁、404 恢复、两阶段创建、文本编辑、PDF 和按类型导出能力。

## 验证结果

- 77 项自动测试全部通过。
- TypeScript 类型检查与生产构建通过。
- 安装目录 34 个文件与候选构建逐字节一致。
- 真实思源回归覆盖一级、二级、三级节点及 70% 画布缩放；正常缩放下纵向误差为 0 px，70% 缩放下约为 0.001 px。
- 浏览器控制台无错误或警告。
