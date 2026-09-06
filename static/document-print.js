const params = new URLSearchParams(location.search);
const documentId = params.get("id") || "";
const requestedName = params.get("name") || "云文档";
const parentWindowId = Number(params.get("parentWindowId"));

const previewPage = document.querySelector("#preview-page");
const previewElement = document.querySelector("#preview");
const statusElement = document.querySelector("#status");
const confirmButton = document.querySelector("#confirm");
const cancelButton = document.querySelector("#cancel");
const pageSizeElement = document.querySelector("#page-size");
const marginTypeElement = document.querySelector("#margin-type");
const marginTopElement = document.querySelector("#margin-top");
const marginRightElement = document.querySelector("#margin-right");
const marginBottomElement = document.querySelector("#margin-bottom");
const marginLeftElement = document.querySelector("#margin-left");
const customMarginsElement = document.querySelector("#custom-margins");
const scaleElement = document.querySelector("#scale");
const scaleValueElement = document.querySelector("#scale-value");
const landscapeElement = document.querySelector("#landscape");
const embedAssetsElement = document.querySelector("#embed-assets");
const keepFoldElement = document.querySelector("#keep-fold");
const addTitleElement = document.querySelector("#add-title");
const customTitleElement = document.querySelector("#custom-title");
const customTitlePanelElement = document.querySelector("#custom-title-panel");
const mergeSubdocsElement = document.querySelector("#merge-subdocs");
const watermarkElement = document.querySelector("#watermark");
const pagedElement = document.querySelector("#paged");

const PAGE_SIZES = {
  A3: { width: 11.7, height: 16.54 },
  A4: { width: 8.27, height: 11.7 },
  A5: { width: 5.83, height: 8.27 },
  Letter: { width: 8.5, height: 11 },
  Legal: { width: 8.5, height: 14 },
  Tabloid: { width: 11, height: 17 }
};

let rootTitle = requestedName;
let refreshTimer;
let titleComposing = false;

function ipcRenderer() {
  try {
    if (typeof window.require === "function") return window.require("electron")?.ipcRenderer;
    if (typeof require === "function") return require("electron")?.ipcRenderer;
  } catch (error) {
    console.warn("[Cloud Document Suite] Electron PDF bridge unavailable", error);
  }
  return undefined;
}

function setStatus(message, error = false) {
  statusElement.textContent = message;
  statusElement.classList.toggle("error", error);
}

function closeWindow() {
  const ipc = ipcRenderer();
  if (ipc && Number.isInteger(parentWindowId) && parentWindowId > 0) ipc.send("siyuan-cmd", "destroy");
  else window.close();
}

function marginValues() {
  return {
    top: Number.parseFloat(marginTopElement.value) || 0,
    right: Number.parseFloat(marginRightElement.value) || 0,
    bottom: Number.parseFloat(marginBottomElement.value) || 0,
    left: Number.parseFloat(marginLeftElement.value) || 0
  };
}

function setPresetMargins() {
  const landscape = landscapeElement.checked;
  const presets = {
    default: landscape ? [0.42, 0.42, 0.42, 0.42] : [1, 0.54, 1, 0.54],
    none: [0, 0, 0, 0],
    printableArea: landscape ? [0.07, 0.07, 0.07, 0.07] : [0.58, 0.1, 0.58, 0.1]
  };
  const values = presets[marginTypeElement.value];
  if (values) {
    [marginTopElement.value, marginRightElement.value, marginBottomElement.value, marginLeftElement.value] = values.map(String);
  }
}

function applyPageLayout() {
  const page = PAGE_SIZES[pageSizeElement.value] || PAGE_SIZES.A4;
  const landscape = landscapeElement.checked;
  const width = (landscape ? page.height : page.width) * 96;
  const height = (landscape ? page.width : page.height) * 96;
  const margins = marginValues();
  previewPage.style.width = `${width}px`;
  previewPage.style.minHeight = `${height}px`;
  previewPage.style.padding = `${margins.top}in ${margins.right}in ${margins.bottom}in ${margins.left}in`;
  previewPage.style.zoom = scaleElement.value;
  scaleValueElement.textContent = String(Number(scaleElement.value));
}

function renderEnhancements() {
  const protyle = window.Protyle;
  if (!protyle) return;
  try {
    protyle.highlightRender?.(previewElement, "/stage/protyle");
    protyle.mathRender?.(previewElement, "/stage/protyle", true);
    protyle.mermaidRender?.(previewElement, "/stage/protyle");
    protyle.flowchartRender?.(previewElement, "/stage/protyle");
    protyle.graphvizRender?.(previewElement, "/stage/protyle");
    protyle.chartRender?.(previewElement, "/stage/protyle");
    protyle.mindmapRender?.(previewElement, "/stage/protyle");
    protyle.abcRender?.(previewElement, "/stage/protyle");
    protyle.htmlRender?.(previewElement);
  } catch (error) {
    console.warn("[Cloud Document Suite] Optional PDF preview rendering failed", error);
  }
}

