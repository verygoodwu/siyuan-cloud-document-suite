import { Plugin, showMessage, type IMenu } from "siyuan";
import * as XLSX from "xlsx";
import * as mammoth from "mammoth";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import JSZip from "jszip";
import { KernelClient } from "./kernel-client";
import { buildAttachmentMarkdown, DocumentCreator } from "./document-creator";
import { PreviewBuilders } from "./preview-builders";
import { EmbedManager } from "./embed-manager";
import type { DocTreeMenuDetail, DocumentPathData, DropTarget, UploadedAsset } from "./types";
import {
  buildUniqueUploadName,
  isFreeMindFile,
  isMarkdownFile,
  isPdfFile,
  isSpreadsheetFile,
  isWordFile,
  isXMindFile,
  isZipContent
} from "./file-types";

declare const __PLUGIN_VERSION__: string;
const PLUGIN_VERSION = __PLUGIN_VERSION__;
const MM_EDITOR_CACHE_VERSION = `${PLUGIN_VERSION}-mm47`;

const EDITOR_SELECTOR = ".protyle-wysiwyg";
const BLOCK_SELECTOR = "[data-node-id]";
const TREE_DOCUMENT_SELECTOR = ".b3-list-item[data-node-id]";
const FILE_TREE_SELECTOR = ".sy__file";
const CLOUD_DOCUMENT_IFRAME = 'iframe:is([src*="/plugins/siyuan-cloud-document-suite/"], [data-src*="/plugins/siyuan-cloud-document-suite/"])';
const CLOUD_DOCUMENT_EDITOR_IFRAME = 'iframe:is([src*="/plugins/siyuan-cloud-document-suite/mm-editor.html"], [data-src*="/plugins/siyuan-cloud-document-suite/mm-editor.html"], [src*="/plugins/siyuan-cloud-document-suite/sheet-editor.html"], [data-src*="/plugins/siyuan-cloud-document-suite/sheet-editor.html"])';
const EMBED_STYLE = "width: 100%; border: 0; border-radius: 0; box-shadow: none; outline: 0; background: transparent; display: block;";
const EMBED_RESET_CSS = `
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_IFRAME}),
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_IFRAME}) > .iframe-content,
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_IFRAME}) > .iframe-content > ${CLOUD_DOCUMENT_IFRAME} {
  border: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  outline: 0 !important;
  background: transparent !important;
}
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_EDITOR_IFRAME}) {
  width: calc(100% + var(--cloud-document-inline-extra, 0px)) !important;
  max-width: none !important;
  margin-left: var(--cloud-document-inline-start, 0px) !important;
  margin-right: 0 !important;
  height: var(--cloud-document-editor-height, clamp(480px, calc(100vh - 200px), 720px)) !important;
  min-height: 480px !important;
  padding: 0 !important;
}
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_EDITOR_IFRAME}) > .iframe-content,
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_EDITOR_IFRAME}) > .iframe-content > ${CLOUD_DOCUMENT_EDITOR_IFRAME} {
  height: 100% !important;
  min-height: 0 !important;
  width: 100% !important;
  display: block !important;
}
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_IFRAME}) .protyle-action__drag,
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_IFRAME}) .protyle-action__drag::after,
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_IFRAME}) > .protyle-action__drag,
.protyle-wysiwyg [data-node-id].iframe:has(> .iframe-content > ${CLOUD_DOCUMENT_IFRAME}) > .protyle-action__drag::after {
  display: none !important;
  opacity: 0 !important;
  box-shadow: none !important;
  background: transparent !important;
}
`;

class DropImporterPlugin extends Plugin {
  private readonly api = new KernelClient();
  private readonly documents = new DocumentCreator(this.api);
  private readonly previews = new PreviewBuilders(PLUGIN_VERSION, MM_EDITOR_CACHE_VERSION);
  private dragDepth = 0;
  private overlay: HTMLDivElement | null = null;
  private toastTimer: number | null = null;
  private boundTrees = new Set<HTMLElement>();
  private treeObserver: MutationObserver | null = null;
  private treeObserverTimer: number | null = null;
  private menuPromotionTimers = new Set<number>();
  private embedResetStyle: HTMLStyleElement | null = null;
  private readonly embeds = new EmbedManager(
    EDITOR_SELECTOR,
    CLOUD_DOCUMENT_EDITOR_IFRAME,
    PLUGIN_VERSION,
    MM_EDITOR_CACHE_VERSION
  );
  // Kept only for the legacy wrapper below during the staged refactor.
  private readonly observedEmbedContents = new Set<HTMLElement>();
  private embedResizeObserver: ResizeObserver | null = null;
  private debug: Record<string, unknown> = {};

