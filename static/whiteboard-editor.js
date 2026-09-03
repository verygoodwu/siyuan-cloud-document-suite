import { SaveConflictError, SiyuanFileStore } from "./siyuan-file-store.js?v=__PLUGIN_VERSION__";
import {
  anchorForDirection,
  cloneWhiteboardDocument,
  connectorPath,
  createWhiteboardNode,
  detachWhiteboardReferences,
  documentBounds,
  duplicateWhiteboardNodes,
  endpointPosition,
  frameWhiteboardNodes,
  groupWhiteboardNodes,
  nodeBounds,
  normalizeWhiteboardDocument,
  oppositeAnchor,
  parseWhiteboardDocument,
  resizeWhiteboardNode,
  reorderWhiteboardNodes,
  resolveWhiteboardSelection,
  serializeWhiteboardDocument,
  ungroupWhiteboardNodes
} from "./whiteboard-model.js?v=__PLUGIN_VERSION__";
import {
  alignWhiteboardNodes,
  autoLayoutWhiteboardNodes,
  distributeWhiteboardNodes,
  nodesInMarquee
} from "./whiteboard-layout.js?v=__PLUGIN_VERSION__";
import {
  connectableNodeAtPoint,
  selectionBounds,
  snapWhiteboardMove
} from "./whiteboard-interactions.js?v=__PLUGIN_VERSION__";
import { instantiateWhiteboardTemplate } from "./whiteboard-templates.js?v=__PLUGIN_VERSION__";
import {
  buildWhiteboardSvg,
  renderSelection,
  renderWhiteboard,
  renderWhiteboardNodes,
  updateViewportTransform
} from "./whiteboard-renderer.js?v=__PLUGIN_VERSION__";

const params = new URLSearchParams(location.search);
const asset = params.get("asset");
const assetFileName = (() => {
  try { return decodeURIComponent(asset?.split("/").pop() || "新建白板.board.json"); }
  catch { return "新建白板.board.json"; }
})();
const storageKey = `siyuan-whiteboard-editor:${asset}`;
const store = new SiyuanFileStore(asset, storageKey);
const encoder = new TextEncoder();

const shell = document.querySelector("#canvas-shell");
const board = document.querySelector("#board");
const viewportLayer = document.querySelector("#viewport-layer");
const nodeLayer = document.querySelector("#node-layer");
const draftLayer = document.querySelector("#draft-layer");
const selectionLayer = document.querySelector("#selection-layer");
const status = document.querySelector("#status");
const loading = document.querySelector("#loading");
const emptyTip = document.querySelector("#empty-tip");
const selectionToolbar = document.querySelector("#selection-toolbar");
const textEditor = document.querySelector("#text-editor");
const textEditorInput = document.querySelector("#text-editor-input");
const conflictNotice = document.querySelector("#conflict-notice");
const zoomValue = document.querySelector("#zoom-value");
const undoButton = document.querySelector("#undo");
const redoButton = document.querySelector("#redo");
const fillColor = document.querySelector("#fill-color");
const strokeColor = document.querySelector("#stroke-color");
const textColor = document.querySelector("#text-color");
const fillSwatch = document.querySelector("#fill-swatch");
const strokeSwatch = document.querySelector("#stroke-swatch");
const textSwatch = document.querySelector("#text-swatch");
const fontSize = document.querySelector("#font-size");
const boldButton = document.querySelector("#bold");
const lineShape = document.querySelector("#line-shape");
const shapeMenu = document.querySelector("#shape-menu");
const arrangeAction = document.querySelector("#arrange-action");
const layerAction = document.querySelector("#layer-action");
const templateDialog = document.querySelector("#template-dialog");

let whiteboard;
let selectedIds = new Set();
let tool = "select";
let temporaryHand = false;
let interaction = null;
let saveTimer;
let viewportSaveTimer;
let saving = false;
let saveAgain = false;
let revision = 0;
let savedRevision = 0;
let history = [];
let historyIndex = -1;
let clipboardNodes = [];
let editingNodeId = null;
const DRAG_THRESHOLD_PX = 5;

function setStatus(message, state = "idle") {
  status.textContent = message;
  status.dataset.state = state;
  status.title = message;
}

function currentViewport() {
  return whiteboard.viewport;
}

function screenToWorld(clientX, clientY) {
  const rect = shell.getBoundingClientRect();
  const viewport = currentViewport();
  return {
    x: (clientX - rect.left - viewport.x) / viewport.zoom,
    y: (clientY - rect.top - viewport.y) / viewport.zoom
  };
}

function worldToScreen(x, y) {
  const viewport = currentViewport();
  return { x: viewport.x + x * viewport.zoom, y: viewport.y + y * viewport.zoom };
}

function nodeById(id) {
  return whiteboard.nodes.find((node) => node.id === id);
}

function nodeIdFromTarget(target) {
  return target instanceof Element ? target.closest("[data-node-id]")?.getAttribute("data-node-id") : null;
}

function nodeAnchorFromPoint(node, point) {
  const bounds = nodeBounds(node);
  const distances = {
    top: Math.abs(point.y - bounds.y),
    right: Math.abs(point.x - bounds.right),
    bottom: Math.abs(point.y - bounds.bottom),
    left: Math.abs(point.x - bounds.x)
  };
  return Object.entries(distances).sort((a, b) => a[1] - b[1])[0][0];
}

function setTool(next) {
  tool = next;
  shell.className = `canvas-shell tool-${next}`;
  document.querySelectorAll("[data-tool]").forEach((button) => button.classList.toggle("active", button.dataset.tool === next));
  shapeMenu.hidden = true;
}

function selectedNodes() {
  return whiteboard.nodes.filter((node) => selectedIds.has(node.id));
}

function effectiveSelectedIds() {
  return resolveWhiteboardSelection(whiteboard, [...selectedIds]);
}

function effectiveSelectedNodes() {
  const ids = effectiveSelectedIds();
  return whiteboard.nodes.filter((node) => ids.has(node.id));
}

function render() {
  updateViewportTransform(viewportLayer, currentViewport());
  renderWhiteboard(whiteboard, nodeLayer, selectedIds);
  const bounds = renderSelection(whiteboard, selectedIds, selectionLayer);
  emptyTip.hidden = whiteboard.nodes.length > 0;
  zoomValue.textContent = `${Math.round(currentViewport().zoom * 100)}%`;
  syncSelectionToolbar();
  positionSelectionToolbar(bounds);
  undoButton.disabled = historyIndex <= 0;
  redoButton.disabled = historyIndex >= history.length - 1;
}