async function requestPreview() {
  if (!/^\d{14}-[a-z0-9]{7}$/.test(documentId)) throw new Error("文档 ID 无效");
  setStatus("正在生成预览…");
  confirmButton.disabled = true;
  const response = await fetch("/api/export/exportPreviewHTML", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: documentId,
      keepFold: keepFoldElement.checked,
      addTitle: addTitleElement.checked,
      customTitle: customTitleElement.value,
      merge: mergeSubdocsElement.checked,
      mergeDocHeadingMode: "flat",
      mergeContentHeadingMode: "preserve"
    })
  });
  if (!response.ok) throw new Error(`思源接口返回 HTTP ${response.status}`);
  const result = await response.json();
  if (result.code !== 0) throw new Error(result.msg || "思源无法生成 PDF 预览");
  rootTitle = (result.data?.name || requestedName).replace(/\.docx$/i, "") || "云文档";
  document.title = `${rootTitle} - 导出 PDF`;
  previewElement.innerHTML = result.data?.content || "";
  if (result.data?.type) previewElement.dataset.docType = result.data.type;
  for (const [key, value] of Object.entries(result.data?.attrs || {})) previewElement.setAttribute(key, String(value));
  renderEnhancements();
  applyPageLayout();
  confirmButton.disabled = false;
  setStatus(Number.isInteger(parentWindowId) && parentWindowId > 0 ? "预览已就绪" : "浏览器模式：确定后打开打印窗口");
}

function schedulePreview() {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => void requestPreview().catch(fail), 260);
}

function waitForImages() {
  return Promise.all(Array.from(previewElement.querySelectorAll("img")).map((image) => {
    image.loading = "eager";
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        window.clearTimeout(timeout);
        image.removeEventListener("load", finish);
        image.removeEventListener("error", finish);
        resolve();
      };
      const timeout = window.setTimeout(finish, 30000);
      image.addEventListener("load", finish, { once: true });
      image.addEventListener("error", finish, { once: true });
    });
  }));
}

function unpagedPageSize() {
  if (pagedElement.checked) return undefined;
  const page = PAGE_SIZES[pageSizeElement.value] || PAGE_SIZES.A4;
  const margins = marginValues();
  const contentHeight = Math.max(previewPage.scrollHeight / 96 - margins.top - margins.bottom, page.height);
  return landscapeElement.checked
    ? { width: contentHeight, height: page.width }
    : { width: page.width, height: contentHeight };
}

async function exportPdf() {
  const ipc = ipcRenderer();
  if (!ipc || !Number.isInteger(parentWindowId) || parentWindowId <= 0) {
    window.print();
    return;
  }
  confirmButton.disabled = true;
  const result = await ipc.invoke("siyuan-get", {
    cmd: "showOpenDialog",
    title: "导出 PDF",
    properties: ["createDirectory", "openDirectory"]
  });
  if (result?.canceled || !result?.filePaths?.length) {
    confirmButton.disabled = false;
    return;
  }
  setStatus("正在导出 PDF…");
  await Promise.all([waitForImages(), document.fonts?.ready || Promise.resolve()]);
  const pageSize = pageSizeElement.value;
  const margins = marginValues();
  const customPageSize = unpagedPageSize();
  document.body.classList.add("exporting");
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  ipc.send("siyuan-export-pdf", {
    title: "导出 PDF",
    pdfOptions: {
      printBackground: true,
      landscape: landscapeElement.checked,
      marginType: marginTypeElement.value,
      margins,
      scale: Number.parseFloat(scaleElement.value),
      pageSize: customPageSize || pageSize
    },
    pageSize,
    keepFold: keepFoldElement.checked,
    addTitle: addTitleElement.checked,
    customTitle: customTitleElement.value,
    mergeSubdocs: mergeSubdocsElement.checked,
    mergeDocHeadingMode: "flat",
    mergeContentHeadingMode: "preserve",
    watermark: watermarkElement.checked,
    removeAssets: embedAssetsElement.checked,
    paged: pagedElement.checked,
    rootId: documentId,
    rootTitle,
    parentWindowId,
    filePaths: result.filePaths
  });
}

function fail(error) {
  console.error("[Cloud Document Suite] PDF preview failed", error);
  setStatus(`PDF 预览失败：${error instanceof Error ? error.message : String(error)}`, true);
  confirmButton.disabled = true;
}

pageSizeElement.addEventListener("change", applyPageLayout);
scaleElement.addEventListener("input", applyPageLayout);
marginTypeElement.addEventListener("change", () => {
  customMarginsElement.classList.toggle("hidden", marginTypeElement.value !== "custom");
  setPresetMargins();
  applyPageLayout();
});
for (const element of [marginTopElement, marginRightElement, marginBottomElement, marginLeftElement]) element.addEventListener("input", applyPageLayout);
landscapeElement.addEventListener("change", () => {
  setPresetMargins();
  applyPageLayout();
});
keepFoldElement.addEventListener("change", schedulePreview);
mergeSubdocsElement.addEventListener("change", schedulePreview);
addTitleElement.addEventListener("change", () => {
  customTitlePanelElement.classList.toggle("hidden", !addTitleElement.checked);
  schedulePreview();
});
customTitleElement.addEventListener("compositionstart", () => {
  titleComposing = true;
  window.clearTimeout(refreshTimer);
});
customTitleElement.addEventListener("compositionend", () => {
  titleComposing = false;
  schedulePreview();
});
customTitleElement.addEventListener("input", () => {
  if (!titleComposing) schedulePreview();
});
cancelButton.addEventListener("click", closeWindow);
confirmButton.addEventListener("click", () => void exportPdf().catch(fail));
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    event.preventDefault();
    closeWindow();
  }
});

setPresetMargins();
applyPageLayout();
void requestPreview().catch(fail);
