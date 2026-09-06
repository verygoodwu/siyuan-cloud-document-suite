import type { IMenu } from "siyuan";
import {
  CLOUD_DOCUMENT_ASSET_ATTR,
  CLOUD_DOCUMENT_KIND_ATTR,
  CLOUD_DOCUMENT_NAME_ATTR
} from "./document-creator";
import { KernelClient } from "./kernel-client";
import type { CloudDocumentKind } from "./types";

type ExportFormat =
  | "docx"
  | "document-pdf"
  | "mm"
  | "xlsx"
  | "svg"
  | "png"
  | "text"
  | "pdf"
  | "xmind";

interface MenuLike {
  addItem(item: IMenu): void;
}

export interface CloudDocumentExportInfo {
  kind: CloudDocumentKind;
  documentId?: string;
  assetPath?: string;
  originalName?: string;
}

interface WorkspaceInfo {
  workspaceDir?: string;
}

interface DocumentExportResponse {
  path?: string;
}

interface ElectronIpcRenderer {
  invoke<T = unknown>(channel: string, payload: unknown): Promise<T>;
  send(channel: string, payload: unknown): void;
}

interface ElectronModule {
  ipcRenderer?: ElectronIpcRenderer;
}

interface KramdownResponse {
  id?: string;
  kramdown?: string;
}

const KIND_VALUES = new Set<CloudDocumentKind>([
  "document",
  "mindmap",
  "spreadsheet",
  "whiteboard",
  "text",
  "pdf",
  "xmind"
]);

const FORMAT_LABELS: Record<ExportFormat, string> = {
  docx: "云文档：导出 Word .docx",
  "document-pdf": "云文档：导出 PDF",
  mm: "云文档：导出脑图 .mm",
  xlsx: "云文档：导出表格 .xlsx",
  svg: "云文档：导出白板 SVG",
  png: "云文档：导出白板 PNG",
  text: "云文档：下载原始文本文件",
  pdf: "云文档：下载原始 PDF",
  xmind: "云文档：下载原始 .xmind"
};
const ALL_EXPORT_FORMATS = Object.keys(FORMAT_LABELS) as ExportFormat[];

function decodeHtml(value: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = value;
  return textarea.value;
}

export function safeAssetPath(value?: string): string | undefined {
  if (!value) return undefined;
  const withoutOrigin = value.replace(/^https?:\/\/[^/]+/i, "");
  const normalized = decodeHtml(withoutOrigin).replace(/^\/+/, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(normalized).replace(/^\/+/, "");
  } catch {
    return undefined;
  }
  if (!decoded.startsWith("assets/") || decoded.split("/").includes("..")) return undefined;
  return decoded;
}

function assetUrl(path: string): string {
  return `/${path.split("/").map((part) => encodeURIComponent(part)).join("/")}`;
}

function assetFromEditor(markup: string, editor: "mm" | "sheet" | "whiteboard" | "text"): string | undefined {
  const expression = new RegExp(`${editor}-editor\\.html[^"'<>]*?(?:&|&amp;)asset=([^&"'<>\\s]+)`, "i");
  const match = markup.match(expression);
  return safeAssetPath(match?.[1]);
}

function attachmentByExtension(markup: string, extension: string): string | undefined {
  const expression = new RegExp(`(?:\\/)?assets\\/[^"'<>\\s()]+\\.${extension}(?:[?#][^"'<>\\s()]*)?`, "i");
  return safeAssetPath(markup.match(expression)?.[0]);
}

export function inferCloudDocumentExport(markup: string): CloudDocumentExportInfo | undefined {
  const mindmap = assetFromEditor(markup, "mm");
  if (mindmap) return { kind: "mindmap", assetPath: mindmap };
  const spreadsheet = assetFromEditor(markup, "sheet");
  if (spreadsheet) return { kind: "spreadsheet", assetPath: spreadsheet };
  const whiteboard = assetFromEditor(markup, "whiteboard");
  if (whiteboard) return { kind: "whiteboard", assetPath: whiteboard };
  const text = assetFromEditor(markup, "text");
  if (text) return { kind: "text", assetPath: text };
  const document = attachmentByExtension(markup, "docx");
  if (document) return { kind: "document", assetPath: document };
  const pdf = attachmentByExtension(markup, "pdf");
  if (pdf) return { kind: "pdf", assetPath: pdf };
  const xmind = attachmentByExtension(markup, "xmind");
  if (xmind) return { kind: "xmind", assetPath: xmind };
  return undefined;
}

