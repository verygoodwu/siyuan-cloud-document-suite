import MindElixir from "./MindElixir.js?v=right-pan-1";
import { SaveConflictError, SiyuanFileStore } from "./siyuan-file-store.js";
import {
  buildOutlineRows,
  captureMindExpansion,
  expandNodeAncestors,
  flattenMindNodes,
  nextSearchResultId,
  resolveMindShortcut,
  restoreMindExpansion,
  searchMindNodes
} from "./mm-workspace.js";

const params = new URLSearchParams(location.search);
const asset = params.get("asset");
const status = document.querySelector("#status");
const exportButton = document.querySelector("#export");
const viewStyleButton = document.querySelector("#view-style");
const nodeTools = document.querySelector("#node-tools");
const searchToggle = document.querySelector("#search-toggle");
const shortcutToggle = document.querySelector("#shortcut-toggle");
const shortcutDialog = document.querySelector("#shortcut-dialog");
const shortcutClose = document.querySelector("#shortcut-close");
const focusExit = document.querySelector("#focus-exit");
const outlineToggle = document.querySelector("#outline-toggle");
const workspacePanel = document.querySelector("#workspace-panel");
const workspaceSearch = document.querySelector("#workspace-search");
const workspaceClose = document.querySelector("#workspace-close");
const searchCount = document.querySelector("#search-count");
const outlineList = document.querySelector("#outline-list");
const storageKey = `siyuan-mm-editor:${asset}`;
const store = new SiyuanFileStore(asset, storageKey);
let saveTimer;
let saveInFlight = false;
let saveAgain = false;
let nativeAddChild;
let sourceDocument;
let pendingViewportAnchor;
let viewportAnchorTimer;
let mindRenderFrame;
let mindRenderRequested = false;
let mindRenderReveal = false;
let passiveDecorationFrame;
let workspaceRenderFrame;
let workspaceSelectionFrame;
let workspaceRevealActive = false;
let workspaceSelectionReveal = false;
let lastSearchResultId;
let lastSearchQuery = "";
let searchExpansionSnapshot;
const searchManualExpansionChanges = new Set();
let focusViewportState;
let scheduleMindPersistence = () => {};
let pendingKeyboardAdd;

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
  const normalized = String(text);
  status.dataset.state = normalized.includes("失败") || normalized.includes("冲突")
    ? "error"
    : normalized.includes("正在")
      ? "working"
      : normalized.includes("保存") || normalized.includes("写入")
        ? "saved"
        : "idle";
}

function findMindTopic(mind, nodeId) {
  if (!nodeId) return undefined;
  try {
    return mind.findEle(nodeId);
  } catch {
    return undefined;
  }
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
  const childEdge = left ? cL + cW - gap : cL + gap;
  const parentCenterY = pT + pH / 2;
  const childCenterY = cT + cH / 2;
  const sameRowTolerance = Math.max(8, Math.min(pH, cH) / 2);
  if (Math.abs(childCenterY - parentCenterY) <= sameRowTolerance) {
    const lineY = (parentCenterY + childCenterY) / 2;
    return `M ${parentEdge} ${lineY} H ${childEdge}`;
  }
  return roundedOrthogonalBranch(
    parentEdge,
    parentCenterY,
    childEdge,
    childCenterY,
    Math.max(12, gap / 2)
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

function convertNode(element, inheritedDirection = 1, root = false, topLevel = false) {
  const position = element.getAttribute("POSITION")?.toLowerCase();
  const direction = topLevel
    ? position === "left" ? 0 : position === "right" ? 1 : inheritedDirection
    : inheritedDirection;
  const children = Array.from(element.children)
    .filter((child) => child.localName.toLowerCase() === "node")
    .map((child) => convertNode(child, direction, false, root));
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

function buildPreservedNode(documentNode, sourceById, node, root = false, topLevel = false) {
  const source = sourceById.get(String(node.id));
  const element = source
    ? source.cloneNode(true)
    : documentNode.createElement("node");
  for (const child of Array.from(element.children)) {
    if (child.localName.toLowerCase() === "node") child.remove();
  }

  setAttribute(element, "ID", node.id || `mm-${createRandomId()}`);
  setAttribute(element, "TEXT", node.topic || "输入文字");
  setAttribute(element, "POSITION", topLevel ? node.direction === 0 ? "left" : "right" : null);
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
    element.appendChild(buildPreservedNode(documentNode, sourceById, child, false, root));
  }
  return element;
}

function normalizedMapDirection(value) {
  const direction = Number(value);
  return [0, 1, 2].includes(direction) ? direction : 1;
}

function setBranchDirection(node, direction) {
  node.direction = direction;
  for (const child of node.children || []) setBranchDirection(child, direction);
}

function normalizeMindDirections(data) {
  data.direction = normalizedMapDirection(data.direction);
  for (const [index, child] of (data.nodeData.children || []).entries()) {
    const branchDirection = data.direction === 2
      ? child.direction === 0 || child.direction === 1 ? child.direction : index % 2
      : data.direction;
    setBranchDirection(child, branchDirection);
  }
  return data;
}

function updateToolbar(mind) {
  const topic = mind.currentNode;
  const node = topic?.nodeObj;
  const focused = Boolean(mind.isFocusMode);
  document.body.classList.toggle("focus-mode", focused);
  focusExit.textContent = focused && mind.nodeData?.topic
    ? `返回完整脑图 · ${mind.nodeData.topic}`
    : "返回完整脑图";
  nodeTools.style.display = node ? "flex" : "none";
  if (!node) return;
  nodeTools.querySelector('[data-action="bold"]').classList.toggle("active", node.style?.fontWeight === "700" || node.style?.fontWeight === "bold");
  nodeTools.querySelector('[data-action="italic"]').classList.toggle("active", node.style?.fontStyle === "italic");
  nodeTools.querySelector('[data-action="underline"]').classList.toggle("active", node.style?.textDecoration?.includes("underline"));
  const taskButton = nodeTools.querySelector('[data-action="task"]');
  const taskDone = topic.classList.contains("task-done");
  taskButton.classList.toggle("active", taskDone);
  taskButton.setAttribute("aria-pressed", String(taskDone));
  const focusButton = nodeTools.querySelector('[data-action="focus"]');
  focusButton.textContent = focused ? "退出聚焦" : "聚焦分支";
  focusButton.title = focused ? "返回完整脑图" : "仅显示当前分支";
  focusButton.classList.toggle("active", focused);
  focusButton.disabled = !focused && !node.parent;
}

function isTextEditingTarget(target) {
  return target instanceof HTMLElement && (
    target.id === "input-box" ||
    target.matches("input,textarea,[contenteditable='true'],[contenteditable='plaintext-only']")
  );
}

function setShortcutDialogOpen(open) {
  shortcutDialog.hidden = !open;
  shortcutToggle.classList.toggle("active", open);
  shortcutToggle.setAttribute("aria-expanded", String(open));
  if (open) shortcutClose.focus();
}

function resizeMindInputBox(input) {
  if (!(input instanceof HTMLElement) || input.id !== "input-box") return;
  const available = Math.max(120, Math.min(480, innerWidth - 48));
  const originalMin = Number.parseFloat(input.dataset.cloudMinWidth || input.style.minWidth) || 72;
  input.dataset.cloudMinWidth = String(originalMin);
  input.style.width = "auto";
  input.style.width = `${Math.min(available, Math.max(originalMin, input.scrollWidth + 4))}px`;
  input.style.height = "auto";
  input.style.height = `${Math.max(34, input.scrollHeight)}px`;
}

function selectAndCenterMindNode(mind, nodeId) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const topic = findMindTopic(mind, nodeId);
    if (!topic) return;
    mind.selectNode(topic);
    decorateNodes(mind);
    centerTopicInWorkspace(mind, topic);
    redrawVisibleBranches();
    queueWorkspaceRender(mind, true);
  }));
}

