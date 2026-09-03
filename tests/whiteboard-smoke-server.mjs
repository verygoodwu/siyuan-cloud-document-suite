import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";

const root = resolve("static");
const port = Number(process.env.WHITEBOARD_TEST_PORT || 41730);
const initial = {
  schema: "siyuan-cloud-whiteboard",
  version: 1,
  title: "浏览器冒烟测试",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  viewport: { x: 600, y: 360, zoom: 1 },
  nodes: []
};
const initialBytes = () => Buffer.from(`${JSON.stringify(initial, null, 2)}\n`);
let remote = initialBytes();
let smokeResult = { status: "not-run" };
let strictResult = { status: "not-run" };
let performanceResult = { status: "not-run" };
let stressResult = { status: "not-run" };

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function collect(request) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolveBody(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function multipartFile(body, contentType) {
  const boundary = /boundary=([^;]+)/i.exec(contentType || "")?.[1];
  if (!boundary) throw new Error("multipart boundary missing");
  const fileHeader = Buffer.from('name="file"');
  const headerIndex = body.indexOf(fileHeader);
  const dataStart = body.indexOf(Buffer.from("\r\n\r\n"), headerIndex) + 4;
  const dataEnd = body.indexOf(Buffer.from(`\r\n--${boundary}`), dataStart);
  if (headerIndex < 0 || dataStart < 4 || dataEnd < 0) throw new Error("multipart file missing");
  return body.subarray(dataStart, dataEnd);
}

function largeWhiteboard(count, title = "白板性能测试") {
  const columns = Math.ceil(Math.sqrt(count));
  return Buffer.from(`${JSON.stringify({
    ...initial,
    title,
    viewport: { x: 80, y: 80, zoom: 0.2 },
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `perf-${index}`,
      type: "rect",
      x: (index % columns) * 150,
      y: Math.floor(index / columns) * 100,
      width: 120,
      height: 64,
      text: `节点 ${index + 1}`,
      style: { fill: "#ffffff", stroke: "#4e83fd", textColor: "#1f2329", fontSize: 16, bold: false }
    }))
  }, null, 2)}\n`);
}

async function serveTest(response, name) {
  const content = await readFile(resolve("tests", name), "utf8");
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(content);
}

async function resultEndpoint(request, response, current, update) {
  if (request.method === "POST") {
    const result = JSON.parse((await collect(request)).toString("utf8"));
    update(result);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: 0 }));
    return true;
  }
  if (request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify(current()));
    return true;
  }
  return false;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://127.0.0.1:${port}`);
    if (url.pathname === "/test-reset" && request.method === "POST") {
      await collect(request);
      remote = initialBytes();
      smokeResult = { status: "not-run" };
      strictResult = { status: "not-run" };
      performanceResult = { status: "not-run" };
      stressResult = { status: "not-run" };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 0 }));
      return;
    }
    if (url.pathname === "/smoke-runner") {
      await serveTest(response, "whiteboard-browser-smoke.html");
      return;
    }
    if (url.pathname === "/full-test") {
      await serveTest(response, "whiteboard-full-browser.html");
      return;
    }
    if (url.pathname === "/export-test") {
      await serveTest(response, "whiteboard-export-browser.html");
      return;
    }
    if (url.pathname === "/strict-test") {
      await serveTest(response, "whiteboard-strict-browser.html");
      return;
    }
    if (url.pathname === "/performance-test") {
      await serveTest(response, "whiteboard-performance-browser.html");
      return;
    }
    if (url.pathname === "/stress-test") {
      await serveTest(response, "whiteboard-stress-browser.html");
      return;
    }
    if (url.pathname === "/test-seed-large" && request.method === "POST") {
      const payload = JSON.parse((await collect(request)).toString("utf8") || "{}");
      const count = Math.max(1, Math.min(5000, Number(payload.count) || 2000));
      remote = largeWhiteboard(count);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 0, count }));
      return;
    }
    if (url.pathname === "/smoke-result" && request.method === "POST") {
      smokeResult = JSON.parse((await collect(request)).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 0 }));
      return;
    }
    if (url.pathname === "/smoke-result" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(smokeResult));
      return;
    }
    if (url.pathname === "/full-result" && request.method === "POST") {
      smokeResult = JSON.parse((await collect(request)).toString("utf8"));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 0 }));
      return;
    }
    if (url.pathname === "/full-result" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(smokeResult));
      return;
    }
    if (url.pathname === "/strict-result" && await resultEndpoint(request, response, () => strictResult, (value) => { strictResult = value; })) return;
    if (url.pathname === "/performance-result" && await resultEndpoint(request, response, () => performanceResult, (value) => { performanceResult = value; })) return;
    if (url.pathname === "/stress-result" && await resultEndpoint(request, response, () => stressResult, (value) => { stressResult = value; })) return;
    if (url.pathname === "/assets/test.board.json" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(remote);
      return;
    }
    if (url.pathname === "/api/file/putFile" && request.method === "POST") {
      remote = multipartFile(await collect(request), request.headers["content-type"]);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 0, msg: "", data: null }));
      return;
    }
    if (url.pathname === "/api/attr/setBlockAttrs" && request.method === "POST") {
      await collect(request);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ code: 0, msg: "", data: null }));
      return;
    }
    const name = url.pathname.replace(/^\/plugins\/siyuan-cloud-document-suite\//, "");
    if (!/^[a-z0-9.-]+$/i.test(name)) {
      response.writeHead(404).end();
      return;
    }
    const file = resolve(root, name);
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    const content = (await readFile(file, "utf8")).replaceAll("__PLUGIN_VERSION__", "smoke");
    response.writeHead(200, { "content-type": contentTypes[extname(file)] || "text/plain; charset=utf-8", "cache-control": "no-store" });
    response.end(content);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(String(error?.stack || error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`whiteboard smoke server listening at http://127.0.0.1:${port}`);
});
