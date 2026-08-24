# 云文档套件

在思源笔记中导入、预览、创建、编辑和导出办公文档与脑图。支持 Windows 桌面端，以及 Linux/Docker 内核的桌面浏览器端。Excel 与 FreeMind 脑图的修改会自动写回思源附件，并更新文档同步修订标记；本机缓存仅用于失败恢复。

![功能预览](preview.png)

## 功能

- 将 Windows 资源管理器中的文件拖到文档树中的文档或笔记本，自动上传附件并创建同名子文档。
- PDF 内嵌预览，并在下方保留原始附件。
- Excel 工作簿可编辑，支持多 Sheet、新增、删除、重命名、自动写回思源和导出 `.xlsx`。
- Word `.docx` 转换为可阅读的文档内容，同时保留原始附件；右键菜单可新建 Word 文档。
- XMind `.xmind` 支持新版 `content.json` 与旧版 `content.xml`。
- FreeMind/Freeplane `.mm` 可实时编辑、拖动节点、自动写回思源并导出标准 `.mm`。
- 文档与笔记本右键菜单支持新建脑图、Word 文档和 Excel 工作簿。
- 同名文件自动追加 `(2)`、`(3)`，多文件按顺序导入，单个文件失败不会中断其余任务。

## 支持范围

| 类型 | 导入 | 预览/编辑 | 导出 |
| --- | --- | --- | --- |
| PDF | ✓ | 内嵌预览 | 原文件 |
| Excel `.xlsx` | ✓ | 多 Sheet 编辑 | `.xlsx` |
| Word `.docx` | ✓ | 内容预览/思源编辑 | `.docx` |
| XMind `.xmind` | ✓ | 层级内容 | — |
| FreeMind `.mm` | ✓ | 实时脑图编辑 | `.mm` |

旧版 `.doc` 和网页链接预览暂不支持。

NAS Docker 用户请使用桌面浏览器访问思源。文件会从当前电脑上传到 NAS 上的思源工作空间；手机浏览器端暂不支持。

## 安装与开发

从 GitHub Releases 下载 `package.zip`，解压到 `<思源工作空间>/data/plugins/siyuan-cloud-document-suite/`，重启思源后在“设置 → 集市 → 已下载”中启用。

```powershell
pnpm install
pnpm build
```

`pnpm build` 会生成 `dist/` 和可直接发布到 GitHub Release 的 `package.zip`。

## 隐私

文档解析和编辑在本地完成。插件不会主动上传文件到第三方服务；附件仅保存到当前思源工作空间。

## 功能建议与问题反馈

如果你希望插件增加新的功能，或在使用过程中发现问题，欢迎发送邮件至 [wujiaqi8868@gamil.com](mailto:wujiaqi8868@gamil.com)。我会查看反馈，并根据功能的适用范围、实现难度和插件整体规划，评估是否将其加入云文档套件。

云文档套件仍在持续开发中。我正在陆续补充更多功能并修复已发现的问题。欢迎各位用户和开发者试用、反馈，也感谢大家对这个插件的改进建议。

## 许可证

[MIT](LICENSE)