function restoreFocusViewport(mind, nodeId, viewport) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const topic = findMindTopic(mind, nodeId);
    if (topic) mind.selectNode(topic);
    decorateNodes(mind);
    redrawVisibleBranches();
    if (viewport?.transform) {
      mind.scaleVal = viewport.scaleVal;
      mind.map.style.transform = viewport.transform;
    }
    queueWorkspaceSelectionSync(mind, true);
  }));
}

function toggleBranchFocus(mind) {
  if (mind.isFocusMode) {
    const focusedNodeId = mind.nodeData?.id;
    const viewport = focusViewportState;
    focusViewportState = undefined;
    mind.cancelFocus();
    if (focusedNodeId) restoreFocusViewport(mind, focusedNodeId, viewport);
    setStatus("已返回完整脑图");
    return;
  }
  const topic = mind.currentNode;
  if (!topic?.nodeObj?.parent) {
    setStatus("中心主题已经是完整脑图");
    return;
  }
  const nodeId = topic.nodeObj.id;
  focusViewportState = {
    transform: mind.map.style.transform,
    scaleVal: mind.scaleVal
  };
  mind.focusNode(topic);
  selectAndCenterMindNode(mind, nodeId);
  setStatus("已聚焦当前分支 · 可从底部工具栏退出");
}