export function exportFormatsForKind(kind: CloudDocumentKind): ExportFormat[] {
  if (kind === "document") return ["docx", "document-pdf"];
  if (kind === "mindmap") return ["mm"];
  if (kind === "spreadsheet") return ["xlsx"];
  if (kind === "whiteboard") return ["svg", "png"];
  if (kind === "text") return ["text"];
  if (kind === "pdf") return ["pdf"];
  if (kind === "xmind") return ["xmind"];
  return [];
}

export function textExportLabel(originalName?: string): string {
  const extension = originalName?.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase();
  if (!extension) return FORMAT_LABELS.text;
  const display = extension.length <= 5 ? extension.toUpperCase() : extension;
  return `云文档：导出 ${display} .${extension}`;
}

function electronIpcRenderer(): ElectronIpcRenderer | undefined {
  const runtimeRequire = (window as Window & {
    require?: (id: string) => ElectronModule;
  }).require;
  if (typeof runtimeRequire !== "function") return undefined;
  try {
    return runtimeRequire("electron")?.ipcRenderer;
  } catch {
    return undefined;
  }
}

export class DocumentExportMenu {
  private requestRevision = 0;
  private readonly timers = new Set<number>();

  constructor(
    private readonly api: KernelClient,
    private readonly pluginVersion: string,
    private readonly showToast: (message: string, error?: boolean) => void
  ) {}

  stop(): void {
    this.requestRevision += 1;
    for (const timer of this.timers) window.clearTimeout(timer);
    this.timers.clear();
  }

  async addForDocument(menu: MenuLike, documentId: string, documentTitle?: string): Promise<void> {
    const revision = ++this.requestRevision;
    let resolvedInfo: CloudDocumentExportInfo | undefined;
    const rootId = `cloud-document-export-menu-${revision}`;
    const ids = new Map<ExportFormat, string>();
    const submenu: IMenu[] = [];
    for (const format of ALL_EXPORT_FORMATS) {
      const id = `cloud-document-export-${format}-${revision}`;
      ids.set(format, id);
      submenu.push({
        id,
        icon: "iconUpload",
        label: FORMAT_LABELS[format],
        bind: (element) => { element.style.display = "none"; },
        click: () => {
          if (resolvedInfo) void this.runExport(resolvedInfo, format);
        }
      });
    }
    menu.addItem({
      id: rootId,
      icon: "iconUpload",
      label: "导出文件",
      type: "submenu",
      bind: (element) => { element.style.display = "none"; },
      submenu
    });

    const info = await this.resolveDocumentInfo(documentId, documentTitle);
    if (revision !== this.requestRevision) return;
    resolvedInfo = info;
    if (info) info.documentId = documentId;
    const formats = info ? exportFormatsForKind(info.kind) : [];
    if (info && !info.originalName && documentTitle) info.originalName = documentTitle;
    const rootItem = document.querySelector<HTMLElement>(`.b3-menu [data-id="${rootId}"]`);
    if (formats.length === 0) {
      rootItem?.remove();
      return;
    }
    for (const [format, id] of ids) {
      const item = document.querySelector<HTMLElement>(`.b3-menu [data-id="${id}"]`);
      if (!formats.includes(format)) item?.remove();
      else {
        item?.style.removeProperty("display");
        if (format === "text") {
          const label = item?.querySelector<HTMLElement>(".b3-menu__label");
          if (label) label.textContent = textExportLabel(info?.originalName);
        }
      }
    }
    rootItem?.style.removeProperty("display");
    this.schedulePromotion(rootId);
  }

  private async resolveDocumentInfo(
    documentId: string,
    documentTitle?: string
  ): Promise<CloudDocumentExportInfo | undefined> {
    try {
      const attrs = await this.api.postJson<Record<string, string>>("/api/attr/getBlockAttrs", { id: documentId });
      const kindValue = attrs?.[CLOUD_DOCUMENT_KIND_ATTR] as CloudDocumentKind | undefined;
      if (kindValue && KIND_VALUES.has(kindValue)) {
        return {
          kind: kindValue,
          assetPath: safeAssetPath(attrs[CLOUD_DOCUMENT_ASSET_ATTR]),
          originalName: attrs[CLOUD_DOCUMENT_NAME_ATTR]
        };
      }
    } catch (error) {
      console.warn("[Cloud Document Suite] Cannot read document export marker", error);
    }

    try {
      const response = await this.api.postJson<string | KramdownResponse>("/api/block/getBlockKramdown", { id: documentId });
      const markup = typeof response === "string" ? response : response?.kramdown || "";
      const inferred = inferCloudDocumentExport(markup);
      if (inferred) return inferred;
      if (documentTitle === "新建 Word 文档" || documentTitle === "新建文档") {
        return { kind: "document", originalName: documentTitle };
      }
      return undefined;
    } catch (error) {
      console.warn("[Cloud Document Suite] Cannot inspect legacy document export type", error);
      return undefined;
    }
  }

