export const WHITEBOARD_SCHEMA = "siyuan-cloud-whiteboard";
export const WHITEBOARD_VERSION = 1;
export const WHITEBOARD_NODE_LIMIT = 5000;

const NODE_TYPES = new Set([
  "rect",
  "ellipse",
  "diamond",
  "sticky",
  "text",
  "image",
  "freehand",
  "connector",
  "frame"
]);

const DEFAULT_STYLES = {
  rect: { fill: "#ffffff", stroke: "#4e83fd", strokeWidth: 2, textColor: "#1f2329", fontSize: 16 },
  ellipse: { fill: "#ffffff", stroke: "#4e83fd", strokeWidth: 2, textColor: "#1f2329", fontSize: 16 },
  diamond: { fill: "#ffffff", stroke: "#4e83fd", strokeWidth: 2, textColor: "#1f2329", fontSize: 16 },
  sticky: { fill: "#fff1b8", stroke: "#e8c667", strokeWidth: 1, textColor: "#4a3b10", fontSize: 16 },
  text: { fill: "transparent", stroke: "transparent", strokeWidth: 0, textColor: "#1f2329", fontSize: 18 },
  image: { fill: "transparent", stroke: "transparent", strokeWidth: 0, textColor: "#1f2329", fontSize: 16 },
  freehand: { fill: "none", stroke: "#3370ff", strokeWidth: 3, textColor: "#1f2329", fontSize: 16 },
  connector: { fill: "none", stroke: "#646a73", strokeWidth: 2, textColor: "#1f2329", fontSize: 14 },
  frame: { fill: "#f7f8fa", stroke: "#c9cdd4", strokeWidth: 1, textColor: "#646a73", fontSize: 14 }
};

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const positive = (value, fallback) => Math.max(1, finite(value, fallback));
const boundedText = (value, maximum = 20000) => String(value ?? "").slice(0, maximum);

