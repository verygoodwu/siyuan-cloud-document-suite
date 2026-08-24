import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { contentHash, SiyuanFileStore } from "../static/siyuan-file-store.js";

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

test("editor sources keep automatic save and readable borderless layouts", async () => {
  const [sheetHtml, sheetScript, mindHtml, mindScript] = await Promise.all([
    readFile(new URL("../static/sheet-editor.html", import.meta.url), "utf8"),
    readFile(new URL("../static/sheet-editor.js", import.meta.url), "utf8"),
    readFile(new URL("../static/mm-editor.html", import.meta.url), "utf8"),
    readFile(new URL("../static/mm-editor.js", import.meta.url), "utf8")
  ]);

  assert.doesNotMatch(sheetHtml, /id="save"/);
  assert.doesNotMatch(mindHtml, /id="save"/);
  assert.match(sheetHtml, /table\{[^}]*border:0/);
  assert.match(sheetHtml, /th,td\{[^}]*border-right:1px solid #e4e7ec[^}]*border-bottom:1px solid #e4e7ec/);
  assert.match(mindHtml, /#help\{left:72px;right:96px/);
  assert.doesNotMatch(sheetScript, /querySelector\("#save"\)/);
  assert.doesNotMatch(mindScript, /querySelector\("#save"\)/);
  assert.match(sheetScript, /wrapper\.scrollTop = 0/);
  assert.match(sheetScript, /setTimeout\(\(\) => void persist\(false\), 700\)/);
  assert.match(mindScript, /setTimeout\(\(\) => void persistMind\(false\), 700\)/);
});