function renderSelectionOnly() {
  nodeLayer.querySelectorAll("[data-node-id]").forEach((element) => {
    element.classList.toggle("selected", selectedIds.has(element.getAttribute("data-node-id")));
  });
  const bounds = renderSelection(whiteboard, selectedIds, selectionLayer);
  syncSelectionToolbar();
  positionSelectionToolbar(bounds);
}

function renderViewportOnly() {
  updateViewportTransform(viewportLayer, currentViewport());
  zoomValue.textContent = `${Math.round(currentViewport().zoom * 100)}%`;
  const bounds = selectedIds.size ? selectionBounds(whiteboard, [...selectedIds]) : null;
  positionSelectionToolbar(bounds);
}

function renderInteractionNodes(nodeIds) {
  renderWhiteboardNodes(whiteboard, nodeLayer, nodeIds, selectedIds);
  const bounds = renderSelection(whiteboard, selectedIds, selectionLayer);
  positionSelectionToolbar(bounds);
}

function positionSelectionToolbar(bounds) {
  if (!bounds || selectedIds.size === 0 || editingNodeId) {
    selectionToolbar.hidden = true;
    return;
  }
  selectionToolbar.hidden = false;
  const width = selectionToolbar.offsetWidth || 280;
  const height = selectionToolbar.offsetHeight || 46;
  const top = worldToScreen(bounds.x + bounds.width / 2, bounds.y);
  const bottom = worldToScreen(bounds.x + bounds.width / 2, bounds.bottom);
  const quickClearance = selectedIds.size === 1 && !["connector", "freehand", "image", "text"].includes(selectedNodes()[0]?.type)
    ? 28 * currentViewport().zoom + 18
    : 14;
  const aboveY = top.y - quickClearance;
  const belowY = bottom.y + quickClearance;
  const placeBelow = aboveY - height < 8;
  selectionToolbar.dataset.placement = placeBelow ? "below" : "above";
  selectionToolbar.style.left = `${Math.min(shell.clientWidth - width / 2 - 8, Math.max(width / 2 + 8, top.x))}px`;
  selectionToolbar.style.top = `${placeBelow ? Math.min(shell.clientHeight - height - 8, belowY) : aboveY}px`;
}

function safeHex(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback;
}

function syncSelectionToolbar() {
  const nodes = selectedNodes();
  document.querySelectorAll("[data-single-selection]").forEach((element) => { element.hidden = nodes.length !== 1; });
  const shapeCount = nodes.filter((node) => node.type !== "connector").length;
  arrangeAction.hidden = shapeCount < 2;
  document.querySelector("#group").hidden = shapeCount < 2;
  document.querySelector("#ungroup").hidden = !nodes.some((node) => node.groupId);
  document.querySelector("#create-frame").hidden = shapeCount < 1;
  if (nodes.length !== 1) return;
  const node = nodes[0];
  fillColor.value = safeHex(node.style.fill, "#ffffff");
  strokeColor.value = safeHex(node.style.stroke, "#4e83fd");
  textColor.value = safeHex(node.style.textColor, "#1f2329");
  fillSwatch.style.setProperty("--swatch", node.style.fill);
  strokeSwatch.style.setProperty("--swatch", node.style.stroke);
  textSwatch.style.setProperty("--swatch", node.style.textColor);
  fontSize.value = String([12, 14, 16, 18, 24, 32, 48].reduce((best, size) => Math.abs(size - node.style.fontSize) < Math.abs(best - node.style.fontSize) ? size : best, 16));
  boldButton.classList.toggle("active", node.style.fontWeight === "bold");
  lineShape.hidden = node.type !== "connector";
  if (node.type === "connector") lineShape.value = node.lineShape;
}

function historySnapshot() {
  return JSON.stringify(whiteboard);
}

function resetHistory() {
  history = [historySnapshot()];
  historyIndex = 0;
  render();
}

function pushHistory() {
  const snapshot = historySnapshot();
  if (history[historyIndex] === snapshot) return;
  history.splice(historyIndex + 1);
  history.push(snapshot);
  if (history.length > 100) history.shift();
  historyIndex = history.length - 1;
}

function cacheAndScheduleSave(message = "正在保存…") {
  revision += 1;
  store.cacheRecovery(whiteboard);
  setStatus(message, "saving");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void persist(false), 700);
}

function scheduleViewportSave() {
  window.clearTimeout(viewportSaveTimer);
  viewportSaveTimer = window.setTimeout(() => cacheAndScheduleSave("正在保存视图…"), 180);
}

function commitChange({ history: withHistory = true } = {}) {
  whiteboard.updatedAt = new Date().toISOString();
  if (withHistory) pushHistory();
  cacheAndScheduleSave();
  render();
}

async function persist(force) {
  window.clearTimeout(saveTimer);
  if (saving) {
    saveAgain = true;
    return;
  }
  saving = true;
  const targetRevision = revision;
  try {
    setStatus("正在保存…", "saving");
    await store.save(serializeWhiteboardDocument(whiteboard), { force });
    savedRevision = targetRevision;
    conflictNotice.hidden = true;
    if (revision === savedRevision) setStatus("已保存到思源", "saved");
  } catch (error) {
    if (error instanceof SaveConflictError) {
      conflictNotice.hidden = false;
      setStatus("保存冲突，已保留本地修改", "error");
    } else {
      console.error("[Cloud Document Suite] Cannot save whiteboard", error);
      setStatus(`保存失败：${error.message || error}`, "error");
    }
  } finally {
    saving = false;
    if (saveAgain || revision > savedRevision) {
      saveAgain = false;
      saveTimer = window.setTimeout(() => void persist(false), 900);
    }
  }
}

function restoreHistory(nextIndex) {
  if (nextIndex < 0 || nextIndex >= history.length || nextIndex === historyIndex) return;
  const previous = whiteboard;
  historyIndex = nextIndex;
  const restored = normalizeWhiteboardDocument(JSON.parse(history[historyIndex]));
  const previousOrder = previous.nodes.map((node) => node.id);
  const restoredOrder = restored.nodes.map((node) => node.id);
  const orderUnchanged = previousOrder.length === restoredOrder.length
    && previousOrder.every((id, index) => id === restoredOrder[index]);
  const previousNodes = new Map(previous.nodes.map((node) => [node.id, JSON.stringify(node)]));
  const restoredNodes = new Map(restored.nodes.map((node) => [node.id, JSON.stringify(node)]));
  const changedIds = new Set([...previousNodes.keys(), ...restoredNodes.keys()].filter((id) => previousNodes.get(id) !== restoredNodes.get(id)));
  whiteboard = restored;
  selectedIds = new Set([...selectedIds].filter((id) => nodeById(id)));
  cacheAndScheduleSave();
  if (orderUnchanged && changedIds.size <= 64) {
    updateViewportTransform(viewportLayer, currentViewport());
    renderWhiteboardNodes(whiteboard, nodeLayer, changedIds, selectedIds);
    const bounds = renderSelection(whiteboard, selectedIds, selectionLayer);
    emptyTip.hidden = whiteboard.nodes.length > 0;
    zoomValue.textContent = `${Math.round(currentViewport().zoom * 100)}%`;
    syncSelectionToolbar();
    positionSelectionToolbar(bounds);
    undoButton.disabled = historyIndex <= 0;
    redoButton.disabled = historyIndex >= history.length - 1;
  } else render();
}