  public onload(): void {
    // Window capture runs before SiYuan's editor handlers, so the plugin can
    // reliably take ownership of external file drops.
    window.addEventListener("dragenter", this.onDragEnter, true);
    window.addEventListener("dragleave", this.onDragLeave, true);
    window.addEventListener("dragover", this.onDragOver, true);
    window.addEventListener("drop", this.onDrop, true);
    this.embedResetStyle = document.createElement("style");
    this.embedResetStyle.dataset.cloudDocumentSuite = "borderless-embeds";
    this.embedResetStyle.textContent = EMBED_RESET_CSS;
    (document.head || document.documentElement).append(this.embedResetStyle);
    this.embeds.start();
    this.eventBus.on("open-menu-doctree", this.onOpenDocTreeMenu);
    void this.recordDebug("onload");
    showMessage("云文档套件已启动", 3000, "info");
  }

  public onLayoutReady(): void {
    this.bindFileTrees();
    this.embeds.refresh();
    this.embeds.fit();
    this.treeObserver = new MutationObserver((records) => {
      if (this.embeds.affects(records)) {
        // MutationObserver callbacks run before the next paint. Fit the newly
        // inserted editor immediately so the 720px fallback is never visible.
        this.embeds.refresh();
        this.embeds.fit();
      }
      if (this.treeObserverTimer !== null) window.clearTimeout(this.treeObserverTimer);
      this.treeObserverTimer = window.setTimeout(() => {
        this.treeObserverTimer = null;
        this.bindFileTrees();
      }, 120);
    });
    this.treeObserver.observe(document.body, { childList: true, subtree: true });
    void this.recordDebug("layout-ready", { treeCount: this.boundTrees.size });
  }

