import {
  connectorPath,
  documentBounds,
  endpointPosition,
  freehandPath,
  nodeBounds
} from "./whiteboard-model.js?v=__PLUGIN_VERSION__";

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined && value !== null) element.setAttribute(key, String(value));
  }
  return element;
}

function dashArray(style) {
  if (style?.dash === "dashed") return "9 6";
  if (style?.dash === "dotted") return "2 6";
  return undefined;
}

function addText(group, node) {
  const foreign = svgElement("foreignObject", {
    x: node.x + 8,
    y: node.y + 6,
    width: Math.max(1, node.width - 16),
    height: Math.max(1, node.height - 12),
    "pointer-events": "none"
  });
  const div = document.createElementNS(XHTML_NS, "div");
  div.className = "whiteboard-node-text";
  div.style.color = node.style.textColor;
  div.style.fontSize = `${node.style.fontSize}px`;
  div.style.fontWeight = node.style.fontWeight;
  div.style.textAlign = node.style.textAlign;
  div.textContent = node.text || "";
  foreign.append(div);
  group.append(foreign);
}

function renderShape(node) {
  const group = svgElement("g", {
    class: "whiteboard-node",
    "data-node-id": node.id,
    transform: node.rotation
      ? `rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})`
      : undefined
  });
  const common = {
    fill: node.style.fill,
    stroke: node.style.stroke,
    "stroke-width": node.style.strokeWidth,
    "stroke-dasharray": dashArray(node.style),
    "vector-effect": "non-scaling-stroke"
  };
  if (node.type === "frame") {
    group.classList.add("whiteboard-frame");
    group.append(svgElement("rect", {
      x: node.x, y: node.y, width: node.width, height: node.height, rx: 12,
      ...common, fill: node.style.fill, "fill-opacity": 0.45, "stroke-dasharray": "8 5"
    }));
    const title = svgElement("text", {
      x: node.x + 16, y: node.y + 28, fill: node.style.textColor,
      "font-size": node.style.fontSize, "font-weight": node.style.fontWeight,
      "pointer-events": "none"
    });
    title.textContent = node.text || "分区";
    group.append(title);
    return group;
  }
  if (node.type === "ellipse") {
    group.append(svgElement("ellipse", {
      cx: node.x + node.width / 2,
      cy: node.y + node.height / 2,
      rx: node.width / 2,
      ry: node.height / 2,
      ...common
    }));
  } else if (node.type === "diamond") {
    group.append(svgElement("polygon", {
      points: `${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y + node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y + node.height / 2}`,
      ...common
    }));
  } else if (node.type === "image") {
    group.append(svgElement("rect", {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rx: 8,
      fill: "var(--board-surface)",
      stroke: "var(--board-border)",
      "vector-effect": "non-scaling-stroke"
    }));
    if (node.src) group.append(svgElement("image", {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      href: node.src,
      preserveAspectRatio: "xMidYMid meet"
    }));
  } else {
    group.append(svgElement("rect", {
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      rx: node.type === "sticky" ? 3 : node.type === "text" ? 0 : 9,
      ...common
    }));
  }
  if (node.type !== "image") addText(group, node);
  return group;
}

function renderFreehand(node) {
  return svgElement("path", {
    class: "whiteboard-node whiteboard-freehand",
    "data-node-id": node.id,
    d: freehandPath(node.points),
    fill: "none",
    stroke: node.style.stroke,
    "stroke-width": node.style.strokeWidth,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "vector-effect": "non-scaling-stroke"
  });
}

