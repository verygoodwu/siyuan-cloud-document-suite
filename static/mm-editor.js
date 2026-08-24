import MindElixir from "./MindElixir.js";

const params = new URLSearchParams(location.search);
const asset = params.get("asset");
const status = document.querySelector("#status");
const exportButton = document.querySelector("#export");
const nodeTools = document.querySelector("#node-tools");
const storageKey = `siyuan-mm-editor:${asset}`;
let saveTimer;
let nativeAddChild;

const zhCnMenu = {
  addChild: "添加子节点",
  addParent: "插入父节点",
  addSibling: "添加同级节点",
  removeNode: "删除节点",
  focus: "聚焦此分支",
  cancelFocus: "退出聚焦模式",
  moveUp: "向上移动",
  moveDown: "向下移动",
  link: "添加连接",
  linkBidirectional: "添加双向连接",
  clickTips: "请点击目标节点",
  summary: "添加概要"
};

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

function directChild(element, name) {
  return Array.from(element.children)
    .find((child) => child.localName.toLowerCase() === name);
}

function readNodeStyle(element) {
  const font = directChild(element, "font");
  const style = {};
  const color = element.getAttribute("COLOR");
  const background = element.getAttribute("BACKGROUND_COLOR");
  if (color) style.color = color;
  if (background) style.background = background;
  if (font?.getAttribute("BOLD")?.toLowerCase() === "true") style.fontWeight = "700";
  if (font?.getAttribute("ITALIC")?.toLowerCase() === "true") style.fontStyle = "italic";
  if (element.getAttribute("CLOUD_UNDERLINE")?.toLowerCase() === "true") {
    style.textDecoration = "underline";
  }
  return style;
}

function readTask(element) {
  const explicit = element.getAttribute("CLOUD_TASK")?.toLowerCase();
  const icon = Array.from(element.children)
    .filter((child) => child.localName.toLowerCase() === "icon")
    .map((child) => child.getAttribute("BUILTIN")?.toLowerCase());
  if (explicit === "done" || icon.includes("button_ok")) return { enabled: true, done: true };
  if (explicit === "todo" || icon.includes("unchecked")) return { enabled: true, done: false };
  return undefined;
}

function convertNode(element, inheritedDirection = 1, root = false) {
  const position = element.getAttribute("POSITION")?.toLowerCase();
  const direction = position === "left" ? 0 : position === "right" ? 1 : inheritedDirection;
  const children = Array.from(element.children)
    .filter((child) => child.localName.toLowerCase() === "node")
    .map((child) => convertNode(child, direction));
  const importedStyle = readNodeStyle(element);
  const task = readTask(element);
  return {
    id: makeId(element),
    topic: nodeText(element),
    root,
    direction: root ? undefined : direction,
    expanded: element.getAttribute("FOLDED")?.toLowerCase() !== "true",
    children,
    style: root
      ? { background: "#3f73f1", color: "#ffffff", fontWeight: "700", ...importedStyle }
      : Object.keys(importedStyle).length ? importedStyle : undefined,
    metadata: task ? { task } : undefined
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
  if (node.style?.color) attributes.push(`COLOR="${escapeXml(node.style.color)}"`);
  if (node.style?.background) attributes.push(`BACKGROUND_COLOR="${escapeXml(node.style.background)}"`);
  if (node.style?.textDecoration?.includes("underline")) attributes.push('CLOUD_UNDERLINE="true"');
  const task = node.metadata?.task;
  if (task?.enabled) attributes.push(`CLOUD_TASK="${task.done ? "done" : "todo"}"`);
  const fontAttributes = [];
  if (node.style?.fontWeight === "700" || node.style?.fontWeight === "bold") fontAttributes.push('BOLD="true"');
  if (node.style?.fontStyle === "italic") fontAttributes.push('ITALIC="true"');
  const font = fontAttributes.length ? `<font ${fontAttributes.join(" ")}/>` : "";
  const taskIcon = task?.enabled ? `<icon BUILTIN="${task.done ? "button_ok" : "unchecked"}"/>` : "";
  const children = (node.children || []).map((child) => exportNode(child)).join("");
  const content = `${font}${taskIcon}${children}`;
  return content.length
    ? `<node ${attributes.join(" ")}>${content}</node>`
    : `<node ${attributes.join(" ")}/>`;
}

function updateToolbar(mind) {
  const node = mind.currentNode?.nodeObj;
  nodeTools.style.display = node ? "flex" : "none";
  if (!node) return;
  nodeTools.querySelector('[data-action="bold"]').classList.toggle("active", node.style?.fontWeight === "700" || node.style?.fontWeight === "bold");
  nodeTools.querySelector('[data-action="italic"]').classList.toggle("active", node.style?.fontStyle === "italic");
  nodeTools.querySelector('[data-action="underline"]').classList.toggle("active", node.style?.textDecoration?.includes("underline"));
  nodeTools.querySelector('[data-action="task"]').classList.toggle("active", Boolean(node.metadata?.task?.enabled));
}

function decorateNodes(mind) {
  for (const topic of document.querySelectorAll("me-tpc")) {
    const node = topic.nodeObj;
    if (!node) continue;
    if (!topic.querySelector(":scope > .quick-add")) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "quick-add";
      add.title = "新增子节点";
      add.textContent = "+";
      add.addEventListener("pointerdown", (event) => event.stopPropagation());
      add.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        mind.selectNode(topic);
        await mind.addChild(topic);
      });
      topic.appendChild(add);
    }
    const task = node.metadata?.task;
    let checkbox = topic.querySelector(":scope > .task-box");
    if (task?.enabled && !checkbox) {
      checkbox = document.createElement("button");
      checkbox.type = "button";
      checkbox.className = "task-box";
      checkbox.title = "切换完成状态";
      checkbox.addEventListener("pointerdown", (event) => event.stopPropagation());
      checkbox.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const current = topic.nodeObj.metadata?.task;
        await mind.reshapeNode(topic, {
          metadata: { ...topic.nodeObj.metadata, task: { enabled: true, done: !current?.done } }
        });
      });
      topic.insertBefore(checkbox, topic.firstChild);
    } else if (!task?.enabled && checkbox) {
      checkbox.remove();
      checkbox = null;
    }
    if (checkbox) {
      checkbox.classList.toggle("done", Boolean(task.done));
      const mark = task.done ? "✓" : "";
      if (checkbox.textContent !== mark) checkbox.textContent = mark;
    }
    topic.classList.toggle("task-done", Boolean(task?.done));
  }
  updateToolbar(mind);
}

