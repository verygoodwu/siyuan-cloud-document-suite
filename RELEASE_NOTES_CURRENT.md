# 云文档套件 v2.3.5

- 修复脑图中较多长文本、多层且不对称的分支展开后，节点文字与相邻分支重叠的问题。
- 布局由最深层向上对齐父节点，子分支保持正常占位；父节点超出范围时自动补足上下空间。
- 根据最终节点位置重新绘制连线，保留折叠、展开、缩放和窗口调整后的对齐。
- 不改变现有 .mm 文件格式、节点内容与保存及冲突保护机制。

验证：自动测试、TypeScript检查、生产构建及隔离浏览器回归；在Windows思源3.8.2测试594节点副本，全部展开的节点重叠从13处降至0；缩放、窗口调整、折叠再展开与连续重排通过。其他系统与真实跨设备同步未在本次重新实机验收。

---

# Cloud Document Suite v2.3.5

- Fix overlapping mind-map nodes when large, deeply nested, asymmetric branches contain long labels.
- Align parent labels bottom-up while preserving child branches in normal layout flow, reserving overflow space when necessary.
- Redraw connectors from final node positions after folding, zooming and resizing.
- Preserve the .mm format, existing node content, and save/conflict protection.

Validated with automated tests, type checking, production build and isolated browser regressions. A fully expanded 594-node copy had 13 node overlaps before the fix and none after it on Windows SiYuan 3.8.2. Other operating systems and real cross-device synchronization were not revalidated in this release.