function renderConnector(documentValue, node) {
  const group = svgElement("g", {
    class: "whiteboard-node whiteboard-connector",
    "data-node-id": node.id
  });
  group.append(svgElement("path", {
    class: "connector-hit",
    d: connectorPath(documentValue, node),
    fill: "none",
    stroke: "transparent",
    "stroke-width": Math.max(14, node.style.strokeWidth + 10),
    "vector-effect": "non-scaling-stroke"
  }));
  group.append(svgElement("path", {
    d: connectorPath(documentValue, node),
    fill: "none",
    stroke: node.style.stroke,
    "stroke-width": node.style.strokeWidth,
    "stroke-dasharray": dashArray(node.style),
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "marker-end": node.endArrow === "none" ? undefined : "url(#board-arrow)",
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none"
  }));
  if (node.text) {
    const from = endpointPosition(documentValue, node.from);
    const to = endpointPosition(documentValue, node.to, from);
    const x = (from.x + to.x) / 2;
    const y = (from.y + to.y) / 2;
    const label = svgElement("text", {
      class: "connector-label",
      x,
      y,
      fill: node.style.textColor,
      "font-size": node.style.fontSize,
      "font-weight": node.style.fontWeight,
      "text-anchor": "middle",
      "dominant-baseline": "middle",
      "paint-order": "stroke",
      stroke: "var(--board-bg)",
      "stroke-width": 6,
      "stroke-linejoin": "round",
      "pointer-events": "none"
    });
    label.textContent = node.text;
    group.append(label);
  }
  return group;
}

function renderNode(documentValue, node) {
  return node.type === "connector"
    ? renderConnector(documentValue, node)
    : node.type === "freehand"
      ? renderFreehand(node)
      : renderShape(node);
}

export function renderWhiteboard(documentValue, nodeLayer, selectedIds = new Set()) {
  nodeLayer.replaceChildren();
  const ordered = [
    ...documentValue.nodes.filter((node) => node.type === "frame"),
    ...documentValue.nodes.filter((node) => node.type === "connector"),
    ...documentValue.nodes.filter((node) => !["connector", "frame"].includes(node.type))
  ];
  for (const node of ordered) {
    const rendered = renderNode(documentValue, node);
    rendered.classList.toggle("selected", selectedIds.has(node.id));
    nodeLayer.append(rendered);
  }
}

export function renderWhiteboardNodes(documentValue, nodeLayer, nodeIds, selectedIds = new Set()) {
  const requested = new Set(nodeIds);
  for (const connector of documentValue.nodes.filter((node) => node.type === "connector")) {
    if (requested.has(connector.from?.nodeId) || requested.has(connector.to?.nodeId)) requested.add(connector.id);
  }
  for (const id of requested) {
    const node = documentValue.nodes.find((item) => item.id === id);
    const existing = nodeLayer.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
    if (!node) {
      existing?.remove();
      continue;
    }
    const rendered = renderNode(documentValue, node);
    rendered.classList.toggle("selected", selectedIds.has(node.id));
    if (existing) existing.replaceWith(rendered);
    else nodeLayer.append(rendered);
  }
}