async function applyToolbarAction(mind, button) {
  const topic = mind.currentNode;
  if (!topic) return;
  const node = topic.nodeObj;
  const style = { ...(node.style || {}) };
  const action = button.dataset.action;
  if (action === "bold") style.fontWeight = style.fontWeight === "700" ? "" : "700";
  if (action === "italic") style.fontStyle = style.fontStyle === "italic" ? "" : "italic";
  if (action === "underline") style.textDecoration = style.textDecoration?.includes("underline") ? "" : "underline";
  if (button.dataset.color) style.color = style.color === button.dataset.color ? "" : button.dataset.color;
  if (action === "clear") {
    for (const key of ["fontWeight", "fontStyle", "textDecoration", "color"]) delete style[key];
  }
  const patch = { style };
  if (action === "task") {
    const enabled = !node.metadata?.task?.enabled;
    patch.metadata = { ...node.metadata, task: { enabled, done: false } };
  }
  await mind.reshapeNode(topic, patch);
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
    newTopicName: "新节点",
    editable: true,
    contextMenu: { locale: zhCnMenu, focus: true, link: true },
    toolBar: true,
    keypress: {
      Tab: (event) => {
        const target = mind.currentNode;
        if (event.shiftKey && target && !target.nodeObj.parent) {
          const node = mind.generateNewObj();
          node.direction = 0;
          mind.addChild(target, node);
        } else {
          mind.addChild();
        }
      }
    },
    allowUndo: true,
    compact: false
  });
  await mind.init(data);
  const toolbarTitles = {
    fullscreen: "全屏",
    toCenter: "居中显示",
    zoomout: "缩小",
    zoomin: "放大",
    tbltl: "全部向左布局",
    tbltr: "全部向右布局",
    tblts: "左右布局"
  };
  for (const [id, title] of Object.entries(toolbarTitles)) {
    const control = document.getElementById(id);
    if (control) {
      control.title = title;
      control.setAttribute("aria-label", title);
    }
  }
  nativeAddChild = mind.addChild.bind(mind);
  mind.addChild = (element, node) => {
    const target = element || mind.currentNode;
    if (target && !target.nodeObj.parent) {
      node ||= mind.generateNewObj();
      node.direction ??= 1;
      const layoutDirection = mind.direction;
      mind.direction = node.direction;
      try {
        return nativeAddChild(target, node);
      } finally {
        mind.direction = layoutDirection;
      }
    }
    return nativeAddChild(target, node);
  };
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
    requestAnimationFrame(() => decorateNodes(mind));
  });
  mind.bus.addListener("selectNodes", () => updateToolbar(mind));
  mind.bus.addListener("unselectNodes", () => updateToolbar(mind));
  nodeTools.addEventListener("pointerdown", (event) => event.stopPropagation());
  nodeTools.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (button) await applyToolbarAction(mind, button);
  });
  const observer = new MutationObserver(() => decorateNodes(mind));
  observer.observe(document.querySelector("#map"), { childList: true, subtree: true });
  decorateNodes(mind);
  exportButton.addEventListener("click", () => downloadMm(mind));
  setStatus("可编辑 · 自动保存");
} catch (error) {
  console.error(error);
  setStatus(error instanceof Error ? error.message : String(error));
}
