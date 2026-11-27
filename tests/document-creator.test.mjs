import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/document-creator.ts", import.meta.url), "utf8");
const compiled = await transform(source, { loader: "ts", format: "esm" });
const { DocumentCreator } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const clientSource = await readFile(new URL("../src/kernel-client.ts", import.meta.url), "utf8");
const clientCompiled = await transform(clientSource, { loader: "ts", format: "esm" });
const { KernelClient } = await import(`data:text/javascript;base64,${Buffer.from(clientCompiled.code).toString("base64")}`);

test("child import resolves name collisions and does not mark a missing asset ready", async () => {
  const states = [];
  const paths = [];
  let created;
  const creator = new DocumentCreator({
    async postJson(endpoint, body) {
      switch (endpoint) {
        case "/api/filetree/getPathByID":
          assert.equal(body.id, "folder-a");
          return { notebook: "book-a" };
        case "/api/filetree/getHPathByID":
          assert.equal(body.id, "folder-a");
          return "/资料";
        case "/api/filetree/getIDsByHPath":
          paths.push(body.path);
          return paths.length === 1 ? ["existing"] : [];
        case "/api/filetree/createDocWithMd":
          created = body;
          return "new-doc";
        case "/api/attr/setBlockAttrs":
          assert.equal(body.id, "new-doc");
          states.push(body.attrs["custom-cloud-document-state"]);
          return {};
        default:
          assert.fail(endpoint);
      }
    },
    async verifyAsset(path) {
      assert.equal(path, "assets/map.mm");
      throw Error("asset missing");
    }
  });
  await assert.rejects(creator.createChildDocuments("folder-a", [
    { originalName: "map.mm", assetPath: "assets/map.mm", documentKind: "mindmap" }
  ]), /asset missing/);
  assert.deepEqual(paths, ["/资料/map.mm", "/资料/map (2).mm"]);
  assert.equal(created.notebook, "book-a");
  assert.equal(created.path, "/资料/map (2).mm");
  assert.equal(created.parentID, "folder-a");
  assert.deepEqual(states, ["initializing"]);
});

test("dropping previewable files into a content block inserts previews, not only asset links", async () => {
  const calls = [];
  const documents = new DocumentCreator({
    async postJson(endpoint, body) { calls.push({ endpoint, body }); }
  });
  await documents.insertAttachmentBlock({ id: "block-1", position: "after-block" }, [
    { originalName: "map.mm", assetPath: "assets/map.mm", documentMarkdown: '<iframe src="/plugins/siyuan-cloud-document-suite/mm-editor.html?asset=%2Fassets%2Fmap.mm"></iframe>' },
    { originalName: "notes.bin", assetPath: "assets/notes.bin" }
  ]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "/api/block/insertBlock");
  assert.equal(calls[0].body.previousID, "block-1");
  assert.match(calls[0].body.data, /^<iframe /);
  assert.match(calls[0].body.data, /\n\n\[notes\.bin\]\(<assets\/notes\.bin>\)$/);
  assert.doesNotMatch(calls[0].body.data, /\[map\.mm\]/);
});

test("NAS asset verification reports kernel and proxy responses precisely", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  const client = new KernelClient();
  globalThis.fetch = async () => Response.json({ code: 404, msg: "file not found" }, { status: 202 });
  await assert.rejects(() => client.readAsset("assets/missing.mm"), /file not found/);
  globalThis.fetch = async () => new Response("<!doctype html><title>Login</title>", {
    status: 200,
    headers: { "content-type": "text/html" }
  });
  await assert.rejects(() => client.readAsset("assets/map.mm"), /received HTML instead of file bytes/);
  assert.equal(new TextDecoder().decode(await client.readAsset("assets/page.html")), "<!doctype html><title>Login</title>");
});
