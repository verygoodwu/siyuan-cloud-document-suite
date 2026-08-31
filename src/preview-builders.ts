import * as mammoth from "mammoth";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import JSZip from "jszip";
import { buildAttachmentMarkdown } from "./document-creator";
import type { UploadedAsset } from "./types";

const EMBED_STYLE = "width: 100%; border: 0; border-radius: 0; box-shadow: none; outline: 0; background: transparent; display: block;";
const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeLabel = (value: string) => value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
const escapeHeading = (value: string) => value.replace(/\r?\n/g, " ").replace(/#/g, "\\#");

export class PreviewBuilders {
  constructor(private readonly pluginVersion: string, private readonly mmVersion: string) {}

  buildFreeMind(asset: UploadedAsset, xml: string): string {
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    if (parsed.querySelector("parsererror")) throw new Error("Invalid FreeMind .mm XML");
    const root = Array.from(parsed.documentElement.children).find((child) => child.localName.toLowerCase() === "node");
    if (!root) throw new Error("FreeMind root node not found");
    const url = `/plugins/siyuan-cloud-document-suite/mm-editor.html?v=${encodeURIComponent(this.mmVersion)}&asset=${encodeURIComponent(`/${asset.assetPath}`)}`;
    return `<iframe src="${escapeHtml(url)}" data-src="${escapeHtml(url)}" style="${EMBED_STYLE} height: clamp(480px, calc(100vh - 200px), 720px); min-height: 480px;" frameborder="0"></iframe>`;
  }

  async buildXMind(asset: UploadedAsset, content: ArrayBuffer): Promise<string> {
    if (content.byteLength > 100 * 1024 * 1024) throw new Error("XMind file exceeds the 100 MB preview limit");
    const zip = await JSZip.loadAsync(content);
    let outline = "";
    const json = zip.file("content.json");
    if (json) outline = this.convertXMindJson(JSON.parse(await json.async("string")) as unknown);
    else {
      const xml = zip.file("content.xml");
      if (!xml) throw new Error("XMind content.json/content.xml not found");
      outline = this.convertXMindXml(await xml.async("string"));
    }
    return `${outline.trim() || "该 XMind 文件没有可显示的主题。"}\n\n---\n\n### 附件\n\n📎 ${buildAttachmentMarkdown([asset])}`;
  }

  async buildWord(asset: UploadedAsset, content: ArrayBuffer): Promise<string> {
    const result = await mammoth.convertToHtml({ arrayBuffer: content }, { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh"] });
    const prepared = this.extractWordTables(result.value);
    const turndown = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*", strongDelimiter: "**" });
    turndown.use(gfm);
    let markdown = turndown.turndown(prepared.html).replace(/<\/?(?:table|thead|tbody|tfoot|tr|th|td|p)(?:\s[^>]*)?>/gi, "");
    prepared.tables.forEach((table, index) => { markdown = markdown.replace(`SIYUANWORDTABLE${index}END`, table); });
    markdown = markdown.replace(/\n{3,}/g, "\n\n").trim();
    const warning = result.messages.length > 0 ? `\n\n> Word 转换提示：${result.messages.length} 项复杂格式未完全还原，请通过附件查看原版。` : "";
    return `${markdown || "该 Word 文档没有可显示的正文。"}${warning}\n\n---\n\n### 附件\n\n📎 ${buildAttachmentMarkdown([asset])}`;
  }

  buildSpreadsheet(asset: UploadedAsset): string {
    const url = `/plugins/siyuan-cloud-document-suite/sheet-editor.html?v=${encodeURIComponent(this.pluginVersion)}&asset=${encodeURIComponent(`/${asset.assetPath}`)}`;
    return `<iframe src="${escapeHtml(url)}" data-src="${escapeHtml(url)}" style="${EMBED_STYLE} height: clamp(480px, calc(100vh - 200px), 720px); min-height: 480px;" frameborder="0"></iframe>`;
  }

  buildPdf(asset: UploadedAsset): string {
    const source = escapeHtml(`/${asset.assetPath}`);
    return `<iframe src="${source}" data-src="${source}" style="${EMBED_STYLE} height: 78vh; min-height: 640px;" frameborder="0"></iframe>\n\n---\n\n### 附件\n\n📎 ${buildAttachmentMarkdown([asset])}`;
  }

  private convertXMindJson(value: unknown): string {
    const sections: string[] = [];
    for (const raw of Array.isArray(value) ? value : [value]) {
      if (!raw || typeof raw !== "object") continue;
      const sheet = raw as Record<string, unknown>;
      if (!sheet.rootTopic || typeof sheet.rootTopic !== "object") continue;
      sections.push(`## ${escapeHeading(typeof sheet.title === "string" ? sheet.title : "工作表")}\n\n${this.jsonTopic(sheet.rootTopic as Record<string, unknown>, 0)}`);
    }
    return sections.join("\n\n");
  }

  private jsonTopic(topic: Record<string, unknown>, depth: number): string {
    const lines = [`${"  ".repeat(depth)}- ${escapeLabel(typeof topic.title === "string" ? topic.title : "未命名主题")}`];
    if (topic.children && typeof topic.children === "object") for (const group of Object.values(topic.children as Record<string, unknown>)) if (Array.isArray(group)) for (const child of group) if (child && typeof child === "object") lines.push(this.jsonTopic(child as Record<string, unknown>, depth + 1));
    return lines.join("\n");
  }

  private convertXMindXml(xml: string): string {
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    if (parsed.querySelector("parsererror")) throw new Error("Invalid XMind content.xml");
    return Array.from(parsed.getElementsByTagName("sheet")).map((sheet) => {
      const root = Array.from(sheet.children).find((child) => child.localName === "topic");
      return root ? `## ${escapeHeading(this.childText(sheet, "title") || "工作表")}\n\n${this.xmlTopic(root, 0)}` : "";
    }).filter(Boolean).join("\n\n");
  }

  private xmlTopic(topic: Element, depth: number): string {
    const lines = [`${"  ".repeat(depth)}- ${escapeLabel(this.childText(topic, "title") || "未命名主题")}`];
    for (const child of Array.from(topic.getElementsByTagName("topic"))) if (child.parentElement?.closest("topic") === topic) lines.push(this.xmlTopic(child, depth + 1));
    return lines.join("\n");
  }

  private childText(element: Element, localName: string): string {
    return Array.from(element.children).find((child) => child.localName === localName)?.textContent?.trim() ?? "";
  }

  private extractWordTables(html: string): { html: string; tables: string[] } {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const tables: string[] = [];
    for (const table of Array.from(parsed.querySelectorAll("table")).reverse()) {
      if (!table.isConnected) continue;
      const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr")).map((row) => Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) => cell.textContent?.replace(/\s+/g, " ").trim().replace(/\\/g, "\\\\").replace(/\|/g, "\\|") || "")).filter((row) => row.length);
      if (!rows.length) { table.remove(); continue; }
      const count = Math.max(...rows.map((row) => row.length));
      const normalized = rows.map((row) => Array.from({ length: count }, (_, i) => row[i] || ""));
      const markdown = normalized.length === 1 && count === 1 ? `> ${normalized[0][0]}` : [`| ${normalized[0].join(" | ")} |`, `| ${Array(count).fill("---").join(" | ")} |`, ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`)].join("\n");
      const index = tables.length; tables.push(markdown); table.replaceWith(parsed.createTextNode(`SIYUANWORDTABLE${index}END`));
    }
    return { html: parsed.body.innerHTML, tables };
  }
}