function toggleSelectedBranch(mind) {
  const topic = mind.currentNode;
  const node = topic?.nodeObj;
  if (!node?.children?.length) {
    setStatus("当前节点没有可收起的子节点");
    return;
  }
  const rect = topic.getBoundingClientRect();
  pendingViewportAnchor = {
    nodeId: node.id,
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
  node.expanded = node.expanded === false;
  mind.bus.fire("operation", {
    name: "toggleExpand",
    obj: { id: node.id, expanded: node.expanded }
  });
  setStatus(node.expanded ? "已展开当前分支" : "已收起当前分支");
}

function focusRootTopic(mind) {
  if (mind.isFocusMode) mind.cancelFocus();
  focusViewportState = undefined;
  const rootId = mind.nodeData?.id;
  if (!rootId) return;
  selectAndCenterMindNode(mind, rootId);
  setStatus("已回到中心主题");
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
    const depth = nodeDepth(node);
    const childCount = node.children?.length || 0;
    const existingAdd = topic.querySelector(":scope > .quick-add");
    if (depth === 0 && childCount === 0 && !existingAdd) {
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
    } else if (depth !== 0 || childCount > 0) existingAdd?.remove();
    topic.querySelector(":scope > .task-box")?.remove();
    const collapsed = childCount > 0 && node.expanded === false;
    topic.classList.toggle("has-children", childCount > 0);
    topic.classList.toggle("node-collapsed", collapsed);
    const parent = topic.parentElement;
    parent?.classList.toggle("main-branch-parent", depth === 1);
    parent?.classList.toggle("has-child-nodes", childCount > 0);
    const expander = parent?.querySelector(":scope > me-epd");
    if (expander) {
      expander.dataset.childCount = String(childCount);
      expander.dataset.collapsed = String(collapsed);
      if (!expander.dataset.cloudToggleBound) {
        expander.dataset.cloudToggleBound = "true";
        expander.addEventListener("pointerdown", () => {
          const rect = topic.getBoundingClientRect();
          const anchor = {
            nodeId: node.id,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
          };
          pendingViewportAnchor = anchor;
          clearTimeout(viewportAnchorTimer);
          viewportAnchorTimer = setTimeout(() => {
            if (pendingViewportAnchor === anchor) pendingViewportAnchor = undefined;
          }, 1000);
        }, true);
        expander.addEventListener("click", () => {
          queueMicrotask(() => mind.bus.fire("operation", {
            name: "toggleExpand",
            obj: { id: node.id, expanded: node.expanded !== false }
          }));
        });
      }
      const label = collapsed ? `展开 ${childCount} 个子节点` : "收起子节点";
      expander.title = label;
      expander.setAttribute("aria-label", label);
    }
    topic.dataset.depth = String(depth);
    topic.classList.toggle("task-done", Boolean(node.metadata?.task?.done));
    topic.classList.toggle("node-underlined", Boolean(node.style?.textDecoration?.includes("underline")));
  }
  updateViewStyle(mind);
  updateToolbar(mind);
  resizeMindInputBox(document.querySelector("#input-box"));
}

function pathCoordinates(svg, startRect, endRect, left) {
  const svgRect = svg.getBoundingClientRect();
  const scaleX = svg.clientWidth ? svgRect.width / svg.clientWidth : 1;
  const scaleY = svg.clientHeight ? svgRect.height / svg.clientHeight : 1;
  const startX = ((left ? startRect.left : startRect.right) - svgRect.left) / scaleX;
  const endX = ((left ? endRect.right : endRect.left) - svgRect.left) / scaleX;
  const startY = (startRect.top + startRect.height / 2 - svgRect.top) / scaleY;
  const endY = (endRect.top + endRect.height / 2 - svgRect.top) / scaleY;
  return { startX, startY, endX, endY };
}

function branchPathFromRects(svg, startRect, endRect, left, elbowDistance) {
  const { startX, startY, endX, endY } = pathCoordinates(svg, startRect, endRect, left);
  const sameRowTolerance = Math.max(8, Math.min(startRect.height, endRect.height) / 2);
  if (Math.abs(endRect.top + endRect.height / 2 - startRect.top - startRect.height / 2) <= sameRowTolerance) {
    const lineY = (startY + endY) / 2;
    return `M ${startX} ${lineY} H ${endX}`;
  }
  return roundedOrthogonalBranch(startX, startY, endX, endY, elbowDistance);
}

function collectSubConnections(wrapper, connections) {
  const parentTopic = wrapper.querySelector(":scope > me-parent > me-tpc");
  const children = wrapper.querySelector(":scope > me-children");
  if (!parentTopic || !children) return;
  for (const childWrapper of Array.from(children.children)) {
    if (!(childWrapper instanceof HTMLElement) || childWrapper.tagName !== "ME-WRAPPER") continue;
    const childParent = childWrapper.querySelector(":scope > me-parent");
    const childTopic = childParent?.querySelector(":scope > me-tpc");
    if (!childParent || !childTopic) continue;
    connections.push({ parentTopic, childTopic });
    const expander = childParent.querySelector(":scope > me-epd");
    if (!expander || expander.expanded !== false) collectSubConnections(childWrapper, connections);
  }
}

function alignVisibleHierarchy() {
  const childrenGroups = Array.from(document.querySelectorAll("me-children"));
  for (const children of childrenGroups) children.style.removeProperty("transform");
  // Read after clearing every previous correction so repeated refreshes never
  // accumulate offsets from an earlier layout.
  void document.documentElement.offsetHeight;

  const alignWrapper = (wrapper) => {
    const parentTopic = wrapper.querySelector(":scope > me-parent > me-tpc");
    const children = wrapper.querySelector(":scope > me-children");
    if (!parentTopic || !children) return;
    const childWrappers = Array.from(children.children).filter(
      (child) => child instanceof HTMLElement && child.tagName === "ME-WRAPPER"
    );
    const childTopics = childWrappers
      .map((child) => child.querySelector(":scope > me-parent > me-tpc"))
      .filter(Boolean);
    if (!childTopics.length) return;

    const parentRect = parentTopic.getBoundingClientRect();
    const childRects = childTopics.map((topic) => topic.getBoundingClientRect());
    const parentCenter = parentRect.top + parentRect.height / 2;
    const childrenCenter = (
      Math.min(...childRects.map((rect) => rect.top)) +
      Math.max(...childRects.map((rect) => rect.bottom))
    ) / 2;
    const correction = Math.abs(parentCenter - childrenCenter) < 0.25
      ? 0
      : Math.round((parentCenter - childrenCenter) * 100) / 100;
    if (correction) children.style.transform = `translateY(${correction}px)`;

    for (const childWrapper of childWrappers) alignWrapper(childWrapper);
  };

  for (const wrapper of document.querySelectorAll("me-main > me-wrapper")) {
    alignWrapper(wrapper);
  }
}

