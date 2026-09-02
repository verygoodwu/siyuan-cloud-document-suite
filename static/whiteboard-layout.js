import { documentBounds, nodeBounds } from "./whiteboard-model.js?v=__PLUGIN_VERSION__";

function layoutNodes(documentValue, nodeIds) {
  const ids = new Set(nodeIds);
  return documentValue.nodes.filter((node) => ids.has(node.id) && !["connector", "frame"].includes(node.type));
}

function moveNode(node, dx, dy) {
  if (node.type === "freehand") node.points = node.points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
  else { node.x += dx; node.y += dy; }
}

export function alignWhiteboardNodes(documentValue, nodeIds, mode) {
  const nodes = layoutNodes(documentValue, nodeIds);
  if (nodes.length < 2) return false;
  const all = documentBounds(documentValue, nodes.map((node) => node.id));
  for (const node of nodes) {
    const bounds = nodeBounds(node);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = all.x - bounds.x;
    else if (mode === "center") dx = all.x + all.width / 2 - (bounds.x + bounds.width / 2);
    else if (mode === "right") dx = all.right - bounds.right;
    else if (mode === "top") dy = all.y - bounds.y;
    else if (mode === "middle") dy = all.y + all.height / 2 - (bounds.y + bounds.height / 2);
    else if (mode === "bottom") dy = all.bottom - bounds.bottom;
    else return false;
    moveNode(node, dx, dy);
  }
  return true;
}

export function distributeWhiteboardNodes(documentValue, nodeIds, axis) {
  const horizontal = axis === "horizontal";
  const nodes = layoutNodes(documentValue, nodeIds).sort((a, b) => {
    const aa = nodeBounds(a);
    const bb = nodeBounds(b);
    return horizontal ? aa.x - bb.x : aa.y - bb.y;
  });
  if (nodes.length < 3) return false;
  const first = nodeBounds(nodes[0]);
  const last = nodeBounds(nodes.at(-1));
  const totalSize = nodes.reduce((sum, node) => sum + (horizontal ? nodeBounds(node).width : nodeBounds(node).height), 0);
  const span = horizontal ? last.right - first.x : last.bottom - first.y;
  const gap = (span - totalSize) / (nodes.length - 1);
  let cursor = horizontal ? first.x : first.y;
  for (const node of nodes) {
    const bounds = nodeBounds(node);
    moveNode(node, horizontal ? cursor - bounds.x : 0, horizontal ? 0 : cursor - bounds.y);
    cursor += (horizontal ? bounds.width : bounds.height) + gap;
  }
  return true;
}

export function autoLayoutWhiteboardNodes(documentValue, nodeIds, mode = "horizontal") {
  const nodes = layoutNodes(documentValue, nodeIds);
  if (nodes.length < 2) return false;
  const bounds = documentBounds(documentValue, nodes.map((node) => node.id));
  const columns = mode === "grid" ? Math.ceil(Math.sqrt(nodes.length)) : mode === "vertical" ? 1 : nodes.length;
  const maxWidth = Math.max(...nodes.map((node) => nodeBounds(node).width));
  const maxHeight = Math.max(...nodes.map((node) => nodeBounds(node).height));
  nodes.forEach((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const nextX = bounds.x + column * (maxWidth + 72);
    const nextY = bounds.y + row * (maxHeight + 72);
    const current = nodeBounds(node);
    moveNode(node, nextX - current.x, nextY - current.y);
  });
  return true;
}

export function nodesInMarquee(documentValue, rectangle) {
  const left = Math.min(rectangle.x, rectangle.right);
  const right = Math.max(rectangle.x, rectangle.right);
  const top = Math.min(rectangle.y, rectangle.bottom);
  const bottom = Math.max(rectangle.y, rectangle.bottom);
  return documentValue.nodes.filter((node) => {
    if (node.type === "connector") return false;
    const bounds = nodeBounds(node);
    return bounds.right >= left && bounds.x <= right && bounds.bottom >= top && bounds.y <= bottom;
  }).map((node) => node.id);
}