export function createWhiteboardId(prefix = "node") {
  const token = globalThis.crypto?.randomUUID?.().replace(/-/g, "")
    || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${token.slice(0, 16)}`;
}

export function createWhiteboardDocument(title = "新建白板") {
  const now = new Date().toISOString();
  return {
    schema: WHITEBOARD_SCHEMA,
    version: WHITEBOARD_VERSION,
    title: boundedText(title, 200) || "新建白板",
    createdAt: now,
    updatedAt: now,
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: []
  };
}

export function createWhiteboardNode(type, overrides = {}) {
  if (!NODE_TYPES.has(type)) throw new Error(`不支持的白板节点类型：${type}`);
  const defaults = DEFAULT_STYLES[type];
  const node = {
    id: createWhiteboardId(type),
    type,
    x: 0,
    y: 0,
    width: type === "text" ? 180 : type === "frame" ? 520 : 160,
    height: type === "text" ? 48 : type === "frame" ? 320 : 88,
    rotation: 0,
    text: "",
    style: { ...defaults },
    ...overrides,
    style: { ...defaults, ...(overrides.style || {}) }
  };
  if (type === "freehand") {
    node.points = Array.isArray(overrides.points) ? overrides.points : [];
    node.width = positive(overrides.width, 1);
    node.height = positive(overrides.height, 1);
  }
  if (type === "connector") {
    node.from = normalizeEndpoint(overrides.from);
    node.to = normalizeEndpoint(overrides.to);
    node.lineShape = ["straight", "curve", "rightAngle"].includes(overrides.lineShape)
      ? overrides.lineShape
      : "rightAngle";
    node.endArrow = overrides.endArrow === "none" ? "none" : "arrow";
  }
  if (type === "frame") node.childIds = Array.isArray(overrides.childIds) ? [...new Set(overrides.childIds.map(String))] : [];
  return normalizeNode(node);
}

function normalizeEndpoint(endpoint) {
  if (endpoint?.nodeId) {
    return {
      nodeId: boundedText(endpoint.nodeId, 100),
      anchor: ["top", "right", "bottom", "left"].includes(endpoint.anchor)
        ? endpoint.anchor
        : "right"
    };
  }
  return { x: finite(endpoint?.x), y: finite(endpoint?.y) };
}

function normalizeStyle(type, style) {
  const defaults = DEFAULT_STYLES[type] || DEFAULT_STYLES.rect;
  return {
    fill: boundedText(style?.fill ?? defaults.fill, 100),
    stroke: boundedText(style?.stroke ?? defaults.stroke, 100),
    strokeWidth: Math.min(40, Math.max(0, finite(style?.strokeWidth, defaults.strokeWidth))),
    textColor: boundedText(style?.textColor ?? defaults.textColor, 100),
    fontSize: Math.min(160, Math.max(8, finite(style?.fontSize, defaults.fontSize))),
    fontWeight: style?.fontWeight === "bold" || Number(style?.fontWeight) >= 600 ? "bold" : "normal",
    textAlign: ["left", "center", "right"].includes(style?.textAlign) ? style.textAlign : "center",
    dash: style?.dash === "dashed" || style?.dash === "dotted" ? style.dash : "solid"
  };
}

export function normalizeNode(raw) {
  if (!raw || typeof raw !== "object" || !NODE_TYPES.has(raw.type)) return null;
  const type = raw.type;
  const node = {
    id: boundedText(raw.id, 100) || createWhiteboardId(type),
    type,
    x: finite(raw.x),
    y: finite(raw.y),
    width: Math.min(100000, positive(raw.width, type === "text" ? 180 : type === "frame" ? 520 : 160)),
    height: Math.min(100000, positive(raw.height, type === "text" ? 48 : type === "frame" ? 320 : 88)),
    rotation: finite(raw.rotation) % 360,
    text: boundedText(raw.text),
    style: normalizeStyle(type, raw.style)
  };
  if (raw.groupId) node.groupId = boundedText(raw.groupId, 100);
  if (type === "image") node.src = boundedText(raw.src, 8 * 1024 * 1024);
  if (type === "freehand") {
    node.points = Array.isArray(raw.points)
      ? raw.points.slice(0, 10000).map((point) => ({ x: finite(point?.x), y: finite(point?.y) }))
      : [];
  }
  if (type === "connector") {
    node.from = normalizeEndpoint(raw.from);
    node.to = normalizeEndpoint(raw.to);
    node.lineShape = ["straight", "curve", "rightAngle"].includes(raw.lineShape)
      ? raw.lineShape
      : "rightAngle";
    node.endArrow = raw.endArrow === "none" ? "none" : "arrow";
  }
  if (type === "frame") node.childIds = Array.isArray(raw.childIds)
    ? [...new Set(raw.childIds.slice(0, WHITEBOARD_NODE_LIMIT).map((id) => boundedText(id, 100)).filter(Boolean))]
    : [];
  return node;
}

export function normalizeWhiteboardDocument(raw) {
  if (!raw || typeof raw !== "object") throw new Error("白板文件内容无效");
  if (raw.schema !== WHITEBOARD_SCHEMA) throw new Error("不是云文档套件白板文件");
  if (finite(raw.version) > WHITEBOARD_VERSION) throw new Error("该白板由更高版本插件创建，请升级插件后打开");
  const nodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (nodes.length > WHITEBOARD_NODE_LIMIT) throw new Error(`白板节点超过 ${WHITEBOARD_NODE_LIMIT} 个，已停止加载以保护性能`);
  const normalized = createWhiteboardDocument(raw.title);
  normalized.createdAt = boundedText(raw.createdAt, 100) || normalized.createdAt;
  normalized.updatedAt = boundedText(raw.updatedAt, 100) || normalized.updatedAt;
  normalized.viewport = {
    x: finite(raw.viewport?.x),
    y: finite(raw.viewport?.y),
    zoom: Math.min(4, Math.max(0.1, finite(raw.viewport?.zoom, 1)))
  };
  const ids = new Set();
  normalized.nodes = nodes.map(normalizeNode).filter((node) => {
    if (!node || ids.has(node.id)) return false;
    ids.add(node.id);
    return true;
  });
  return normalized;
}

export function parseWhiteboardDocument(input) {
  const text = typeof input === "string" ? input : new TextDecoder().decode(input);
  return normalizeWhiteboardDocument(JSON.parse(text));
}

export function serializeWhiteboardDocument(document) {
  const normalized = normalizeWhiteboardDocument(document);
  normalized.updatedAt = new Date().toISOString();
  return new TextEncoder().encode(`${JSON.stringify(normalized, null, 2)}\n`);
}

export function cloneWhiteboardDocument(document) {
  return normalizeWhiteboardDocument(JSON.parse(JSON.stringify(document)));
}

export function nodeBounds(node) {
  if (!node) return { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
  if (node.type === "freehand" && node.points?.length) {
    const xs = node.points.map((point) => point.x);
    const ys = node.points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    return { x, y, width: right - x, height: bottom - y, right, bottom };
  }
  const x = finite(node.x);
  const y = finite(node.y);
  const width = positive(node.width, 1);
  const height = positive(node.height, 1);
  return { x, y, width, height, right: x + width, bottom: y + height };
}

export function documentBounds(document, nodeIds) {
  const allowed = nodeIds ? new Set(nodeIds) : null;
  const nodes = document.nodes.filter((node) => node.type !== "connector" && (!allowed || allowed.has(node.id)));
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0 };
  const bounds = nodes.map(nodeBounds);
  const x = Math.min(...bounds.map((item) => item.x));
  const y = Math.min(...bounds.map((item) => item.y));
  const right = Math.max(...bounds.map((item) => item.right));
  const bottom = Math.max(...bounds.map((item) => item.bottom));
  return { x, y, width: right - x, height: bottom - y, right, bottom };
}

export function moveWhiteboardNodes(document, nodeIds, dx, dy) {
  const selected = new Set(nodeIds);
  for (const node of document.nodes) {
    if (!selected.has(node.id)) continue;
    if (node.type === "freehand") {
      node.points = node.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
    } else if (node.type !== "connector") {
      node.x += dx;
      node.y += dy;
    }
  }
}

export function resizeWhiteboardNode(node, nextBounds) {
  if (!node || node.type === "connector") return;
  const before = nodeBounds(node);
  const width = Math.max(24, finite(nextBounds.width, before.width));
  const height = Math.max(24, finite(nextBounds.height, before.height));
  const x = finite(nextBounds.x, before.x);
  const y = finite(nextBounds.y, before.y);
  if (node.type === "freehand") {
    const scaleX = before.width ? width / before.width : 1;
    const scaleY = before.height ? height / before.height : 1;
    node.points = node.points.map((point) => ({
      x: x + (point.x - before.x) * scaleX,
      y: y + (point.y - before.y) * scaleY
    }));
  } else {
    node.x = x;
    node.y = y;
    node.width = width;
    node.height = height;
  }
}

export function duplicateWhiteboardNodes(document, nodeIds, offset = 28) {
  const selected = new Set(nodeIds);
  const idMap = new Map();
  const groupMap = new Map();
  const copies = document.nodes.filter((node) => selected.has(node.id)).map((node) => {
    const copy = JSON.parse(JSON.stringify(node));
    copy.id = createWhiteboardId(node.type);
    idMap.set(node.id, copy.id);
    if (copy.groupId) {
      if (!groupMap.has(copy.groupId)) groupMap.set(copy.groupId, createWhiteboardId("group"));
      copy.groupId = groupMap.get(copy.groupId);
    }
    if (copy.type === "freehand") copy.points = copy.points.map((point) => ({ x: point.x + offset, y: point.y + offset }));
    else if (copy.type !== "connector") { copy.x += offset; copy.y += offset; }
    return copy;
  });
  for (const copy of copies) {
    if (copy.type === "frame") copy.childIds = copy.childIds.map((id) => idMap.get(id)).filter(Boolean);
    if (copy.type !== "connector") continue;
    if (copy.from?.nodeId && idMap.has(copy.from.nodeId)) copy.from.nodeId = idMap.get(copy.from.nodeId);
    if (copy.to?.nodeId && idMap.has(copy.to.nodeId)) copy.to.nodeId = idMap.get(copy.to.nodeId);
  }
  document.nodes.push(...copies);
  return copies.map((copy) => copy.id);
}

export function resolveWhiteboardSelection(document, nodeIds) {
  const resolved = new Set(nodeIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of document.nodes) {
      const selectedGroup = node.groupId && document.nodes.some((item) => resolved.has(item.id) && item.groupId === node.groupId);
      const selectedFrame = node.type === "frame" && resolved.has(node.id);
      if (selectedGroup && !resolved.has(node.id)) { resolved.add(node.id); changed = true; }
      if (selectedFrame) for (const childId of node.childIds || []) if (!resolved.has(childId)) { resolved.add(childId); changed = true; }
    }
  }
  return resolved;
}

export function groupWhiteboardNodes(document, nodeIds) {
  const eligible = document.nodes.filter((node) => nodeIds.includes(node.id) && node.type !== "connector" && node.type !== "frame");
  if (eligible.length < 2) return null;
  const groupId = createWhiteboardId("group");
  for (const node of eligible) node.groupId = groupId;
  return groupId;
}

export function ungroupWhiteboardNodes(document, nodeIds) {
  const groupIds = new Set(document.nodes.filter((node) => nodeIds.includes(node.id)).map((node) => node.groupId).filter(Boolean));
  let count = 0;
  for (const node of document.nodes) {
    if (!groupIds.has(node.groupId)) continue;
    delete node.groupId;
    count += 1;
  }
  return count;
}

export function frameWhiteboardNodes(document, nodeIds, title = "分区") {
  const eligible = document.nodes.filter((node) => nodeIds.includes(node.id) && node.type !== "connector" && node.type !== "frame");
  if (!eligible.length) return null;
  const bounds = documentBounds(document, eligible.map((node) => node.id));
  const frame = createWhiteboardNode("frame", {
    x: bounds.x - 40,
    y: bounds.y - 64,
    width: bounds.width + 80,
    height: bounds.height + 104,
    text: boundedText(title, 200) || "分区",
    childIds: eligible.map((node) => node.id)
  });
  document.nodes.unshift(frame);
  return frame;
}

export function detachWhiteboardReferences(document, deletedIds) {
  const deleting = new Set(deletedIds);
  for (const node of document.nodes) {
    if (node.type === "frame") node.childIds = (node.childIds || []).filter((id) => !deleting.has(id));
  }
}

export function reorderWhiteboardNodes(document, nodeIds, mode) {
  const moving = new Set(nodeIds);
  const movable = document.nodes.filter((node) => moving.has(node.id));
  if (!movable.length) return false;
  const rest = document.nodes.filter((node) => !moving.has(node.id));
  if (mode === "front") document.nodes = [...rest, ...movable];
  else if (mode === "back") document.nodes = [...movable, ...rest];
  else {
    const step = mode === "forward" ? 1 : mode === "backward" ? -1 : 0;
    if (!step) return false;
    const nodes = [...document.nodes];
    const range = step > 0 ? [...nodes.keys()].reverse() : [...nodes.keys()];
    for (const index of range) {
      if (!moving.has(nodes[index]?.id)) continue;
      const target = index + step;
      if (target < 0 || target >= nodes.length || moving.has(nodes[target]?.id)) continue;
      [nodes[index], nodes[target]] = [nodes[target], nodes[index]];
    }
    document.nodes = nodes;
  }
  return true;
}

export function endpointPosition(document, endpoint, opposite) {
  if (!endpoint?.nodeId) return { x: finite(endpoint?.x), y: finite(endpoint?.y) };
  const node = document.nodes.find((item) => item.id === endpoint.nodeId);
  if (!node) return { x: 0, y: 0 };
  const bounds = nodeBounds(node);
  let anchor = endpoint.anchor;
  if (!["top", "right", "bottom", "left"].includes(anchor)) {
    const other = opposite || { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    const dx = other.x - (bounds.x + bounds.width / 2);
    const dy = other.y - (bounds.y + bounds.height / 2);
    anchor = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top");
  }
  if (anchor === "top") return { x: bounds.x + bounds.width / 2, y: bounds.y };
  if (anchor === "bottom") return { x: bounds.x + bounds.width / 2, y: bounds.bottom };
  if (anchor === "left") return { x: bounds.x, y: bounds.y + bounds.height / 2 };
  return { x: bounds.right, y: bounds.y + bounds.height / 2 };
}

export function connectorPath(document, connector) {
  const rawFrom = endpointPosition(document, connector.from);
  const rawTo = endpointPosition(document, connector.to, rawFrom);
  const from = endpointPosition(document, connector.from, rawTo);
  const to = endpointPosition(document, connector.to, from);
  if (connector.lineShape === "straight") return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  if (connector.lineShape === "curve") {
    const distance = Math.max(48, Math.abs(to.x - from.x) * 0.45);
    const direction = to.x >= from.x ? 1 : -1;
    return `M ${from.x} ${from.y} C ${from.x + distance * direction} ${from.y}, ${to.x - distance * direction} ${to.y}, ${to.x} ${to.y}`;
  }
  const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  if (horizontal) {
    const middle = (from.x + to.x) / 2;
    return `M ${from.x} ${from.y} H ${middle} V ${to.y} H ${to.x}`;
  }
  const middle = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} V ${middle} H ${to.x} V ${to.y}`;
}

export function freehandPath(points = []) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y} l 0.01 0`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    path += ` Q ${current.x} ${current.y} ${(current.x + next.x) / 2} ${(current.y + next.y) / 2}`;
  }
  const last = points.at(-1);
  return `${path} L ${last.x} ${last.y}`;
}

export function anchorForDirection(direction) {
  return ["top", "right", "bottom", "left"].includes(direction) ? direction : "right";
}

export function oppositeAnchor(anchor) {
  return { top: "bottom", right: "left", bottom: "top", left: "right" }[anchor] || "left";
}