  private schedulePromotion(id: string): void {
    for (const delay of [0, 16, 50, 120]) {
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        const promoted = this.promoteBelowCreateFile(id);
        if (delay === 120 && !promoted) {
          console.info("[Cloud Document Suite] Native menu layout changed; export remains in the standard plugin submenu");
        }
      }, delay);
      this.timers.add(timer);
    }
  }

  private promoteBelowCreateFile(id: string): boolean {
    const exportItem = document.querySelector<HTMLElement>(`.b3-menu [data-id="${id}"]`);
    const rootMenu = exportItem?.closest<HTMLElement>(".b3-menu");
    const rootItems = rootMenu?.querySelector<HTMLElement>(":scope > .b3-menu__items");
    const createItem = rootItems?.querySelector<HTMLElement>(
      ':scope > [data-id="cloud-document-create-menu"]'
    );
    if (!exportItem || !rootItems || !createItem) return false;
    exportItem.classList.remove("b3-menu__item--group-first", "b3-menu__item--group-last");
    if (createItem.nextElementSibling !== exportItem) {
      rootItems.insertBefore(exportItem, createItem.nextElementSibling);
    }
    return true;
  }

  private async runExport(info: CloudDocumentExportInfo, format: ExportFormat): Promise<void> {
    try {
      if (format === "docx") {
        await this.exportDocumentDocx(info);
        return;
      }
      if (format === "document-pdf") {
        await this.exportDocumentPdf(info);
        return;
      }
      if (!info.assetPath) throw new Error("没有找到对应的插件附件");
      if (this.requestOpenEditorExport(info.assetPath, format)) return;
      if (format === "svg" || format === "png") {
        await this.exportClosedWhiteboard(info, format);
      } else {
        await this.downloadOriginalAsset(info, format);
      }
    } catch (error) {
      console.error("[Cloud Document Suite] Context export failed", error);
      this.showToast(`导出失败：${error instanceof Error ? error.message : String(error)}`, true);
    }
  }

  private async exportDocumentDocx(info: CloudDocumentExportInfo): Promise<void> {
    if (!info.documentId) throw new Error("没有找到对应的思源文档");
    this.showToast("正在生成 Word 文档…");
    const workspace = await this.api.postJson<WorkspaceInfo>("/api/system/getWorkspaceInfo", {});
    if (!workspace?.workspaceDir) throw new Error("无法读取思源工作区路径");
    const separator = workspace.workspaceDir.includes("\\") ? "\\" : "/";
    const savePath = `${workspace.workspaceDir.replace(/[\\/]+$/, "")}${separator}temp${separator}export`;
    const result = await this.api.postJson<DocumentExportResponse>("/api/export/exportDocx", {
      id: info.documentId,
      savePath,
      removeAssets: true,
      merge: false,
      mergeDocHeadingMode: "",
      mergeContentHeadingMode: ""
    });
    const fileName = result?.path?.split(/[\\/]/).pop();
    if (!fileName || !/\.docx$/i.test(fileName)) throw new Error("思源没有返回 Word 导出文件");
    const response = await fetch(`/export/${encodeURIComponent(fileName)}`);
    if (!response.ok) throw new Error(`读取 Word 导出文件失败（HTTP ${response.status}）`);
    this.downloadBlob(await response.blob(), this.exportFileName(info, ".docx"));
    void this.api.postJson("/api/file/removeFile", {
      path: `/temp/export/${fileName}`
    }).catch((error) => console.warn("[Cloud Document Suite] Cannot clean temporary Word export", error));
    this.showToast("已导出 .docx");
  }

  private async exportDocumentPdf(info: CloudDocumentExportInfo): Promise<void> {
    if (!info.documentId) throw new Error("没有找到对应的思源文档");
    const ipcRenderer = electronIpcRenderer();
    const previewUrl = new URL(
      `/plugins/siyuan-cloud-document-suite/document-print.html?v=${encodeURIComponent(this.pluginVersion)}`,
      location.origin
    );
    previewUrl.searchParams.set("id", info.documentId);
    previewUrl.searchParams.set("name", info.originalName || "云文档");

    if (!ipcRenderer) {
      const fallback = window.open(previewUrl.href, "_blank");
      if (!fallback) throw new Error("当前环境无法打开 PDF 预览窗口");
      fallback.opener = null;
      this.showToast("当前为浏览器环境，已打开打印预览；桌面端使用思源 PDF 导出面板");
      return;
    }

    const parentWindowId = await ipcRenderer.invoke<number>("siyuan-get", { cmd: "getContentsId" });
    if (!Number.isInteger(parentWindowId) || parentWindowId <= 0) {
      throw new Error("无法读取当前思源窗口标识");
    }
    previewUrl.searchParams.set("parentWindowId", String(parentWindowId));
    ipcRenderer.send("siyuan-export-newwindow", previewUrl.href);
    this.showToast("正在打开思源 PDF 导出预览…");
  }

  private requestOpenEditorExport(assetPath: string, format: ExportFormat): boolean {
    const normalized = `/${safeAssetPath(assetPath) || ""}`;
    for (const frame of document.querySelectorAll<HTMLIFrameElement>(
      'iframe[src*="/plugins/siyuan-cloud-document-suite/"], iframe[data-src*="/plugins/siyuan-cloud-document-suite/"]'
    )) {
      const raw = frame.getAttribute("src") || frame.getAttribute("data-src");
      if (!raw || !frame.contentWindow) continue;
      try {
        const url = new URL(raw, location.href);
        if (url.searchParams.get("asset") !== normalized) continue;
        frame.contentWindow.postMessage(
          { type: "siyuan-cloud-document-export", asset: normalized, format },
          location.origin
        );
        this.showToast("正在从当前编辑器导出…");
        return true;
      } catch {
        // Ignore unrelated or malformed iframe URLs.
      }
    }
    return false;
  }

  private async downloadOriginalAsset(info: CloudDocumentExportInfo, format: ExportFormat): Promise<void> {
    const path = safeAssetPath(info.assetPath);
    if (!path) throw new Error("附件路径无效");
    const response = await fetch(assetUrl(path));
    if (!response.ok) throw new Error(`读取附件失败（HTTP ${response.status}）`);
    const extension = format === "xmind"
      ? ".xmind"
      : format === "text"
        ? info.originalName?.match(/\.[^.\\/]+$/)?.[0] || ".txt"
        : `.${format}`;
    this.downloadBlob(await response.blob(), this.exportFileName(info, extension));
    this.showToast(`已导出 ${extension}`);
  }

  private async exportClosedWhiteboard(
    info: CloudDocumentExportInfo,
    format: "svg" | "png"
  ): Promise<void> {
    const path = safeAssetPath(info.assetPath);
    if (!path) throw new Error("白板附件路径无效");
    const response = await fetch(assetUrl(path));
    if (!response.ok) throw new Error(`读取白板失败（HTTP ${response.status}）`);
    const documentValue = await response.json() as unknown;
    const rendererUrl = `/plugins/siyuan-cloud-document-suite/whiteboard-renderer.js?v=${encodeURIComponent(this.pluginVersion)}`;
    const renderer = await import(/* webpackIgnore: true */ rendererUrl) as {
      buildWhiteboardSvg(value: unknown): string;
    };
    const svg = renderer.buildWhiteboardSvg(documentValue);
    const name = this.exportFileName(info, `.${format}`);
    if (format === "svg") {
      this.downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), name);
    } else {
      this.downloadBlob(await this.svgToPng(svg), name);
    }
    this.showToast(`已导出 .${format}`);
  }

  private async svgToPng(svg: string): Promise<Blob> {
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
    const viewBox = (parsed.getAttribute("viewBox") || "0 0 1 1").split(/\s+/).map(Number);
    const width = Math.max(1, Math.ceil(viewBox[2] || 1));
    const height = Math.max(1, Math.ceil(viewBox[3] || 1));
    const source = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const image = new Image();
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("浏览器无法渲染白板 SVG"));
        image.src = source;
      });
      const scale = Math.min(2, 8192 / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建 PNG 画布");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error("PNG 生成失败")),
        "image/png"
      ));
    } finally {
      URL.revokeObjectURL(source);
    }
  }

  private exportFileName(info: CloudDocumentExportInfo, extension: string): string {
    const candidate = (info.originalName || "云文档").replace(/[\\/:*?"<>|]/g, "-");
    const stem = candidate.replace(/(?:\.board\.json|\.[^.]+)$/i, "") || "云文档";
    return `${stem}${extension}`;
  }

  private downloadBlob(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