export function renderSelection(documentValue, selectedIds, selectionLayer, options = {}) {
  selectionLayer.replaceChildren();
  const selected = documentValue.nodes.filter((node) => selectedIds.has(node.id) && node.type !== "connector");
  const selectedConnectors = documentValue.nodes.filter((node) => selectedIds.has(node.id) && node.type === "connector");
  if (!selected.length && !selectedConnectors.length) return null;
  const bounds = selected.length
    ? documentBounds(documentValue, selected.map((node) => node.id))
    : (() => {
        const points = selectedConnectors.flatMap((connector) => [
          endpointPosition(documentValue, connector.from),
          endpointPosition(documentValue, connector.to)
        ]);
        const x = Math.min(...points.map((point) => point.x));
        const y = Math.min(...points.map((point) => point.y));
        const right = Math.max(...points.map((point) => point.x));
        const bottom = Math.max(...points.map((point) => point.y));
        return { x, y, width: right - x, height: bottom - y, right, bottom };
      })();
  const outline = svgElement("rect", {
    class: "selection-outline",
    x: bounds.x - 4,
    y: bounds.y - 4,
    width: bounds.width + 8,
    height: bounds.height + 8,
    rx: 5,
    fill: "none",
    stroke: "#3370ff",
    "stroke-width": 2,
    "vector-effect": "non-scaling-stroke",
    "pointer-events": "none"
  });
  selectionLayer.append(outline);
  if (selected.length === 0 && selectedConnectors.length === 1) {
    const connector = selectedConnectors[0];
    for (const [end, point] of [
      ["from", endpointPosition(documentValue, connector.from)],
      ["to", endpointPosition(documentValue, connector.to)]
    ]) {
      selectionLayer.append(svgElement("circle", {
        class: "connector-end-handle",
        "data-connector-end": end,
        cx: point.x,
        cy: point.y,
        r: 6,
        fill: "var(--board-surface)",
        stroke: "#3370ff",
        "stroke-width": 2,
        "vector-effect": "non-scaling-stroke"
      }));
    }
  }
  if (selected.length === 1 && selectedConnectors.length === 0 && selected[0].type !== "freehand") {
    for (const [handle, x, y, cursor] of [
      ["nw", bounds.x - 4, bounds.y - 4, "nwse-resize"],
      ["ne", bounds.right + 4, bounds.y - 4, "nesw-resize"],
      ["se", bounds.right + 4, bounds.bottom + 4, "nwse-resize"],
      ["sw", bounds.x - 4, bounds.bottom + 4, "nesw-resize"]
    ]) {
      const control = svgElement("circle", {
        class: "selection-handle",
        "data-resize-handle": handle,
        cx: x,
        cy: y,
        r: 5,
        fill: "var(--board-surface)",
        stroke: "#3370ff",
        "stroke-width": 2,
        "vector-effect": "non-scaling-stroke"
      });
      control.style.cursor = cursor;
      selectionLayer.append(control);
    }
    if (options.quickCreate !== false && !["image", "text"].includes(selected[0].type)) {
      for (const [anchor, x, y] of [
        ["top", bounds.x + bounds.width / 2, bounds.y - 28],
        ["right", bounds.right + 28, bounds.y + bounds.height / 2],
        ["bottom", bounds.x + bounds.width / 2, bounds.bottom + 28],
        ["left", bounds.x - 28, bounds.y + bounds.height / 2]
      ]) {
        const quick = svgElement("g", {
          class: "quick-create",
          "data-quick-anchor": anchor,
          transform: `translate(${x} ${y})`
        });
        quick.append(svgElement("circle", { class: "quick-create-hit", r: 16, fill: "transparent" }));
        quick.append(svgElement("circle", { class: "quick-create-dot", r: 5, fill: "var(--board-surface)", stroke: "#3370ff", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }));
        quick.append(svgElement("path", {
          class: "quick-create-plus",
          d: "M -4 0 H 4 M 0 -4 V 4",
          stroke: "#fff",
          "stroke-width": 1.8,
          "stroke-linecap": "round",
          "pointer-events": "none"
        }));
        selectionLayer.append(quick);
      }
    }
  }
  return bounds;
}

export function updateViewportTransform(viewportLayer, viewport) {
  viewportLayer.setAttribute("transform", `translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`);
}