function selectOnly(id) {
  selectedIds = id ? new Set([id]) : new Set();
  render();
}

function createNodeAt(type, point, overrides = {}) {
  const sizes = {
    rect: [168, 88], ellipse: [168, 96], diamond: [168, 104],
    sticky: [168, 148], text: [180, 52], image: [260, 180]
  };
  const [width, height] = sizes[type] || [168, 88];
  const node = createWhiteboardNode(type, {
    x: point.x - width / 2,
    y: point.y - height / 2,
    width,
    height,
    text: "",
    ...overrides
  });
  whiteboard.nodes.push(node);
  selectedIds = new Set([node.id]);
  commitChange();
  return node;
}

function connectedNodeSize(source) {
  return {
    width: Math.max(96, Math.min(320, source.width || 168)),
    height: Math.max(52, Math.min(220, source.height || 88))
  };
}

function connectedNodeType(source) {
  return ["rect", "ellipse", "diamond", "sticky"].includes(source.type) ? source.type : "rect";
}

function directionBetween(source, point) {
  const bounds = nodeBounds(source);
  const dx = point.x - (bounds.x + bounds.width / 2);
  const dy = point.y - (bounds.y + bounds.height / 2);
  return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top");
}

function createConnectedNodeAt(source, center, direction = directionBetween(source, center), edit = true) {
  const size = connectedNodeSize(source);
  const target = createWhiteboardNode(connectedNodeType(source), {
    x: center.x - size.width / 2,
    y: center.y - size.height / 2,
    width: size.width,
    height: size.height,
    text: "",
    style: JSON.parse(JSON.stringify(source.style))
  });
  const connector = createWhiteboardNode("connector", {
    from: { nodeId: source.id, anchor: anchorForDirection(direction) },
    to: { nodeId: target.id, anchor: oppositeAnchor(direction) }
  });
  whiteboard.nodes.push(connector, target);
  selectedIds = new Set([target.id]);
  commitChange();
  if (edit) beginTextEditing(target);
  return target;
}

function createConnectedNode(source, direction = "right", edit = true) {
  const bounds = nodeBounds(source);
  const size = connectedNodeSize(source);
  const gap = 72;
  const targetPoint = {
    top: { x: bounds.x + bounds.width / 2, y: bounds.y - gap - size.height / 2 },
    right: { x: bounds.right + gap + size.width / 2, y: bounds.y + bounds.height / 2 },
    bottom: { x: bounds.x + bounds.width / 2, y: bounds.bottom + gap + size.height / 2 },
    left: { x: bounds.x - gap - size.width / 2, y: bounds.y + bounds.height / 2 }
  }[direction];
  return createConnectedNodeAt(source, targetPoint, direction, edit);
}

function deleteSelection() {
  if (!selectedIds.size) return;
  const deleting = new Set(selectedIds);
  detachWhiteboardReferences(whiteboard, deleting);
  whiteboard.nodes = whiteboard.nodes.filter((node) => {
    if (deleting.has(node.id)) return false;
    if (node.type === "connector" && (deleting.has(node.from?.nodeId) || deleting.has(node.to?.nodeId))) return false;
    return true;
  });
  selectedIds.clear();
  commitChange();
}

function duplicateSelection() {
  if (!selectedIds.size) return;
  selectedIds = new Set(duplicateWhiteboardNodes(whiteboard, selectedIds));
  commitChange();
}

function copySelection() {
  clipboardNodes = selectedNodes().map((node) => JSON.parse(JSON.stringify(node)));
}

function pasteSelection() {
  if (!clipboardNodes.length) return;
  const temporary = { ...whiteboard, nodes: clipboardNodes.map((node) => JSON.parse(JSON.stringify(node))) };
  const ids = clipboardNodes.map((node) => node.id);
  const copied = duplicateWhiteboardNodes(temporary, ids, 36).map((id) => temporary.nodes.find((node) => node.id === id));
  whiteboard.nodes.push(...copied);
  selectedIds = new Set(copied.map((node) => node.id));
  clipboardNodes = copied.map((node) => JSON.parse(JSON.stringify(node)));
  commitChange();
}

function textEditingBounds(node) {
  if (node.type !== "connector") return nodeBounds(node);
  const from = endpointPosition(whiteboard, node.from);
  const to = endpointPosition(whiteboard, node.to, from);
  const center = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  return { x: center.x - 90, y: center.y - 22, width: 180, height: 44, right: center.x + 90, bottom: center.y + 22 };
}

function beginTextEditing(node, options = {}) {
  if (!node || node.type === "freehand" || node.type === "image") return;
  if (editingNodeId && editingNodeId !== node.id) finishTextEditing();
  editingNodeId = node.id;
  const bounds = textEditingBounds(node);
  const start = worldToScreen(bounds.x, bounds.y);
  textEditor.hidden = false;
  selectionToolbar.hidden = true;
  textEditorInput.textContent = options.replaceWith ?? node.text ?? "";
  textEditorInput.dataset.placeholder = node.type === "connector" ? "输入连线说明" : node.type === "sticky" ? "输入便签内容" : "输入文字";
  textEditor.style.left = `${start.x}px`;
  textEditor.style.top = `${start.y}px`;
  textEditor.style.width = `${Math.max(80, bounds.width * currentViewport().zoom)}px`;
  textEditor.style.height = `${Math.max(38, bounds.height * currentViewport().zoom)}px`;
  textEditorInput.style.fontSize = `${Math.max(12, node.style.fontSize * currentViewport().zoom)}px`;
  textEditorInput.style.color = node.style.textColor;
  textEditorInput.style.textAlign = node.style.textAlign;
  textEditor.dataset.initialValue = node.text || "";
  const focusAndPlaceCaret = () => {
    textEditorInput.focus({ preventScroll: true });
    const range = document.createRange();
    range.selectNodeContents(textEditorInput);
    if (options.selectAll === false) range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  };
  focusAndPlaceCaret();
  requestAnimationFrame(() => {
    if (document.activeElement !== textEditorInput) focusAndPlaceCaret();
  });
}

