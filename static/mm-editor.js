import MindElixir from "./MindElixir.js?v=right-pan-1";
import { SaveConflictError, SiyuanFileStore } from "./siyuan-file-store.js";

const params = new URLSearchParams(location.search);
const asset = params.get("asset");
const status = document.querySelector("#status");
const exportButton = document.querySelector("#export");
const viewStyleButton = document.querySelector("#view-style");
const nodeTools = document.querySelector("#node-tools");
const storageKey = `siyuan-mm-editor:${asset}`;
const store = new SiyuanFileStore(asset, storageKey);
let saveTimer;
let saveInFlight = false;
let saveAgain = false;
let nativeAddChild;
let sourceDocument;

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

function createRandomId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const random = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") {
    globalThis.crypto.getRandomValues(random);
  } else {
    for (let index = 0; index < random.length; index++) random[index] = Math.floor(Math.random() * 256);
  }
  random[6] = (random[6] & 0x0f) | 0x40;
  random[8] = (random[8] & 0x3f) | 0x80;
  const value = Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function makeId(element) {
  return element.getAttribute("ID") || `mm-${createRandomId()}`;
}

function nodeText(element) {
  const text = element.getAttribute("TEXT")?.trim() ||
    element.querySelector(":scope > richcontent[type='NODE']")?.textContent?.trim() ||
    "";
  return /^(?:新节点|未命名主题|new node)$/i.test(text) || !text
    ? "输入文字"
    : text;
}

function isLeftBranch(direction) {
  return direction === MindElixir.LEFT || String(direction).toLowerCase().includes("lhs");
}

function roundedOrthogonalAt(startX, startY, endX, endY, elbowX) {
  if (Math.abs(endY - startY) < 1) return `M ${startX} ${startY} H ${endX}`;
  const horizontalSign = endX >= startX ? 1 : -1;
  const verticalSign = endY >= startY ? 1 : -1;
  const radius = Math.min(10, Math.abs(endY - startY) / 2, Math.abs(elbowX - startX), Math.abs(endX - elbowX));
  return `M ${startX} ${startY} H ${elbowX - horizontalSign * radius}` +
    ` Q ${elbowX} ${startY} ${elbowX} ${startY + verticalSign * radius}` +
    ` V ${endY - verticalSign * radius}` +
    ` Q ${elbowX} ${endY} ${elbowX + horizontalSign * radius} ${endY} H ${endX}`;
}

function roundedOrthogonalBranch(startX, startY, endX, endY, elbowDistance) {
  const horizontalSign = endX >= startX ? 1 : -1;
  const availableX = Math.abs(endX - startX);
  const elbowX = startX + horizontalSign * Math.min(elbowDistance, availableX / 2);
  return roundedOrthogonalAt(startX, startY, endX, endY, elbowX);
}

function generateFeishuMainBranch({ pT, pL, pW, pH, cT, cL, cW, cH, direction }) {
  const left = isLeftBranch(direction);
  return roundedOrthogonalBranch(
    left ? pL : pL + pW,
    pT + pH / 2,
    left ? cL + cW : cL,
    cT + cH / 2,
    28
  );
}

