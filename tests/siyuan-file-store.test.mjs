import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import { contentHash, SaveConflictError, SiyuanFileStore } from "../static/siyuan-file-store.js";

const encoder = new TextEncoder();

function replaceGlobal(name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  return () => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  };
}

test("pure JavaScript SHA-256 fallback matches standard vectors", async () => {
  assert.equal(
    await contentHash(new Uint8Array(), null),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  );
  assert.equal(
    await contentHash(encoder.encode("abc"), null),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
  assert.equal(
    await contentHash(encoder.encode("The quick brown fox jumps over the lazy dog"), null),
    "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
  );
});

test("encoded traversal cannot escape the assets directory", () => {
  const restoreLocation = replaceGlobal(
    "location",
    new URL("http://127.0.0.1:6806/plugins/siyuan-cloud-document-suite/mm-editor.html")
  );
  try {
    assert.throws(
      () => new SiyuanFileStore("/assets/dir%2F..%2F..%2Fconf.json", "recovery:path"),
      /仅允许保存思源 assets/
    );
  } finally {
    restoreLocation();
  }
});

test("marketplace icon stays within the Bazaar size limit", async () => {
  const iconUrl = new URL("../icon.png", import.meta.url);
  const [icon, details] = await Promise.all([readFile(iconUrl), stat(iconUrl)]);
  assert.ok(details.size <= 20 * 1024, `icon.png is ${details.size} bytes`);
  assert.equal(icon.subarray(1, 4).toString("ascii"), "PNG");
  assert.equal(icon.readUInt32BE(16), 160);
  assert.equal(icon.readUInt32BE(20), 160);
  assert.ok(icon.includes(Buffer.from("tRNS")), "icon.png must preserve transparency");
});

test("a completed putFile remains successful when the optional sync marker fails", async (context) => {
  const storage = new Map();
  const restores = [
    replaceGlobal("location", new URL("http://192.168.1.20:6806/plugins/siyuan-cloud-document-suite/mm-editor.html")),
    replaceGlobal("window", {
      frameElement: {
        closest: () => ({ getAttribute: () => "20260824200859-jc3m0gp" })
      }
    }),
    replaceGlobal("localStorage", {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    })
  ];
  const originalWarn = console.warn;
  console.warn = () => {};
  context.after(() => {
    console.warn = originalWarn;
    restores.reverse().forEach((restore) => restore());
  });

  const current = encoder.encode("before");
  const desired = encoder.encode("after");
  let assetReads = 0;
  let putCalls = 0;
  const restoreFetch = replaceGlobal("fetch", async (input, init = {}) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/assets/test.mm") {
      assetReads += 1;
      return new Response(current, { status: 200 });
    }
    if (url.pathname === "/api/file/putFile") {
      putCalls += 1;
      assert.equal(init.method, "POST");
      assert.ok(init.body instanceof FormData);
      assert.equal(init.body.get("path"), "/data/assets/test.mm");
      assert.equal(init.body.has("modTime"), false);
      assert.ok(init.body.get("file") instanceof Blob);
      return Response.json({ code: 0, msg: "", data: null });
    }
    if (url.pathname === "/api/attr/setBlockAttrs") {
      return Response.json({ code: 1, msg: "marker unavailable", data: null });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  context.after(restoreFetch);

  const store = new SiyuanFileStore("/assets/test.mm", "recovery:test");
  await store.loadRemote();
  store.cacheRecovery({ nodeData: { topic: "after" } });
  const saved = await store.save(desired);

  assert.equal(assetReads, 2);
  assert.equal(putCalls, 1);
  assert.equal(saved.unchanged, false);
  assert.equal(saved.syncMarked, false);
  assert.equal(store.baseHash, await contentHash(desired, null));
  assert.equal(store.conflicted, false);
  assert.equal(storage.has("recovery:test"), false);
});

test("an older in-flight save does not clear a newer recovery snapshot", async (context) => {
  const storage = new Map();
  const restores = [
    replaceGlobal("location", new URL("http://192.168.1.20:6806/plugins/siyuan-cloud-document-suite/mm-editor.html")),
    replaceGlobal("window", { frameElement: null }),
    replaceGlobal("localStorage", {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    })
  ];
  context.after(() => restores.reverse().forEach((restore) => restore()));

  let remote = encoder.encode("before");
  const desiredA = encoder.encode("saved-A");
  const desiredB = encoder.encode("saved-B");
  let putCalls = 0;
  let releasePut;
  let signalPutStarted;
  const putStarted = new Promise((resolve) => { signalPutStarted = resolve; });
  const putReleased = new Promise((resolve) => { releasePut = resolve; });
  const restoreFetch = replaceGlobal("fetch", async (input, init = {}) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/assets/test.mm") {
      return new Response(remote, { status: 200 });
    }
    if (url.pathname === "/api/file/putFile") {
      putCalls += 1;
      if (putCalls === 1) {
        signalPutStarted();
        await putReleased;
      }
      remote = new Uint8Array(await init.body.get("file").arrayBuffer());
      return Response.json({ code: 0, msg: "", data: null });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  context.after(restoreFetch);

  const store = new SiyuanFileStore("/assets/test.mm", "recovery:race");
  await store.loadRemote();
  store.cacheRecovery({ revision: "A" });
  const saveA = store.save(desiredA);
  await putStarted;
  store.cacheRecovery({ revision: "B" });
  releasePut();
  await saveA;

  assert.deepEqual(store.readRecovery()?.payload, { revision: "B" });
  assert.equal(storage.has("recovery:race"), true);

  await store.save(desiredB);
  assert.equal(storage.has("recovery:race"), false);
  assert.deepEqual(remote, desiredB);
});

test("a deleted remote asset is never recreated by an open editor", async (context) => {
  const storage = new Map();
  const restores = [
    replaceGlobal("location", new URL("http://127.0.0.1:6806/plugins/siyuan-cloud-document-suite/mm-editor.html")),
    replaceGlobal("window", { frameElement: null }),
    replaceGlobal("localStorage", {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    })
  ];
  context.after(() => restores.reverse().forEach((restore) => restore()));

  let deleted = false;
  let putCalls = 0;
  const restoreFetch = replaceGlobal("fetch", async (input) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/assets/deleted.mm") {
      return deleted
        ? new Response("missing", { status: 404 })
        : new Response(encoder.encode("before"), { status: 200 });
    }
    if (url.pathname === "/api/file/putFile") {
      putCalls += 1;
      return Response.json({ code: 0, msg: "", data: null });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  context.after(restoreFetch);

  const store = new SiyuanFileStore("/assets/deleted.mm", "recovery:deleted");
  await store.loadRemote();
  store.cacheRecovery({ revision: "unsaved" });
  deleted = true;
  await assert.rejects(() => store.save(encoder.encode("after")), /读取附件失败：HTTP 404/);
  assert.equal(putCalls, 0);
  assert.deepEqual(store.readRecovery()?.payload, { revision: "unsaved" });
});

test("an external asset update triggers conflict protection and keeps recovery", async (context) => {
  const storage = new Map();
  const restores = [
    replaceGlobal("location", new URL("http://127.0.0.1:6806/plugins/siyuan-cloud-document-suite/mm-editor.html")),
    replaceGlobal("window", { frameElement: null }),
    replaceGlobal("localStorage", {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    })
  ];
  context.after(() => restores.reverse().forEach((restore) => restore()));

  let remote = encoder.encode("base");
  let putCalls = 0;
  const restoreFetch = replaceGlobal("fetch", async (input) => {
    const url = new URL(String(input), location.origin);
    if (url.pathname === "/assets/conflict.mm") return new Response(remote, { status: 200 });
    if (url.pathname === "/api/file/putFile") {
      putCalls += 1;
      return Response.json({ code: 0, msg: "", data: null });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  context.after(restoreFetch);

  const store = new SiyuanFileStore("/assets/conflict.mm", "recovery:conflict");
  await store.loadRemote();
  store.cacheRecovery({ revision: "local" });
  remote = encoder.encode("changed elsewhere");
  await assert.rejects(() => store.save(encoder.encode("local change")), SaveConflictError);
  assert.equal(putCalls, 0);
  assert.equal(store.conflicted, true);
  assert.deepEqual(store.readRecovery()?.payload, { revision: "local" });
});

test("editor sources keep automatic save and readable borderless layouts", async () => {
  const [sheetHtml, sheetScript, mindHtml, mindScript, pluginSource, packageScript] = await Promise.all([
    readFile(new URL("../static/sheet-editor.html", import.meta.url), "utf8"),
    readFile(new URL("../static/sheet-editor.js", import.meta.url), "utf8"),
    readFile(new URL("../static/mm-editor.html", import.meta.url), "utf8"),
    readFile(new URL("../static/mm-editor.js", import.meta.url), "utf8"),
    readFile(new URL("../src/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../scripts/package.mjs", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(sheetHtml, /id="save"/);
  assert.doesNotMatch(mindHtml, /id="save"/);
  assert.match(sheetHtml, /table\{[^}]*border:0/);
  assert.match(sheetHtml, /th,td\{[^}]*border:0[^}]*border-right:1px solid var\(--border\)[^}]*border-bottom:1px solid var\(--border\)/);
  assert.match(sheetHtml, /id="undo"[^>]*disabled/);
  assert.match(sheetHtml, /id="redo"[^>]*disabled/);
  assert.match(sheetHtml, /id="find" type="search"/);
  assert.match(sheetHtml, /td\.range-selected/);
  assert.match(sheetHtml, /td\.selection-top/);
  assert.match(sheetHtml, /table\.range-multi td\.active-cell:focus\{outline:0\}/);
  assert.match(mindHtml, /#help\{left:72px;right:182px/);
  assert.match(mindHtml, /#map \.map-container\{background:#fff!important\}/);
  assert.match(mindHtml, /me-tpc\.task-done,me-tpc\.node-underlined\{text-decoration:none!important\}/);
  assert.match(mindHtml, /me-tpc\.task-done \.text\{color:#98a2b3!important;text-decoration-line:line-through!important/);
  assert.match(mindHtml, /me-tpc\.node-underlined \.text\{text-decoration-line:underline!important/);
  assert.match(mindHtml, /me-tpc\.task-done\.node-underlined \.text\{text-decoration-line:underline line-through!important\}/);
  assert.match(mindHtml, /#cm-summary,#cm-link,#cm-link-bidirectional\{display:none!important\}/);
  assert.doesNotMatch(mindHtml, /\.task-box\{/);
  assert.match(mindHtml, /data-action="task" title="切换完成状态" aria-pressed="false">✓ 完成/);
  assert.match(mindHtml, /id="view-style"[^>]*>层级样式/);
  assert.match(mindHtml, /body\.hierarchy-view me-tpc\[data-depth="1"\]/);
  assert.match(mindHtml, /me-tpc\.selected:not\(\[data-depth="0"\]\).*background:#fff!important.*box-shadow:0 0 0 2px #3478f6!important/);
  assert.match(mindHtml, /#input-box\{[^}]*outline:0!important[^}]*box-shadow:0 0 0 2px #3478f6!important/);
  assert.match(mindScript, /CLOUD_VIEW_STYLE/);
  assert.match(mindScript, /cloudViewStyle === "hierarchy"/);
  assert.match(mindScript, /contextMenu: \{ locale: zhCnMenu, focus: true, link: false \}/);
  assert.doesNotMatch(mindScript, /nativeCreateArrow|readJsonAttribute/);
  assert.match(mindScript, /setAttribute\(map, "CLOUD_ARROWS", null\)/);
  assert.match(mindScript, /setAttribute\(map, "CLOUD_SUMMARIES", null\)/);
  assert.match(mindScript, /generateMainBranch: generateFeishuMainBranch/);
  assert.match(mindScript, /generateSubBranch: generateFeishuSubBranch/);
  assert.match(mindScript, /savedDirectionAttribute === null \? 1/);
  assert.match(mindScript, /direction: \[0, 1, 2\]\.includes\(savedDirection\) \? savedDirection : 1/);
  assert.match(mindScript, /direction: data\.direction/);
  assert.match(mindScript, /setBranchDirection\(child, direction\)/);
  assert.match(mindScript, /setAttribute\(element, "POSITION", topLevel/);
  assert.match(mindHtml, /me-epd\.minus::before\{content:""[^}]*top:1px[^}]*border-width:0 2px 2px 0[^}]*rotate\(135deg\)/);
  assert.match(mindHtml, /\.lhs me-parent>me-epd\.minus::before\{transform:rotate\(-45deg\)/);
  assert.match(mindScript, /await mind\.init\(data\);[\s\S]*mind\.generateMainBranch = generateFeishuMainBranch;[\s\S]*mind\.generateSubBranch = generateFeishuSubBranch;[\s\S]*refreshDecoratedLayout\(mind, true\)/);
  assert.match(mindScript, /function refreshDecoratedLayout\(mind, reveal = false\)[\s\S]*const selectedNodeId = mind\.currentNode\?\.nodeObj\?\.id[\s\S]*requestAnimationFrame\(\(\) => requestAnimationFrame\(\(\) => \{[\s\S]*mind\.refresh\(\);[\s\S]*mind\.findEle\(selectedNodeId\)[\s\S]*mind\.selectNode\(selectedTopic\)[\s\S]*layout-ready/);
  assert.match(mindScript, /function redrawVisibleBranches\(\)/);
  assert.match(mindScript, /path\.setAttribute\("d", branchPathFromRects/);
  assert.match(mindScript, /redrawVisibleBranches\(\);/);
  assert.match(mindScript, /if \(operation\?\.name === "beginEdit"\) return/);
  assert.match(mindScript, /const scheduleMindPersistence = \(\) =>/);
  assert.match(mindScript, /for \(const historyAction of \["undo", "redo"\]\)/);
  assert.match(mindScript, /const result = nativeHistoryAction\(\.\.\.args\);[\s\S]*scheduleMindPersistence\(\);[\s\S]*refreshDecoratedLayout\(mind\)/);
  assert.match(mindScript, /roundedOrthogonalBranch/);
  assert.match(mindScript, /sameRowTolerance/);
  assert.match(mindScript, /left \? cL \+ cW - gap : cL \+ gap/);
  assert.match(mindScript, /return `M \$\{parentEdge\} \$\{lineY\} H \$\{childEdge\}`/);
  assert.match(mindHtml, /mm-editor\.js\?v=__PLUGIN_VERSION__-mm35/);
  assert.match(mindHtml, /me-nodes\{isolation:isolate\}/);
  assert.match(mindHtml, /me-nodes>me-main,#map me-nodes>me-root\{position:relative;z-index:10\}/);
  assert.match(mindHtml, /me-nodes>svg\.lines\{z-index:1!important;pointer-events:none\}/);
  assert.match(mindHtml, /me-wrapper\{isolation:isolate\}/);
  assert.match(mindHtml, /me-wrapper>me-parent,#map me-wrapper>me-children\{position:relative;z-index:10\}/);
  assert.match(mindHtml, /me-wrapper>svg\.subLines\{z-index:1!important;pointer-events:none\}/);
  assert.match(mindHtml, /me-parent>me-epd\{display:grid;place-items:center[^}]*isolation:isolate[^}]*z-index:20[^}]*top:calc\(50% - 9px\)!important[^}]*box-shadow:0 0 0 3px #fff/);
  assert.match(mindHtml, /me-parent\.has-child-nodes>me-epd\.minus\{pointer-events:auto\}/);
  assert.match(mindHtml, /me-parent\.has-child-nodes:hover>me-epd\.minus\{opacity:1\}/);
  assert.doesNotMatch(mindHtml, /focus-within>me-epd\.minus|me-tpc\.selected\+me-epd\.minus/);
  assert.match(mindHtml, /me-parent>me-epd::after\{content:"";position:absolute;inset:-6px;border-radius:50%\}/);
  assert.match(mindHtml, /\.rhs me-wrapper me-parent>me-epd\{right:calc\(var\(--node-gap-x\) - 23px\);left:auto\}/);
  assert.match(mindHtml, /\.lhs me-wrapper me-parent>me-epd\{left:calc\(var\(--node-gap-x\) - 23px\);right:auto\}/);
  assert.match(mindHtml, /\.rhs me-parent\.main-branch-parent>me-epd\{right:-23px;left:auto\}/);
  assert.match(mindHtml, /\.lhs me-parent\.main-branch-parent>me-epd\{left:-23px;right:auto\}/);
  assert.match(mindHtml, /me-parent>me-epd:not\(\.minus\)::before\{[^}]*display:grid;place-items:center[^}]*width:14px;height:14px[^}]*text-align:center/);
  assert.match(mindHtml, /me-tpc\[data-depth\]:not\(\[data-depth="0"\]\):not\(\[data-depth="1"\]\)\{[^}]*min-height:39px[^}]*padding:9px 4px!important/);
  assert.doesNotMatch(mindHtml, /body\.hierarchy-view me-children\{[^}]*top:-5px/);
  assert.match(mindScript, /function alignVisibleHierarchy\(\)/);
  assert.match(mindScript, /children\.style\.removeProperty\("transform"\)/);
  assert.match(mindScript, /Math\.min\(\.\.\.childRects\.map\(\(rect\) => rect\.top\)\)/);
  assert.match(mindScript, /Math\.max\(\.\.\.childRects\.map\(\(rect\) => rect\.bottom\)\)/);
  assert.match(mindScript, /children\.style\.transform = `translateY\(\$\{correction\}px\)`/);
  assert.match(mindScript, /function redrawVisibleBranches\(\) \{\s*alignVisibleHierarchy\(\)/);
  assert.match(mindScript, /expander\.addEventListener\("pointerdown", \(\) => \{[\s\S]*pendingViewportAnchor = anchor/);
  assert.match(mindScript, /function restoreViewportAnchor\(mind, anchor\)[\s\S]*mind\.findEle\(anchor\.nodeId\)[\s\S]*mind\.move\(dx, dy\)/);
  assert.match(mindScript, /const viewportAnchor = pendingViewportAnchor;[\s\S]*redrawVisibleBranches\(\);[\s\S]*restoreViewportAnchor\(mind, viewportAnchor\)/);
  assert.match(mindHtml, /body\.layout-ready #map\{opacity:1\}/);
  assert.match(mindScript, /\^\(\?:新节点\|未命名主题\|new node\)\$/);
  assert.match(mindHtml, /stroke-linecap:round!important;stroke-linejoin:round!important/);
  assert.doesNotMatch(mindScript, /rightDragMoved|rightDragStart/);
  assert.match(mindHtml, /左键拖节点：调整层级.*右键拖动画布：平移视图/);
  assert.doesNotMatch(packageScript, /f\.button === 2/);
  assert.match(pluginSource, /this\.buildUniqueUploadName\("新建脑图\.mm"\)/);
  assert.match(pluginSource, /asset\.originalName = "新建脑图\.mm"/);
  assert.match(pluginSource, /this\.buildUniqueUploadName\("新建 Excel 工作簿\.xlsx"\)/);
  assert.match(pluginSource, /asset\.originalName = "新建 Excel 工作簿\.xlsx"/);
  assert.match(pluginSource, /<map version="1\.0\.1" CLOUD_DIRECTION="1" CLOUD_VIEW_STYLE="hierarchy"><node ID="root" TEXT="中心主题" STYLE="bubble"\/><\/map>/);
  assert.match(pluginSource, /id: "cloud-document-create-menu"/);
  assert.match(pluginSource, /type: "submenu"/);
  assert.match(pluginSource, /label: "创建文件"/);
  assert.match(pluginSource, /label: "新建脑图（\.mm）"/);
  assert.match(pluginSource, /label: "新建 Word 文档"/);
  assert.match(pluginSource, /label: "新建 Excel 工作簿"/);
  assert.match(pluginSource, /id: "cloud-document-suite-status"/);
  assert.match(pluginSource, /label: "云文档套件"/);
  assert.match(pluginSource, /scheduleCreateFileMenuPromotion/);
  assert.match(pluginSource, /promoteCreateFileMenu/);
  assert.match(pluginSource, /rootItems\.insertBefore\(createItem, replaceItem\.nextElementSibling\)/);
  assert.match(pluginSource, /separatorBeforeClose/);
  assert.match(pluginSource, /private async resolveNotebookId/);
  assert.match(pluginSource, /await this\.createRootDocuments\(notebook, \[asset\]\)/);
  assert.doesNotMatch(sheetScript, /querySelector\("#save"\)/);
  assert.match(sheetScript, /grid\.addEventListener\("paste"/);
  assert.match(sheetScript, /grid\.addEventListener\("copy"/);
  assert.match(sheetScript, /td\.contentEditable = "plaintext-only"/);
  assert.doesNotMatch(sheetScript, /td\.contentEditable = editMode/);
  assert.doesNotMatch(sheetScript, /粘贴内容请先进入编辑模式/);
  assert.match(sheetScript, /简约模式 · 可直接编辑单元格并自动写入思源/);
  assert.match(sheetScript, /event\.key === "Delete"/);
  assert.match(sheetScript, /event\.key === "Enter"/);
  assert.match(sheetScript, /event\.key === "Tab"/);
  assert.match(sheetScript, /const HISTORY_LIMIT = 100/);
  assert.match(sheetScript, /grid\.classList\.add\("range-multi"\)/);
  assert.match(sheetScript, /cellInputText\(XLSX, model/);
  assert.match(sheetScript, /if \(!session\.dirty\) return/);
  assert.match(sheetScript, /restoreCellRange\(XLSX, model/);
  assert.match(sheetScript, /event\.key\.toLowerCase\(\) === "f"/);
  assert.doesNotMatch(mindScript, /querySelector\("#save"\)/);
  assert.doesNotMatch(mindScript, /createElement\("button"\);\s*checkbox\.type/);
  assert.match(mindScript, /const taskDone = topic\.classList\.contains\("task-done"\)/);
  assert.match(mindScript, /taskDone = !topic\.classList\.contains\("task-done"\)/);
  assert.match(mindScript, /if \(taskDone\) metadata\.task = \{ enabled: true, done: true \}/);
  assert.match(mindScript, /else delete metadata\.task/);
  assert.match(mindScript, /taskButton\.setAttribute\("aria-pressed", String\(taskDone\)\)/);
  assert.match(mindScript, /topic\.classList\.toggle\("task-done", taskDone\)/);
  assert.match(mindScript, /button\.classList\.toggle\("active", taskDone\)/);
  assert.match(mindScript, /button\.setAttribute\("aria-pressed", String\(taskDone\)\)/);
  assert.match(mindScript, /nodeTools\.addEventListener\("click", async \(event\) => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\)/);
  assert.match(mindScript, /data-action="underline"[^\n]+includes\("underline"\)/);
  assert.match(sheetScript, /wrapper\.scrollTop = 0/);
  assert.match(sheetScript, /\.\/siyuan-file-store\.js\?v=__PLUGIN_VERSION__/);
  assert.match(sheetScript, /\.\/sheet-workbook\.js\?v=__PLUGIN_VERSION__/);
  assert.match(sheetScript, /setTimeout\(\(\) => void persist\(false\), 700\)/);
  assert.match(mindScript, /setTimeout\(\(\) => void persistMind\(false\), 700\)/);
  assert.match(pluginSource, /refreshCloudDocumentEmbeds/);
  assert.match(pluginSource, /const MM_EDITOR_CACHE_VERSION = `\$\{PLUGIN_VERSION\}-mm35`/);
  assert.match(pluginSource, /searchParams\.set\("v", editorVersion\)/);
  assert.match(pluginSource, /fitCloudDocumentEmbeds/);
  assert.match(pluginSource, /mutationsAffectCloudDocument\(records\)/);
  assert.match(pluginSource, /this\.refreshCloudDocumentEmbeds\(\);\s*this\.fitCloudDocumentEmbeds\(\);/);
  assert.match(pluginSource, /--cloud-document-inline-extra/);
  assert.match(pluginSource, /contentRect\.bottom - blockRect\.top/);
});