function finishTextEditing(cancel = false) {
  if (!editingNodeId) return;
  const node = nodeById(editingNodeId);
  const initial = textEditor.dataset.initialValue || "";
  if (node && !cancel) node.text = (textEditorInput.innerText || textEditorInput.textContent || "").replace(/\r/g, "").slice(0, 20000);
  textEditor.hidden = true;
  editingNodeId = null;
  if (node && !cancel && node.text !== initial) commitChange();
  else render();
}

function beginMove(event, id, point) {
  const additive = event.shiftKey || event.ctrlKey || event.metaKey;
  if (!selectedIds.has(id)) {
    const next = resolveWhiteboardSelection(whiteboard, [id]);
    selectedIds = additive ? new Set([...selectedIds, ...next]) : next;
  }
  else if (additive) {
    selectedIds.delete(id);
    render();
    return;
  }
  const selectedNode = nodeById(id);
  if (selectedNode?.type === "connector") {
    renderSelectionOnly();
    return;
  }
  const originals = new Map();
  for (const node of effectiveSelectedNodes()) originals.set(node.id, JSON.parse(JSON.stringify(node)));
  const movedIds = [...originals.keys()].filter((nodeId) => nodeById(nodeId)?.type !== "connector");
  interaction = {
    type: "move",
    pointerId: event.pointerId,
    start: point,
    startClient: { x: event.clientX, y: event.clientY },
    originals,
    movedIds,
    originalBounds: selectionBounds(whiteboard, movedIds),
    duplicateOnDrag: event.altKey,
    duplicated: false,
    dragging: false,
    changed: false
  };
  shell.setPointerCapture(event.pointerId);
  renderSelectionOnly();
}

function beginResize(event, handle, point) {
  const node = selectedNodes()[0];
  if (!node || selectedIds.size !== 1) return;
  interaction = {
    type: "resize",
    pointerId: event.pointerId,
    start: point,
    handle,
    nodeId: node.id,
    originalNode: JSON.parse(JSON.stringify(node)),
    originalBounds: nodeBounds(node),
    changed: false
  };
  shell.setPointerCapture(event.pointerId);
}

function beginPan(event) {
  interaction = {
    type: "pan",
    pointerId: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    original: { ...currentViewport() },
    changed: false
  };
  shell.classList.add("dragging");
  shell.setPointerCapture(event.pointerId);
}

function beginPen(event, point) {
  interaction = { type: "pen", pointerId: event.pointerId, points: [point], changed: false };
  shell.setPointerCapture(event.pointerId);
}

function drawDraftPath(path, stroke = "#3370ff") {
  draftLayer.replaceChildren();
  const element = document.createElementNS("http://www.w3.org/2000/svg", "path");
  element.setAttribute("d", path);
  element.setAttribute("fill", "none");
  element.setAttribute("stroke", stroke);
  element.setAttribute("stroke-width", "2");
  element.setAttribute("stroke-dasharray", "6 5");
  element.setAttribute("vector-effect", "non-scaling-stroke");
  draftLayer.append(element);
}

function drawMarquee(start, current) {
  draftLayer.replaceChildren();
  const rectangle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rectangle.setAttribute("x", String(Math.min(start.x, current.x)));
  rectangle.setAttribute("y", String(Math.min(start.y, current.y)));
  rectangle.setAttribute("width", String(Math.abs(current.x - start.x)));
  rectangle.setAttribute("height", String(Math.abs(current.y - start.y)));
  rectangle.setAttribute("fill", "#3370ff18");
  rectangle.setAttribute("stroke", "#3370ff");
  rectangle.setAttribute("stroke-dasharray", "6 5");
  rectangle.setAttribute("vector-effect", "non-scaling-stroke");
  draftLayer.append(rectangle);
}

function drawSnapIndicators(indicators = []) {
  draftLayer.replaceChildren();
  for (const indicator of indicators) {
    if (indicator.type === "align-x") {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "snap-guide");
      line.setAttribute("x1", indicator.x); line.setAttribute("x2", indicator.x);
      line.setAttribute("y1", indicator.y1 - 20); line.setAttribute("y2", indicator.y2 + 20);
      draftLayer.append(line);
    } else if (indicator.type === "align-y") {
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("class", "snap-guide");
      line.setAttribute("x1", indicator.x1 - 20); line.setAttribute("x2", indicator.x2 + 20);
      line.setAttribute("y1", indicator.y); line.setAttribute("y2", indicator.y);
      draftLayer.append(line);
    } else if (indicator.type === "gap-x") {
      for (const [x1, x2] of [[indicator.x1, indicator.x2], [indicator.x3, indicator.x4]]) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("class", "snap-guide"); line.setAttribute("x1", x1); line.setAttribute("x2", x2); line.setAttribute("y1", indicator.y); line.setAttribute("y2", indicator.y);
        draftLayer.append(line);
      }
    } else if (indicator.type === "gap-y") {
      for (const [y1, y2] of [[indicator.y1, indicator.y2], [indicator.y3, indicator.y4]]) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("class", "snap-guide"); line.setAttribute("x1", indicator.x); line.setAttribute("x2", indicator.x); line.setAttribute("y1", y1); line.setAttribute("y2", y2);
        draftLayer.append(line);
      }
    }
  }
}

function setConnectionTarget(id) {
  nodeLayer.querySelectorAll(".connection-target").forEach((element) => element.classList.remove("connection-target"));
  if (id) nodeLayer.querySelector(`[data-node-id="${CSS.escape(id)}"]`)?.classList.add("connection-target");
}

function drawQuickCreatePreview(source, point) {
  draftLayer.replaceChildren();
  const direction = directionBetween(source, point);
  const size = connectedNodeSize(source);
  const preview = createWhiteboardNode(connectedNodeType(source), {
    x: point.x - size.width / 2,
    y: point.y - size.height / 2,
    width: size.width,
    height: size.height,
    style: JSON.parse(JSON.stringify(source.style))
  });
  const connector = createWhiteboardNode("connector", {
    from: { nodeId: source.id, anchor: direction },
    to: { nodeId: preview.id, anchor: oppositeAnchor(direction) }
  });
  const previewDocument = { ...whiteboard, nodes: [...whiteboard.nodes, preview] };
  drawDraftPath(connectorPath(previewDocument, connector));
  const rectangle = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rectangle.setAttribute("x", preview.x); rectangle.setAttribute("y", preview.y);
  rectangle.setAttribute("width", preview.width); rectangle.setAttribute("height", preview.height);
  rectangle.setAttribute("rx", "9"); rectangle.setAttribute("fill", `${source.style.fill === "transparent" ? "#ffffff" : source.style.fill}`);
  rectangle.setAttribute("fill-opacity", "0.65"); rectangle.setAttribute("stroke", "#3370ff"); rectangle.setAttribute("stroke-dasharray", "6 5");
  rectangle.setAttribute("vector-effect", "non-scaling-stroke");
  draftLayer.append(rectangle);
}