function redrawVisibleBranches() {
  alignVisibleHierarchy();
  const rootTopic = document.querySelector("me-root > me-tpc");
  const mainSvg = document.querySelector("svg.lines");
  const mainPaths = mainSvg ? Array.from(mainSvg.querySelectorAll("path")) : [];
  const mainWrappers = Array.from(document.querySelectorAll("me-main > me-wrapper"));
  if (rootTopic && mainSvg) {
    const rootRect = rootTopic.getBoundingClientRect();
    mainWrappers.forEach((wrapper, index) => {
      const topic = wrapper.querySelector(":scope > me-parent > me-tpc");
      const path = mainPaths[index];
      if (!topic || !path) return;
      const left = wrapper.parentElement?.classList.contains("lhs") === true;
      path.setAttribute("d", branchPathFromRects(mainSvg, rootRect, topic.getBoundingClientRect(), left, 28));
    });
  }
  for (const wrapper of mainWrappers) {
    const svg = wrapper.querySelector(":scope > svg.subLines");
    if (!svg) continue;
    const paths = Array.from(svg.querySelectorAll("path"));
    const connections = [];
    collectSubConnections(wrapper, connections);
    const left = wrapper.parentElement?.classList.contains("lhs") === true;
    connections.forEach(({ parentTopic, childTopic }, index) => {
      const path = paths[index];
      if (!path) return;
      path.setAttribute("d", branchPathFromRects(
        svg,
        parentTopic.getBoundingClientRect(),
        childTopic.getBoundingClientRect(),
        left,
        15
      ));
    });
  }
}

function restoreViewportAnchor(mind, anchor) {
  if (!anchor) return;
  const topic = findMindTopic(mind, anchor.nodeId);
  if (!topic) return;
  const rect = topic.getBoundingClientRect();
  const dx = anchor.x - (rect.left + rect.width / 2);
  const dy = anchor.y - (rect.top + rect.height / 2);
  if (Math.abs(dx) >= 0.25 || Math.abs(dy) >= 0.25) mind.move(dx, dy);
}

function refreshDecoratedLayout(mind, reveal = false) {
  mindRenderRequested = true;
  mindRenderReveal ||= reveal;
  if (mindRenderFrame) return;
  const flush = () => {
    mindRenderFrame = requestAnimationFrame(() => {
      mindRenderFrame = requestAnimationFrame(() => {
        mindRenderFrame = undefined;
        if (!mindRenderRequested) return;
        mindRenderRequested = false;
        const selectedNodeId = mind.currentNode?.nodeObj?.id;
        const viewportAnchor = pendingViewportAnchor;
        const shouldReveal = mindRenderReveal;
        pendingViewportAnchor = undefined;
        mindRenderReveal = false;
        clearTimeout(viewportAnchorTimer);
        mind.refresh();
        if (selectedNodeId) {
          const selectedTopic = findMindTopic(mind, selectedNodeId);
          if (selectedTopic) mind.selectNode(selectedTopic);
        }
        decorateNodes(mind);
        redrawVisibleBranches();
        restoreViewportAnchor(mind, viewportAnchor);
        if (shouldReveal) document.body.classList.add("layout-ready");
        if (mindRenderRequested) flush();
      });
    });
  };
  flush();
}

function queuePassiveDecorations(mind) {
  if (passiveDecorationFrame || document.querySelector("#input-box")) return;
  passiveDecorationFrame = requestAnimationFrame(() => {
    passiveDecorationFrame = undefined;
    decorateNodes(mind);
    queueWorkspaceRender(mind);
  });
}

function beginSearchExpansionSession(mind) {
  if (!searchExpansionSnapshot) {
    searchExpansionSnapshot = captureMindExpansion(mind.nodeData);
    searchManualExpansionChanges.clear();
  }
}

function endSearchExpansionSession(mind) {
  if (!searchExpansionSnapshot) return false;
  const changed = restoreMindExpansion(
    mind.nodeData,
    searchExpansionSnapshot,
    searchManualExpansionChanges
  );
  searchExpansionSnapshot = undefined;
  searchManualExpansionChanges.clear();
  if (changed) refreshDecoratedLayout(mind);
  return changed > 0;
}

function setWorkspaceOpen(mind, open, focusSearch = false) {
  if (!open) endSearchExpansionSession(mind);
  document.body.classList.toggle("workspace-open", open);
  searchToggle.setAttribute("aria-expanded", String(open));
  outlineToggle.setAttribute("aria-expanded", String(open));
  outlineToggle.classList.toggle("active", open);
  searchToggle.classList.toggle("active", open && (focusSearch || Boolean(workspaceSearch.value)));
  if (open && focusSearch) requestAnimationFrame(() => {
    workspaceSearch.focus();
    workspaceSearch.select();
  });
}

function centerTopicInWorkspace(mind, topic) {
  const mapRect = document.querySelector("#map").getBoundingClientRect();
  const topicRect = topic.getBoundingClientRect();
  const panelWidth = document.body.classList.contains("workspace-open") && innerWidth > 760
    ? workspacePanel.getBoundingClientRect().width + 24
    : 0;
  const targetX = mapRect.left + Math.max(0, mapRect.width - panelWidth) / 2;
  const targetY = mapRect.top + mapRect.height / 2;
  const topicX = topicRect.left + topicRect.width / 2;
  const topicY = topicRect.top + topicRect.height / 2;
  mind.move(targetX - topicX, targetY - topicY);
}

