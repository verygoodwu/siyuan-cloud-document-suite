import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { resolve, extname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import * as XLSX from "xlsx";
import { build } from "esbuild";
import JSZip from "jszip";

const dropTargetBundle = (await build({ entryPoints: ["src/drop-target.ts"], bundle: true, format: "iife", globalName: "CloudDrop", write: false })).outputFiles[0].text;
const previewBundle = (await build({ entryPoints: ["src/preview-builders.ts"], bundle: true, platform: "browser", format: "iife", globalName: "CloudPreview", write: false })).outputFiles[0].text;
const conversionFixtures = new Map();
async function zipFixture(name, entries) {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(entries)) zip.file(path, content);
  conversionFixtures.set(`/fixtures/${name}`, await zip.generateAsync({ type: "nodebuffer" }));
}
await zipFixture("modern.xmind", { "content.json": JSON.stringify([{ title: "工作表", rootTopic: { title: "根主题", children: { attached: [{ title: "子主题" }] } } }]) });
await zipFixture("legacy.xmind", { "content.xml": '<xmap-content xmlns="urn:xmind:xmap:xmlns:content:2.0"><sheet><title>旧工作表</title><topic><title>旧根主题</title><children><topics><topic><title>旧子主题</title></topic></topics></children></topic></sheet></xmap-content>' });
await zipFixture("sample.docx", {
  "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  "_rels/.rels": '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  "word/document.xml": '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>中文正文 &amp; 保留符号</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>名称</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数值</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>项目</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>42</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
});

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
files.set("/data/assets/tab-siblings.mm", Buffer.from('<map version="1.0.1" CLOUD_VIEW_STYLE="hierarchy" CLOUD_DIRECTION="1"><node TEXT="中心主题" ID="root"><node TEXT="上方" ID="upper" POSITION="right"><node TEXT="已有子节点" ID="upper-child"/></node><node TEXT="下方" ID="lower" POSITION="right"/></node></map>'));
files.set("/data/assets/imported.mm", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><map CLOUD_VIEW_STYLE="hierarchy" CLOUD_DIRECTION="1"><node ID="root" TEXT="afafaf" COLOR="#ffffff" BACKGROUND_COLOR="#3f73f1"><font BOLD="true"/><node TEXT="q" ID="branch" STYLE="bubble" POSITION="right"><node TEXT="45646546" ID="nested" STYLE="fork"><node TEXT="输入文字" ID="leaf-a" STYLE="fork"/><node TEXT="556465465" ID="leaf-b" STYLE="fork"/><node TEXT="56asf4a54fa6" ID="leaf-c" STYLE="fork"/></node></node><node TEXT="13216541" ID="middle" STYLE="bubble" POSITION="right"/><node TEXT="456465161" ID="lower-a" STYLE="bubble" POSITION="right"/><node TEXT="456465465" ID="lower-b" STYLE="bubble" POSITION="right"/></node></map>'));
files.set("/data/assets/mixed.mm", Buffer.from('<map CLOUD_VIEW_STYLE="hierarchy" CLOUD_DIRECTION="2"><node ID="root" TEXT="两侧"><node ID="l1" TEXT="左一" POSITION="left"/><node ID="l2" TEXT="左二" POSITION="left"/><node ID="r1" TEXT="右一" POSITION="right"/><node ID="r2" TEXT="右二" POSITION="right"/></node></map>'));
files.set("/data/assets/five.mm", Buffer.from('<map CLOUD_VIEW_STYLE="hierarchy" CLOUD_DIRECTION="1"><node ID="root" TEXT="五条支路"><node ID="b1" TEXT="计划" POSITION="right"><node ID="c1" TEXT="下一步"/></node><node ID="b2" TEXT="设计" POSITION="right"><node ID="c2" TEXT="规范"/></node><node ID="b3" TEXT="开发" POSITION="right"><node ID="c3" TEXT="实现"/></node><node ID="b4" TEXT="测试" POSITION="right"><node ID="c4" TEXT="验收"/></node><node ID="b5" TEXT="发布" POSITION="right"><node ID="c5" TEXT="上线"/></node></node></map>'));
const board = Buffer.from(JSON.stringify({ schema: "siyuan-cloud-whiteboard", version: 1, title: "Test", viewport: { x: 300, y: 200, zoom: 1 }, nodes: [] }));
files.set("/data/assets/test.board.json", board);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    res.setHeader("Cache-Control", "no-store");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    if (conversionFixtures.has(url.pathname)) { res.end(conversionFixtures.get(url.pathname)); return; }
    if (url.pathname === "/conversion-host") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><script src="/preview-builders-test.js"></script>'); return;
    }
    if (url.pathname === "/preview-builders-test.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.end(previewBundle); return;
    }
    if (url.pathname === "/drop-target-test.js") {
      res.setHeader("Content-Type", "text/javascript; charset=utf-8"); res.end(dropTargetBundle); return;
    }
    if (url.pathname === "/compatibility-host") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end('<!doctype html><div class="protyle"><div class="protyle-wysiwyg"><div data-node-id="ordinary" contenteditable="true"><span id="ordinary">text</span></div><div data-type="NodeAttributeView" data-node-id="database"><span id="database" contenteditable="true">asset cell</span></div><div data-type="NodeBlockQueryEmbed" data-node-id="query"><span id="query" contenteditable="true">embed</span></div><div data-node-id="iframe" contenteditable="false"><span id="noneditable">iframe</span></div></div></div><div class="protyle" data-readonly="true"><div class="protyle-wysiwyg"><div data-node-id="locked" contenteditable="true"><span id="locked">locked</span></div></div></div><div class="protyle-db-attr"><div class="protyle-wysiwyg"><div data-node-id="panel" contenteditable="true"><span id="panel">standalone database</span></div></div></div><script src="/drop-target-test.js"></script>'); return;
    }
    if (url.pathname === "/api/export/exportPreviewHTML") {
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ code: 0, data: { name: "Preview", content: "<h1>Title</h1><p>Content</p><h2>Section</h2>" } })); return;
    }
    if (url.pathname === "/stage/protyle/js/protyle-html.js") {
      res.setHeader("Content-Type", "text/javascript");
      res.end('window.headingCalls=[];window.Protyle=location.search.includes("legacy=1")?{}:{applyExportHeadingPageBreaks:(root,levels,enabled)=>{window.headingCalls.push({levels,enabled});root.dataset.headingLevels=enabled?levels.join(","):""}};'); return;
    }
    if (url.pathname === "/stage/build/export/base.css" || url.pathname === "/appearance/themes/daylight/theme.css") {
      res.setHeader("Content-Type", "text/css"); res.end(""); return;
    }
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
  await command("Page.navigate", { url: `${base}/compatibility-host` });
  await until("typeof CloudDrop !== 'undefined'");
  assert.deepEqual(await evaluate("['ordinary','database','query','noneditable','locked','panel'].map(id=>CloudDrop.findEditorDropTarget(document.getElementById(id)))"), [{ id: "ordinary", position: "after-block" }, null, null, null, null, null]);
  checks.push("drop targeting leaves database assets, readonly editors and embedded blocks to SiYuan");
  await command("Page.navigate", { url: `${base}/document-print.html?id=20261021000000-abcdefg` });
  await until("!document.querySelector('#confirm').disabled");
  assert.equal(await evaluate("document.querySelector('#heading-page-breaks').classList.contains('hidden')"), false);
  await evaluate("document.querySelector('#heading-page-breaks input[value=\"2\"]').click()");
  assert.deepEqual(await evaluate("window.headingCalls.at(-1)"), { levels: [2], enabled: true });
  await click("#paged");
  assert.deepEqual(await evaluate("window.headingCalls.at(-1)"), { levels: [2], enabled: false });
  assert.equal(await evaluate("document.querySelector('#heading-page-breaks input').disabled"), true);
  await command("Page.navigate", { url: `${base}/document-print.html?id=20261021000000-abcdefg&legacy=1` });
  await until("!document.querySelector('#confirm').disabled");
  assert.equal(await evaluate("document.querySelector('#heading-page-breaks').classList.contains('hidden')"), true);
  checks.push("PDF heading pagination uses host capability detection and remains compatible with older hosts");
  await evaluate(`window.previewRequests=[]; window.fetch=()=>new Promise((resolve,reject)=>window.previewRequests.push({resolve,reject}));
    window.setPreviewTitle=(value)=>{const input=document.querySelector('#custom-title');input.value=value;input.dispatchEvent(new Event('input'))};
    window.replyPreview=(index,text)=>previewRequests[index].resolve({ok:true,json:async()=>({code:0,data:{name:text,content:'<p>'+text+'</p>'}})});
    setPreviewTitle('old')`);
  assert.equal(await evaluate("document.querySelector('#confirm').disabled"), true);
  await until("previewRequests.length===1");
  await evaluate("setPreviewTitle('new')");
  await until("previewRequests.length===2");
  await evaluate("replyPreview(1,'new')");
  await until("!document.querySelector('#confirm').disabled");
  await evaluate("replyPreview(0,'old')");
  assert.equal(await evaluate("document.querySelector('#preview').textContent"), "new");
  await evaluate("setPreviewTitle('outdated failure')");
  await until("previewRequests.length===3");
  await evaluate("setPreviewTitle('latest')");
  await until("previewRequests.length===4");
  await evaluate("replyPreview(3,'latest');previewRequests[2].reject(new Error('outdated error'))");
  await until("!document.querySelector('#confirm').disabled");
  assert.equal(await evaluate("document.querySelector('#status').classList.contains('error')"), false);
  await evaluate("setPreviewTitle('failure')");
  await until("previewRequests.length===5");
  await evaluate("previewRequests[4].reject(new Error('网络断开'))");
  await until("!document.querySelector('#retry').classList.contains('hidden')");
  assert.match(await evaluate("document.querySelector('#status').textContent"), /网络断开/);
  await click("#retry");
  await until("previewRequests.length===6");
  await evaluate("replyPreview(5,'recovered')");
  await until("!document.querySelector('#confirm').disabled");
  await evaluate(`window.printCount=0;window.print=()=>printCount++;const img=document.createElement('img');img.id='pending-image';Object.defineProperty(img,'complete',{value:false});document.querySelector('#preview').append(img)`);
  await click("#confirm");
  assert.equal(await evaluate("printCount"), 0);
  assert.equal(await evaluate("document.querySelector('#options').inert"), true);
  await evaluate("document.querySelector('#pending-image').dispatchEvent(new Event('load'))");
  await until("printCount===1 && !document.querySelector('#confirm').disabled");
  checks.push("PDF preview ignores stale responses/errors, blocks stale export, retries failures and waits for print images");
  await command("Page.navigate", { url: `${base}/document-print.html?id=20261021000000-abcdefg&parentWindowId=1` });
  await until("!document.querySelector('#confirm').disabled");
  await evaluate("window.require=()=>({ipcRenderer:{invoke:async()=>{throw new Error('目录选择失败')}}})");
  await click("#confirm");
  await until("document.querySelector('#status').textContent.includes('PDF 导出失败')");
  assert.equal(await evaluate("document.querySelector('#confirm').disabled"), false);
  await evaluate("window.sentExports=0;window.require=()=>({ipcRenderer:{invoke:async()=>({filePaths:['test-output']}),send:()=>sentExports++}})");
  await click("#confirm");
  await until("sentExports===1");
  await click("#confirm");
  assert.equal(await evaluate("sentExports"), 1);
  checks.push("PDF export errors allow retry and native dispatch prevents duplicate exports");
  await command("Page.navigate", { url: `${base}/conversion-host` });
  await until("typeof CloudPreview !== 'undefined'");
  const conversions = await evaluate(`(async()=>{
    const builder=new CloudPreview.PreviewBuilders('test','test','test');
    const asset=(name)=>({assetPath:'assets/'+name,originalName:name});
    const read=async(name)=>(await fetch('/fixtures/'+name)).arrayBuffer();
    let invalid='';try{builder.buildFreeMind(asset('bad.mm'),'<map><node TEXT="A & B"/></map>')}catch(error){invalid=error.message}
    return {modern:await builder.buildXMind(asset('modern.xmind'),await read('modern.xmind')),
      legacy:await builder.buildXMind(asset('legacy.xmind'),await read('legacy.xmind')),
      word:await builder.buildWord(asset('sample.docx'),await read('sample.docx')),
      mm:builder.buildFreeMind(asset('valid.mm'),'<map><node TEXT="A &amp; B"/></map>'),invalid};
  })()`);
  assert.match(conversions.modern, /工作表[\s\S]*根主题[\s\S]*子主题/);
  assert.match(conversions.legacy, /旧工作表[\s\S]*旧根主题[\s\S]*旧子主题/);
  assert.match(conversions.word, /中文正文 & 保留符号/);
  assert.match(conversions.word, /\|.*名称.*\|.*数值.*\|/);
  assert.match(conversions.word, /\|.*项目.*\|.*42.*\|/);
  for (const type of ['modern','legacy','word']) assert.match(conversions[type], /### 附件[\s\S]*assets\//);
  assert.match(conversions.mm, /mm-editor\.html/);
  assert.match(conversions.invalid, /Invalid FreeMind/);
  checks.push("Word text/tables, modern and legacy XMind, and escaped/invalid FreeMind XML exercise real browser parsers");
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
  await until("document.querySelector('.cloud-dialog') === null");
  assert.equal(XLSX.read(files.get('/data/assets/test.xlsx')).Sheets.First.A1.v, 900);
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === '覆盖远端').click()");
  await until("document.querySelector('.cloud-dialog[open]') !== null");
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
  assert.match(await evaluate("document.querySelector('#help').textContent"), /按住右键拖动：移动画布/);
  const fullscreenPoint = await evaluate(`(()=>{
    const rect = document.querySelector('#fullscreen').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...fullscreenPoint, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...fullscreenPoint, button: "left", clickCount: 1 });
  await until("document.fullscreenElement !== null");
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await until("document.fullscreenElement === null");
  await wait(120);
  const exitCenter = await evaluate(`(()=>{
    const root = document.querySelector('me-root > me-tpc').getBoundingClientRect();
    const viewport = document.querySelector('#map .map-container').getBoundingClientRect();
    return { dx: root.left + root.width / 2 - (viewport.left + viewport.width / 2),
      dy: root.top + root.height / 2 - (viewport.top + viewport.height / 2) };
  })()`);
  assert.ok(Math.abs(exitCenter.dx) < 2 && Math.abs(exitCenter.dy) < 2,
    `Esc after fullscreen left mind-map off center: ${JSON.stringify(exitCenter)}`);
  checks.push("Esc exits mind-map fullscreen and restores the centered viewport");
  await navigate("mm-editor", "/assets/imported.mm", "document.body.classList.contains('layout-ready') && document.querySelectorAll('me-tpc').length === 9");
  const importedGeometry = await evaluate(`(()=>{
    const centerY = (element) => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2; };
    const screenPoint = (path, end) => {
      const point = path.getPointAtLength(end ? path.getTotalLength() : 0);
      const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
      return { x: screen.x, y: screen.y };
    };
    const root = document.querySelector('me-root > me-tpc');
    const mainSvg = document.querySelector('svg.lines');
    const wrappers = [...document.querySelectorAll('me-main > me-wrapper')];
    const paths = [...mainSvg.querySelectorAll(':scope > path')];
    const branches = wrappers.map((wrapper, index) => {
      const topic = wrapper.querySelector(':scope > me-parent > me-tpc');
      return {
        text: topic.textContent.trim(),
        rootCenterY: centerY(root),
        topicCenterY: centerY(topic),
        start: screenPoint(paths[index], false),
        end: screenPoint(paths[index], true),
        d: paths[index].getAttribute('d')
      };
    });
    return {
      branches,
      pathCount: paths.length,
      trunk: paths[wrappers.length].getAttribute('d'),
      rootStub: paths[wrappers.length + 1].getAttribute('d'),
      rootStubStart: screenPoint(paths[wrappers.length + 1], false),
      rootStubEnd: screenPoint(paths[wrappers.length + 1], true)
    };
  })()`);
  assert.equal(importedGeometry.pathCount, 6);
  assert.match(importedGeometry.trunk, /^M .* V /);
  assert.match(importedGeometry.rootStub, /^M .* H /);
  assert.ok(Math.abs(importedGeometry.rootStubStart.y - importedGeometry.branches[0].rootCenterY) < 0.75);
  assert.ok(Math.abs(importedGeometry.rootStubEnd.y - importedGeometry.branches[0].rootCenterY) < 0.75);
  assert.ok(importedGeometry.branches.filter((branch) => branch.d.includes(" Q ")).length >= 3,
    "main branches lost their soft rounded junctions");
  for (const geometry of importedGeometry.branches) {
    assert.ok(Math.abs(geometry.start.x - importedGeometry.rootStubEnd.x) < 0.75, `${geometry.text} connector misses the shared trunk`);
    assert.ok(Math.abs(geometry.end.y - geometry.topicCenterY) < 0.75, `${geometry.text} connector misses the imported topic center`);
  }
  checks.push("imported mind-map uses one straight root stub, shared trunk, and aligned child connectors");
  const nestedLine = await evaluate(`(()=>{
    const wrapper = [...document.querySelectorAll('me-main > me-wrapper')].find((item) => item.querySelector(':scope > me-parent > me-tpc')?.textContent.trim() === 'q');
    const svg = wrapper.querySelector(':scope > svg.subLines');
    const parent = wrapper.querySelector(':scope > me-parent > me-tpc').getBoundingClientRect();
    const child = wrapper.querySelector(':scope > me-children > me-wrapper > me-parent > me-tpc').getBoundingClientRect();
    return { paths: [...svg.querySelectorAll(':scope > path')].map((path) => path.getAttribute('d')),
      parentY: parent.top + parent.height / 2, childY: child.top + child.height / 2 };
  })()`);
  assert.match(nestedLine.paths[0], /^M [\d.-]+ [\d.-]+ H [\d.-]+$/);
  assert.ok(Math.abs(nestedLine.parentY - nestedLine.childY) < 0.25);
  checks.push("single nested branch stays perfectly horizontal under map zoom");
  if (process.env.MM_SCREENSHOT_PATH) {
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(process.env.MM_SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));
  }
  await evaluate("document.querySelector('me-main > me-wrapper me-tpc').style.paddingBottom = '28px'");
  await until(`(()=>{
    const topic = document.querySelector('me-main > me-wrapper me-tpc');
    const path = document.querySelector('svg.lines > path');
    const point = path.getPointAtLength(path.getTotalLength());
    const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
    const rect = topic.getBoundingClientRect();
    return Math.abs(screen.y - rect.top - rect.height / 2) < 0.75;
  })()`);
  checks.push("mind-map connectors follow a topic resize without a manual refresh");
  await navigate("mm-editor", "/assets/mixed.mm", "document.body.classList.contains('layout-ready') && document.querySelectorAll('me-main > me-wrapper').length === 4");
  const mixedBranches = await evaluate(`(()=>{
    const paths = [...document.querySelectorAll('svg.lines > path')];
    const wrappers = [...document.querySelectorAll('me-main > me-wrapper')];
    return {
      count: paths.length,
      valid: paths.every((path) => path.getAttribute('d') && !/NaN|Infinity/.test(path.getAttribute('d'))),
      aligned: wrappers.every((wrapper, index) => {
        const topic = wrapper.querySelector(':scope > me-parent > me-tpc');
        const path = paths[index];
        const point = path.getPointAtLength(path.getTotalLength());
        const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM());
        const rect = topic.getBoundingClientRect();
        const left = wrapper.parentElement.classList.contains('lhs');
        return Math.abs(screen.x - (left ? rect.right : rect.left)) < 0.75 && Math.abs(screen.y - rect.top - rect.height / 2) < 0.75;
      })
    };
  })()`);
  assert.deepEqual(mixedBranches, { count: 8, valid: true, aligned: true });
  checks.push("mixed left/right mind-map branches share separate trunks without invalid geometry");
  await command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await navigate("mm-editor", "/assets/five.mm", "document.body.classList.contains('layout-ready') && document.querySelectorAll('me-tpc').length === 11");
  assert.equal(await evaluate("document.querySelectorAll('svg.lines > path').length"), 7);
  assert.equal(await evaluate("[...document.querySelectorAll('me-main > me-wrapper svg.subLines > path:first-child')].filter(path => /^M [\\d.-]+ [\\d.-]+ H [\\d.-]+$/.test(path.getAttribute('d'))).length"), 5);
  checks.push("five-way trunk has five branches and five straight follow-up connections");
  if (process.env.MM_FIVE_SCREENSHOT_PATH) {
    const screenshot = await command("Page.captureScreenshot", { format: "png" });
    await writeFile(process.env.MM_FIVE_SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));
  }
  await command("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await navigate("mm-editor", "/assets/imported.mm", "document.body.classList.contains('layout-ready') && document.querySelectorAll('me-tpc').length === 9");
  assert.equal(await evaluate("document.querySelector('#map').getBoundingClientRect().width"), 390);
  assert.equal(await evaluate("document.querySelectorAll('svg.lines > path').length"), 6);
  checks.push("mobile-width browser renders the imported mind map and its connectors");
  await command("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await navigate("mm-editor", "/assets/tab-siblings.mm", "document.body.classList.contains('layout-ready') && document.querySelectorAll('me-tpc').length === 4");
  const childCenter = await evaluate(`(()=>{
    const rect = [...document.querySelectorAll('me-tpc')].find((topic) => topic.nodeObj?.id === 'lower').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", ...childCenter, button: "left", clickCount: 1 });
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...childCenter, button: "left", clickCount: 1 });
  await evaluate("[...document.querySelectorAll('me-tpc')].find((topic) => topic.nodeObj?.id === 'lower').dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }))");
  await until("document.querySelector('#input-box') !== null");
  await command("Input.insertText", { text: "新建的子节点" });
  await wait(150);
  const editingBranch = await evaluate(`(()=>{
    const input = document.querySelector('#input-box');
    const rect = input.getBoundingClientRect();
    const parentTopic = [...document.querySelectorAll('me-tpc')].find((topic) => topic.nodeObj?.id === 'lower');
    const parent = parentTopic.getBoundingClientRect();
    const path = parentTopic.closest('me-wrapper').querySelector(':scope > svg.subLines > path');
    return { parentY: parent.top + parent.height / 2, editorY: rect.top + rect.height / 2, d: path?.getAttribute('d') };
  })()`);
  assert.ok(Math.abs(editingBranch.parentY - editingBranch.editorY) < 0.25, "Tab editor is not centered on its parent branch");
  assert.match(editingBranch.d, /^M [\d.-]+ [\d.-]+ H [\d.-]+$/, "Tab editor connector has an unwanted elbow");
  checks.push("Tab-created mind node keeps a horizontal connector while editing");
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
