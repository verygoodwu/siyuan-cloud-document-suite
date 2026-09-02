import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  WHITEBOARD_NODE_LIMIT,
  connectorPath,
  createWhiteboardDocument,
  createWhiteboardNode,
  detachWhiteboardReferences,
  documentBounds,
  duplicateWhiteboardNodes,
  frameWhiteboardNodes,
  groupWhiteboardNodes,
  moveWhiteboardNodes,
  normalizeWhiteboardDocument,
  parseWhiteboardDocument,
  resizeWhiteboardNode,
  reorderWhiteboardNodes,
  resolveWhiteboardSelection,
  serializeWhiteboardDocument,
  ungroupWhiteboardNodes
} from "../static/whiteboard-model.js";
import { buildWhiteboardSvg } from "../static/whiteboard-renderer.js";
import {
  alignWhiteboardNodes,
  autoLayoutWhiteboardNodes,
  distributeWhiteboardNodes,
  nodesInMarquee
} from "../static/whiteboard-layout.js";
import { instantiateWhiteboardTemplate } from "../static/whiteboard-templates.js";

function sampleBoard() {
  const documentValue = createWhiteboardDocument("产品流程");
  const start = createWhiteboardNode("rect", { id: "start", x: 20, y: 30, width: 160, height: 80, text: "开始" });
  const end = createWhiteboardNode("diamond", { id: "end", x: 320, y: 40, width: 140, height: 100, text: "完成？" });
  const edge = createWhiteboardNode("connector", {
    id: "edge",
    from: { nodeId: start.id, anchor: "right" },
    to: { nodeId: end.id, anchor: "left" }
  });
  documentValue.nodes.push(start, edge, end);
  return documentValue;
}

test("whiteboard documents round-trip as versioned editable node data", () => {
  const original = sampleBoard();
  const reopened = parseWhiteboardDocument(serializeWhiteboardDocument(original));
  assert.equal(reopened.schema, "siyuan-cloud-whiteboard");
  assert.equal(reopened.version, 1);
  assert.equal(reopened.title, "产品流程");
  assert.deepEqual(reopened.nodes.map(({ id, type }) => ({ id, type })), [
    { id: "start", type: "rect" },
    { id: "edge", type: "connector" },
    { id: "end", type: "diamond" }
  ]);
});

test("connector geometry follows node anchors after nodes move", () => {
  const documentValue = sampleBoard();
  assert.equal(connectorPath(documentValue, documentValue.nodes[1]), "M 180 70 H 250 V 90 H 320");
  moveWhiteboardNodes(documentValue, ["end"], 100, 40);
  assert.equal(connectorPath(documentValue, documentValue.nodes[1]), "M 180 70 H 300 V 130 H 420");
});

test("duplicate keeps internal connector references editable", () => {
  const documentValue = sampleBoard();
  const copyIds = duplicateWhiteboardNodes(documentValue, ["start", "edge", "end"], 30);
  assert.equal(copyIds.length, 3);
  const copies = documentValue.nodes.filter((node) => copyIds.includes(node.id));
  const copiedConnector = copies.find((node) => node.type === "connector");
  assert.ok(copyIds.includes(copiedConnector.from.nodeId));
  assert.ok(copyIds.includes(copiedConnector.to.nodeId));
  assert.equal(documentBounds(documentValue, copyIds).x, 50);
});

test("resize preserves a freehand stroke's relative geometry", () => {
  const stroke = createWhiteboardNode("freehand", {
    points: [{ x: 10, y: 10 }, { x: 20, y: 30 }, { x: 30, y: 20 }]
  });
  resizeWhiteboardNode(stroke, { x: 100, y: 200, width: 40, height: 40 });
  assert.deepEqual(stroke.points, [
    { x: 100, y: 200 },
    { x: 120, y: 240 },
    { x: 140, y: 220 }
  ]);
});

