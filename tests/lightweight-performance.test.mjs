import assert from "node:assert/strict";
import test from "node:test";
import { createTextMetrics } from "../static/text-editor-core.js";
import { trimSnapshotHistory } from "../static/editor-session.js";

test("text metrics matches newline boundaries, Unicode, edits and restored content", () => {
  const metrics = createTextMetrics();
  for (const text of ["", "中文🙂\n第二行\n", "a\r\nb", "single", "a\nb", ""]) {
    for (let offset = 0; offset <= text.length; offset++) {
      const prefix = text.slice(0, offset);
      const actual = metrics.read(text, offset);
      assert.equal(actual.lines, text.split("\n").length);
      assert.equal(actual.line, prefix.split("\n").length);
      assert.equal(actual.column, offset - prefix.lastIndexOf("\n"));
    }
  }
});

test("large-text cursor queries reuse a single index", () => {
  const metrics = createTextMetrics();
  const text = "中文 text\n".repeat(100000);
  const start = performance.now();
  for (let i = 0; i < 10000; i++) assert.equal(metrics.read(text, (i * 97) % text.length).builds, 1);
  console.log(`Text index + 10000 cursor queries: ${(performance.now() - start).toFixed(1)} ms`);
  assert.equal(metrics.read(text + "new").builds, 2);
});

test("snapshot budget bounds history and preserves latest content", () => {
  const history = ["a".repeat(20), "b".repeat(20), "c".repeat(20)];
  assert.deepEqual(trimSnapshotHistory(history, 80), { removed: 1, bytes: 80 });
  assert.equal(history.at(-1), "c".repeat(20));
  history.push("large".repeat(100));
  assert.deepEqual(trimSnapshotHistory(history, 80), { removed: 2, bytes: 1000 });
  assert.equal(history.length, 1); // One oversize current state must never be discarded.
  assert.deepEqual(trimSnapshotHistory([]), { removed: 0, bytes: 0 });
});

test("snapshot entry cap and redo branch pruning preserve order", () => {
  const history = Array.from({ length: 110 }, (_, i) => JSON.stringify({ i }));
  assert.equal(trimSnapshotHistory(history).removed, 10);
  assert.equal(JSON.parse(history[0]).i, 10);
  history.splice(50);
  history.push('{"i":"new branch"}');
  trimSnapshotHistory(history);
  assert.equal(JSON.parse(history.at(-1)).i, "new branch");
  assert.equal(history.length, 51);
});