function focusMindNode(mind, nodeId) {
  const searching = Boolean(workspaceSearch.value.trim());
  if (searching) beginSearchExpansionSession(mind);
  const revealed = expandNodeAncestors(mind.nodeData, nodeId);
  if (revealed) {
    mind.refresh();
    if (!searching) scheduleMindPersistence();
  }
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const topic = findMindTopic(mind, nodeId);
    if (!topic) return;
    mind.selectNode(topic);
    decorateNodes(mind);
    centerTopicInWorkspace(mind, topic);
    redrawVisibleBranches();
    queueWorkspaceRender(mind, true);
  }));
}

function renderWorkspace(mind, revealActive = false) {
  const query = workspaceSearch.value.trim();
  const results = searchMindNodes(mind.nodeData, query);
  const rows = buildOutlineRows(mind.nodeData, query);
  const selectedId = mind.currentNode?.nodeObj?.id;
  searchCount.textContent = query
    ? `${results.length} 个匹配`
    : `${flattenMindNodes(mind.nodeData).length} 个节点`;
  searchToggle.classList.toggle("active", document.body.classList.contains("workspace-open") && Boolean(query));
  outlineList.replaceChildren();
  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "outline-empty";
    empty.textContent = query ? "没有匹配节点" : "脑图中没有节点";
    outlineList.appendChild(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const row of rows) {
    const container = document.createElement("div");
    container.className = "outline-row";
    container.style.setProperty("--depth", String(Math.max(0, row.depth)));
    container.dataset.nodeId = row.id;
    container.setAttribute("role", "treeitem");
    container.setAttribute("aria-level", String(row.depth + 1));
    container.setAttribute("aria-selected", String(row.id === selectedId));
    if (row.hasChildren) container.setAttribute("aria-expanded", String(row.expanded));
    container.classList.toggle("matched", Boolean(row.matched));
    container.classList.toggle("active", row.id === selectedId);

    const expander = document.createElement("button");
    expander.type = "button";
    expander.className = `outline-expander${row.hasChildren ? "" : " placeholder"}`;
    expander.tabIndex = row.hasChildren ? 0 : -1;
    expander.setAttribute("aria-label", row.expanded ? "收起子节点" : "展开子节点");
    expander.textContent = row.expanded ? "⌄" : "›";
    if (row.hasChildren) expander.addEventListener("click", (event) => {
      event.stopPropagation();
      if (searchExpansionSnapshot) searchManualExpansionChanges.add(row.id);
      row.node.expanded = !row.expanded;
      mind.refresh();
      scheduleMindPersistence();
      refreshDecoratedLayout(mind);
      queueWorkspaceRender(mind);
    });

    const topicButton = document.createElement("button");
    topicButton.type = "button";
    topicButton.className = "outline-topic";
    topicButton.textContent = row.topic;
    topicButton.title = row.topic;
    topicButton.addEventListener("click", () => {
      if (row.matched) lastSearchResultId = row.id;
      focusMindNode(mind, row.id);
    });
    container.append(expander, topicButton);
    fragment.appendChild(container);
  }
  outlineList.appendChild(fragment);
  if (revealActive && selectedId) {
    const activeRow = Array.from(outlineList.querySelectorAll(".outline-row"))
      .find((row) => row.dataset.nodeId === selectedId);
    activeRow?.scrollIntoView({ block: "nearest" });
  }
}

function queueWorkspaceRender(mind, revealActive = false) {
  workspaceRevealActive ||= revealActive;
  if (workspaceRenderFrame) return;
  workspaceRenderFrame = requestAnimationFrame(() => {
    workspaceRenderFrame = undefined;
    const shouldReveal = workspaceRevealActive;
    workspaceRevealActive = false;
    renderWorkspace(mind, shouldReveal);
  });
}

function syncWorkspaceSelection(mind, revealActive = false) {
  const selectedId = mind.currentNode?.nodeObj?.id;
  let activeRow;
  for (const row of outlineList.querySelectorAll(".outline-row")) {
    const active = row.dataset.nodeId === selectedId;
    row.classList.toggle("active", active);
    row.setAttribute("aria-selected", String(active));
    if (active) activeRow = row;
  }
  if (revealActive) activeRow?.scrollIntoView({ block: "nearest" });
}

function queueWorkspaceSelectionSync(mind, revealActive = false) {
  workspaceSelectionReveal ||= revealActive;
  if (workspaceSelectionFrame) return;
  workspaceSelectionFrame = requestAnimationFrame(() => {
    workspaceSelectionFrame = undefined;
    const shouldReveal = workspaceSelectionReveal;
    workspaceSelectionReveal = false;
    syncWorkspaceSelection(mind, shouldReveal);
  });
}

function goToSearchResult(mind, step) {
  const query = workspaceSearch.value.trim();
  if (!query) return;
  beginSearchExpansionSession(mind);
  const results = searchMindNodes(mind.nodeData, query);
  const nodeId = nextSearchResultId(results, lastSearchResultId, step);
  if (!nodeId) {
    setStatus("没有匹配的脑图节点");
    return;
  }
  lastSearchResultId = nodeId;
  focusMindNode(mind, nodeId);
  const index = results.findIndex((row) => row.id === nodeId);
  setStatus(`查找结果 ${index + 1}/${results.length}`);
}

