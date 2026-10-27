# 云文档套件 v2.3.4

- 修复白板节点按下即捕获鼠标，干扰双击进入编辑的问题；现在双击保留原文，并按点击位置放置光标。
- Enter/F2 从末尾编辑，选中节点后直接输入改为追加；支持局部修改、换行和取消编辑。
- 四向连接点拖到已有节点时直接连接，拖到空白处仍可创建节点，增加目标高亮和端点吸附提示。
- 改善折线和曲线的出入方向、连线说明位置；释放鼠标时重新判断连接目标，缩放后控制点保持可操作大小。
- 选中连线时取消矩形包围框，只高亮线条并显示两端重连圆点；普通图形保留原选择框。
- 保留已有白板格式、自动保存、恢复及冲突保护。连线仅对相连的两个节点做局部避让，不提供全画布避障或重复连线合并。

验证：95 项自动测试、TypeScript 检查、生产构建、白板专项浏览器回归通过；修复测试版已在 Windows 思源 3.8.2 中安装并核验插件文件。系统实体输入法候选窗、Mac/Linux 及跨设备同步未完成本次实机回归。

---

# Cloud Document Suite v2.3.4

- Fixes pointer capture interfering with double-click editing. Existing text is preserved and the caret follows the clicked position.
- Enter/F2 edits at the end; typing on a selected node appends instead of replacing the whole label.
- Drag quick-create handles onto existing shapes to connect, or onto empty space to create a connected shape, with target and endpoint feedback.
- Improves side-aware orthogonal/curved routing, connector label placement, drop targeting and zoom-stable connection handles.
- Selecting a connector highlights its path and shows endpoint handles without a rectangular selection box.
- Preserves the existing document format and save/recovery/conflict protections. Routing only avoids the two attached nodes; duplicate links remain separate.

Validation includes automated tests, type checking, production build and isolated whiteboard browser regressions. The preview was installed and file-verified in Windows SiYuan 3.8.2. Native IME candidate windows, Mac/Linux and cross-device sync were not fully tested in this release.
