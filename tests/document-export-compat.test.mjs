import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({ entryPoints: [fileURLToPath(new URL("../src/document-export-menu.ts", import.meta.url))], bundle: true, packages: "external", platform: "node", format: "cjs", write: false });
const module = { exports: {} };
new Function("require", "module", "exports", compiled.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { DocumentExportMenu } = module.exports;

function harness(context, connection, search = "", electron = true) {
  const oldWindow = globalThis.window;
  const oldLocation = globalThis.location;
  const calls = [];
  const opened = [];
  const notices = [];
  const ipcRenderer = {
    async invoke(channel, payload) {
      calls.push({ channel, payload });
      if (payload.cmd === "kernelConnection") return connection;
      if (payload.cmd === "getContentsId") return 42;
      throw new Error("Unexpected IPC invocation");
    },
    send(channel, payload) { calls.push({ channel, payload }); }
  };
  globalThis.window = {
    ...(electron ? { require: () => ({ ipcRenderer }) } : {}),
    open(url) { const child = { opener: "parent" }; opened.push({ url, child }); return child; }
  };
  globalThis.location = new URL(`http://127.0.0.1:6806/stage/build/desktop/${search}`);
  context.after(() => {
    if (oldWindow === undefined) delete globalThis.window; else globalThis.window = oldWindow;
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
  });
  return { menu: new DocumentExportMenu({}, "2.3.3", (message) => notices.push(message)), calls, opened, notices };
}

test("remote Electron kernel bypasses local-only PDF export IPC", async (context) => {
  const h = harness(context, { kernelMode: "remote" });
  await h.menu.exportDocumentPdf({ documentId: "document", originalName: "报告" });
  assert.deepEqual(h.calls.map((call) => call.payload.cmd), ["kernelConnection"]);
  assert.equal(h.opened.length, 1);
  assert.equal(h.opened[0].child.opener, null);
  const url = new URL(h.opened[0].url);
  assert.equal(url.searchParams.get("id"), "document");
  assert.equal(url.searchParams.has("parentWindowId"), false);
  assert.match(h.notices[0], /远程内核/);
});

test("local Electron retains native PDF export window", async (context) => {
  const h = harness(context, { kernelMode: "local" });
  await h.menu.exportDocumentPdf({ documentId: "document" });
  assert.equal(h.opened.length, 0);
  const send = h.calls.find((call) => call.channel === "siyuan-export-newwindow");
  assert.equal(new URL(send.payload).searchParams.get("parentWindowId"), "42");
});

test("legacy hosts without kernelConnection keep their local PDF path", async (context) => {
  const h = harness(context, undefined);
  await h.menu.exportDocumentPdf({ documentId: "document" });
  assert.equal(h.opened.length, 0);
  assert.ok(h.calls.some((call) => call.channel === "siyuan-export-newwindow"));
});

test("browser PDF export does not invoke Electron", async (context) => {
  const h = harness(context, undefined, "", false);
  await h.menu.exportDocumentPdf({ documentId: "document" });
  assert.equal(h.calls.length, 0);
  assert.equal(h.opened.length, 1);
});