function beginQuickCreate(event, source, direction) {
  interaction = {
    type: "quick-create",
    pointerId: event.pointerId,
    sourceId: source.id,
    direction,
    startClient: { x: event.clientX, y: event.clientY },
    current: screenToWorld(event.clientX, event.clientY),
    dragging: false
  };
  shell.setPointerCapture(event.pointerId);
}

function beginReconnect(event, connector, end) {
  interaction = {
    type: "reconnect",
    pointerId: event.pointerId,
    connectorId: connector.id,
    end,
    original: JSON.parse(JSON.stringify(connector)),
    current: screenToWorld(event.clientX, event.clientY),
    targetId: null
  };
  shell.setPointerCapture(event.pointerId);
}

function beginConnector(event, id, point) {
  const source = nodeById(id);
  if (!source || source.type === "connector" || source.type === "freehand") return;
  interaction = {
    type: "connector",
    pointerId: event.pointerId,
    sourceId: id,
    sourceAnchor: nodeAnchorFromPoint(source, point),
    current: point
  };
  shell.setPointerCapture(event.pointerId);
}

function onPointerDown(event) {
  if (![0, 1, 2].includes(event.button)) return;
  if (event.button === 2) event.preventDefault();
  if (editingNodeId) finishTextEditing();
  const point = screenToWorld(event.clientX, event.clientY);
  const resizeHandle = event.target instanceof Element ? event.target.closest("[data-resize-handle]")?.getAttribute("data-resize-handle") : null;
  const quickAnchor = event.target instanceof Element ? event.target.closest("[data-quick-anchor]")?.getAttribute("data-quick-anchor") : null;
  const connectorEnd = event.target instanceof Element ? event.target.closest("[data-connector-end]")?.getAttribute("data-connector-end") : null;
  const id = nodeIdFromTarget(event.target);
  if (event.button === 1 || event.button === 2 || tool === "hand" || temporaryHand) {
    beginPan(event);
    return;
  }
  if (tool === "select" && id && event.detail >= 2) {
    selectedIds = new Set([id]);
    render();
    beginTextEditing(nodeById(id));
    return;
  }
  if (connectorEnd) {
    const connector = selectedNodes()[0];
    if (connector?.type === "connector") beginReconnect(event, connector, connectorEnd);
    return;
  }
  if (quickAnchor) {
    const source = selectedNodes()[0];
    if (source) beginQuickCreate(event, source, quickAnchor);
    return;
  }
  if (resizeHandle) {
    beginResize(event, resizeHandle, point);
    return;
  }
  if (tool === "pen") {
    beginPen(event, point);
    return;
  }
  if (tool === "connector") {
    if (id) beginConnector(event, id, point);
    return;
  }
  if (["rect", "ellipse", "diamond", "sticky", "text"].includes(tool)) {
    const node = createNodeAt(tool, point);
    setTool("select");
    beginTextEditing(node);
    return;
  }
  if (id) beginMove(event, id, point);
  else {
    interaction = { type: "marquee", pointerId: event.pointerId, start: point, current: point, additive: event.shiftKey || event.ctrlKey || event.metaKey };
    shell.setPointerCapture(event.pointerId);
    if (!(event.shiftKey || event.ctrlKey || event.metaKey)) selectedIds.clear();
    renderSelectionOnly();
  }
}

function onPointerMove(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const point = screenToWorld(event.clientX, event.clientY);
  if (interaction.type === "pan") {
    const dx = event.clientX - interaction.clientX;
    const dy = event.clientY - interaction.clientY;
    whiteboard.viewport.x = interaction.original.x + dx;
    whiteboard.viewport.y = interaction.original.y + dy;
    interaction.changed ||= Math.abs(dx) + Math.abs(dy) > 1;
    renderViewportOnly();
    return;
  }
  if (interaction.type === "move") {
    const screenDistance = Math.hypot(event.clientX - interaction.startClient.x, event.clientY - interaction.startClient.y);
    if (!interaction.dragging && screenDistance < DRAG_THRESHOLD_PX) return;
    if (!interaction.dragging) {
      interaction.dragging = true;
      if (interaction.duplicateOnDrag) {
        const duplicateIds = duplicateWhiteboardNodes(whiteboard, interaction.movedIds, 0);
        selectedIds = new Set(duplicateIds);
        interaction.movedIds = duplicateIds;
        interaction.originals = new Map(duplicateIds.map((id) => [id, JSON.parse(JSON.stringify(nodeById(id)))]) );
        interaction.originalBounds = selectionBounds(whiteboard, duplicateIds);
        interaction.duplicated = true;
      }
    }
    const rawDx = point.x - interaction.start.x;
    const rawDy = point.y - interaction.start.y;
    const snapped = event.ctrlKey || event.metaKey
      ? { dx: rawDx, dy: rawDy, indicators: [] }
      : snapWhiteboardMove(whiteboard, interaction.movedIds, interaction.originalBounds, rawDx, rawDy, currentViewport().zoom);
    const { dx, dy } = snapped;
    for (const [id, original] of interaction.originals) {
      const node = nodeById(id);
      if (!node) continue;
      if (node.type === "freehand") node.points = original.points.map((item) => ({ x: item.x + dx, y: item.y + dy }));
      else if (node.type !== "connector") { node.x = original.x + dx; node.y = original.y + dy; }
    }
    interaction.changed = true;
    renderInteractionNodes(interaction.movedIds);
    drawSnapIndicators(snapped.indicators);
    return;
  }
  if (interaction.type === "resize") {
    const node = nodeById(interaction.nodeId);
    if (!node) return;
    const before = interaction.originalBounds;
    let x = before.x;
    let y = before.y;
    let right = before.right;
    let bottom = before.bottom;
    if (interaction.handle.includes("w")) x = Math.min(point.x, right - 24);
    if (interaction.handle.includes("e")) right = Math.max(point.x, x + 24);
    if (interaction.handle.includes("n")) y = Math.min(point.y, bottom - 24);
    if (interaction.handle.includes("s")) bottom = Math.max(point.y, y + 24);
    Object.assign(node, JSON.parse(JSON.stringify(interaction.originalNode)));
    resizeWhiteboardNode(node, { x, y, width: right - x, height: bottom - y });
    interaction.changed = true;
    renderInteractionNodes([interaction.nodeId]);
    return;
  }
  if (interaction.type === "pen") {
    const previous = interaction.points.at(-1);
    if (Math.hypot(point.x - previous.x, point.y - previous.y) >= 2 / currentViewport().zoom) interaction.points.push(point);
    const path = `M ${interaction.points.map((item) => `${item.x} ${item.y}`).join(" L ")}`;
    drawDraftPath(path);
    interaction.changed = true;
    return;
  }
  if (interaction.type === "connector") {
    interaction.current = point;
    const target = connectableNodeAtPoint(whiteboard, point, [interaction.sourceId], 12 / currentViewport().zoom);
    interaction.targetId = target?.id || null;
    setConnectionTarget(interaction.targetId);
    const targetEndpoint = target ? { nodeId: target.id, anchor: nodeAnchorFromPoint(target, point) } : point;
    const draft = createWhiteboardNode("connector", {
      from: { nodeId: interaction.sourceId, anchor: interaction.sourceAnchor },
      to: targetEndpoint,
      lineShape: "rightAngle"
    });
    drawDraftPath(connectorPath(whiteboard, draft));
    return;
  }
  if (interaction.type === "quick-create") {
    interaction.current = point;
    interaction.dragging ||= Math.hypot(event.clientX - interaction.startClient.x, event.clientY - interaction.startClient.y) >= DRAG_THRESHOLD_PX;
    if (interaction.dragging) {
      const source = nodeById(interaction.sourceId);
      if (source) drawQuickCreatePreview(source, point);
    }
    return;
  }
  if (interaction.type === "reconnect") {
    interaction.current = point;
    const connector = nodeById(interaction.connectorId);
    if (!connector) return;
    const opposite = interaction.end === "from" ? connector.to : connector.from;
    const target = connectableNodeAtPoint(whiteboard, point, [opposite?.nodeId].filter(Boolean), 12 / currentViewport().zoom);
    interaction.targetId = target?.id || null;
    setConnectionTarget(interaction.targetId);
    const draft = JSON.parse(JSON.stringify(interaction.original));
    draft[interaction.end] = target ? { nodeId: target.id, anchor: nodeAnchorFromPoint(target, point) } : point;
    drawDraftPath(connectorPath(whiteboard, draft));
    return;
  }
  if (interaction.type === "marquee") {
    interaction.current = point;
    drawMarquee(interaction.start, point);
  }
}

