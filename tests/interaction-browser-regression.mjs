import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import * as XLSX from "xlsx";

// Isolated browser and in-memory kernel: never touches a user's workspace data.
const files = new Map();
const writes = new Map();
const checks = [];
checks.push = function (...items) { console.log(...items); return Array.prototype.push.apply(this, items); };
const errors = [];
let denyLease = false;
let fullResult;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["original", 2]]), "First");
const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
files.set("/data/assets/test.xlsx", bytes);
const big = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(big, XLSX.utils.aoa_to_sheet(Array.from({ length: 501 }, () => ["protected"])), "Big");
files.set("/data/assets/big.xlsx", XLSX.write(big, { type: "buffer", bookType: "xlsx" }));
files.set("/data/assets/test.txt", Buffer.from("original text"));
files.set("/data/assets/theme.txt", Buffer.from("theme test"));
files.set("/data/assets/theme.mm", Buffer.from('<map version="1.0.1"><node TEXT="中心主题" ID="root"><node TEXT="子节点" ID="child" POSITION="right"/></node></map>'));
const board = Buffer.from(JSON.stringify({ schema: "siyuan-cloud-whiteboard", version: 1, title: "Test", viewport: { x: 300, y: 200, zoom: 1 }, nodes: [] }));
files.set("/data/assets/test.board.json", board);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Cache-Control", "no-store");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (url.pathname === "/full-result") {
      fullResult = JSON.parse(body); res.end('{"code":0}'); return;
    }
    if (url.pathname === "/full-test") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await readFile("tests/whiteboard-full-browser.html")); return;
    }
    if (url.pathname === "/theme-host") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><html data-theme-mode="dark"><style>:root{--b3-theme-primary:#aabbcc}</style><iframe src="/text-editor.html?asset=/assets/theme.txt"></iframe></html>'); return;
    }
    if (url.pathname === "/api/file/putFile") {
      const form = await new Request("http://localhost", { method: "POST", headers: req.headers, body }).formData();
      if (form.get("file")) {
        const path = form.get("path");
        files.set(path, Buffer.from(await form.get("file").arrayBuffer()));
        writes.set(path, (writes.get(path) || 0) + 1);
      }
      res.end('{"code":0}'); return;
    }
    if (url.pathname === "/api/file/getFile") {
      const { path } = JSON.parse(body);
      if (denyLease && !path.startsWith("/data/assets/")) {
        res.end(JSON.stringify({ owner: "other-session", expiresAt: Date.now() + 60000 })); return;
      }
      if (!files.has(path)) { res.writeHead(404).end(); return; }
      res.end(files.get(path)); return;
    }
    if (url.pathname === "/api/file/removeFile") {
      files.delete(JSON.parse(body).path); res.end('{"code":0}'); return;
    }
    if (url.pathname.startsWith("/api/")) { res.end('{"code":0,"data":[]}'); return; }
    if (url.pathname.startsWith("/assets/")) {
      res.end(files.get(`/data${url.pathname}`)); return;
    }
    const name = url.pathname.split("/").pop();
    if (!/^[a-z0-9.-]+$/i.test(name)) { res.writeHead(404).end(); return; }
    const path = name === "xlsx.full.min.js" ? "node_modules/xlsx/dist/xlsx.full.min.js"
      : ["MindElixir.js", "MindElixir.css"].includes(name) ? `node_modules/mind-elixir/dist/${name}` : `static/${name}`;
    const content = await readFile(resolve(path));
    res.setHeader("Content-Type", extname(path) === ".html" ? "text/html; charset=utf-8" : extname(path) === ".css" ? "text/css" : "text/javascript; charset=utf-8");
    res.end(content);
  } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(join(tmpdir(), "cloud-suite-regression-"));
