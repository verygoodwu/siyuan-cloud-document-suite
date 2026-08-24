import MindElixir from "./MindElixir.js";

const params = new URLSearchParams(location.search);
const asset = params.get("asset");
const status = document.querySelector("#status");
const exportButton = document.querySelector("#export");
const storageKey = `siyuan-mm-editor:${asset}`;
let saveTimer;

function setStatus(text) {
  status.textContent = text;
}

function makeId(element) {
  return element.getAttribute("ID") || `mm-${crypto.randomUUID()}`;
}

function nodeText(element) {
  return element.getAttribute("TEXT")?.trim() ||
    element.querySelector(":scope > richcontent[type='NODE']")?.textContent?.trim() ||
    "未命名主题";
}

function convertNode(element, inheritedDirection = 1, root = false) {
  const position = element.getAttribute("POSITION")?.toLowerCase();
  const direction = position === "left" ? 0 : position === "right" ? 1 : inheritedDirection;
  const children = Array.from(element.children)
    .filter((child) => child.localName.toLowerCase() === "node")
    .map((child) => convertNode(child, direction));
  return {
    id: makeId(element),
    topic: nodeText(element),
    root,
    direction: root ? undefined : direction,
    expanded: element.getAttribute("FOLDED")?.toLowerCase() !== "true",
    children,
    style: root
      ? { background: "#3f73f1", color: "#ffffff", fontWeight: "700" }
      : undefined
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportNode(node, root = false) {
  const attributes = [
    `ID="${escapeXml(node.id)}"`,
    `TEXT="${escapeXml(node.topic || "未命名主题")}"`
  ];
  if (!root) attributes.push(`POSITION="${node.direction === 0 ? "left" : "right"}"`);
  if (node.expanded === false) attributes.push('FOLDED="true"');
  const children = (node.children || []).map((child) => exportNode(child)).join("");
  return children.length
    ? `<node ${attributes.join(" ")}>${children}</node>`
    : `<node ${attributes.join(" ")}/>`;
}

function downloadMm(mind) {
  const data = mind.getData();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<map version="1.0.1">${exportNode(data.nodeData, true)}</map>`;
  const blobUrl = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `${data.nodeData.topic || "脑图"}.mm`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  setStatus("已导出 .mm");
}

async function loadInitialData() {
  const saved = localStorage.getItem(storageKey);
  if (saved) return JSON.parse(saved);
  if (!asset) throw new Error("缺少 .mm 附件路径");
  const response = await fetch(asset);
  if (!response.ok) throw new Error(`读取 .mm 失败：HTTP ${response.status}`);
  const xml = new DOMParser().parseFromString(await response.text(), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error(".mm XML 格式无效");
  const root = Array.from(xml.documentElement.children)
    .find((child) => child.localName.toLowerCase() === "node");
  if (!root) throw new Error("未找到脑图根节点");
  return { nodeData: convertNode(root, 1, true), direction: 2 };
}

try {
  const data = await loadInitialData();
  const mind = new MindElixir({
    el: "#map",
    direction: 2,
    editable: true,
    contextMenu: true,
    toolBar: true,
    keypress: true,
    allowUndo: true,
    compact: false
  });
  await mind.init(data);
  const fitMap = () => {
    mind.scaleFit();
    mind.toCenter();
  };
  requestAnimationFrame(() => requestAnimationFrame(fitMap));
  setTimeout(fitMap, 300);
  mind.bus.addListener("operation", () => {
    clearTimeout(saveTimer);
    setStatus("正在保存…");
    saveTimer = setTimeout(() => {
      localStorage.setItem(storageKey, JSON.stringify(mind.getData()));
      setStatus(`已自动保存 ${new Date().toLocaleTimeString()}`);
    }, 350);
  });
  exportButton.addEventListener("click", () => downloadMm(mind));
  setStatus("可编辑 · 自动保存");
} catch (error) {
  console.error(error);
  setStatus(error instanceof Error ? error.message : String(error));
}
