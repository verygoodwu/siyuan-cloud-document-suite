export function normalizePdfAsset(value, origin = "http://127.0.0.1") {
  if (!value) throw new Error("缺少 PDF 附件路径");
  if (String(value).includes("\\") || String(value).includes("\0")) {
    throw new Error("仅允许打开思源 assets 目录中的 PDF");
  }
  const url = new URL(value, origin);
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch { throw new Error("PDF 附件路径无法解码"); }
  const segments = pathname.split("/");
  if (url.origin !== new URL(origin).origin
    || !pathname.startsWith("/assets/")
    || pathname.includes("\\")
    || pathname.includes("\0")
    || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("仅允许打开思源 assets 目录中的 PDF");
  }
  return url.pathname;
}

export function pdfFileName(asset, requestedName = "") {
  const candidate = requestedName || (() => {
    try { return decodeURIComponent(String(asset).split("/").pop() || "文档.pdf"); }
    catch { return String(asset).split("/").pop() || "文档.pdf"; }
  })();
  const safe = candidate.replace(/[\\/:*?"<>|]/g, "-").trim() || "文档.pdf";
  return /\.pdf$/i.test(safe) ? safe : `${safe}.pdf`;
}

export function hasPdfHeader(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const limit = Math.min(source.length, 1024);
  for (let index = 0; index <= limit - 5; index += 1) {
    if (source[index] === 0x25
      && source[index + 1] === 0x50
      && source[index + 2] === 0x44
      && source[index + 3] === 0x46
      && source[index + 4] === 0x2d) return true;
  }
  return false;
}

export function formatFileSize(bytes) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}
