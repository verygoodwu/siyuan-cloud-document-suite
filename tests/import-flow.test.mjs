import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const { outputFiles } = await build({
  entryPoints: ["src/index.ts"], bundle: true, platform: "node",
  packages: "external", format: "cjs", write: false,
  define: { __PLUGIN_VERSION__: '"test"' }
});

function harness(cloudTreeHandlesReveal = true) {
  const opened = [];
  const dialogs = [];
  const created = [];
  const revealed = [];
  const nativeSelections = [];
  const announced = [];
  const listeners = new Map();
  const closeButton = { addEventListener: (name, fn) => listeners.set(`close:${name}`, fn) };
  const openButton = { dataset: { importOpen: "2" }, addEventListener: (name, fn) => listeners.set(name, fn) };
  const module = { exports: {} };
  runInNewContext(outputFiles[0].text, {
    module, exports: module.exports, location: { origin: "http://localhost" }, File,
    ResizeObserver: class {},
    CustomEvent: class { constructor(type, options) { Object.assign(this, { type }, options); } },
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      dispatchEvent(event) {
        if (event.type === "cloud-docs-home:document-created") {
          announced.push(event.detail);
          return true;
        }
        assert.equal(event.type, "cloud-docs-home:reveal-imported-document");
        assert.equal(event.cancelable, true);
        assert.equal(opened.at(-1), event.detail.id);
        revealed.push(event.detail.id);
        return !cloudTreeHandlesReveal;
      }
    },
    console: { ...console, error() {} },
    require(name) {
      if (name !== "siyuan") return require(name);
      return {
        Plugin: class {},
        openTab: async ({ doc }) => opened.push(doc.id),
        expandDocTree: ({ id, isSetCurrent }) => nativeSelections.push({ id, isSetCurrent }),
        Dialog: class {
          constructor(options) {
            dialogs.push(options.content);
            this.element = {
              querySelector: selector => selector === "[data-import-close]" ? closeButton : null,
              querySelectorAll: () => [openButton]
            };
            this.destroy = options.destroyCallback;
          }
        }
      };
    }
  });
  const plugin = new module.exports();
  const realDocuments = plugin.documents;
  const kernel = plugin.api;
  Object.assign(plugin, {
    importDialogs: new Set(),
    recordDebug: async () => {},
    showToast: () => {},
    api: {
      uploadAsset: async file => ({ originalName: file.name, assetPath: "assets/example" }),
      postJson: async () => "/项目/测试资料"
    },
    documents: {
      createChildDocuments: async (parent, [asset]) => {
        assert.equal(parent, "folder");
        created.push(asset.originalName);
        if (asset.originalName === "失败.bin") throw Error("写入失败 <原因>");
        return [{ id: asset.originalName, title: asset.originalName === "排期.bin" ? "排期 (2).bin" : asset.originalName }];
      }
    }
  });
  const target = { id: "folder", position: "create-child-documents" };
  return { plugin, target, dialogs, opened, created, listeners, revealed, nativeSelections, announced, realDocuments, kernel };
}

test("right-click creation sends all six file types to the selected folder or notebook and publishes their actual paths", async () => {
  for (const type of ["doc", "notebook"]) {
    const { plugin, realDocuments, kernel, announced, opened } = harness();
    const requests = [];
    const targetId = type === "doc" ? "qa-folder" : "projects";
    Object.assign(kernel, {
      uploadAsset: async () => ({ assetPath: "assets/test" }),
      verifyAsset: async () => {},
      async postJson(endpoint, body) {
        switch (endpoint) {
          case "/api/filetree/getPathByID":
            assert.equal(body.id, targetId);
            return { notebook: "projects", path: "/qa-folder.sy" };
          case "/api/filetree/getHPathByID": return "/示例目录";
          case "/api/filetree/getIDsByHPath": return [];
          case "/api/filetree/createDocWithMd": return `created-${requests.push(body)}`;
          case "/api/attr/setBlockAttrs": return null;
          default: assert.fail(endpoint);
        }
      }
    });
    const preview = () => "<iframe></iframe>";
    Object.assign(plugin, {
      api: kernel, documents: realDocuments,
      previews: { buildWhiteboard: preview, buildFreeMind: preview, buildText: preview, buildSpreadsheet: preview },
      documentExports: { addForDocument() {} }, scheduleCreateFileMenuPromotion() {}
    });
    const menuItems = [];
    plugin.onOpenDocTreeMenu({ detail: { type, items: [{ id: targetId }], menu: { addItem: item => menuItems.push(item) } } });
    const menu = menuItems.find(item => item.id === "cloud-document-create-menu");
    for (const item of menu.submenu) await item.click();
    assert.equal(requests.length, 6);
    assert.equal(announced.length, 6);
    for (const [index, request] of requests.entries()) {
      const entry = announced[index];
      assert.equal(request.parentID, type === "doc" ? targetId : undefined);
      assert.equal(request.notebook, "projects");
      assert.equal(request.path, `${type === "doc" ? "/示例目录" : ""}/${entry.title}`);
      assert.equal(entry.hpath, request.path);
      assert.equal(entry.path, `${type === "doc" ? "/qa-folder" : ""}/created-${index + 1}.sy`);
    }
    assert.equal(requests[2].markdown, "");
    assert.deepEqual(opened, []);
  }
});

test("dropping one file on a folder opens the new document automatically", async () => {
  const { plugin, target, opened, dialogs, revealed, nativeSelections } = harness();
  await plugin.importFiles([{ name: "资料.bin" }], target);
  assert.deepEqual(opened, ["资料.bin"]);
  assert.deepEqual(revealed, ["资料.bin"]);
  assert.deepEqual(nativeSelections, []);
  assert.equal(dialogs.length, 0);
});

test("batch folder import continues after failure and opens only the selected result", async () => {
  const { plugin, target, dialogs, opened, created, listeners, revealed } = harness();
  await plugin.importFiles(["测试思路.bin", "失败.bin", "排期.bin"].map(name => ({ name })), target);
  assert.deepEqual(created, ["测试思路.bin", "失败.bin", "排期.bin"]);
  assert.deepEqual(opened, []);
  assert.deepEqual(revealed, []);
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0], /\/项目\/测试资料/);
  assert.match(dialogs[0], /成功 2 个 · 失败 1 个/);
  assert.match(dialogs[0], /写入失败 &lt;原因&gt;/);
  assert.match(dialogs[0], /排期 \(2\)\.bin/);
  await listeners.get("click")();
  assert.deepEqual(opened, ["排期.bin"]);
  assert.deepEqual(revealed, ["排期.bin"]);
});

test("a folder import selects the new document in the native tree if Cloud Docs Home does not handle it", async () => {
  const { plugin, target, nativeSelections } = harness(false);
  await plugin.importFiles([{ name: "资料.bin" }], target);
  assert.deepEqual(nativeSelections, [{ id: "资料.bin", isSetCurrent: true }]);
});

test("closing batch results keeps all imported files without changing the open document or tree selection", async () => {
  const { plugin, target, created, opened, revealed, nativeSelections, listeners } = harness();
  await plugin.importFiles([{ name: "脑图.bin" }, { name: "排期.bin" }], target);
  assert.equal(plugin.importDialogs.size, 1);
  listeners.get("close:click")();
  assert.equal(plugin.importDialogs.size, 0);
  assert.deepEqual(created, ["脑图.bin", "排期.bin"]);
  assert.deepEqual(opened, []);
  assert.deepEqual(revealed, []);
  assert.deepEqual(nativeSelections, []);
});