function onPointerUp(event) {
  if (!interaction || interaction.pointerId !== event.pointerId) return;
  const finished = interaction;
  interaction = null;
  shell.classList.remove("dragging");
  draftLayer.replaceChildren();
  setConnectionTarget(null);
  if (finished.type === "pan") {
    if (finished.changed) scheduleViewportSave();
    return;
  }
  if (finished.type === "move" || finished.type === "resize") {
    if (finished.changed) commitChange();
    else renderSelectionOnly();
    return;
  }
  if (finished.type === "pen") {
    if (finished.points.length > 1) {
      const node = createWhiteboardNode("freehand", { points: finished.points });
      whiteboard.nodes.push(node);
      selectedIds = new Set([node.id]);
      commitChange();
    }
    return;
  }
  if (finished.type === "connector") {
    const target = nodeById(finished.targetId);
    if (target && target.id !== finished.sourceId && target.type !== "connector" && target.type !== "freehand") {
      const point = screenToWorld(event.clientX, event.clientY);
      const connector = createWhiteboardNode("connector", {
        from: { nodeId: finished.sourceId, anchor: finished.sourceAnchor },
        to: { nodeId: target.id, anchor: nodeAnchorFromPoint(target, point) }
      });
      whiteboard.nodes.push(connector);
      selectedIds = new Set([connector.id]);
      commitChange();
    }
    return;
  }
  if (finished.type === "quick-create") {
    const source = nodeById(finished.sourceId);
    if (!source) return;
    if (finished.dragging) createConnectedNodeAt(source, finished.current, directionBetween(source, finished.current));
    else createConnectedNode(source, finished.direction);
    return;
  }
  if (finished.type === "reconnect") {
    const connector = nodeById(finished.connectorId);
    if (!connector) return;
    const target = nodeById(finished.targetId);
    connector[finished.end] = target
      ? { nodeId: target.id, anchor: nodeAnchorFromPoint(target, finished.current) }
      : finished.current;
    selectedIds = new Set([connector.id]);
    commitChange();
    return;
  }
  if (finished.type === "marquee") {
    const found = nodesInMarquee(whiteboard, {
      x: finished.start.x, y: finished.start.y,
      right: finished.current.x, bottom: finished.current.y
    });
    selectedIds = finished.additive ? new Set([...selectedIds, ...found]) : new Set(found);
    render();
  }
}

function onWheel(event) {
  event.preventDefault();
  if (event.ctrlKey || event.metaKey) {
    const rect = shell.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const viewport = currentViewport();
    const worldX = (sx - viewport.x) / viewport.zoom;
    const worldY = (sy - viewport.y) / viewport.zoom;
    const factor = Math.exp(-event.deltaY * 0.0015);
    const zoom = Math.min(4, Math.max(0.1, viewport.zoom * factor));
    viewport.x = sx - worldX * zoom;
    viewport.y = sy - worldY * zoom;
    viewport.zoom = zoom;
  } else {
    const horizontal = event.shiftKey && Math.abs(event.deltaX) < Math.abs(event.deltaY);
    whiteboard.viewport.x -= horizontal ? event.deltaY : event.deltaX;
    whiteboard.viewport.y -= horizontal ? 0 : event.deltaY;
  }
  scheduleViewportSave();
  renderViewportOnly();
}

function zoomAtCenter(factor) {
  const viewport = currentViewport();
  const sx = shell.clientWidth / 2;
  const sy = shell.clientHeight / 2;
  const worldX = (sx - viewport.x) / viewport.zoom;
  const worldY = (sy - viewport.y) / viewport.zoom;
  const zoom = Math.min(4, Math.max(0.1, viewport.zoom * factor));
  viewport.x = sx - worldX * zoom;
  viewport.y = sy - worldY * zoom;
  viewport.zoom = zoom;
  scheduleViewportSave();
  renderViewportOnly();
}

function fitBounds(bounds) {
  if (!bounds.width || !bounds.height) {
    whiteboard.viewport = { x: shell.clientWidth / 2, y: shell.clientHeight / 2, zoom: 1 };
  } else {
    const padding = 90;
    const zoom = Math.min(1.5, Math.max(0.1, Math.min((shell.clientWidth - padding * 2) / bounds.width, (shell.clientHeight - padding * 2) / bounds.height)));
    whiteboard.viewport = {
      x: shell.clientWidth / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: shell.clientHeight / 2 - (bounds.y + bounds.height / 2) * zoom,
      zoom
    };
  }
  scheduleViewportSave();
  renderViewportOnly();
}

function fitContent() {
  fitBounds(documentBounds(whiteboard));
}