async function applyToolbarAction(mind, button) {
  const topic = mind.currentNode;
  if (!topic) return;
  const node = topic.nodeObj;
  const style = { ...(node.style || {}) };
  const action = button.dataset.action;
  if (action === "focus") {
    toggleBranchFocus(mind);
    return;
  }
  let taskDone;
  if (action === "bold") style.fontWeight = style.fontWeight === "700" ? "" : "700";
  if (action === "italic") style.fontStyle = style.fontStyle === "italic" ? "" : "italic";
  if (action === "underline") style.textDecoration = style.textDecoration?.includes("underline") ? "" : "underline";
  if (button.dataset.color) style.color = style.color === button.dataset.color ? "" : button.dataset.color;
  if (action === "clear") {
    for (const key of ["fontWeight", "fontStyle", "textDecoration", "color"]) delete style[key];
  }
  const patch = { style };
  if (action === "task") {
    const metadata = { ...(node.metadata || {}) };
    taskDone = !topic.classList.contains("task-done");
    if (taskDone) metadata.task = { enabled: true, done: true };
    else delete metadata.task;
    patch.metadata = metadata;
  }
  await mind.reshapeNode(topic, patch);
  decorateNodes(mind);
  // Formatting can change the topic dimensions (especially bold text and
  // hierarchy view padding), so keep connectors aligned with the new rects.
  redrawVisibleBranches();
  if (action === "task") {
    topic.classList.toggle("task-done", taskDone);
    button.classList.toggle("active", taskDone);
    button.setAttribute("aria-pressed", String(taskDone));
  }
}

function serializeMm(mind) {
  const data = mind.getData();
  normalizeMindDirections(data);
  const documentNode = sourceDocument
    ? sourceDocument.cloneNode(true)
    : new DOMParser().parseFromString('<map version="1.0.1"/>', "application/xml");
  const map = documentNode.documentElement;
  setAttribute(
    map,
    "CLOUD_VIEW_STYLE",
    data.nodeData.metadata?.cloudViewStyle === "hierarchy" ? "hierarchy" : "classic"
  );
  setAttribute(map, "CLOUD_DIRECTION", normalizedMapDirection(data.direction ?? mind.direction));
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
  const savedDirectionAttribute = xml.documentElement.getAttribute("CLOUD_DIRECTION");
  const savedDirection = savedDirectionAttribute === null ? 1 : Number(savedDirectionAttribute);
  return normalizeMindDirections({
    nodeData,
    direction: [0, 1, 2].includes(savedDirection) ? savedDirection : 1
  });
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

function trackKeyboardNode(node) {
  pendingKeyboardAdd = {
    nodeId: node.id,
    initialTopic: node.topic,
    dirty: false
  };
}

function editKeyboardNode(mind, node) {
  requestAnimationFrame(() => {
    const newTopic = findMindTopic(mind, node.id);
    if (!newTopic) {
      if (pendingKeyboardAdd?.nodeId === node.id) pendingKeyboardAdd = undefined;
      return;
    }
    mind.selectNode(newTopic);
    mind.editTopic(newTopic);
    const input = document.querySelector("#input-box");
    if (input) {
      input.dataset.keyboardNodeId = node.id;
      input.dataset.keyboardInitialTopic = node.topic;
      input.dataset.keyboardDirty = "false";
      input.focus();
      // MindElixir positions the temporary editor after the node layout pass.
      // Recalculate branches once it is mounted so Tab-created nodes do not
      // appear offset from their connector while the user is typing.
      requestAnimationFrame(() => {
        resizeMindInputBox(input);
        redrawVisibleBranches();
      });
    }
    updateToolbar(mind);
    queueWorkspaceRender(mind, true);
  });
}

function beginDirectMindEditing(mind, event) {
  const topic = mind.currentNode;
  if (!topic || event.isComposing || event.key.length !== 1) return false;
  event.preventDefault();
  event.stopPropagation();
  mind.selectNode(topic);
  mind.editTopic(topic);
  requestAnimationFrame(() => {
    const input = document.querySelector("#input-box");
    if (!input) return;
    input.textContent = event.key;
    input.dataset.keyboardNodeId = topic.nodeObj?.id || "";
    input.dataset.keyboardInitialTopic = topic.nodeObj?.topic || "";
    input.dataset.keyboardDirty = "true";
    input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: event.key }));
    input.focus();
    placeCaretAtEnd(input);
    resizeMindInputBox(input);
    redrawVisibleBranches();
  });
  return true;
}

function addKeyboardChild(mind, event) {
  const target = mind.currentNode;
  if (!target) return;
  const node = mind.generateNewObj();
  if (event.shiftKey && !mind.isFocusMode && target.nodeObj === mind.nodeData) node.direction = 0;
  trackKeyboardNode(node);
  mind.addChild(target, node);
  editKeyboardNode(mind, node);
}

function addKeyboardRelative(mind, event) {
  const target = mind.currentNode;
  if (!target) return;
  const visibleRoot = target.nodeObj === mind.nodeData;
  if (visibleRoot) {
    setStatus(mind.isFocusMode
      ? "聚焦根节点不能添加同级或父节点，请先返回完整脑图"
      : "中心主题不能添加同级或父节点");
    return;
  }
  const node = mind.generateNewObj();
  trackKeyboardNode(node);
  if (event.ctrlKey || event.metaKey) mind.insertParent(target, node);
  else mind.insertSibling(event.shiftKey ? "before" : "after", target, node);
  editKeyboardNode(mind, node);
}

