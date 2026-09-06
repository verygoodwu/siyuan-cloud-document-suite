import { formatFileSize, hasPdfHeader, normalizePdfAsset, pdfFileName } from "./pdf-reader-core.js?v=__PLUGIN_VERSION__-pdf2";
import { createEditorSession, createOperationNotice } from "./editor-session.js?v=__PLUGIN_VERSION__-pdf2";

const params = new URLSearchParams(location.search);
const requestedAsset = params.get("asset") || "";
const requestedName = params.get("name") || "";
const viewer = document.querySelector("#viewer");
const loading = document.querySelector("#loading");
const errorPanel = document.querySelector("#error-panel");
const status = document.querySelector("#status");
const fileInfo = document.querySelector("#file-info");
let asset = "";
let fileName = "文档.pdf";
let loadRevision = 0;
let currentPage = 1;
const viewSession = createEditorSession("pdf", requestedAsset);
const notice = createOperationNotice();
const pageInput = document.querySelector("#page-number");
const fullscreenButton = document.querySelector("#fullscreen");

function setStatus(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
}

function setError(error) {
  loading.hidden = true;
  errorPanel.hidden = false;
  viewer.removeAttribute("src");
  const message = error instanceof Error ? error.message : String(error);
  document.querySelector("#error-message").textContent = message;
  setStatus(`打开失败：${message}`, "error");
}

function openOriginal() {
  if (!asset) return;
  window.open(asset, "_blank", "noopener,noreferrer");
}

function downloadOriginal() {
  if (!asset) return;
  const link = document.createElement("a");
  link.href = asset;
  link.download = fileName;
  link.click();
  notice.show(`已下载 ${fileName}`);
}

function viewerSource() {
  return `${asset}?cloudPdfView=${Date.now()}#page=${currentPage}`;
}

function goToPage() {
  const requested = Math.max(1, Number.parseInt(pageInput.value, 10) || 1);
  currentPage = requested;
  pageInput.value = String(currentPage);
  viewSession.write({ page: currentPage });
  viewer.src = viewerSource();
  document.querySelector("#page-state").textContent = `请求页码 ${currentPage}`;
  viewer.focus();
}

async function inspectPdf(revision) {
  const response = await fetch(`${asset}?cloudPdfCheck=${Date.now()}`, {
    cache: "no-store",
    credentials: "include",
    headers: { Range: "bytes=0-1023" }
  });
  if (!response.ok) throw new Error(response.status === 404 ? "原始 PDF 已被删除" : `读取 PDF 失败（HTTP ${response.status}）`);
  const declaredLength = Number(response.headers.get("content-range")?.split("/").pop() || response.headers.get("content-length") || 0);
  const reader = response.body?.getReader();
  let firstChunk = new Uint8Array();
  if (reader) {
    const first = await reader.read();
    firstChunk = first.value || new Uint8Array();
    await reader.cancel();
  } else {
    firstChunk = new Uint8Array(await response.arrayBuffer());
  }
  if (!hasPdfHeader(firstChunk)) throw new Error("文件内容不是有效的 PDF，原件可能已损坏");
  if (revision !== loadRevision) return;
  fileInfo.textContent = declaredLength > 0 ? `原始附件 · ${formatFileSize(declaredLength)}` : "原始附件 · 大小未知";
}

async function loadPdf() {
  const revision = ++loadRevision;
  try {
    asset = normalizePdfAsset(requestedAsset, location.origin);
    fileName = pdfFileName(asset, requestedName);
    currentPage = Math.max(1, Number.parseInt(viewSession.read().page, 10) || 1);
    pageInput.value = String(currentPage);
    document.querySelector("#file-name").textContent = fileName;
    loading.hidden = false;
    errorPanel.hidden = true;
    setStatus("正在检查原文件…", "working");
    await inspectPdf(revision);
    if (revision !== loadRevision) return;
    viewer.src = viewerSource();
    document.querySelector("#page-state").textContent = `请求页码 ${currentPage}`;
    setStatus("PDF 已就绪", "ready");
    loading.hidden = true;
  } catch (error) {
    if (revision === loadRevision) setError(error);
  }
}

document.querySelector("#reload").addEventListener("click", () => void loadPdf());
document.querySelector("#retry").addEventListener("click", () => void loadPdf());
for (const id of ["#open", "#error-open"]) document.querySelector(id).addEventListener("click", openOriginal);
for (const id of ["#download", "#error-download"]) document.querySelector(id).addEventListener("click", downloadOriginal);
document.querySelector("#print").addEventListener("click", () => {
  try { viewer.contentWindow?.focus(); viewer.contentWindow?.print(); }
  catch { openOriginal(); }
});
document.querySelector("#page-go").addEventListener("click", goToPage);
pageInput.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); goToPage(); } });
fullscreenButton.addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch (error) { setStatus(`无法进入全屏：${error instanceof Error ? error.message : String(error)}`, "error"); }
});
document.addEventListener("fullscreenchange", () => {
  const active = Boolean(document.fullscreenElement);
  fullscreenButton.textContent = active ? "退出全屏" : "全屏";
  fullscreenButton.setAttribute("aria-pressed", String(active));
  fullscreenButton.title = active ? "退出全屏" : "全屏查看";
});
window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  if (key === "s") { event.preventDefault(); downloadOriginal(); }
  else if (key === "f") { viewer.focus(); }
});
window.addEventListener("pagehide", () => viewSession.write({ page: currentPage }));
window.addEventListener("message", (event) => {
  if (event.origin !== location.origin) return;
  if (event.data?.type === "siyuan-cloud-document-export" && event.data?.format === "pdf") downloadOriginal();
});

void loadPdf();
