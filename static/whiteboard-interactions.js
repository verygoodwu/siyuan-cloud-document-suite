import { documentBounds, nodeBounds } from "./whiteboard-model.js?v=__PLUGIN_VERSION__";

const centerX = (bounds) => bounds.x + bounds.width / 2;
const centerY = (bounds) => bounds.y + bounds.height / 2;

function nearestCandidate(candidates, threshold) {
  return candidates
    .filter((candidate) => Math.abs(candidate.offset) <= threshold)
    .sort((left, right) => Math.abs(left.offset) - Math.abs(right.offset))[0] || null;
}

/**
 * Calculates screen-consistent alignment and equal-gap snapping for a moving selection.
 * The returned dx/dy are absolute offsets from the original selection position.
 */
export function snapWhiteboardMove(documentValue, movingIds, originalBounds, rawDx, rawDy, zoom = 1, screenThreshold = 8) {
  const moving = new Set(movingIds);
  const stationary = documentValue.nodes.filter((node) => !moving.has(node.id) && !["connector", "freehand", "frame"].includes(node.type));
  const proposed = {
    x: originalBounds.x + rawDx,
    y: originalBounds.y + rawDy,
    width: originalBounds.width,
    height: originalBounds.height,
    right: originalBounds.right + rawDx,
    bottom: originalBounds.bottom + rawDy
  };
  const threshold = screenThreshold / Math.max(0.1, zoom);
  const xCandidates = [];
  const yCandidates = [];

  for (const node of stationary) {
    const target = nodeBounds(node);
    for (const [movingValue, targetValue, alignment] of [
      [proposed.x, target.x, "left"],
      [centerX(proposed), centerX(target), "center"],
      [proposed.right, target.right, "right"]
    ]) {
      xCandidates.push({
        offset: targetValue - movingValue,
        indicator: { type: "align-x", x: targetValue, y1: Math.min(proposed.y, target.y), y2: Math.max(proposed.bottom, target.bottom), alignment }
      });
    }
    for (const [movingValue, targetValue, alignment] of [
      [proposed.y, target.y, "top"],
      [centerY(proposed), centerY(target), "middle"],
      [proposed.bottom, target.bottom, "bottom"]
    ]) {
      yCandidates.push({
        offset: targetValue - movingValue,
        indicator: { type: "align-y", y: targetValue, x1: Math.min(proposed.x, target.x), x2: Math.max(proposed.right, target.right), alignment }
      });
    }
  }

  // Equal spacing between the nearest objects on opposite sides.
  const left = stationary.map((node) => nodeBounds(node)).filter((bounds) => bounds.right <= proposed.x).sort((a, b) => b.right - a.right)[0];
  const right = stationary.map((node) => nodeBounds(node)).filter((bounds) => bounds.x >= proposed.right).sort((a, b) => a.x - b.x)[0];
  if (left && right) {
    const leftGap = proposed.x - left.right;
    const rightGap = right.x - proposed.right;
    const offset = (rightGap - leftGap) / 2;
    if (Math.abs(offset) <= threshold) {
      xCandidates.push({
        offset,
        indicator: { type: "gap-x", y: centerY(proposed), x1: left.right, x2: proposed.x + offset, x3: proposed.right + offset, x4: right.x }
      });
    }
  }

  const above = stationary.map((node) => nodeBounds(node)).filter((bounds) => bounds.bottom <= proposed.y).sort((a, b) => b.bottom - a.bottom)[0];
  const below = stationary.map((node) => nodeBounds(node)).filter((bounds) => bounds.y >= proposed.bottom).sort((a, b) => a.y - b.y)[0];
  if (above && below) {
    const topGap = proposed.y - above.bottom;
    const bottomGap = below.y - proposed.bottom;
    const offset = (bottomGap - topGap) / 2;
    if (Math.abs(offset) <= threshold) {
      yCandidates.push({
        offset,
        indicator: { type: "gap-y", x: centerX(proposed), y1: above.bottom, y2: proposed.y + offset, y3: proposed.bottom + offset, y4: below.y }
      });
    }
  }

  const snapX = nearestCandidate(xCandidates, threshold);
  const snapY = nearestCandidate(yCandidates, threshold);
  return {
    dx: rawDx + (snapX?.offset || 0),
    dy: rawDy + (snapY?.offset || 0),
    indicators: [snapX?.indicator, snapY?.indicator].filter(Boolean)
  };
}

export function connectableNodeAtPoint(documentValue, point, excludedIds = [], padding = 12) {
  const excluded = new Set(excludedIds);
  const candidates = documentValue.nodes.filter((node) => !excluded.has(node.id) && !["connector", "freehand", "frame"].includes(node.type));
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const node = candidates[index];
    const bounds = nodeBounds(node);
    if (point.x >= bounds.x - padding && point.x <= bounds.right + padding && point.y >= bounds.y - padding && point.y <= bounds.bottom + padding) return node;
  }
  return null;
}

export function selectionBounds(documentValue, nodeIds) {
  return documentBounds(documentValue, nodeIds);
}