function fitSelection() {
  const ids = [...effectiveSelectedIds()].filter((id) => nodeById(id)?.type !== "connector");
  if (!ids.length) return;
  fitBounds(documentBounds(whiteboard, ids));
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSvg() {
  const svg = buildWhiteboardSvg(whiteboard);
  downloadBlob(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), `${whiteboard.title || "白板"}.svg`);
  setStatus("已导出 SVG", "saved");
}

function exportPng() {
  const svg = buildWhiteboardSvg(whiteboard);
  const image = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  image.onload = () => {
    try {
      const scale = Math.min(2, 4096 / Math.max(image.width, image.height, 1));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("浏览器无法创建 Canvas");
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (blob) downloadBlob(blob, `${whiteboard.title || "白板"}.png`);
        setStatus(blob ? "已导出 PNG" : "PNG 导出失败", blob ? "saved" : "error");
      }, "image/png");
    } catch (error) {
      console.error("[Cloud Document Suite] Cannot export whiteboard PNG", error);
      setStatus(`PNG 导出失败：${error.message || error}`, "error");
    } finally {
      URL.revokeObjectURL(url);
    }
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus("PNG 导出失败", "error");
  };
  image.src = url;
}

function applyStyle(property, value) {
  const nodes = selectedNodes();
  if (!nodes.length) return;
  for (const node of nodes) node.style[property] = value;
  render();
}

function finishStyleChange() {
  commitChange();
}

function nudgeSelection(dx, dy) {
  if (!selectedIds.size) return;
  for (const node of effectiveSelectedNodes()) {
    if (node.type === "freehand") node.points = node.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    else if (node.type !== "connector") { node.x += dx; node.y += dy; }
  }
  commitChange();
}

function groupSelection() {
  if (groupWhiteboardNodes(whiteboard, [...selectedIds])) commitChange();
}

function ungroupSelection() {
  if (ungroupWhiteboardNodes(whiteboard, [...selectedIds])) commitChange();
}

function createFrameFromSelection() {
  const frame = frameWhiteboardNodes(whiteboard, [...selectedIds], "新建分区");
  if (!frame) return;
  selectedIds = new Set([frame.id]);
  commitChange();
}

function applyArrangement(value) {
  if (!value) return;
  const ids = [...effectiveSelectedIds()];
  let changed = false;
  if (value.startsWith("align-")) changed = alignWhiteboardNodes(whiteboard, ids, value.slice(6));
  else if (value.startsWith("distribute-")) changed = distributeWhiteboardNodes(whiteboard, ids, value.slice(11));
  else if (value.startsWith("auto-")) changed = autoLayoutWhiteboardNodes(whiteboard, ids, value.slice(5));
  arrangeAction.value = "";
  if (changed) commitChange();
}

function applyLayer(value) {
  if (!value) return;
  if (reorderWhiteboardNodes(whiteboard, [...selectedIds], value)) commitChange();
  layerAction.value = "";
}

function insertTemplate(id) {
  const center = screenToWorld(shell.getBoundingClientRect().left + shell.clientWidth / 2, shell.getBoundingClientRect().top + shell.clientHeight / 2);
  const nodes = instantiateWhiteboardTemplate(id, { x: center.x - 300, y: center.y - 160 });
  whiteboard.nodes.push(...nodes);
  selectedIds = new Set(nodes.filter((node) => node.type !== "connector").map((node) => node.id));
  templateDialog.close();
  commitChange();
}