function generateFeishuSubBranch({ pT, pL, pW, pH, cT, cL, cW, cH, direction }) {
  const left = isLeftBranch(direction);
  const gap = Number.parseInt(this.container.style.getPropertyValue("--node-gap-x"), 10) || 30;
  const parentEdge = left ? pL : pL + pW;
  return roundedOrthogonalAt(
    left ? parentEdge + gap : parentEdge - gap,
    pT + pH / 2,
    left ? cL + gap : cL + cW - gap,
    cT + cH / 2,
    parentEdge
  );
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

function setAttribute(element, name, value) {
  if (value === undefined || value === null || value === "") element.removeAttribute(name);
  else element.setAttribute(name, String(value));
}

function buildPreservedNode(documentNode, sourceById, node, root = false) {
  const source = sourceById.get(String(node.id));
  const element = source
    ? source.cloneNode(true)
    : documentNode.createElement("node");
  for (const child of Array.from(element.children)) {
    if (child.localName.toLowerCase() === "node") child.remove();
  }

  setAttribute(element, "ID", node.id || `mm-${createRandomId()}`);
  setAttribute(element, "TEXT", node.topic || "输入文字");
  setAttribute(element, "POSITION", root ? null : node.direction === 0 ? "left" : "right");
  setAttribute(element, "FOLDED", node.expanded === false ? "true" : null);
  setAttribute(element, "COLOR", node.style?.color || null);
  setAttribute(element, "BACKGROUND_COLOR", node.style?.background || null);
  setAttribute(
    element,
    "CLOUD_UNDERLINE",
    node.style?.textDecoration?.includes("underline") ? "true" : null
  );

  const task = node.metadata?.task;
  setAttribute(element, "CLOUD_TASK", task?.enabled ? (task.done ? "done" : "todo") : null);

  let font = directChild(element, "font");
  const bold = node.style?.fontWeight === "700" || node.style?.fontWeight === "bold";
  const italic = node.style?.fontStyle === "italic";
  if ((bold || italic) && !font) {
    font = documentNode.createElement("font");
    element.insertBefore(font, element.firstChild);
  }
  if (font) {
    setAttribute(font, "BOLD", bold ? "true" : null);
    setAttribute(font, "ITALIC", italic ? "true" : null);
    if (font.attributes.length === 0 && !font.children.length) font.remove();
  }

  for (const icon of Array.from(element.children).filter(
    (child) => child.localName.toLowerCase() === "icon"
  )) {
    const builtin = icon.getAttribute("BUILTIN")?.toLowerCase();
    if (builtin === "button_ok" || builtin === "unchecked") icon.remove();
  }
  if (task?.enabled) {
    const taskIcon = documentNode.createElement("icon");
    taskIcon.setAttribute("BUILTIN", task.done ? "button_ok" : "unchecked");
    element.appendChild(taskIcon);
  }
  for (const child of node.children || []) {
    element.appendChild(buildPreservedNode(documentNode, sourceById, child));
  }
  return element;
}

function updateToolbar(mind) {
  const node = mind.currentNode?.nodeObj;
  nodeTools.style.display = node ? "flex" : "none";
  if (!node) return;
  nodeTools.querySelector('[data-action="bold"]').classList.toggle("active", node.style?.fontWeight === "700" || node.style?.fontWeight === "bold");
  nodeTools.querySelector('[data-action="italic"]').classList.toggle("active", node.style?.fontStyle === "italic");
  nodeTools.querySelector('[data-action="underline"]').classList.toggle("active", node.style?.textDecoration?.includes("underline"));
  nodeTools.querySelector('[data-action="task"]').classList.toggle("active", Boolean(node.metadata?.task?.done));
}

function isHierarchyView(mind) {
  return mind.getData().nodeData.metadata?.cloudViewStyle === "hierarchy";
}

function updateViewStyle(mind, fit = false) {
  const enabled = isHierarchyView(mind);
  document.body.classList.toggle("hierarchy-view", enabled);
  viewStyleButton.classList.toggle("active", enabled);
  viewStyleButton.setAttribute("aria-pressed", String(enabled));
  viewStyleButton.textContent = enabled ? "彩色样式" : "层级样式";
  if (fit) requestAnimationFrame(() => {
    mind.scaleFit();
    mind.toCenter();
  });
}

function nodeDepth(node) {
  let depth = 0;
  let current = node;
  const visited = new Set();
  while (current?.parent && !visited.has(current)) {
    visited.add(current);
    current = current.parent;
    depth += 1;
  }
  return depth;
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
    topic.querySelector(":scope > .task-box")?.remove();
    topic.dataset.depth = String(nodeDepth(node));
    topic.classList.toggle("task-done", Boolean(node.metadata?.task?.done));
    topic.classList.toggle("node-underlined", Boolean(node.style?.textDecoration?.includes("underline")));
  }
  updateViewStyle(mind);
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
    const done = !node.metadata?.task?.done;
    patch.metadata = { ...node.metadata, task: { enabled: done, done } };
  }
  await mind.reshapeNode(topic, patch);
}

