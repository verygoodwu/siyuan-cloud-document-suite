import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOutlineRows,
  captureMindExpansion,
  expandNodeAncestors,
  flattenMindNodes,
  nextSearchResultId,
  resolveMindShortcut,
  restoreMindExpansion,
  searchMindNodes
} from "../static/mm-workspace.js";

function sampleMind() {
  return {
    id: "root",
    topic: "项目计划",
    children: [
      {
        id: "design",
        topic: "设计阶段",
        expanded: false,
        children: [
          { id: "review", topic: "界面 评审", children: [] },
          { id: "assets", topic: "设计资源", children: [] }
        ]
      },
      {
        id: "release",
        topic: "发布阶段",
        children: [{ id: "market", topic: "上传集市", children: [] }]
      }
    ]
  };
}

test("mind index keeps hierarchy, visibility, and parent paths", () => {
  const rows = flattenMindNodes(sampleMind());
  assert.deepEqual(rows.map(({ id, depth, visible }) => ({ id, depth, visible })), [
    { id: "root", depth: 0, visible: true },
    { id: "design", depth: 1, visible: true },
    { id: "review", depth: 2, visible: false },
    { id: "assets", depth: 2, visible: false },
    { id: "release", depth: 1, visible: true },
    { id: "market", depth: 2, visible: true }
  ]);
  assert.deepEqual(rows.find((row) => row.id === "review").ancestorIds, ["root", "design"]);
});

test("mind search is case-insensitive, token-aware, and includes hidden nodes", () => {
  const mind = sampleMind();
  assert.deepEqual(searchMindNodes(mind, "设计").map((row) => row.id), ["design", "assets"]);
  assert.deepEqual(searchMindNodes(mind, "界面 评审").map((row) => row.id), ["review"]);
  assert.deepEqual(searchMindNodes(mind, "  "), []);
});

test("filtered outline keeps matching nodes and their context ancestors", () => {
  const mind = sampleMind();
  assert.deepEqual(buildOutlineRows(mind).map((row) => row.id), ["root", "design", "release", "market"]);
  const filtered = buildOutlineRows(mind, "界面");
  assert.deepEqual(filtered.map((row) => row.id), ["root", "design", "review"]);
  assert.equal(filtered.find((row) => row.id === "review").matched, true);
});

test("search navigation wraps in both directions", () => {
  const results = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.equal(nextSearchResultId(results, undefined, 1), "a");
  assert.equal(nextSearchResultId(results, "c", 1), "a");
  assert.equal(nextSearchResultId(results, "a", -1), "c");
  assert.equal(nextSearchResultId([], "a", 1), undefined);
});

test("revealing a search result expands only its ancestors", () => {
  const mind = sampleMind();
  assert.equal(expandNodeAncestors(mind, "review"), true);
  assert.equal(mind.children[0].expanded, true);
  assert.equal(expandNodeAncestors(mind, "review"), false);
  assert.equal(expandNodeAncestors(mind, "missing"), false);
});

test("temporary search expansion restores old state without overwriting manual changes", () => {
  const mind = sampleMind();
  const snapshot = captureMindExpansion(mind);
  assert.deepEqual(snapshot, { root: true, design: false, release: true });
  expandNodeAncestors(mind, "review");
  mind.children[1].expanded = false;
  assert.equal(restoreMindExpansion(mind, snapshot, new Set(["release"])), 1);
  assert.equal(mind.children[0].expanded, false);
  assert.equal(mind.children[1].expanded, false);
});

test("mind shortcuts stay inactive while editing and require valid node context", () => {
  assert.equal(resolveMindShortcut({ key: "?" }), "toggle-help");
  assert.equal(resolveMindShortcut({ key: "Escape" }, { helpOpen: true }), "close-help");
  assert.equal(resolveMindShortcut({ key: "Home", ctrlKey: true }), "focus-root");
  assert.equal(resolveMindShortcut(
    { key: "/", ctrlKey: true },
    { hasSelection: true, hasChildren: true }
  ), "toggle-branch");
  assert.equal(resolveMindShortcut(
    { key: "/", ctrlKey: true },
    { hasSelection: true, hasChildren: false }
  ), undefined);
  assert.equal(resolveMindShortcut({ key: "?" }, { editing: true }), undefined);
  assert.equal(resolveMindShortcut({ key: "Escape" }, { workspaceOpen: true }), "close-workspace");
  assert.equal(resolveMindShortcut({ key: "Escape" }, { focusMode: true }), "exit-focus");
});

test("mind workspace helpers stay responsive with more than one thousand nodes", () => {
  let sequence = 0;
  const makeLevel = (depth, width) => {
    const node = { id: `node-${sequence++}`, topic: `节点 ${sequence}`, children: [] };
    if (depth > 0) {
      for (let index = 0; index < width; index++) node.children.push(makeLevel(depth - 1, width));
    }
    return node;
  };
  const mind = makeLevel(5, 4);
  const startedAt = performance.now();
  const rows = flattenMindNodes(mind);
  const matches = searchMindNodes(mind, "节点");
  const outline = buildOutlineRows(mind, "节点 1000");
  const elapsed = performance.now() - startedAt;
  assert.equal(rows.length, 1365);
  assert.equal(matches.length, 1365);
  assert.ok(outline.length > 0);
  assert.ok(elapsed < 500, `large mind workspace helpers took ${elapsed.toFixed(1)} ms`);
});

test("mind workspace helpers remain bounded at a larger practical limit", () => {
  let sequence = 0;
  const makeTree = (depth, width) => {
    const node = { id: `limit-${sequence++}`, topic: `节点 ${sequence}`, children: [] };
    if (depth > 0) for (let index = 0; index < width; index += 1) node.children.push(makeTree(depth - 1, width));
    return node;
  };
  const mind = makeTree(6, 4);
  const startedAt = performance.now();
  const rows = flattenMindNodes(mind);
  const matches = searchMindNodes(mind, "节点");
  const outline = buildOutlineRows(mind, "节点 4000");
  const elapsed = performance.now() - startedAt;
  assert.equal(rows.length, 5461);
  assert.equal(matches.length, rows.length);
  assert.ok(outline.length > 0);
  assert.ok(elapsed < 1000, `large mind workspace helpers took ${elapsed.toFixed(1)} ms`);
});