function onKeyDown(event) {
  const editingText = event.target === textEditorInput
    || (event.target instanceof Node && textEditor.contains(event.target));
  if (editingText || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) {
    if (editingText && event.key === "Escape") {
      event.preventDefault();
      finishTextEditing(true);
    } else if (editingText && event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      finishTextEditing();
    }
    return;
  }
  const modifier = event.ctrlKey || event.metaKey;
  const key = event.key.toLowerCase();
  if (event.code === "Space" && !temporaryHand) {
    temporaryHand = true;
    shell.classList.add("tool-hand");
    event.preventDefault();
    return;
  }
  if (modifier && key === "z") {
    event.preventDefault();
    restoreHistory(historyIndex + (event.shiftKey ? 1 : -1));
  } else if (modifier && key === "y") {
    event.preventDefault();
    restoreHistory(historyIndex + 1);
  } else if (modifier && key === "d") {
    event.preventDefault();
    duplicateSelection();
  } else if (modifier && key === "g") {
    event.preventDefault();
    if (event.shiftKey) ungroupSelection(); else groupSelection();
  } else if (modifier && key === "c") {
    copySelection();
  } else if (modifier && key === "v") {
    event.preventDefault();
    pasteSelection();
  } else if (modifier && key === "s") {
    event.preventDefault();
    void persist(false);
  } else if (modifier && key === "0") {
    event.preventDefault();
    fitContent();
  } else if (["delete", "backspace"].includes(key)) {
    event.preventDefault();
    deleteSelection();
  } else if ((key === "enter" || key === "f2") && selectedIds.size === 1) {
    event.preventDefault();
    beginTextEditing(selectedNodes()[0]);
  } else if (!modifier && !event.altKey && key === "1") {
    event.preventDefault();
    fitContent();
  } else if (!modifier && !event.altKey && key === "2") {
    event.preventDefault();
    fitSelection();
  } else if (!modifier && !event.altKey && key.length === 1 && selectedIds.size === 1) {
    const node = selectedNodes()[0];
    if (node && !["freehand", "image"].includes(node.type)) {
      event.preventDefault();
      beginTextEditing(node, { replaceWith: event.key, selectAll: false });
    }
  } else if (key === "tab" && selectedIds.size === 1) {
    const source = selectedNodes()[0];
    if (source && !["connector", "freehand", "image", "text"].includes(source.type)) {
      event.preventDefault();
      createConnectedNode(source, event.shiftKey ? "left" : "right");
    }
  } else if (event.altKey && ["arrowup", "arrowdown"].includes(key) && selectedIds.size === 1) {
    const source = selectedNodes()[0];
    if (source && !["connector", "freehand", "image", "text"].includes(source.type)) {
      event.preventDefault();
      createConnectedNode(source, key === "arrowup" ? "top" : "bottom");
    }
  } else if (["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(key) && selectedIds.size) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    nudgeSelection(key === "arrowleft" ? -step : key === "arrowright" ? step : 0, key === "arrowup" ? -step : key === "arrowdown" ? step : 0);
  } else if ({ v: "select", h: "hand", t: "text", n: "sticky", r: "rect", o: "ellipse", d: "diamond", l: "connector", p: "pen" }[key]) {
    setTool({ v: "select", h: "hand", t: "text", n: "sticky", r: "rect", o: "ellipse", d: "diamond", l: "connector", p: "pen" }[key]);
  } else if (key === "escape") {
    if (selectedIds.size) selectedIds.clear();
    else if (tool !== "select") setTool("select");
    render();
  } else if (key === "?") {
    document.querySelector("#shortcut-dialog").showModal();
  }
}

function onKeyUp(event) {
  if (event.code === "Space") {
    temporaryHand = false;
    if (tool !== "hand") shell.classList.remove("tool-hand");
  }
}

function bindControls() {
  document.querySelectorAll("[data-tool]").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
  document.querySelector("#shape-menu-button").addEventListener("click", () => { shapeMenu.hidden = !shapeMenu.hidden; });
  document.querySelector("#image-button").addEventListener("click", () => document.querySelector("#image-input").click());
  document.querySelector("#image-input").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      setStatus("图片超过 3 MB，为保护同步性能未插入", "error");
      return;
    }
    const src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const point = screenToWorld(shell.getBoundingClientRect().left + shell.clientWidth / 2, shell.getBoundingClientRect().top + shell.clientHeight / 2);
    createNodeAt("image", point, { src });
  });
  undoButton.addEventListener("click", () => restoreHistory(historyIndex - 1));
  redoButton.addEventListener("click", () => restoreHistory(historyIndex + 1));
  document.querySelector("#delete").addEventListener("click", deleteSelection);
  document.querySelector("#duplicate").addEventListener("click", duplicateSelection);
  document.querySelector("#group").addEventListener("click", groupSelection);
  document.querySelector("#ungroup").addEventListener("click", ungroupSelection);
  document.querySelector("#create-frame").addEventListener("click", createFrameFromSelection);
  arrangeAction.addEventListener("change", () => applyArrangement(arrangeAction.value));
  layerAction.addEventListener("change", () => applyLayer(layerAction.value));
  document.querySelector("#template-button").addEventListener("click", () => templateDialog.showModal());
  document.querySelector("#close-templates").addEventListener("click", () => templateDialog.close());
  document.querySelectorAll("[data-template]").forEach((button) => button.addEventListener("click", () => insertTemplate(button.dataset.template)));
  fillColor.addEventListener("input", () => applyStyle("fill", fillColor.value));
  fillColor.addEventListener("change", finishStyleChange);
  strokeColor.addEventListener("input", () => applyStyle("stroke", strokeColor.value));
  strokeColor.addEventListener("change", finishStyleChange);
  textColor.addEventListener("input", () => applyStyle("textColor", textColor.value));
  textColor.addEventListener("change", finishStyleChange);
  fontSize.addEventListener("change", () => { applyStyle("fontSize", Number(fontSize.value)); finishStyleChange(); });
  boldButton.addEventListener("click", () => { applyStyle("fontWeight", selectedNodes()[0]?.style.fontWeight === "bold" ? "normal" : "bold"); finishStyleChange(); });
  lineShape.addEventListener("change", () => {
    const node = selectedNodes()[0];
    if (node?.type === "connector") { node.lineShape = lineShape.value; commitChange(); }
  });
  document.querySelector("#zoom-in").addEventListener("click", () => zoomAtCenter(1.2));
  document.querySelector("#zoom-out").addEventListener("click", () => zoomAtCenter(1 / 1.2));
  document.querySelector("#zoom-selection").addEventListener("click", fitSelection);
  document.querySelector("#fit").addEventListener("click", fitContent);
  document.querySelector("#export-svg").addEventListener("click", exportSvg);
  document.querySelector("#export-png").addEventListener("click", exportPng);
  document.querySelector("#help-button").addEventListener("click", () => document.querySelector("#shortcut-dialog").showModal());
  document.querySelector("#close-help").addEventListener("click", () => document.querySelector("#shortcut-dialog").close());
  document.querySelector("#reload-remote").addEventListener("click", () => void reloadRemote());
  document.querySelector("#force-save").addEventListener("click", () => void persist(true));
  textEditorInput.addEventListener("blur", () => finishTextEditing());
  textEditorInput.addEventListener("paste", (event) => {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
  });
  shell.addEventListener("pointerdown", onPointerDown);
  shell.addEventListener("pointermove", onPointerMove);
  shell.addEventListener("pointerup", onPointerUp);
  shell.addEventListener("pointercancel", onPointerUp);
  shell.addEventListener("wheel", onWheel, { passive: false });
  shell.addEventListener("contextmenu", (event) => event.preventDefault());
  shell.addEventListener("dblclick", (event) => {
    const id = nodeIdFromTarget(event.target);
    if (id && editingNodeId !== id) beginTextEditing(nodeById(id));
  });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", render);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && revision > savedRevision) void persist(false);
  });
}

async function reloadRemote() {
  try {
    setStatus("正在重新加载…", "saving");
    whiteboard = parseWhiteboardDocument(await store.loadRemote());
    selectedIds.clear();
    store.clearRecovery();
    conflictNotice.hidden = true;
    revision = 0;
    savedRevision = 0;
    resetHistory();
    setStatus("已加载远端版本", "saved");
  } catch (error) {
    setStatus(`重新加载失败：${error.message || error}`, "error");
  }
}

async function loadInitialDocument() {
  const remote = parseWhiteboardDocument(await store.loadRemote());
  const recovery = store.readRecovery();
  if (!recovery) return { value: remote, state: "remote" };
  try {
    const recovered = normalizeWhiteboardDocument(recovery.payload);
    if (recovery.legacy || recovery.baseHash === store.baseHash) return { value: recovered, state: "recovery" };
    return { value: recovered, state: "conflict" };
  } catch {
    return { value: remote, state: "remote" };
  }
}

async function start() {
  bindControls();
  try {
    const initial = await loadInitialDocument();
    whiteboard = initial.value;
    if (!whiteboard.title || whiteboard.title === "新建白板") whiteboard.title = assetFileName.replace(/(?:\.board)?\.json$/i, "") || "新建白板";
    resetHistory();
    if (initial.state === "conflict") {
      conflictNotice.hidden = false;
      setStatus("发现未同步的本地修改", "error");
    } else if (initial.state === "recovery") {
      setStatus("已恢复本地修改，正在保存…", "saving");
      store.cacheRecovery(whiteboard);
      revision += 1;
      void persist(false);
    } else {
      setStatus("已保存到思源", "saved");
    }
    if (!whiteboard.nodes.length && whiteboard.viewport.x === 0 && whiteboard.viewport.y === 0) {
      whiteboard.viewport.x = shell.clientWidth / 2;
      whiteboard.viewport.y = shell.clientHeight / 2;
      render();
    }
  } catch (error) {
    console.error("[Cloud Document Suite] Cannot open whiteboard", error);
    setStatus(`打开失败：${error.message || error}`, "error");
    emptyTip.hidden = true;
  } finally {
    loading.hidden = true;
  }
}

void start();