try {
  const { value: data, state: initialState } = await loadInitialData();
  delete data.arrows;
  delete data.summaries;
  normalizeMindDirections(data);
  const mind = new MindElixir({
    el: "#map",
    direction: data.direction,
    newTopicName: "输入文字",
    editable: true,
    contextMenu: { locale: zhCnMenu, focus: true, link: false },
    toolBar: true,
    generateMainBranch: generateFeishuMainBranch,
    generateSubBranch: generateFeishuSubBranch,
    keypress: true,
    allowUndo: true,
    compact: false
  });
  await mind.init(data);
  const nativeGetData = mind.getData.bind(mind);
  mind.getData = () => {
    const snapshot = nativeGetData();
    if (mind.isFocusMode && mind.tempDirection !== null) snapshot.direction = mind.tempDirection;
    if (searchExpansionSnapshot) {
      restoreMindExpansion(snapshot.nodeData, searchExpansionSnapshot, searchManualExpansionChanges);
    }
    return snapshot;
  };
  // MindElixir reapplies the theme during init, which restores its curved
  // branch generators. Bind the Feishu-style paths after initialization.
  mind.generateMainBranch = generateFeishuMainBranch;
  mind.generateSubBranch = generateFeishuSubBranch;
  refreshDecoratedLayout(mind, true);
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
        const direction = config.direction === 2 ? index % 2 : config.direction;
        setBranchDirection(child, direction);
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
    const visibleRoot = target?.nodeObj === mind.nodeData;
    if (visibleRoot) {
      // A focused branch root keeps its original parent reference. MindElixir
      // otherwise treats it as a regular child and may try to expand a root
      // control that does not exist in the focused DOM.
      if (target.nodeObj.expanded === false) target.nodeObj.expanded = true;
      node ||= mind.generateNewObj();
      if (node.direction !== 0 && node.direction !== 1) {
        node.direction = mind.direction === 0 ? 0 : 1;
      }
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
  scheduleMindPersistence = () => {
    clearTimeout(saveTimer);
    try {
      store.cacheRecovery(mind.getData());
      setStatus("正在写入思源…");
    } catch (error) {
      console.error(error);
      setStatus("本机恢复缓存失败：数据过大");
    }
    saveTimer = setTimeout(() => void persistMind(false), 700);
  };
  for (const historyAction of ["undo", "redo"]) {
    const nativeHistoryAction = mind[historyAction]?.bind(mind);
    if (!nativeHistoryAction) continue;
    mind[historyAction] = (...args) => {
      const focusedNodeId = mind.isFocusMode ? mind.nodeData?.id : undefined;
      if (focusedNodeId) mind.cancelFocus();
      const result = nativeHistoryAction(...args);
      if (focusedNodeId) {
        const focusedTopic = findMindTopic(mind, focusedNodeId);
        if (focusedTopic) {
          mind.focusNode(focusedTopic);
          selectAndCenterMindNode(mind, focusedNodeId);
        }
      }
      scheduleMindPersistence();
      refreshDecoratedLayout(mind);
      return result;
    };
  }
  mind.bus.addListener("operation", (operation) => {
    if (operation?.name === "beginEdit") {
      if (operation?.obj?.id !== pendingKeyboardAdd?.nodeId) pendingKeyboardAdd = undefined;
      return;
    }
    if (operation?.name === "toggleExpand" && searchExpansionSnapshot && operation?.obj?.id) {
      searchManualExpansionChanges.add(operation.obj.id);
    }
    const keyboardAddInProgress = ["addChild", "insertSibling", "insertParent"].includes(operation?.name) &&
      operation?.obj?.id === pendingKeyboardAdd?.nodeId;
    if (operation?.name === "finishEdit" && operation?.obj?.id === pendingKeyboardAdd?.nodeId) {
      pendingKeyboardAdd = undefined;
    }
    scheduleMindPersistence();
    if (keyboardAddInProgress) {
      decorateNodes(mind);
      // The fast keyboard path intentionally skips a full refresh; it still
      // needs an immediate branch/layout redraw after MindElixir inserts the
      // new node, otherwise the connector remains at the previous position.
      redrawVisibleBranches();
      queueWorkspaceRender(mind, true);
      return;
    }
    refreshDecoratedLayout(mind);
    queueWorkspaceRender(mind);
  });
  mind.bus.addListener("selectNodes", () => {
    updateToolbar(mind);
    queueWorkspaceSelectionSync(mind, true);
  });
  mind.bus.addListener("unselectNodes", () => {
    updateToolbar(mind);
    queueWorkspaceSelectionSync(mind);
  });
  nodeTools.addEventListener("pointerdown", (event) => event.stopPropagation());
  nodeTools.addEventListener("click", async (event) => {
    event.preventDefault();
    event.stopPropagation();
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
    redrawVisibleBranches();
  });
  searchToggle.addEventListener("click", () => {
    setWorkspaceOpen(mind, true, true);
    queueWorkspaceRender(mind);
  });
  shortcutToggle.addEventListener("click", () => {
    setShortcutDialogOpen(shortcutDialog.hidden);
  });
  shortcutClose.addEventListener("click", () => {
    setShortcutDialogOpen(false);
    mind.currentNode?.focus?.();
  });
  focusExit.addEventListener("click", () => toggleBranchFocus(mind));
  outlineToggle.addEventListener("click", () => {
    const open = !document.body.classList.contains("workspace-open");
    setWorkspaceOpen(mind, open);
    if (open) queueWorkspaceRender(mind, true);
  });
  workspaceClose.addEventListener("click", () => setWorkspaceOpen(mind, false));
  workspaceSearch.addEventListener("input", () => {
    const query = workspaceSearch.value.trim();
    if (query && !lastSearchQuery) beginSearchExpansionSession(mind);
    if (!query && lastSearchQuery) endSearchExpansionSession(mind);
    if (query !== lastSearchQuery) {
      lastSearchQuery = query;
      lastSearchResultId = undefined;
    }
    queueWorkspaceRender(mind);
  });
  workspaceSearch.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      goToSearchResult(mind, event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setWorkspaceOpen(mind, false);
      mind.currentNode?.focus?.();
    }
  });
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && key === "s") {
      event.preventDefault();
      if (isTextEditingTarget(event.target)) event.target.blur?.();
      void persistMind(false);
      return;
    }
    const keyboardCreateKey = key === "tab" || event.code === "Tab" || event.keyCode === 9
      ? "tab"
      : ["enter", "return"].includes(key) ||
          ["Enter", "NumpadEnter"].includes(event.code) ||
          event.keyCode === 13
        ? "enter"
        : undefined;
    const editingText = isTextEditingTarget(event.target);
    const mindHasFocus = mind.container?.contains?.(document.activeElement) ||
      mind.container?.contains?.(event.target);
    const shortcutAction = resolveMindShortcut(event, {
      editing: editingText,
      helpOpen: !shortcutDialog.hidden,
      workspaceOpen: document.body.classList.contains("workspace-open"),
      focusMode: Boolean(mind.isFocusMode),
      hasSelection: Boolean(mind.currentNode),
      hasChildren: Boolean(mind.currentNode?.nodeObj?.children?.length)
    });
    if (shortcutAction) {
      event.preventDefault();
      event.stopPropagation();
      if (shortcutAction === "toggle-help") setShortcutDialogOpen(shortcutDialog.hidden);
      else if (shortcutAction === "close-help") {
        setShortcutDialogOpen(false);
        mind.currentNode?.focus?.();
      } else if (shortcutAction === "close-workspace") {
        setWorkspaceOpen(mind, false);
        mind.currentNode?.focus?.();
      } else if (shortcutAction === "exit-focus") {
        toggleBranchFocus(mind);
      } else if (shortcutAction === "toggle-branch") toggleSelectedBranch(mind);
      else if (shortcutAction === "focus-root") focusRootTopic(mind);
      return;
    }
    if (
      !editingText &&
      mindHasFocus &&
      mind.currentNode &&
      keyboardCreateKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (keyboardCreateKey === "tab") addKeyboardChild(mind, event);
      else addKeyboardRelative(mind, event);
      return;
    }
    if (
      !editingText &&
      mindHasFocus &&
      mind.currentNode &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey &&
      !event.isComposing &&
      event.key.length === 1
    ) {
      beginDirectMindEditing(mind, event);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === "f") {
      event.preventDefault();
      event.stopPropagation();
      setWorkspaceOpen(mind, true, true);
      queueWorkspaceRender(mind);
      return;
    }
    if (event.key === "F3" && workspaceSearch.value.trim()) {
      event.preventDefault();
      event.stopPropagation();
      setWorkspaceOpen(mind, true);
      goToSearchResult(mind, event.shiftKey ? -1 : 1);
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || !["z", "y"].includes(key)) return;
    const target = event.target;
    if (
      key === "z" &&
      !event.shiftKey &&
      target instanceof HTMLElement &&
      target.id === "input-box" &&
      target.dataset.keyboardNodeId &&
      target.dataset.keyboardDirty !== "true"
    ) {
      event.preventDefault();
      event.stopPropagation();
      target.textContent = target.dataset.keyboardInitialTopic || "输入文字";
      target.blur();
      pendingKeyboardAdd = undefined;
      mind.undo();
      return;
    }
    if (editingText) return;
    event.preventDefault();
    event.stopPropagation();
    if (key === "y" || (key === "z" && event.shiftKey)) mind.redo();
    else mind.undo();
  }, true);
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || target.id !== "input-box") return;
    resizeMindInputBox(target);
    if (target.dataset.keyboardNodeId) {
      target.dataset.keyboardDirty = String(
        (target.innerText?.trim() || "") !== (target.dataset.keyboardInitialTopic || "")
      );
    }
    if (pendingKeyboardAdd) {
      pendingKeyboardAdd.dirty = (target.innerText?.trim() || "") !== pendingKeyboardAdd.initialTopic;
    }
  }, true);
  document.addEventListener("compositionend", (event) => {
    resizeMindInputBox(event.target);
  }, true);
  const observer = new MutationObserver((records) => {
    const onlyInputMutations = records.every((record) => {
      const target = record.target instanceof HTMLElement
        ? record.target
        : record.target.parentElement;
      return target?.closest?.("#input-box");
    });
    if (onlyInputMutations) {
      resizeMindInputBox(document.querySelector("#input-box"));
      return;
    }
    queuePassiveDecorations(mind);
  });
  observer.observe(document.querySelector("#map"), { childList: true, subtree: true });
  decorateNodes(mind);
  renderWorkspace(mind);
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
