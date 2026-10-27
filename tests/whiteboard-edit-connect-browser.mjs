import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { pathToFileURL } from "node:url";
import { createWhiteboardDocument, createWhiteboardNode } from "../static/whiteboard-model.js";

// Isolated, in-memory SiYuan API. Tests the actual packaged editor with real browser input.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE
  ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : "playwright");
const board = createWhiteboardDocument("白板编辑与连接回归");
board.viewport = { x: 100, y: 100, zoom: 1 };
board.nodes = [
  createWhiteboardNode("rect", { id: "source", x: 100, y: 180, width: 240, height: 100, text: "原有文字ABC" }),
  createWhiteboardNode("rect", { id: "target", x: 600, y: 180, width: 240, height: 100, text: "目标节点" })
];
const assetPath = "/data/assets/test.board.json";
const files = new Map([[assetPath, Buffer.from(JSON.stringify(board))]]);
const checks = [];
const errors = [];
await mkdir("reports", { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (url.pathname === "/api/file/putFile") {
        const form = await new Request("http://localhost", { method: "POST", headers: req.headers, body: bytes }).formData();
        if (form.get("file")) files.set(form.get("path"), Buffer.from(await form.get("file").arrayBuffer()));
      } else if (url.pathname === "/api/file/getFile") {
        const path = JSON.parse(bytes).path;
        if (!files.has(path)) { res.writeHead(404).end(); return; }
        res.end(files.get(path)); return;
      } else if (url.pathname === "/api/file/removeFile") files.delete(JSON.parse(bytes).path);
      res.setHeader("Content-Type", "application/json");
      res.end('{"code":0,"data":[]}'); return;
    }
    if (url.pathname === "/assets/test.board.json") { res.end(files.get(assetPath)); return; }
    const name = url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(name)) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", extname(name) === ".html" ? "text/html; charset=utf-8" : "text/javascript; charset=utf-8");
    res.end(await readFile(resolve("dist", name)));
  } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ executablePath: process.env.TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  const url = `http://127.0.0.1:${server.address().port}/whiteboard-editor.html?asset=/assets/test.board.json`;
  const input = page.locator("#text-editor-input");
  const source = page.locator('[data-node-id="source"]');
  const text = () => source.locator(".whiteboard-node-text").textContent();
  const saved = () => JSON.parse(files.get(assetPath));
  const waitSaved = () => page.waitForFunction(() => document.querySelector("#status")?.dataset.state === "saved");
  const finish = async () => { await page.keyboard.press("Control+Enter"); await waitSaved(); };
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector("#loading")?.hidden);

  await source.dblclick();
  assert.equal(await input.textContent(), "原有文字ABC");
  assert.equal(await page.evaluate(() => getSelection().isCollapsed), true);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await page.keyboard.insertText("修改");
  await finish();
  assert.equal(await text(), "原有文字A修改C");
  checks.push("双击保留原文；移动光标局部删除、插入中文并保存");

  await source.click();
  await page.keyboard.press("F2");
  await page.keyboard.insertText("末尾");
  await finish();
  assert.equal(await text(), "原有文字A修改C末尾");
  await source.click();
  await page.keyboard.press("x");
  await page.keyboard.insertText("追加");
  await finish();
  assert.equal(await text(), "原有文字A修改C末尾x追加");
  checks.push("F2 从末尾编辑；选中直接输入保留原文并追加");

  await source.dblclick();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("取消内容");
  await page.keyboard.press("Escape");
  assert.equal(await text(), "原有文字A修改C末尾x追加");
  await source.dblclick();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("第二行🙂");
  await finish();
  assert.equal(await text(), "原有文字A修改C末尾x追加\n第二行🙂");
  checks.push("Escape 取消；换行、中文与 Emoji 保存");

  // Locate a specific glyph using the browser's rendered text geometry.
  await source.dblclick();
  await page.keyboard.press("Control+A");
  await page.keyboard.insertText("ABCDEFGH");
  await finish();
  const glyph = await source.locator(".whiteboard-node-text").evaluate((el) => {
    const range = document.createRange(); range.setStart(el.firstChild, 3); range.setEnd(el.firstChild, 4);
    const r = range.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.dblclick(glyph.x, glyph.y);
  const caretOffset = await page.evaluate(() => getSelection().anchorOffset);
  assert.ok(caretOffset >= 2 && caretOffset <= 5, `caret offset ${caretOffset}`);
  await page.keyboard.insertText("中");
  await finish();
  assert.equal((await text()).replace("中", ""), "ABCDEFGH");
  checks.push("双击指定字附近落光标并插入，不覆盖整段");

  await source.click();
  const handle = page.locator('[data-quick-anchor="right"]');
  const h = await handle.boundingBox();
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(705, 330, { steps: 15 });
  assert.equal(await page.locator('[data-node-id="target"].connection-target').count(), 1);
  assert.equal(await page.locator(".connection-snap-marker").count(), 1);
  await page.mouse.up();
  await waitSaved();
  assert.equal(saved().nodes.length, 3);
  let edge = saved().nodes.find((n) => n.type === "connector");
  assert.equal(edge.from.nodeId, "source");
  assert.equal(edge.to.nodeId, "target");
  checks.push("四向控制点拖到已有节点：高亮吸附并连接，不多建节点");
  assert.equal(await page.locator("#selection-layer .selection-outline").count(), 0);
  assert.equal(await page.locator("#selection-layer .connector-end-handle").count(), 2);
  const selectedColor = await page.locator(`[data-node-id="${edge.id}"] .connector-line`).evaluate(el => getComputedStyle(el).stroke);
  const accentColor = await page.evaluate(() => {
    const el = document.createElement("i"); el.style.color = "var(--board-accent)";
    document.body.append(el); const color = getComputedStyle(el).color; el.remove(); return color;
  });
  assert.equal(selectedColor, accentColor);
  await page.screenshot({ path: "reports/connector-selected-no-box.png" });
  await source.click();
  assert.equal(await page.locator("#selection-layer .selection-outline").count(), 1);
  const normalColor = await page.locator(`[data-node-id="${edge.id}"] .connector-line`).evaluate(el => getComputedStyle(el).stroke);
  assert.equal(normalColor, "rgb(100, 106, 115)");
  checks.push("选中连线只高亮线条和两个端点；取消选中恢复颜色，图形仍显示选择框");

  await page.keyboard.press("Control+z");
  await waitSaved(); assert.equal(saved().nodes.length, 2);
  await page.keyboard.press("Control+y");
  await waitSaved(); assert.equal(saved().nodes.length, 3);
  checks.push("连接支持撤销、重做与保存");

  await source.click();
  const q = await page.locator('[data-quick-anchor="bottom"]').boundingBox();
  await page.mouse.move(q.x + q.width / 2, q.y + q.height / 2);
  await page.mouse.down(); await page.mouse.move(330, 600, { steps: 15 }); await page.mouse.up();
  await page.waitForFunction(() => !document.querySelector("#text-editor").hidden);
  await page.keyboard.insertText("新建节点"); await finish();
  assert.equal(saved().nodes.filter((n) => n.type !== "connector").length, 3);
  assert.equal(saved().nodes.filter((n) => n.type === "connector").length, 2);
  checks.push("拖到空白处仍创建节点并连接、输入与保存");

  // Reconnect an existing edge using its real endpoint handle.
  edge = saved().nodes.find((n) => n.to?.nodeId === "target");
  const edgePoint = await page.locator(`[data-node-id="${edge.id}"] .connector-hit`).evaluate((path) => {
    const point = path.getPointAtLength(path.getTotalLength() * 0.3);
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(edgePoint.x, edgePoint.y);
  assert.equal(await page.locator("#selection-layer .selection-outline").count(), 0);
  const end = await page.locator('[data-connector-end="to"]').boundingBox();
  const newNode = saved().nodes.find((n) => n.text === "新建节点");
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2);
  await page.mouse.down(); await page.mouse.move(newNode.x + 105, newNode.y + 120, { steps: 15 }); await page.mouse.up();
  await waitSaved();
  assert.equal(saved().nodes.find((n) => n.id === edge.id).to.nodeId, newNode.id);
  checks.push("原有连线端点可拖动重连到另一节点");

  // Composition is issued through Chromium's input API, rather than a synthetic DOM event.
  await source.click(); await page.keyboard.press("F2");
  const session = await page.context().newCDPSession(page);
  await session.send("Input.imeSetComposition", { text: "中文组合", selectionStart: 4, selectionEnd: 4 });
  assert.ok((await input.innerText()).includes("中文组合"));
  await session.send("Input.insertText", { text: "中文组合" });
  await finish();
  assert.ok((await text()).endsWith("中文组合"));
  checks.push("中文组合输入提交后原文保留并保存");

  // Zoom while selected: connection controls retain a usable screen hit area.
  for (const targetZoom of [0.5, 2]) {
    const data = saved(); data.viewport = { x: 50, y: 50, zoom: targetZoom };
    files.set(assetPath, Buffer.from(JSON.stringify(data)));
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#loading")?.hidden);
    await source.click();
    const before = await page.locator('[data-quick-anchor="right"]').boundingBox();
    assert.ok(before.width >= 30 && before.width <= 34);
    await page.locator("#zoom-out").click();
    const after = await page.locator('[data-quick-anchor="right"]').boundingBox();
    assert.ok(after.width >= 30 && after.width <= 34);
    await page.keyboard.press("F2");
    await page.keyboard.insertText("缩放"); await finish();
    assert.ok((await text()).endsWith("缩放"));
  }
  checks.push("50% / 200% 缩放下可继续编辑，缩放时连接点点击范围保持稳定");

  const expected = saved().nodes;
  await page.reload();
  await page.waitForFunction(() => document.querySelector("#loading")?.hidden);
  assert.equal(await page.locator("#node-layer > [data-node-id]").count(), expected.length);
  assert.deepEqual(saved().nodes, expected);
  assert.equal(await source.locator(".whiteboard-node-text").textContent(), expected.find((n) => n.id === "source").text);
  checks.push("重开后文字、节点和连接关系保持一致");
  await page.locator("#fit").click();
  await waitSaved();
  await page.screenshot({ path: "reports/whiteboard-edit-connect.png", fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
  await writeFile("reports/whiteboard-edit-connect.json", JSON.stringify({ passed: checks.length, checks, errors }, null, 2));
} finally { await browser.close(); await new Promise((r) => server.close(r)); }