  public onunload(): void {
    window.removeEventListener("dragenter", this.onDragEnter, true);
    window.removeEventListener("dragleave", this.onDragLeave, true);
    window.removeEventListener("dragover", this.onDragOver, true);
    window.removeEventListener("drop", this.onDrop, true);
    this.eventBus.off("open-menu-doctree", this.onOpenDocTreeMenu);
    this.embedResetStyle?.remove();
    this.embedResetStyle = null;
    this.embeds.stop();
    this.treeObserver?.disconnect();
    this.treeObserver = null;
    if (this.treeObserverTimer !== null) {
      window.clearTimeout(this.treeObserverTimer);
      this.treeObserverTimer = null;
    }
    for (const timer of this.menuPromotionTimers) window.clearTimeout(timer);
    this.menuPromotionTimers.clear();
    for (const tree of this.boundTrees) {
      tree.removeEventListener("dragenter", this.onTreeDragEnter, true);
      tree.removeEventListener("dragover", this.onTreeDragOver, true);
      tree.removeEventListener("drop", this.onTreeDrop, true);
    }
    this.boundTrees.clear();
    this.removeOverlay();

    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
      this.toastTimer = null;
    }
  }

  private readonly onOpenDocTreeMenu = (
    event: CustomEvent<DocTreeMenuDetail>
  ): void => {
    const { menu, type, items } = event.detail;
    if (items.length !== 1 || (type !== "doc" && type !== "notebook")) return;
    const target = items[0];
    menu.addItem({
      id: "cloud-document-create-menu",
      type: "submenu",
      icon: "iconAdd",
      label: "创建文件",
      submenu: [
        {
          id: "cloud-document-create-mindmap",
          icon: "iconGraph",
          label: "新建脑图（.mm）",
          click: async () => {
            await this.createNewMindMap(type, target.id);
          }
        },
        {
          id: "cloud-document-create-word",
          icon: "iconFile",
          label: "新建 Word 文档",
          click: async () => {
            await this.createNewWordDocument(type, target.id);
          }
        },
        {
          id: "cloud-document-create-excel",
          icon: "iconTable",
          label: "新建 Excel 工作簿",
          click: async () => {
            await this.createNewSpreadsheet(type, target.id);
          }
        }
      ]
    });
    menu.addItem({
      id: "cloud-document-suite-status",
      icon: "iconCloud",
      label: "云文档套件",
      click: () => {
        showMessage("云文档套件已启用，创建入口位于一级右键菜单。", 4000);
      }
    });
    this.scheduleCreateFileMenuPromotion();
  };

  private scheduleCreateFileMenuPromotion(): void {
    for (const delay of [0, 16, 50]) {
      const timer = window.setTimeout(() => {
        this.menuPromotionTimers.delete(timer);
        this.promoteCreateFileMenu();
      }, delay);
      this.menuPromotionTimers.add(timer);
    }
  }

  private promoteCreateFileMenu(): void {
    const createItem = document.querySelector<HTMLElement>(
      '.b3-menu [data-id="cloud-document-create-menu"]'
    );
    const rootMenu = createItem?.closest<HTMLElement>(".b3-menu");
    const rootItems = rootMenu?.querySelector<HTMLElement>(
      ":scope > .b3-menu__items"
    );
    if (!createItem || !rootItems || createItem.parentElement === rootItems) return;

    const replaceItem = rootItems.querySelector<HTMLElement>(
      ':scope > [data-id="replace"]'
    );
    const closeItem = rootItems.querySelector<HTMLElement>(
      ':scope > [data-id="close"]'
    );
    const separatorBeforeClose =
      closeItem?.previousElementSibling instanceof HTMLElement &&
      closeItem.previousElementSibling.classList.contains("b3-menu__separator")
        ? closeItem.previousElementSibling
        : null;
    if (replaceItem) rootItems.insertBefore(createItem, replaceItem.nextElementSibling);
    else if (separatorBeforeClose) rootItems.insertBefore(createItem, separatorBeforeClose);
    else rootItems.prepend(createItem);
  }

  private async createNewMindMap(
    type: "doc" | "notebook",
    targetId: string
  ): Promise<void> {
    this.showToast("正在创建脑图…");
    try {
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1" CLOUD_DIRECTION="1" CLOUD_VIEW_STYLE="hierarchy"><node ID="root" TEXT="中心主题" STYLE="bubble"/></map>`;
      const asset = await this.api.uploadAsset(
        new File([xml], buildUniqueUploadName("新建脑图.mm"), {
          type: "application/xml"
        })
      );
      // The kernel keeps assets after their document is deleted. Always upload
      // a fresh backing file, but keep the user-facing document title stable.
      asset.originalName = "新建脑图.mm";
      asset.documentMarkdown = this.previews.buildFreeMind(asset, xml);
      const notebook = await this.documents.resolveNotebookId(type, targetId);
      await this.documents.createRootDocuments(notebook, [asset]);
      this.showToast("脑图已创建");
      await this.recordDebug("mindmap-created", { type, targetId, asset });
    } catch (error) {
      console.error("[Drop Importer] Cannot create mind map", error);
      this.showToast("脑图创建失败，请查看诊断信息", true);
      await this.recordDebug("mindmap-create-failed", {
        type,
        targetId,
        reason: String(error)
      });
    }
  }

  private async createNewWordDocument(
    type: "doc" | "notebook",
    targetId: string
  ): Promise<void> {
    this.showToast("正在创建 Word 文档…");
    try {
      const notebook = await this.documents.resolveNotebookId(type, targetId);
      const path = await this.documents.findAvailableChildPath(
        notebook,
        "/",
        "新建 Word 文档"
      );
      await this.postJson<string>("/api/filetree/createDocWithMd", {
        notebook,
        path,
        markdown: ""
      });
      this.showToast("Word 文档已创建，可编辑后通过“导出 → Word .docx”导出");
      await this.recordDebug("word-document-created", { type, targetId, path });
    } catch (error) {
      console.error("[Drop Importer] Cannot create Word document", error);
      this.showToast("Word 文档创建失败，请查看诊断信息", true);
      await this.recordDebug("word-document-create-failed", {
        type,
        targetId,
        reason: String(error)
      });
    }
  }

  private async createNewSpreadsheet(
    type: "doc" | "notebook",
    targetId: string
  ): Promise<void> {
    this.showToast("正在创建 Excel 工作簿…");
    try {
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([[""]]),
        "Sheet1"
      );
      const content = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array"
      }) as ArrayBuffer;
      const asset = await this.api.uploadAsset(
        new File([content], buildUniqueUploadName("新建 Excel 工作簿.xlsx"), {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        })
      );
      asset.originalName = "新建 Excel 工作簿.xlsx";
      asset.documentMarkdown = this.previews.buildSpreadsheet(asset);
      const notebook = await this.documents.resolveNotebookId(type, targetId);
      await this.documents.createRootDocuments(notebook, [asset]);
      this.showToast("Excel 工作簿已创建");
      await this.recordDebug("spreadsheet-created", { type, targetId, asset });
    } catch (error) {
      console.error("[Drop Importer] Cannot create spreadsheet", error);
      this.showToast("Excel 工作簿创建失败，请查看诊断信息", true);
      await this.recordDebug("spreadsheet-create-failed", {
        type,
        targetId,
        reason: String(error)
      });
    }
  }

  private bindFileTrees(): void {
    for (const tree of this.boundTrees) {
      if (tree.isConnected) continue;
      tree.removeEventListener("dragenter", this.onTreeDragEnter, true);
      tree.removeEventListener("dragover", this.onTreeDragOver, true);
      tree.removeEventListener("drop", this.onTreeDrop, true);
      this.boundTrees.delete(tree);
    }
    let added = 0;
    for (const tree of document.querySelectorAll<HTMLElement>(FILE_TREE_SELECTOR)) {
      if (this.boundTrees.has(tree)) continue;
      tree.addEventListener("dragenter", this.onTreeDragEnter, true);
      tree.addEventListener("dragover", this.onTreeDragOver, true);
      tree.addEventListener("drop", this.onTreeDrop, true);
      this.boundTrees.add(tree);
      added += 1;
    }
    if (added > 0) {
      void this.recordDebug("tree-bound", { added, treeCount: this.boundTrees.size });
    }
  }

  private readonly onTreeDragEnter = (event: DragEvent): void => {
    if (!this.isFileDrag(event)) return;
    const target = this.findTreeDropTarget(event);
    void this.recordDebug("tree-dragenter", this.describeDrop(event, target));
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dragDepth = 1;
    this.showOverlay();
  };

  private readonly onTreeDragOver = (event: DragEvent): void => {
    if (!this.isFileDrag(event) || !this.findTreeDropTarget(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };

  private readonly onTreeDrop = (event: DragEvent): void => {
    if (!this.isFileDrag(event)) return;
    const target = this.findTreeDropTarget(event);
    const files = Array.from(event.dataTransfer?.files ?? []);
    void this.recordDebug("tree-drop", this.describeDrop(event, target, files));
    event.preventDefault();
    event.stopImmediatePropagation();
    this.dragDepth = 0;
    this.removeOverlay();
    if (!target) {
      this.showToast("没有识别到目标文档，请将鼠标放在文档名称上", true);
      return;
    }
    if (files.length === 0) {
      this.showToast("已收到拖放事件，但没有读取到文件", true);
      return;
    }
    void this.importFiles(files, target);
  };

  private readonly onDragEnter = (event: DragEvent): void => {
    if (!this.isFileDrag(event) || !this.isSupportedPoint(event)) {
      return;
    }

    this.dragDepth += 1;
    this.showOverlay();
  };

  private readonly onDragLeave = (event: DragEvent): void => {
    if (!this.isFileDrag(event)) {
      return;
    }

    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (this.dragDepth === 0) {
      this.removeOverlay();
    }
  };

  private readonly onDragOver = (event: DragEvent): void => {
    if (!this.isFileDrag(event) || !this.isSupportedPoint(event)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  };

  private readonly onDrop = (event: DragEvent): void => {
    this.dragDepth = 0;
    this.removeOverlay();

    if (!this.isFileDrag(event) || !this.isSupportedPoint(event)) {
      return;
    }

    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length === 0) {
      return;
    }

    const dropTarget = this.findDropTarget(event);
    if (!dropTarget) {
      this.showToast("请把文件放到内容块或文档树中的文档上", true);
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    void this.importFiles(files, dropTarget);
  };

  private async importFiles(files: File[], dropTarget: DropTarget): Promise<void> {
    await this.recordDebug("import-start", { fileNames: files.map((file) => file.name), dropTarget });
    this.showToast(`正在导入 0/${files.length} 个文件…`);
    const uploaded: UploadedAsset[] = [];

    for (const [index, file] of files.entries()) {
      this.showToast(`正在导入 ${index + 1}/${files.length}：${file.name}…`);
      try {
        const asset = await this.api.uploadAsset(file);
        try {
          if (isMarkdownFile(file.name)) {
            asset.documentMarkdown = await file.text();
          } else if (/\.xmd$/i.test(file.name)) {
            const content = await file.arrayBuffer();
            asset.documentMarkdown = isZipContent(content)
              ? await this.previews.buildXMind(asset, content)
              : new TextDecoder().decode(content);
          } else if (isPdfFile(file.name)) {
            asset.documentMarkdown = this.previews.buildPdf(asset);
          } else if (isSpreadsheetFile(file.name)) {
            asset.documentMarkdown = this.previews.buildSpreadsheet(asset);
          } else if (isWordFile(file.name)) {
            asset.documentMarkdown = await this.previews.buildWord(
              asset,
              await file.arrayBuffer()
            );
          } else if (isXMindFile(file.name)) {
            asset.documentMarkdown = await this.previews.buildXMind(
              asset,
              await file.arrayBuffer()
            );
          } else if (isFreeMindFile(file.name)) {
            asset.documentMarkdown = this.previews.buildFreeMind(
              asset,
              await file.text()
            );
          }
        } catch (previewError) {
          console.error("[Drop Importer] Preview generation failed", previewError);
          await this.recordDebug("preview-failed", {
            fileName: file.name,
            reason: String(previewError)
          });
        }
        uploaded.push(asset);
      } catch (error) {
        console.error("[Drop Importer] Asset upload failed", error);
        await this.recordDebug("import-file-failed", {
          fileName: file.name,
          reason: String(error)
        });
      }
    }

    if (uploaded.length === 0) {
      await this.recordDebug("import-failed", { reason: "no-assets-uploaded" });
      this.showToast("文件导入失败，请查看开发者控制台", true);
      return;
    }

    try {
      if (dropTarget.position === "create-child-documents") {
        await this.documents.createChildDocuments(dropTarget.id, uploaded);
      } else if (dropTarget.position === "create-root-documents") {
        await this.documents.createRootDocuments(dropTarget.id, uploaded);
      } else {
        await this.documents.insertAttachmentBlock(dropTarget, uploaded);
      }
    } catch (error) {
      console.error("[Drop Importer] Attachment insertion failed", error);
      this.showToast("文件已上传，但附件链接插入失败", true);
      await this.recordDebug("import-failed", { reason: String(error) });
      return;
    }

    const failedCount = files.length - uploaded.length;
    this.showToast(
      failedCount === 0
        ? `已导入 ${uploaded.length} 个文件`
        : `已导入 ${uploaded.length} 个文件，${failedCount} 个失败`,
      failedCount > 0
    );
    await this.recordDebug("import-complete", { uploaded, failedCount });
  }

  private async postJson<T>(endpoint: string, body: unknown): Promise<T> {
    return this.api.postJson<T>(endpoint, body);
  }

  private refreshCloudDocumentEmbeds(): void {
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(CLOUD_DOCUMENT_EDITOR_IFRAME)) {
      const rawSource = frame.getAttribute("src") || frame.getAttribute("data-src");
      if (!rawSource) continue;

      let url: URL;
      try {
        url = new URL(rawSource, window.location.href);
      } catch {
        continue;
      }
      if (!/\/plugins\/siyuan-cloud-document-suite\/(?:mm|sheet)-editor\.html$/i.test(url.pathname)) continue;
      const editorVersion = /\/mm-editor\.html$/i.test(url.pathname)
        ? MM_EDITOR_CACHE_VERSION
        : PLUGIN_VERSION;
      if (url.searchParams.get("v") === editorVersion) continue;

      url.searchParams.set("v", editorVersion);
      const refreshedSource = `${url.pathname}${url.search}${url.hash}`;
      frame.setAttribute("data-src", refreshedSource);
      frame.setAttribute("src", refreshedSource);
    }
  }

  private mutationsAffectCloudDocument(records: MutationRecord[]): boolean {
    return records.some((record) => {
      const target = record.target instanceof Element
        ? record.target
        : record.target.parentElement;
      if (target?.closest(".protyle")?.querySelector(CLOUD_DOCUMENT_EDITOR_IFRAME)) return true;

      return Array.from(record.addedNodes).some((node) =>
        node instanceof Element && (
          node.matches(CLOUD_DOCUMENT_EDITOR_IFRAME) ||
          node.querySelector(CLOUD_DOCUMENT_EDITOR_IFRAME)
        )
      );
    });
  }

  private fitCloudDocumentEmbeds(): void {
    for (const content of this.observedEmbedContents) {
      if (!content.isConnected) {
        this.embedResizeObserver?.unobserve(content);
        this.observedEmbedContents.delete(content);
      }
    }

    for (const frame of document.querySelectorAll<HTMLIFrameElement>(CLOUD_DOCUMENT_EDITOR_IFRAME)) {
      const block = frame.closest<HTMLElement>("[data-node-id].iframe");
      const editor = block?.closest<HTMLElement>(EDITOR_SELECTOR);
      const content = block?.closest<HTMLElement>(".protyle-content");
      if (!block || !editor || !content) continue;

      if (!this.observedEmbedContents.has(content)) {
        this.embedResizeObserver?.observe(content);
        this.observedEmbedContents.add(content);
      }

      const editorStyle = getComputedStyle(editor);
      const inlineStart = Number.parseFloat(editorStyle.paddingLeft) || 0;
      const inlineEnd = Number.parseFloat(editorStyle.paddingRight) || 0;
      const contentRect = content.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      const availableHeight = Math.max(480, Math.floor(contentRect.bottom - blockRect.top));

      block.style.setProperty("--cloud-document-inline-start", `${-inlineStart}px`);
      block.style.setProperty("--cloud-document-inline-extra", `${inlineStart + inlineEnd}px`);
      block.style.setProperty("--cloud-document-editor-height", `${availableHeight}px`);
    }
  }

  private async buildFreeMindPreviewMarkdown(
    asset: UploadedAsset,
    xml: string
  ): Promise<string> {
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    if (documentNode.querySelector("parsererror")) {
      throw new Error("Invalid FreeMind .mm XML");
    }
    const map = documentNode.documentElement;
    const root = Array.from(map.children).find(
      (child) => child.localName.toLowerCase() === "node"
    );
    if (!root) throw new Error("FreeMind root node not found");
    const editorUrl = `/plugins/siyuan-cloud-document-suite/mm-editor.html?v=${encodeURIComponent(MM_EDITOR_CACHE_VERSION)}&asset=${encodeURIComponent(`/${asset.assetPath}`)}`;
    return `<iframe src="${this.escapeHtmlAttribute(editorUrl)}" data-src="${this.escapeHtmlAttribute(editorUrl)}" style="${EMBED_STYLE} height: clamp(480px, calc(100vh - 200px), 720px); min-height: 480px;" frameborder="0"></iframe>`;
  }

  private async buildXMindPreviewMarkdown(
    asset: UploadedAsset,
    content: ArrayBuffer
  ): Promise<string> {
    if (content.byteLength > 100 * 1024 * 1024) {
      throw new Error("XMind file exceeds the 100 MB preview limit");
    }
    const zip = await JSZip.loadAsync(content);
    let outline = "";
    const jsonEntry = zip.file("content.json");
    if (jsonEntry) {
      outline = this.convertXMindJson(
        JSON.parse(await jsonEntry.async("string")) as unknown
      );
    } else {
      const xmlEntry = zip.file("content.xml");
      if (!xmlEntry) throw new Error("XMind content.json/content.xml not found");
      outline = this.convertXMindXml(await xmlEntry.async("string"));
    }
    const attachment = buildAttachmentMarkdown([asset]);
    return `${outline.trim() || "该 XMind 文件没有可显示的主题。"}\n\n---\n\n### 附件\n\n📎 ${attachment}`;
  }

  private convertXMindJson(value: unknown): string {
    const sheets = Array.isArray(value) ? value : [value];
    const sections: string[] = [];
    for (const rawSheet of sheets) {
      if (!rawSheet || typeof rawSheet !== "object") continue;
      const sheet = rawSheet as Record<string, unknown>;
      const title = typeof sheet.title === "string" ? sheet.title : "工作表";
      const root = sheet.rootTopic;
      if (!root || typeof root !== "object") continue;
      sections.push(`## ${this.escapeMarkdownHeading(title)}\n\n${this.xMindJsonTopic(root as Record<string, unknown>, 0)}`);
    }
    return sections.join("\n\n");
  }

  private xMindJsonTopic(topic: Record<string, unknown>, depth: number): string {
    const title = typeof topic.title === "string" ? topic.title : "未命名主题";
    const lines = [`${"  ".repeat(depth)}- ${this.escapeMarkdownLabel(title)}`];
    const children = topic.children;
    if (children && typeof children === "object") {
      const groups = Object.values(children as Record<string, unknown>);
      for (const group of groups) {
        if (!Array.isArray(group)) continue;
        for (const child of group) {
          if (child && typeof child === "object") {
            lines.push(this.xMindJsonTopic(child as Record<string, unknown>, depth + 1));
          }
        }
      }
    }
    return lines.join("\n");
  }

  private convertXMindXml(xml: string): string {
    const documentNode = new DOMParser().parseFromString(xml, "application/xml");
    if (documentNode.querySelector("parsererror")) {
      throw new Error("Invalid XMind content.xml");
    }
    const sections: string[] = [];
    const sheets = Array.from(documentNode.getElementsByTagName("sheet"));
    for (const sheet of sheets) {
      const sheetTitle = this.directChildText(sheet, "title") || "工作表";
      const root = Array.from(sheet.children).find(
        (child) => child.localName === "topic"
      );
      if (root) {
        sections.push(`## ${this.escapeMarkdownHeading(sheetTitle)}\n\n${this.xMindXmlTopic(root, 0)}`);
      }
    }
    return sections.join("\n\n");
  }

  private xMindXmlTopic(topic: Element, depth: number): string {
    const title = this.directChildText(topic, "title") || "未命名主题";
    const lines = [`${"  ".repeat(depth)}- ${this.escapeMarkdownLabel(title)}`];
    for (const child of Array.from(topic.getElementsByTagName("topic"))) {
      const nearestParentTopic = child.parentElement?.closest("topic");
      if (nearestParentTopic === topic) {
        lines.push(this.xMindXmlTopic(child, depth + 1));
      }
    }
    return lines.join("\n");
  }

  private directChildText(element: Element, localName: string): string {
    return Array.from(element.children).find(
      (child) => child.localName === localName
    )?.textContent?.trim() ?? "";
  }

  private async buildWordPreviewMarkdown(
    asset: UploadedAsset,
    content: ArrayBuffer
  ): Promise<string> {
    const result = await mammoth.convertToHtml(
      { arrayBuffer: content },
      {
        styleMap: [
          "p[style-name='Title'] => h1:fresh",
          "p[style-name='Subtitle'] => h2:fresh"
        ]
      }
    );
    const prepared = this.extractWordTables(result.value);
    const turndown = new TurndownService({
      headingStyle: "atx",
      bulletListMarker: "-",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
      strongDelimiter: "**"
    });
    turndown.use(gfm);
    let markdown = turndown
      .turndown(prepared.html)
      .replace(
        /<\/?(?:table|thead|tbody|tfoot|tr|th|td|p)(?:\s[^>]*)?>/gi,
        ""
      );
    prepared.tables.forEach((table, index) => {
      markdown = markdown.replace(`SIYUANWORDTABLE${index}END`, table);
    });
    markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();
    const attachment = buildAttachmentMarkdown([asset]);
    const warning = result.messages.length > 0
      ? `\n\n> Word 转换提示：${result.messages.length} 项复杂格式未完全还原，请通过附件查看原版。`
      : "";
    const preview = markdown || "该 Word 文档没有可显示的正文。";
    return `${preview}${warning}\n\n---\n\n### 附件\n\n📎 ${attachment}`;
  }

  private extractWordTables(html: string): { html: string; tables: string[] } {
    const documentNode = new DOMParser().parseFromString(html, "text/html");
    const tables: string[] = [];
    const tableElements = Array.from(documentNode.querySelectorAll("table"));

    for (const table of tableElements.reverse()) {
      if (!table.isConnected) continue;
      const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"))
        .map((row) =>
          Array.from(row.querySelectorAll(":scope > th, :scope > td")).map(
            (cell) => this.normalizeWordTableCell(cell.textContent ?? "")
          )
        )
        .filter((row) => row.length > 0);
      if (rows.length === 0) {
        table.remove();
        continue;
      }

      const columnCount = Math.max(...rows.map((row) => row.length));
      const normalizedRows = rows.map((row) =>
        Array.from({ length: columnCount }, (_, index) => row[index] ?? "")
      );
      const tableMarkdown =
        normalizedRows.length === 1 && columnCount === 1
          ? `> ${normalizedRows[0][0]}`
          : [
              `| ${normalizedRows[0].join(" | ")} |`,
              `| ${Array(columnCount).fill("---").join(" | ")} |`,
              ...normalizedRows
                .slice(1)
                .map((row) => `| ${row.join(" | ")} |`)
            ].join("\n");
      const index = tables.length;
      tables.push(tableMarkdown);
      table.replaceWith(documentNode.createTextNode(`SIYUANWORDTABLE${index}END`));
    }

    return { html: documentNode.body.innerHTML, tables };
  }

  private normalizeWordTableCell(value: string): string {
    return value
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\\/g, "\\\\")
      .replace(/\|/g, "\\|");
  }

  private buildSpreadsheetPreviewMarkdown(
    asset: UploadedAsset
  ): string {
    const editorUrl = `/plugins/siyuan-cloud-document-suite/sheet-editor.html?v=${encodeURIComponent(PLUGIN_VERSION)}&asset=${encodeURIComponent(`/${asset.assetPath}`)}`;
    return `<iframe src="${this.escapeHtmlAttribute(editorUrl)}" data-src="${this.escapeHtmlAttribute(editorUrl)}" style="${EMBED_STYLE} height: clamp(480px, calc(100vh - 200px), 720px); min-height: 480px;" frameborder="0"></iframe>`;
  }

  private escapeMarkdownHeading(value: string): string {
    return value.replace(/\r?\n/g, " ").replace(/#/g, "\\#");
  }

  private buildPdfPreviewMarkdown(asset: UploadedAsset): string {
    const attachment = buildAttachmentMarkdown([asset]);
    const source = `/${asset.assetPath}`;
    const escapedSource = this.escapeHtmlAttribute(source);
    return `<iframe src="${escapedSource}" data-src="${escapedSource}" style="${EMBED_STYLE} height: 78vh; min-height: 640px;" frameborder="0"></iframe>\n\n---\n\n### 附件\n\n📎 ${attachment}`;
  }

  private escapeHtmlAttribute(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  private isFileDrag(event: DragEvent): boolean {
    const transfer = event.dataTransfer;
    if (!transfer) {
      return false;
    }

    const types = Array.from(transfer.types ?? []).map((type) =>
      type.toLowerCase()
    );
    return (
      types.includes("files") ||
      Array.from(transfer.items ?? []).some((item) => item.kind === "file") ||
      transfer.files.length > 0
    );
  }

  private isSupportedPoint(event: DragEvent): boolean {
    return this.findDropTarget(event) !== null;
  }

  private findDropTarget(event: DragEvent): DropTarget | null {
    const pointedElement = document.elementFromPoint(event.clientX, event.clientY);
    const editor = pointedElement?.closest(EDITOR_SELECTOR);
    if (editor) {
      const block = pointedElement?.closest<HTMLElement>(BLOCK_SELECTOR);
      const id = block?.dataset.nodeId;
      return id ? { id, position: "after-block" } : null;
    }

    return this.findTreeDropTarget(event);
  }

  private findTreeDropTarget(event: DragEvent): DropTarget | null {
    const candidates = [
      ...document.elementsFromPoint(event.clientX, event.clientY),
      ...(event.target instanceof Element ? [event.target] : [])
    ];
    for (const candidate of candidates) {
      const treeItem =
        candidate.closest<HTMLElement>(TREE_DOCUMENT_SELECTOR) ??
        candidate.closest<HTMLElement>(
          ".b3-list-item[data-type='navigation-file']"
        );
      // In SiYuan's document tree, data-node-id can be placed on the
      // surrounding <li> rather than on the visible .b3-list-item row.
      const idElement = treeItem
        ? candidate.closest<HTMLElement>("[data-node-id]") ??
          treeItem.closest<HTMLElement>("[data-node-id]") ??
          treeItem.querySelector<HTMLElement>("[data-node-id]")
        : null;
      const id = idElement?.dataset.nodeId;
      if (id) {
        return { id, position: "create-child-documents" };
      }

      const notebookRoot = candidate.closest<HTMLElement>(
        ".b3-list-item[data-type='navigation-root']"
      );
      const notebook = notebookRoot
        ?.closest<HTMLElement>("ul[data-url]")
        ?.getAttribute("data-url");
      if (notebook) {
        return { id: notebook, position: "create-root-documents" };
      }
    }
    return null;
  }

  private describeDrop(event: DragEvent, target: DropTarget | null, files: File[] = []): Record<string, unknown> {
    const element = event.target instanceof HTMLElement ? event.target : null;
    return {
      target,
      fileNames: files.map((file) => file.name),
      transferTypes: Array.from(event.dataTransfer?.types ?? []),
      element: element ? { tag: element.tagName, className: element.className } : null
    };
  }

  private async recordDebug(stage: string, details: Record<string, unknown> = {}): Promise<void> {
    this.debug = { stage, time: new Date().toISOString(), ...details };
    try {
      await this.saveData("drop-debug.json", this.debug);
    } catch (error) {
      console.error("[Drop Importer] Cannot save diagnostics", error);
    }
  }

  private escapeMarkdownLabel(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  }

  private showOverlay(): void {
    if (this.overlay) {
      return;
    }

    const overlay = document.createElement("div");
    overlay.dataset.dropImporterOverlay = "true";
    overlay.textContent = "松开鼠标，将文件导入目标文档";
    Object.assign(overlay.style, {
      position: "fixed",
      inset: "12px",
      zIndex: "9999",
      display: "grid",
      placeItems: "center",
      pointerEvents: "none",
      border: "2px dashed var(--b3-theme-primary)",
      borderRadius: "12px",
      color: "var(--b3-theme-primary)",
      background: "color-mix(in srgb, var(--b3-theme-primary) 10%, transparent)",
      fontSize: "18px",
      fontWeight: "600"
    });
    document.body.appendChild(overlay);
    this.overlay = overlay;
  }

  private removeOverlay(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  private showToast(message: string, isError = false): void {
    document.querySelector("[data-drop-importer-toast]")?.remove();

    const toast = document.createElement("div");
    toast.dataset.dropImporterToast = "true";
    toast.textContent = message;
    Object.assign(toast.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      zIndex: "10000",
      maxWidth: "360px",
      padding: "10px 14px",
      borderRadius: "8px",
      color: "var(--b3-theme-on-surface)",
      background: isError
        ? "var(--b3-card-error-background, var(--b3-theme-error))"
        : "var(--b3-theme-surface)",
      boxShadow: "var(--b3-dialog-shadow)",
      fontSize: "14px"
    });
    document.body.appendChild(toast);

    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastTimer = window.setTimeout(() => {
      toast.remove();
      this.toastTimer = null;
    }, 3200);
  }
}

export = DropImporterPlugin;