function escapeXml(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function styleAttributes(node) {
  const dash = dashArray(node.style);
  return `fill="${escapeXml(node.style.fill)}" stroke="${escapeXml(node.style.stroke)}" stroke-width="${node.style.strokeWidth}"${dash ? ` stroke-dasharray="${dash}"` : ""}`;
}

function wrapExportText(value, maximumCharacters) {
  const result = [];
  for (const paragraph of String(value ?? "").split(/\r?\n/)) {
    const characters = Array.from(paragraph);
    if (!characters.length) { result.push(""); continue; }
    for (let index = 0; index < characters.length; index += maximumCharacters) {
      result.push(characters.slice(index, index + maximumCharacters).join(""));
    }
  }
  return result.slice(0, 200);
}

function exportText(node) {
  if (!node.text || node.type === "image") return "";
  if (node.type === "frame") {
    return `<text x="${node.x + 16}" y="${node.y + 28}" fill="${escapeXml(node.style.textColor)}" font-family="system-ui, sans-serif" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}">${escapeXml(node.text)}</text>`;
  }
  const maximumCharacters = Math.max(1, Math.floor((node.width - 16) / Math.max(5, node.style.fontSize * 0.62)));
  const lines = wrapExportText(node.text, maximumCharacters);
  const lineHeight = node.style.fontSize * 1.35;
  const x = node.style.textAlign === "left" ? node.x + 8 : node.style.textAlign === "right" ? node.x + node.width - 8 : node.x + node.width / 2;
  const anchor = node.style.textAlign === "left" ? "start" : node.style.textAlign === "right" ? "end" : "middle";
  const firstY = node.y + node.height / 2 - ((lines.length - 1) * lineHeight) / 2;
  const spans = lines.map((line, index) => `<tspan x="${x}" y="${firstY + index * lineHeight}">${escapeXml(line)}</tspan>`).join("");
  return `<text text-anchor="${anchor}" dominant-baseline="middle" fill="${escapeXml(node.style.textColor)}" font-family="system-ui, sans-serif" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}">${spans}</text>`;
}

function exportNode(documentValue, node, offsetX, offsetY) {
  if (node.type === "connector") {
    const from = endpointPosition(documentValue, node.from);
    const to = endpointPosition(documentValue, node.to, from);
    const label = node.text ? `<text x="${(from.x + to.x) / 2}" y="${(from.y + to.y) / 2}" text-anchor="middle" dominant-baseline="middle" fill="${escapeXml(node.style.textColor)}" font-family="system-ui, sans-serif" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}" paint-order="stroke" stroke="#ffffff" stroke-width="6" stroke-linejoin="round">${escapeXml(node.text)}</text>` : "";
    return `<g><path d="${escapeXml(connectorPath(documentValue, node))}" fill="none" stroke="${escapeXml(node.style.stroke)}" stroke-width="${node.style.strokeWidth}"${node.endArrow === "none" ? "" : " marker-end=\"url(#arrow)\""}/>${label}</g>`;
  }
  if (node.type === "freehand") return `<path d="${escapeXml(freehandPath(node.points))}" fill="none" stroke="${escapeXml(node.style.stroke)}" stroke-width="${node.style.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const transform = node.rotation ? ` transform="rotate(${node.rotation} ${node.x + node.width / 2} ${node.y + node.height / 2})"` : "";
  let shape;
  if (node.type === "frame") {
    shape = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="12" ${styleAttributes(node)} fill-opacity="0.45" stroke-dasharray="8 5"/>`;
  } else if (node.type === "ellipse") shape = `<ellipse cx="${node.x + node.width / 2}" cy="${node.y + node.height / 2}" rx="${node.width / 2}" ry="${node.height / 2}" ${styleAttributes(node)}/>`;
  else if (node.type === "diamond") shape = `<polygon points="${node.x + node.width / 2},${node.y} ${node.x + node.width},${node.y + node.height / 2} ${node.x + node.width / 2},${node.y + node.height} ${node.x},${node.y + node.height / 2}" ${styleAttributes(node)}/>`;
  else if (node.type === "image") shape = `<image x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" href="${escapeXml(node.src)}" preserveAspectRatio="xMidYMid meet"/>`;
  else shape = `<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${node.type === "sticky" ? 3 : node.type === "text" ? 0 : 9}" ${styleAttributes(node)}/>`;
  const text = exportText(node);
  return `<g${transform}>${shape}${text}</g>`;
}

export function buildWhiteboardSvg(documentValue, padding = 40) {
  const bounds = documentBounds(documentValue);
  const x = bounds.width ? bounds.x - padding : 0;
  const y = bounds.height ? bounds.y - padding : 0;
  const width = Math.max(320, bounds.width + padding * 2);
  const height = Math.max(200, bounds.height + padding * 2);
  const nodes = [
    ...documentValue.nodes.filter((node) => node.type === "frame"),
    ...documentValue.nodes.filter((node) => node.type === "connector"),
    ...documentValue.nodes.filter((node) => !["connector", "frame"].includes(node.type))
  ].map((node) => exportNode(documentValue, node, x, y)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}"><defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L0,6 L9,3 z" fill="#646a73"/></marker></defs><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#ffffff"/>${nodes}</svg>`;
}