const browser = spawn(process.env.TEST_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
  "--headless=new", "--no-first-run", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"
], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
let socket;
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chrome startup timeout")), 20000);
    let log = "";
    browser.on("error", reject);
    browser.stderr.on("data", (chunk) => {
      log += chunk;
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(log);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  console.log("Isolated Chrome started");
  const list = await fetch(`http://${new URL(endpoint).host}/json/list`).then((r) => r.json());
  socket = new WebSocket(list.find((item) => item.type === "page").webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener("open", resolve, { once: true }));
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (!message.id) return;
    const entry = pending.get(message.id);
    if (!entry) return;
    pending.delete(message.id);
    message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result);
  });
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const next = ++id;
    const timeout = setTimeout(() => { pending.delete(next); reject(new Error(`CDP timeout: ${method} ${JSON.stringify(params).slice(0, 250)}`)); }, 15000);
    pending.set(next, { resolve: (value) => { clearTimeout(timeout); resolve(value); }, reject: (error) => { clearTimeout(timeout); reject(error); } });
    socket.send(JSON.stringify({ id: next, method, params }));
  });
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await wait(50); }
    throw new Error(`Timeout: ${expression}\n${errors.join("\n")}\n${await evaluate("JSON.stringify({status:document.querySelector('#status')?.textContent, nodes:document.querySelector('#node-layer')?.innerHTML, focus:document.activeElement?.id, size:[innerWidth,innerHeight], tool:document.querySelector('#canvas-shell')?.className})")}`);
  };
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const key = (value, options = {}) => evaluate(`(document.activeElement || window).dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ key: value, bubbles: true, cancelable: true, ...options })}))`);
  const navigate = async (editor, asset, ready) => {
    await command("Page.navigate", { url: `${base}/${editor}.html?asset=${encodeURIComponent(asset)}` });
    await until(ready);
  };
  await command("Runtime.enable"); await command("Page.enable");
  await command("Emulation.setFocusEmulationEnabled", { enabled: true });
  await command("Page.setDownloadBehavior", { behavior: "allow", downloadPath: profile });
  await navigate("sheet-editor", "/assets/test.xlsx", "document.querySelectorAll('#grid td').length > 0");
  await evaluate("document.querySelector('#grid td').focus()");
  await command("Input.insertText", { text: "123" });
  await key("s", { ctrlKey: true });
  await until("document.querySelector('#status').textContent.includes('已写入') || document.querySelector('#status').textContent.includes('内容已保存')");
  assert.equal(XLSX.read(files.get("/data/assets/test.xlsx")).Sheets.First.A1.v, 123);
  checks.push("basic-mode typing and Ctrl+S persist actual workbook bytes");
  await click("#mode-toggle"); await click("#add-sheet");
  await evaluate("window.prompt = () => 'Renamed'; window.confirm = () => true");
  await click("#rename");
  await until("document.querySelector('.cloud-dialog[open]') !== null");
  await evaluate("document.querySelector('.cloud-dialog input').value='bad/name'");
  await click('.cloud-dialog button[type="submit"]');
  assert.ok(await evaluate("document.querySelector('.cloud-dialog [role=alert]').textContent"));
  await evaluate("document.querySelector('.cloud-dialog input').value='First'");
  await click('.cloud-dialog button[type="submit"]');
  assert.equal(await evaluate("document.querySelector('.cloud-dialog [role=alert]').textContent"), "已有同名工作表");
  await evaluate("document.querySelector('.cloud-dialog input').value='x'.repeat(32)");
  await click('.cloud-dialog button[type="submit"]');
  assert.equal(await evaluate("document.querySelector('.cloud-dialog [role=alert]').textContent"), "名称不能超过 31 个字符");
  await key("Escape");
  await until("document.querySelector('.cloud-dialog') === null");
  assert.equal(await evaluate("document.querySelector('.cloud-dialog')"), null);
  await click("#rename");
  await evaluate("document.querySelector('.cloud-dialog input').value='Renamed'");
  await click('.cloud-dialog button[type="submit"]');
  await until("[...document.querySelectorAll('.tab')].some(n => n.textContent === 'Renamed')");
  checks.push("rename dialog validates invalid/duplicate names, cancels and restores editor focus");
  await click("#delete");
  await click("#undo");
  assert.equal(await evaluate("document.querySelectorAll('.tab').length"), 2);
  await click("#undo");
  assert.equal(await evaluate("[...document.querySelectorAll('.tab')].some(n => n.textContent === 'Renamed')"), false);
  await click("#undo");
  assert.equal(await evaluate("document.querySelectorAll('.tab').length"), 1);
  await click("#undo");
  assert.equal(await evaluate("document.querySelector('#grid td').textContent"), "original");
  await click("#redo");
  checks.push("sheet add/rename/delete undo preserves earlier cell history and redo");
  const external = XLSX.read(files.get('/data/assets/test.xlsx'));
  external.Sheets.First.A1 = { t: 'n', v: 900 };
  files.set('/data/assets/test.xlsx', XLSX.write(external, { type: 'buffer', bookType: 'xlsx' }));
  await evaluate("document.querySelector('#grid td').focus()");
  await command("Input.insertText", { text: "456" });
  await key("s", { ctrlKey: true });
  await until("[...document.querySelectorAll('button')].some(b => b.textContent === '覆盖远端')");
  assert.equal(XLSX.read(files.get('/data/assets/test.xlsx')).Sheets.First.A1.v, 900);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '下载恢复副本').click()");
  let recoveredDownload;
  for (let i = 0; i < 100; i++) {
    try { recoveredDownload = await readFile(join(profile, 'test.recovery.xlsx')); break; } catch { await wait(50); }
  }
  assert.ok(recoveredDownload, 'recovery download did not finish');
  assert.equal(XLSX.read(recoveredDownload).Sheets.First.A1.v, 456);
  assert.equal(XLSX.read(files.get('/data/assets/test.xlsx')).Sheets.First.A1.v, 900);
  checks.push("conflict recovery download contains local edits without altering remote workbook");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '覆盖远端').click()");
  await key("Escape");
  assert.equal(XLSX.read(files.get('/data/assets/test.xlsx')).Sheets.First.A1.v, 900);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '覆盖远端').click()");
  await click('.cloud-dialog button[type="submit"]');
  await until("document.querySelector('#status').textContent.includes('已写入')");
  assert.equal(XLSX.read(files.get('/data/assets/test.xlsx')).Sheets.First.A1.v, 456);
  checks.push("save conflict preserves remote bytes; cancel is safe; explicit confirm saves local content");
  await until("document.querySelector('.cloud-dialog') === null");
  await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
  external.Sheets.First.A1 = { t: 'n', v: 777 };
  files.set('/data/assets/test.xlsx', XLSX.write(external, { type: 'buffer', bookType: 'xlsx' }));
  await evaluate("document.querySelector('#grid td').focus()");
  await command("Input.insertText", { text: '789' });
  await until("document.querySelector('#grid td').textContent === '789'");
  await key('s', { ctrlKey: true });
  await until("[...document.querySelectorAll('button')].some(b=>b.textContent==='读取远端')");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='读取远端').click()");
  await key('Escape');
  await until("document.querySelector('.cloud-dialog') === null");
  assert.equal(await evaluate("document.querySelector('#grid td').textContent"), '789');
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='读取远端').click()");
  await click('.cloud-dialog button[type="submit"]');
  await until("document.querySelector('#grid td')?.textContent === '777'");
  assert.equal(XLSX.read(files.get('/data/assets/test.xlsx')).Sheets.First.A1.v, 777);
  checks.push("read-remote cancel keeps local draft; confirm reloads remote without overwriting it");
  await navigate("sheet-editor", "/assets/big.xlsx", "document.querySelectorAll('#grid td').length > 0");
  assert.equal(await evaluate("[...document.querySelectorAll('#grid td')].every(n => n.contentEditable === 'false')"), true);
  assert.equal(writes.get("/data/assets/big.xlsx") || 0, 0);
  checks.push("capability-blocked workbook is actually read-only");

  await navigate("whiteboard-editor", "/assets/test.board.json", "document.querySelector('#loading')?.hidden === true");
  await click('[data-tool="rect"]');
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 300, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 500, y: 300, button: "left", clickCount: 1 });
  await until("!document.querySelector('#text-editor').hidden");
  await command("Input.insertText", { text: "old" });
  await key("Enter", { ctrlKey: true });
  await evaluate("document.querySelector('#canvas-shell').focus()");
  await key("1");
  assert.equal(await evaluate("document.querySelector('#text-editor-input').textContent"), "1");
  await key("Escape", { isComposing: true });
  assert.equal(await evaluate("document.querySelector('#text-editor').hidden"), false);
  await key("Enter", { ctrlKey: true });
  await evaluate("document.querySelector('#canvas-shell').focus()");
  checks.push("selected-node digit input and IME Escape priority");
  const geometry = await evaluate("document.querySelector('#node-layer').innerHTML");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: 500, y: 300, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 580, y: 350, button: "left", buttons: 1 });
  await key("Escape");
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 580, y: 350, button: "left", clickCount: 1 });
  assert.equal(await evaluate("document.querySelector('#node-layer').innerHTML"), geometry);
  checks.push("real pointer drag Escape restores geometry");
  await key(" ", { code: "Space" });
  await evaluate("window.dispatchEvent(new Event('blur'))");
  assert.equal(await evaluate("document.querySelector('#canvas-shell').classList.contains('tool-hand')"), false);
  await click("#help-button");
  await key("Delete");
  assert.equal(await evaluate("document.querySelectorAll('#node-layer [data-node-id]').length"), 1);
  await click("#close-help");
  assert.equal(await evaluate("document.activeElement.id"), "canvas-shell");
  checks.push("blur clears temporary hand; modal isolates shortcuts and restores focus");
  await key("s", { ctrlKey: true }); await wait(350);
  denyLease = true;
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await until("document.querySelector('#main-toolbar').inert === true");
  const beforePan = await evaluate("document.querySelector('#viewport-layer').getAttribute('transform')");
  await evaluate("window.__pointerLog=[]; for(const name of ['pointerdown','pointermove','pointerup','pointercancel']) document.addEventListener(name,e=>window.__pointerLog.push([name,e.target.id,e.button,e.pointerId]),true)");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: 150, y: 250, button: "middle", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 190, y: 280, button: "middle", buttons: 4 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 190, y: 280, button: "middle", clickCount: 1 });
  assert.notEqual(await evaluate("document.querySelector('#viewport-layer').getAttribute('transform')"), beforePan, JSON.stringify(await evaluate("window.__pointerLog")));
  await key("Delete");
  assert.equal(await evaluate("document.querySelectorAll('#node-layer [data-node-id]').length"), 1);
  checks.push("live lease loss stops editing but retains middle-button pan");
  const readonlyCenter = await evaluate("(()=>{const r=document.querySelector('#node-layer [data-node-id]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...readonlyCenter, button: "right", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...readonlyCenter, button: "right", clickCount: 1 });
  await until("document.querySelector('#board-context-menu') !== null");
  assert.equal(await evaluate("[...document.querySelectorAll('#board-context-menu button')].find(b=>b.textContent==='删除').disabled"), true);
  assert.equal(await evaluate("[...document.querySelectorAll('#board-context-menu button')].find(b=>b.textContent==='复制').disabled"), false);
  await key("Escape");
  checks.push("read-only node context menu allows copy but disables mutation");
  denyLease = false;
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '重新获取编辑权').click()");
  await until("document.querySelector('#main-toolbar').inert === false");
  checks.push("lease reacquisition resumes editing without reload");
  await evaluate("document.querySelector('#canvas-shell').focus()");
  const center = await evaluate("(()=>{const r=document.querySelector('#node-layer [data-node-id]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  const stable = await evaluate("document.querySelector('#node-layer').innerHTML");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...center, button: "left", modifiers: 1, clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x + 60, y: center.y + 30, button: "left", modifiers: 1, buttons: 1 });
  assert.equal(await evaluate("document.querySelectorAll('#node-layer [data-node-id]').length"), 2);
  await evaluate("document.querySelector('#canvas-shell').dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true}))");
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: center.x + 60, y: center.y + 30, button: "left", clickCount: 1 });
  assert.equal(await evaluate("document.querySelector('#node-layer').innerHTML"), stable);
  checks.push("Alt duplicate drag pointercancel removes draft copies and restores selection");
  await click('[data-tool="ellipse"]');
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: 180, y: 320, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 180, y: 320, button: "left", clickCount: 1 });
  await until("!document.querySelector('#text-editor').hidden");
  await key("Enter", { ctrlKey: true });
  await click("#bold");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...center, button: "left", modifiers: 8, clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...center, button: "left", modifiers: 8, clickCount: 1 });
  assert.equal(await evaluate("document.querySelector('#bold').getAttribute('aria-pressed')"), "mixed", await evaluate("document.querySelector('#node-layer').innerHTML"));
  await click("#bold");
  assert.equal(await evaluate("document.querySelector('#bold').getAttribute('aria-pressed')"), "true");
  checks.push("mixed multi-selection bold state and uniform apply");
  const menuPoint = await evaluate("(()=>{const r=document.querySelector('#node-layer [data-node-id]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  const beforeMenuView = await evaluate("document.querySelector('#viewport-layer').getAttribute('transform')");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...menuPoint, button: "right", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: menuPoint.x + 2, y: menuPoint.y, button: "right", buttons: 2 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: menuPoint.x + 2, y: menuPoint.y, button: "right", clickCount: 1 });
  await until("document.querySelector('#board-context-menu') !== null");
  assert.equal(await evaluate("document.querySelector('#viewport-layer').getAttribute('transform')"), beforeMenuView);
  await key("ArrowDown");
  assert.equal(await evaluate("document.activeElement.textContent"), "创建副本");
  await evaluate("document.activeElement.click()");
  assert.equal(await evaluate("document.querySelectorAll('#node-layer [data-node-id]').length"), 4);
  await key("z", { ctrlKey: true });
  assert.equal(await evaluate("document.querySelectorAll('#node-layer [data-node-id]').length"), 2);
  await key("F10", { shiftKey: true });
  await until("document.querySelector('#board-context-menu') !== null");
  const menuBounds = await evaluate("(()=>{const r=document.querySelector('#board-context-menu').getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight}})()");
  assert.ok(menuBounds.x >= 0 && menuBounds.y >= 0 && menuBounds.right <= menuBounds.w && menuBounds.bottom <= menuBounds.h);
  await key("Escape");
  assert.equal(await evaluate("document.activeElement.id"), "canvas-shell");
  checks.push("right-click jitter opens keyboard menu; duplicate/undo, bounds and Escape focus work");
  await command("Input.dispatchMouseEvent", { type: "mousePressed", x: 120, y: 180, button: "right", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 160, y: 210, button: "right", buttons: 2 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 160, y: 210, button: "right", clickCount: 1 });
  assert.equal(await evaluate("document.querySelector('#board-context-menu')"), null);
  assert.notEqual(await evaluate("document.querySelector('#viewport-layer').getAttribute('transform')"), beforeMenuView);
  checks.push("right drag pans without opening context menu");
  const connectorSource = await evaluate("(()=>{const r=document.querySelector('#node-layer [data-node-id]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()");
  await click('[data-tool="connector"]');
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...connectorSource, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x: 680, y: 160, button: "left", buttons: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", x: 680, y: 160, button: "left", clickCount: 1 });
  assert.equal(await evaluate("document.querySelectorAll('#node-layer [data-node-id]').length"), 3);
  await key("z", { ctrlKey: true });
  assert.equal(await evaluate("document.querySelectorAll('#node-layer [data-node-id]').length"), 2);
  await key("y", { ctrlKey: true });
  await key("s", { ctrlKey: true });
  await until("document.querySelector('#status').textContent === '已保存到思源'");
  const savedConnector = JSON.parse(files.get('/data/assets/test.board.json')).nodes.find(n=>n.type==='connector');
  assert.ok(savedConnector.from.nodeId && Number.isFinite(savedConnector.to.x) && !savedConnector.to.nodeId);
  await navigate("whiteboard-editor", "/assets/test.board.json", "document.querySelectorAll('#node-layer [data-node-id]').length === 3");
  checks.push("connector to blank creates free endpoint; undo/redo and persisted reload succeed");
  await navigate("whiteboard-editor", "/assets/test.board.json", "document.querySelector('#loading')?.hidden === true");
  assert.equal(await evaluate("document.querySelector('#main-toolbar').inert"), false);
  assert.equal(await evaluate("document.querySelector('#status').textContent.startsWith('只读：')"), false);
  checks.push("immediate whiteboard reopen releases the prior page lease without becoming read-only");

  await navigate("text-editor", "/assets/test.txt", "document.querySelector('#editor')?.value === 'original text'");
  await evaluate("document.querySelector('#editor').focus()");
  await command("Input.insertText", { text: "中文" });
  await key("s", { ctrlKey: true });
  await until("document.querySelector('#status').textContent === '已保存'");
  assert.ok(files.get("/data/assets/test.txt").toString().includes("中文"));
  denyLease = true;
  await evaluate("window.dispatchEvent(new Event('focus'))");
  await until("document.querySelector('#editor').readOnly");
  denyLease = false;
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '重新获取编辑权').click()");
  await until("!document.querySelector('#editor').readOnly");
  checks.push("text input/save and live lease loss/reacquisition");
  await evaluate(`document.documentElement.setAttribute('data-theme-mode','dark')`);
  await until("getComputedStyle(document.documentElement).colorScheme === 'dark'");
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"), "#202124");
  await evaluate(`document.documentElement.setAttribute('data-theme-mode','light')`);
  await until("getComputedStyle(document.documentElement).colorScheme === 'light'");
  assert.equal(await evaluate("getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()"), "#ffffff");
  checks.push("editor theme updates dark/light without navigation or polling");

  await evaluate(`document.querySelector('#editor').value='中文🙂\\n第二行\\n';document.querySelector('#editor').dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#editor').setSelectionRange(6,6);document.querySelector('#editor').dispatchEvent(new Event('click'))`);
  assert.equal(await evaluate("document.querySelector('#position').textContent"), "行 2，列 2");
  await key("s", { ctrlKey: true });
  await until("document.querySelector('#status').textContent === '已保存'");
  assert.equal(files.get('/data/assets/test.txt').toString(), '中文🙂\n第二行\n');
  checks.push("cached text metrics maintain Unicode cursor position and saved bytes");

  // Fresh asset isolates debounce behavior from navigation-time lease expiry.
  files.set('/data/assets/viewport.board.json', Buffer.from(files.get('/data/assets/test.board.json')));
  await navigate("whiteboard-editor", "/assets/viewport.board.json", "document.querySelectorAll('#node-layer [data-node-id]').length === 3");
  await wait(1400);
  const writeStart = writes.get('/data/assets/viewport.board.json') || 0;
  for (let i = 0; i < 5; i++) {
    await evaluate("document.querySelector('#canvas-shell').dispatchEvent(new WheelEvent('wheel',{deltaY:12,bubbles:true,cancelable:true}))");
    await wait(80);
  }
  assert.equal(writes.get('/data/assets/viewport.board.json') || 0, writeStart);
  await until("document.querySelector('#status').textContent === '已保存到思源'");
  assert.equal(writes.get('/data/assets/viewport.board.json'), writeStart + 1);
  const viewportSaved = JSON.parse(files.get('/data/assets/viewport.board.json')).viewport;
  await key('s', { ctrlKey: true });
  await wait(1500);
  assert.equal(writes.get('/data/assets/viewport.board.json'), writeStart + 1);
  checks.push("five viewport changes coalesce to one write; clean Ctrl+S skips duplicate upload");

  await evaluate("document.querySelector('#canvas-shell').dispatchEvent(new WheelEvent('wheel',{deltaY:25,bubbles:true,cancelable:true}));Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'))");
  await until("document.querySelector('#status').textContent === '已保存到思源'");
  assert.equal(writes.get('/data/assets/viewport.board.json'), writeStart + 2);
  assert.notDeepEqual(JSON.parse(files.get('/data/assets/viewport.board.json')).viewport, viewportSaved);
  checks.push("hiding the board flushes the pending viewport before debounce expires");
  await command("Page.navigate", { url: `${base}/theme-host` });
  await until("document.querySelector('iframe')?.contentDocument.querySelector('#editor')?.value === 'theme test'");
  assert.equal(await evaluate("document.querySelector('iframe').contentWindow.getComputedStyle(document.querySelector('iframe').contentDocument.documentElement).colorScheme"), "dark");
  assert.equal(await evaluate("document.querySelector('iframe').contentDocument.documentElement.style.getPropertyValue('--accent')"), "#aabbcc");
  await evaluate("document.documentElement.setAttribute('data-theme-mode','light')");
  await until("document.querySelector('iframe').contentWindow.getComputedStyle(document.querySelector('iframe').contentDocument.documentElement).colorScheme === 'light'");
  assert.equal(writes.get('/data/assets/theme.txt') || 0, 0);
  checks.push("embedded editor follows parent theme and accent without writing attachment");
  await evaluate("document.querySelector('iframe').contentWindow.dispatchEvent(new PageTransitionEvent('pagehide'));document.documentElement.setAttribute('data-theme-mode','dark')");
  await wait(50);
  assert.equal(await evaluate("document.querySelector('iframe').contentDocument.documentElement.style.colorScheme"), 'light');
  await evaluate("document.querySelector('iframe').contentWindow.dispatchEvent(new PageTransitionEvent('pageshow'))");
  await until("document.querySelector('iframe').contentDocument.documentElement.style.colorScheme === 'dark'");
  checks.push("theme observation pauses on pagehide and reconnects on pageshow");

  await navigate("mm-editor", "/assets/theme.mm", "document.body.classList.contains('layout-ready') && document.querySelectorAll('me-tpc').length >= 2");
  const nodeColors = await evaluate("[...document.querySelectorAll('me-tpc')].map(n=>getComputedStyle(n).backgroundColor)");
  await evaluate("document.documentElement.setAttribute('data-theme-mode','dark')");
  await until("getComputedStyle(document.querySelector('#map .map-container')).backgroundColor === 'rgb(32, 33, 36)'");
  assert.deepEqual(await evaluate("[...document.querySelectorAll('me-tpc')].map(n=>getComputedStyle(n).backgroundColor)"), nodeColors);
  await evaluate("document.documentElement.setAttribute('data-theme-mode','light')");
  await until("getComputedStyle(document.querySelector('#map .map-container')).backgroundColor === 'rgb(255, 255, 255)'");
  checks.push("mind-map loads and changes canvas theme without altering node colors");
  await evaluate("localStorage.clear()");
  await command("Page.navigate", { url: "about:blank" });
  await wait(150);
  for (const path of files.keys()) if (!path.startsWith("/data/assets/")) files.delete(path);
  files.set("/data/assets/test.board.json", board);
  await command("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await command("Emulation.setFocusEmulationEnabled", { enabled: true });
  await command("Page.navigate", { url: `${base}/full-test` });
  for (let i = 0; i < 600 && !fullResult; i++) await wait(50);
  assert.equal(fullResult?.status, "passed", JSON.stringify(fullResult));
  checks.push(`existing full whiteboard browser suite: ${fullResult.checks.length} groups`);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ status: "passed", checks, browserErrors: errors }, null, 2));
} finally {
  socket?.close(); browser.kill(); server.close();
}
