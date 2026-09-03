import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

const base = process.env.SIYUAN_BASE_URL || "http://127.0.0.1:6806";
const packageName = "siyuan-cloud-document-suite";
const expectedVersion = "2.1.4";
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = (await readdir("dist", { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name !== "package.zip")
  .map((entry) => entry.name)
  .sort();

const mismatches = [];
const checks = [];
for (const name of files) {
  const local = await readFile(`dist/${name}`);
  const response = await fetch(`${base}/api/file/getFile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path: `/data/plugins/${packageName}/${name}` })
  });
  if (!response.ok) {
    mismatches.push({ name, reason: `HTTP ${response.status}` });
    continue;
  }
  const installed = new Uint8Array(await response.arrayBuffer());
  const localHash = digest(local);
  const installedHash = digest(installed);
  const equal = local.length === installed.length && localHash === installedHash;
  checks.push({ name, bytes: local.length, equal });
  if (!equal) mismatches.push({ name, localBytes: local.length, installedBytes: installed.length, localHash, installedHash });
}

const petalsResponse = await fetch(`${base}/api/petal/loadPetals`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ frontend: "desktop" })
});
const petals = await petalsResponse.json();
const plugin = petals.data?.find((item) => item.name === packageName);
const staticAssets = ["whiteboard-editor.html", "whiteboard-editor.js", "whiteboard-model.js", "whiteboard-renderer.js", "whiteboard-layout.js", "whiteboard-interactions.js", "whiteboard-templates.js"];
const staticChecks = [];
for (const name of staticAssets) {
  const response = await fetch(`${base}/plugins/${packageName}/${name}?v=${expectedVersion}`, {
    headers: { "user-agent": "Mozilla/5.0", accept: "text/html,application/javascript" }
  });
  const content = await response.text();
  staticChecks.push({ name, status: response.status, bytes: Buffer.byteLength(content), placeholder: content.includes("__PLUGIN_VERSION__") });
}

const result = {
  status: mismatches.length === 0 && plugin?.version === expectedVersion && plugin?.enabled === true && staticChecks.every((item) => item.status === 200 && !item.placeholder) ? "passed" : "failed",
  version: plugin?.version,
  enabled: plugin?.enabled,
  comparedFiles: checks.length,
  mismatches,
  staticChecks
};
console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exitCode = 1;