test("groups, frames, and selection resolution preserve editable relationships", () => {
  const documentValue = sampleBoard();
  const groupId = groupWhiteboardNodes(documentValue, ["start", "end"]);
  assert.ok(groupId);
  assert.deepEqual([...resolveWhiteboardSelection(documentValue, ["start"])].sort(), ["end", "start"]);
  assert.equal(ungroupWhiteboardNodes(documentValue, ["start"]), 2);
  const frame = frameWhiteboardNodes(documentValue, ["start", "end"], "核心流程");
  assert.equal(frame.type, "frame");
  assert.deepEqual(frame.childIds, ["start", "end"]);
  assert.deepEqual([...resolveWhiteboardSelection(documentValue, [frame.id])].sort(), [frame.id, "end", "start"].sort());
  const reopened = parseWhiteboardDocument(serializeWhiteboardDocument(documentValue));
  assert.deepEqual(reopened.nodes.find((node) => node.id === frame.id).childIds, ["start", "end"]);
});

test("alignment, distribution, auto layout, and marquee selection are deterministic", () => {
  const documentValue = createWhiteboardDocument("排版");
  documentValue.nodes.push(
    createWhiteboardNode("rect", { id: "a", x: 0, y: 0, width: 100, height: 50 }),
    createWhiteboardNode("rect", { id: "b", x: 240, y: 90, width: 100, height: 50 }),
    createWhiteboardNode("rect", { id: "c", x: 600, y: 180, width: 100, height: 50 })
  );
  assert.equal(alignWhiteboardNodes(documentValue, ["a", "b", "c"], "top"), true);
  assert.deepEqual(documentValue.nodes.map((node) => node.y), [0, 0, 0]);
  assert.equal(distributeWhiteboardNodes(documentValue, ["a", "b", "c"], "horizontal"), true);
  assert.deepEqual(documentValue.nodes.map((node) => node.x), [0, 300, 600]);
  assert.equal(autoLayoutWhiteboardNodes(documentValue, ["a", "b", "c"], "vertical"), true);
  assert.deepEqual(documentValue.nodes.map((node) => node.y), [0, 122, 244]);
  assert.deepEqual(nodesInMarquee(documentValue, { x: -5, y: -5, right: 120, bottom: 60 }), ["a"]);
});

test("built-in whiteboard templates contain valid connected editable nodes", () => {
  for (const id of ["flow", "brainstorm", "plan"]) {
    const nodes = instantiateWhiteboardTemplate(id, { x: 100, y: 100 });
    assert.ok(nodes.length >= 6, `${id} template is unexpectedly small`);
    const ids = new Set(nodes.map((node) => node.id));
    for (const connector of nodes.filter((node) => node.type === "connector")) {
      assert.ok(ids.has(connector.from.nodeId));
      assert.ok(ids.has(connector.to.nodeId));
    }
  }
});

test("layer ordering and deletion cleanup do not leave dangling frame references", () => {
  const documentValue = createWhiteboardDocument("图层");
  const a = createWhiteboardNode("rect", { id: "a" });
  const b = createWhiteboardNode("rect", { id: "b" });
  const c = createWhiteboardNode("rect", { id: "c" });
  const frame = createWhiteboardNode("frame", { id: "frame", childIds: ["a", "b"] });
  documentValue.nodes.push(frame, a, b, c);
  assert.equal(reorderWhiteboardNodes(documentValue, ["a"], "front"), true);
  assert.deepEqual(documentValue.nodes.map((node) => node.id), ["frame", "b", "c", "a"]);
  assert.equal(reorderWhiteboardNodes(documentValue, ["a"], "backward"), true);
  assert.deepEqual(documentValue.nodes.map((node) => node.id), ["frame", "b", "a", "c"]);
  assert.equal(reorderWhiteboardNodes(documentValue, ["c"], "back"), true);
  assert.deepEqual(documentValue.nodes.map((node) => node.id), ["c", "frame", "b", "a"]);
  detachWhiteboardReferences(documentValue, ["a"]);
  assert.deepEqual(frame.childIds, ["b"]);
});