function serializeMm(mind) {
  const data = mind.getData();
  const documentNode = sourceDocument
    ? sourceDocument.cloneNode(true)
    : new DOMParser().parseFromString('<map version="1.0.1"/>', "application/xml");
  const map = documentNode.documentElement;
  setAttribute(
    map,
    "CLOUD_VIEW_STYLE",
    data.nodeData.metadata?.cloudViewStyle === "hierarchy" ? "hierarchy" : "classic"
  );
  setAttribute(map, "CLOUD_DIRECTION", data.direction ?? mind.direction ?? 2);
  setAttribute(map, "CLOUD_ARROWS", null);
  setAttribute(map, "CLOUD_SUMMARIES", null);
  const sourceById = new Map(
    Array.from(map.getElementsByTagName("node"))
      .filter((element) => element.getAttribute("ID"))
      .map((element) => [element.getAttribute("ID"), element])
  );
  for (const child of Array.from(map.children)) {
    if (child.localName.toLowerCase() === "node") child.remove();
  }
  map.appendChild(buildPreservedNode(documentNode, sourceById, data.nodeData, true));
  const body = new XMLSerializer().serializeToString(documentNode)
    .replace(/^<\?xml[^>]*>\s*/i, "");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${body}`;
  sourceDocument = new DOMParser().parseFromString(xml, "application/xml");
  return xml;
}

function downloadMm(mind) {
  const data = mind.getData();
  const xml = serializeMm(mind);
  const blobUrl = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = blobUrl;
  link.download = `${data.nodeData.topic || "脑图"}.mm`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  setStatus("已导出 .mm");
}

function parseMm(bytes) {
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(bytes), "application/xml");
  if (xml.querySelector("parsererror")) throw new Error(".mm XML 格式无效");
  const root = Array.from(xml.documentElement.children)
    .find((child) => child.localName.toLowerCase() === "node");
  if (!root) throw new Error("未找到脑图根节点");
  sourceDocument = xml;
  const nodeData = convertNode(root, 1, true);
  const savedViewStyle = xml.documentElement.getAttribute("CLOUD_VIEW_STYLE");
  if (savedViewStyle !== "classic") {
    nodeData.metadata = { ...nodeData.metadata, cloudViewStyle: "hierarchy" };
  }
  const savedDirection = Number(xml.documentElement.getAttribute("CLOUD_DIRECTION"));
  return {
    nodeData,
    direction: [0, 1, 2, 3].includes(savedDirection) ? savedDirection : 2
  };
}

async function loadInitialData() {
  const remoteData = parseMm(await store.loadRemote());
  const recovery = store.readRecovery();
  if (!recovery) return { value: remoteData, state: "remote" };
  if (recovery.legacy) {
    if (confirm("检测到旧版本保存在本机的脑图修改。是否立即写入思源附件并参与同步？")) {
      return { value: recovery.payload, state: "legacy-recovery" };
    }
    return { value: remoteData, state: "legacy-kept" };
  }
  if (recovery.baseHash === store.baseHash) {
    return { value: recovery.payload, state: "recovery" };
  }
  store.conflicted = true;
  return { value: recovery.payload, state: "conflict" };
}

try {
  const { value: data, state: initialState } = await loadInitialData();
  delete data.arrows;
  delete data.summaries;
  const mind = new MindElixir({
    el: "#map",
    direction: 2,
    newTopicName: "输入文字",
    editable: true,
    contextMenu: { locale: zhCnMenu, focus: true, link: false },
    toolBar: true,
    generateMainBranch: generateFeishuMainBranch,
    generateSubBranch: generateFeishuSubBranch,
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
  // MindElixir reapplies the theme during init, which restores its curved
  // branch generators. Bind the Feishu-style paths after initialization.
  mind.generateMainBranch = generateFeishuMainBranch;
  mind.generateSubBranch = generateFeishuSubBranch;
  mind.refresh();
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
  const directionControls = {
    tbltl: { direction: 0, title: "全部向左布局" },
    tbltr: { direction: 1, title: "全部向右布局" },
    tblts: { direction: 2, title: "左右布局" }
  };
  for (const [id, config] of Object.entries(directionControls)) {
    const control = document.getElementById(id);
    if (!control) continue;
    control.title = config.title;
    control.setAttribute("aria-label", config.title);
    control.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const children = mind.nodeData.children || [];
      children.forEach((child, index) => {
        child.direction = config.direction === 2 ? index % 2 : config.direction;
      });
      mind.direction = config.direction;
      mind.refresh();
      mind.toCenter();
      mind.bus.fire("operation", { name: "changeDirection", obj: { direction: config.direction } });
      requestAnimationFrame(() => decorateNodes(mind));
    }, true);
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
    try {
      store.cacheRecovery(mind.getData());
      setStatus("正在写入思源…");
    } catch (error) {
      console.error(error);
      setStatus("本机恢复缓存失败：数据过大");
    }
    saveTimer = setTimeout(() => void persistMind(false), 700);
    requestAnimationFrame(() => decorateNodes(mind));
  });
  mind.bus.addListener("selectNodes", () => updateToolbar(mind));
  mind.bus.addListener("unselectNodes", () => updateToolbar(mind));
  nodeTools.addEventListener("pointerdown", (event) => event.stopPropagation());
  nodeTools.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (button) await applyToolbarAction(mind, button);
  });
  viewStyleButton.addEventListener("click", async () => {
    const rootTopic = document.querySelector("me-root > me-tpc");
    if (!rootTopic) return;
    const metadata = { ...(rootTopic.nodeObj.metadata || {}) };
    if (metadata.cloudViewStyle === "hierarchy") delete metadata.cloudViewStyle;
    else metadata.cloudViewStyle = "hierarchy";
    await mind.reshapeNode(rootTopic, { metadata });
    updateViewStyle(mind, true);
  });
  const observer = new MutationObserver(() => decorateNodes(mind));
  observer.observe(document.querySelector("#map"), { childList: true, subtree: true });
  decorateNodes(mind);
  async function persistMind(force) {
    if (saveInFlight) {
      saveAgain = true;
      return;
    }
    saveInFlight = true;
    let overwriteConflict = false;
    try {
      setStatus(force ? "正在覆盖写入思源…" : "正在写入思源…");
      const bytes = new TextEncoder().encode(serializeMm(mind));
      const saved = await store.save(bytes, { force });
      const savedAt = new Date().toLocaleTimeString();
      setStatus(saved.unchanged
        ? `内容已保存 ${savedAt}`
        : `已写入思源附件 ${savedAt}`);
    } catch (error) {
      console.error(error);
      if (error instanceof SaveConflictError) {
        setStatus("保存冲突：思源附件已有新版本，本机修改已保留");
        overwriteConflict = confirm("思源附件已在其他页面或设备发生变化。确定用当前脑图覆盖远端版本吗？");
      } else {
        setStatus(`保存失败（本机修改已保留）：${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      saveInFlight = false;
      if (overwriteConflict) {
        saveAgain = false;
        void persistMind(true);
      } else if (saveAgain) {
        saveAgain = false;
        void persistMind(false);
      }
    }
  }
  exportButton.addEventListener("click", () => downloadMm(mind));
  if (initialState === "conflict") {
    setStatus("检测到跨设备保存冲突：当前显示本机恢复内容，尚未覆盖思源");
    if (confirm("检测到本机恢复内容与思源附件冲突。确定用当前脑图覆盖思源中的版本吗？")) {
      void persistMind(true);
    }
  } else if (initialState === "legacy-kept") {
    setStatus("已读取思源附件；旧版本机缓存仍保留");
  } else if (initialState === "legacy-recovery" || initialState === "recovery") {
    setStatus("检测到未写入的本机修改，正在恢复到思源…");
    store.cacheRecovery(mind.getData());
    void persistMind(false);
  } else {
    setStatus("可编辑 · 修改将自动写入思源");
  }
} catch (error) {
  console.error(error);
  setStatus(error instanceof Error ? error.message : String(error));
}
