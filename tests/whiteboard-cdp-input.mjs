const cdpBase = process.env.WHITEBOARD_CDP_URL || "http://127.0.0.1:9223";
const testBase = process.env.WHITEBOARD_TEST_URL || "http://127.0.0.1:41732";
const pageUrl = `${testBase}/plugins/siyuan-cloud-document-suite/whiteboard-editor.html?v=cdp-input&asset=%2Fassets%2Ftest.board.json`;

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForTarget() {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetch(`${cdpBase}/json/list`).then((response) => response.json());
      const target = targets.find((item) => item.type === "page" && item.url.startsWith(testBase))
        || targets.find((item) => item.type === "page");
      if (target) return target;
    } catch {}
    await wait(100);
  }
  throw new Error("CDP page target did not become available");
}

const target = await waitForTarget();
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

function command(method, params = {}) {
  const id = nextId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}

await command("Runtime.enable");
await command("Page.enable");
await command("Page.navigate", { url: pageUrl });

const deadline = Date.now() + 10000;
while (Date.now() < deadline) {
  const ready = await evaluate(`document.readyState === "complete" && document.querySelector("#loading")?.hidden === true`);
  if (ready) break;
  await wait(100);
}

const setup = await evaluate(`(() => {
  const shell = document.querySelector("#canvas-shell");
  document.querySelector('[data-tool="rect"]').click();
  shell.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 404, button: 0, clientX: 600, clientY: 360 }));
  const node = document.querySelector('#node-layer [data-node-id]');
  const overlay = document.querySelector('#text-editor');
  const input = document.querySelector('#text-editor-input');
  if (!node || overlay.hidden || document.activeElement !== input) return { ok: false, reason: "editor not focused" };
  const nodeRect = node.getBoundingClientRect();
  const overlayRect = overlay.getBoundingClientRect();
  return {
    ok: Math.abs((nodeRect.left + nodeRect.width / 2) - (overlayRect.left + overlayRect.width / 2)) < 2
      && Math.abs((nodeRect.top + nodeRect.height / 2) - (overlayRect.top + overlayRect.height / 2)) < 2,
    nodeId: node.dataset.nodeId,
    active: document.activeElement?.id,
    nodeCenter: [nodeRect.left + nodeRect.width / 2, nodeRect.top + nodeRect.height / 2],
    editorCenter: [overlayRect.left + overlayRect.width / 2, overlayRect.top + overlayRect.height / 2]
  };
})()`);
if (!setup.ok) throw new Error(`Editor setup or centering failed: ${JSON.stringify(setup)}`);

await command("Input.insertText", { text: "真实键盘输入测试" });
const duringEdit = await evaluate(`document.querySelector('#text-editor-input').innerText`);
if (duringEdit !== "真实键盘输入测试") throw new Error(`CDP text insertion failed: ${JSON.stringify(duringEdit)}`);

await evaluate(`document.querySelector('#text-editor-input').blur()`);
await wait(100);
const committed = await evaluate(`document.querySelector('[data-node-id="${setup.nodeId}"] .whiteboard-node-text')?.textContent`);
if (committed !== "真实键盘输入测试") throw new Error(`Typed text was not committed: ${JSON.stringify(committed)}`);

console.log(JSON.stringify({
  status: "passed",
  checks: ["focused-editable-element", "pixel-centered-overlay", "cdp-real-text-insertion", "blur-commit"],
  setup,
  committed
}, null, 2));
socket.close();
