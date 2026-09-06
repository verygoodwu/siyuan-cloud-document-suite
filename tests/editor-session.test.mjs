import assert from "node:assert/strict";
import test from "node:test";
import { createEditorSession } from "../static/editor-session.js";

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };
}

test("editor session isolates state by editor and asset", () => {
  const storage = memoryStorage();
  const first = createEditorSession("text", "/assets/a.txt", storage);
  const second = createEditorSession("sheet", "/assets/a.txt", storage);
  first.write({ scrollTop: 120, selectionStart: 8 });
  second.write({ sheet: "统计" });
  assert.equal(first.read().scrollTop, 120);
  assert.equal(first.read().selectionStart, 8);
  assert.equal(second.read().sheet, "统计");
  assert.notEqual(first.key, second.key);
});

test("editor session merges patches and survives invalid storage data", () => {
  const storage = memoryStorage();
  const session = createEditorSession("mind", "/assets/a.mm", storage);
  assert.deepEqual(session.read(), {});
  assert.equal(session.write({ scaleVal: 1.2 }), true);
  assert.equal(session.write({ selectedNodeId: "node-2" }), true);
  assert.equal(session.read().scaleVal, 1.2);
  assert.equal(session.read().selectedNodeId, "node-2");
  storage.setItem(session.key, "invalid-json");
  assert.deepEqual(session.read(), {});
  session.clear();
  assert.deepEqual(session.read(), {});
});

test("editor session rejects oversized state", () => {
  const storage = memoryStorage();
  const session = createEditorSession("pdf", "/assets/a.pdf", storage);
  assert.equal(session.write({ page: 7 }), true);
  assert.equal(session.write({ huge: "x".repeat(17 * 1024) }), false);
  assert.equal(session.read().page, 7);
});