test("SVG export includes frames, shapes, text, connectors, and arrow definitions", () => {
  const documentValue = sampleBoard();
  const frame = frameWhiteboardNodes(documentValue, ["start", "end"], "流程分区");
  const svg = buildWhiteboardSvg(documentValue);
  assert.match(svg, /^<svg/);
  assert.match(svg, /<marker id="arrow"/);
  assert.match(svg, /流程分区/);
  assert.match(svg, /<text[^>]*><tspan/);
  assert.doesNotMatch(svg, /<foreignObject/);
  assert.match(svg, /marker-end=/);
  assert.ok(svg.indexOf(frame.text) < svg.indexOf("开始"));
});

test("invalid and future whiteboard files fail safely", () => {
  assert.throws(() => normalizeWhiteboardDocument({}), /不是云文档套件白板文件/);
  assert.throws(() => normalizeWhiteboardDocument({ schema: "siyuan-cloud-whiteboard", version: 99 }), /更高版本/);
  assert.throws(() => normalizeWhiteboardDocument({
    schema: "siyuan-cloud-whiteboard",
    version: 1,
    nodes: Array.from({ length: WHITEBOARD_NODE_LIMIT + 1 }, () => ({ type: "rect" }))
  }), /节点超过/);
});

test("large practical whiteboards remain inside the model performance budget", () => {
  const documentValue = createWhiteboardDocument("规模测试");
  documentValue.nodes = Array.from({ length: 2000 }, (_, index) => createWhiteboardNode("rect", {
    id: `node-${index}`,
    x: (index % 50) * 180,
    y: Math.floor(index / 50) * 110,
    text: `节点 ${index}`
  }));
  const startedAt = performance.now();
  const bytes = serializeWhiteboardDocument(documentValue);
  const restored = parseWhiteboardDocument(bytes);
  const elapsed = performance.now() - startedAt;
  assert.equal(restored.nodes.length, 2000);
  assert.ok(elapsed < 1000, `whiteboard round-trip took ${elapsed.toFixed(1)} ms`);
});

test("whiteboard editor is packaged through the existing plugin framework", async () => {
  const [html, editor, renderer, plugin, previews, embed, packageScript] = await Promise.all([
    readFile(new URL("../static/whiteboard-editor.html", import.meta.url), "utf8"),
    readFile(new URL("../static/whiteboard-editor.js", import.meta.url), "utf8"),
    readFile(new URL("../static/whiteboard-renderer.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/preview-builders.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/embed-manager.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package.mjs", import.meta.url), "utf8")
  ]);
  assert.match(plugin, /label: "新建白板"/);
  assert.match(plugin, /buildUniqueUploadName\("新建白板\.board\.json"\)/);
  assert.match(previews, /whiteboard-editor\.html/);
  assert.match(embed, /mm\|sheet\|whiteboard/);
  assert.match(packageScript, /whiteboard-editor\.html/);
  assert.match(packageScript, /whiteboard-model\.js/);
  assert.match(packageScript, /whiteboard-layout\.js/);
  assert.match(packageScript, /whiteboard-templates\.js/);
  assert.match(html, /id="main-toolbar"/);
  assert.match(html, /id="selection-toolbar"/);
  assert.match(html, /id="conflict-notice"/);
  assert.match(html, /id="template-dialog"/);
  assert.match(html, /id="arrange-action"/);
  assert.match(html, /id="text-editor" hidden><div id="text-editor-input" contenteditable="true"/);
  assert.match(html, /#text-editor\{[^}]*display:flex;align-items:center/);
  assert.match(html, /#text-editor-input\{[^}]*width:100%;max-height:100%/);
  assert.match(editor, /new SiyuanFileStore\(asset, storageKey\)/);
  assert.match(editor, /setTimeout\(\(\) => void persist\(false\), 700\)/);
  assert.match(editor, /createConnectedNode/);
  assert.match(editor, /buildWhiteboardSvg/);
  assert.match(editor, /nodesInMarquee/);
  assert.match(editor, /groupSelection/);
  assert.doesNotMatch(editor, /else \{\s*const node = createNodeAt\("rect", screenToWorld\(event\.clientX/);
  assert.match(renderer, /data-quick-anchor/);
});
