import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadSource(path) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL(path, import.meta.url))],
    bundle: true, platform: "node", format: "cjs", packages: "external", write: false
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", result.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  return module.exports;
}

const { DragDropController } = await loadSource("../src/drag-drop-controller.ts");
const { PreviewBuilders } = await loadSource("../src/preview-builders.ts");
const { DocumentCreator } = await loadSource("../src/document-creator.ts");

function harness(context, position = "after-block") {
  const originalWindow = globalThis.window;
  const target = { id: "target", position };
  const events = new EventTarget();
  const imports = [];
  let nativeDrops = 0;
  let overlays = 0;
  globalThis.window = events;
  const controller = new DragDropController({
    isFileDrag: () => true,
    isSupportedPoint: () => true,
    findDropTarget: () => target,
    findTreeDropTarget: () => position === "after-block" ? null : target,
    describeDrop: () => ({}),
    importFiles: async (files, dropTarget) => { imports.push({ files, target: dropTarget }); },
    showOverlay: () => { overlays += 1; },
    removeOverlay: () => {}, showToast: () => {}, recordDebug: async () => {}
  });
  controller.start();
  // Represents SiYuan's listener, which runs after the plugin's capture handler.
  events.addEventListener("drop", () => { nativeDrops += 1; });
  context.after(() => {
    controller.stop();
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  });
  return {
    imports,
    get nativeDrops() { return nativeDrops; },
    get overlays() { return overlays; },
    dispatch(type, files, items = []) {
      const event = new Event(type, { cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files, items, dropEffect: "none" } });
      events.dispatchEvent(event);
      return event;
    }
  };
}

test("PDF-only editor drops reach SiYuan without cancellation or plugin uploads", (context) => {
  const h = harness(context);
  const items = [{ kind: "file", type: "application/pdf" }];
  assert.equal(h.dispatch("dragenter", [], items).defaultPrevented, false);
  assert.equal(h.dispatch("dragover", [], items).defaultPrevented, false);
  const files = [{ name: "说明.PDF", type: "application/octet-stream" }, { name: "第二份.pdf" }];
  assert.equal(h.dispatch("drop", files).defaultPrevented, false);
  assert.equal(h.nativeDrops, 1);
  assert.equal(h.imports.length, 0);
  assert.equal(h.overlays, 0);
});

test("mixed editor drops remain one plugin import without duplicate native uploads", (context) => {
  const h = harness(context);
  const files = [{ name: "paper.pdf" }, { name: "map.mm" }];
  assert.equal(h.dispatch("drop", files).defaultPrevented, true);
  assert.equal(h.nativeDrops, 0);
  assert.equal(h.imports.length, 1);
  assert.deepEqual(h.imports[0].files, files);
});

test("PDF drops into the document tree still create plugin documents", (context) => {
  const h = harness(context, "create-child-documents");
  assert.equal(h.dispatch("drop", [{ name: "paper.pdf" }]).defaultPrevented, true);
  assert.equal(h.nativeDrops, 0);
  assert.equal(h.imports.length, 1);
  assert.equal(h.imports[0].target.position, "create-child-documents");
});

test("tree and mixed imports insert normal PDF asset links, never browser PDF embeds", async () => {
  const builder = new PreviewBuilders("test", "test", "test");
  const asset = { originalName: "报告 [终稿].pdf", assetPath: "assets/report-123.pdf", documentKind: "pdf" };
  asset.documentMarkdown = builder.buildPdf(asset);
  assert.equal(asset.documentMarkdown, "[报告 \\[终稿\\].pdf](<assets/report-123.pdf>)");
  const calls = [];
  const creator = new DocumentCreator({ async postJson(endpoint, body) { calls.push({ endpoint, body }); } });
  await creator.insertAttachmentBlock({ id: "block", position: "after-block" }, [asset]);
  assert.equal(calls[0].body.data, asset.documentMarkdown);
  assert.doesNotMatch(calls[0].body.data, /iframe|pdf-reader|\/stage\//);
});
