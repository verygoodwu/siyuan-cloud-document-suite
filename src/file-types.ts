export function isMarkdownFile(fileName: string): boolean {
  return /\.(?:md|markdown)$/i.test(fileName);
}

export function isPdfFile(fileName: string): boolean {
  return /\.pdf$/i.test(fileName);
}

export function isSpreadsheetFile(fileName: string): boolean {
  return /\.xlsx$/i.test(fileName);
}

export function isWordFile(fileName: string): boolean {
  return /\.docx$/i.test(fileName);
}

export function isXMindFile(fileName: string): boolean {
  return /\.xmind$/i.test(fileName);
}

export function isFreeMindFile(fileName: string): boolean {
  return /\.mm$/i.test(fileName);
}

export function isZipContent(content: ArrayBuffer): boolean {
  const bytes = new Uint8Array(content, 0, Math.min(4, content.byteLength));
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export function buildUniqueUploadName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  const stem = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  const extension = dotIndex > 0 ? fileName.slice(dotIndex) : "";
  const random = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 8)
    ?? Math.random().toString(36).slice(2, 10);
  return `${stem}-${Date.now()}-${random}${extension}`;
}
