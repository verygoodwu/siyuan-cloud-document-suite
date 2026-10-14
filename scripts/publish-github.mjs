import { spawnSync } from "node:child_process";

const repository = "verygoodwu/siyuan-cloud-document-suite";
const values = process.argv.slice(2);
const option = (name) => values[values.indexOf(name) + 1];
const version = values.includes("--version") ? option("--version") : "";
const expectedHead = values.includes("--expected-remote-head") ? option("--expected-remote-head") : "";
const dryRun = values.includes("--dry-run");
const syncOnly = values.includes("--sync-only");
if (!/^\d+\.\d+\.\d+$/.test(version) || !/^[a-f0-9]{40}$/i.test(expectedHead)) {
  throw new Error("Supply --version X.Y.Z and --expected-remote-head SHA.");
}

function command(executable, args, input, binary = false) {
  const result = spawnSync(executable, args, {
    input,
    encoding: binary ? undefined : "utf8",
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true,
    shell: false
  });
  if (result.error) throw result.error;
  return result;
}

function git(args, binary = false) {
  const result = command("git", args, undefined, binary);
  if (result.status !== 0) throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  return result.stdout;
}

function api(endpoint, body, allowNotFound = false, method) {
  const args = ["api", `repos/${repository}/${endpoint}`];
  if (method) args.push("--method", method);
  if (body !== undefined) args.push("--input", "-");
  const result = command("gh", args, body === undefined ? undefined : JSON.stringify(body));
  if (result.status !== 0) {
    if (allowNotFound && /HTTP 404/.test(result.stderr)) return null;
    throw new Error(`GitHub API ${endpoint} failed: ${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

const origin = git(["remote", "get-url", "origin"]).trim();
if (!origin.endsWith(`${repository}.git`) && !origin.endsWith(repository)) {
  throw new Error(`Origin must point to ${repository}.`);
}
if (git(["status", "--porcelain"]).trim()) {
  throw new Error("Commit working-tree changes before publishing.");
}
const head = api("git/ref/heads/main").object.sha;
if (head !== expectedHead) {
  throw new Error(`Remote main changed: expected ${expectedHead}, found ${head}. Review it before retrying.`);
}
const remote = api(`git/trees/${head}?recursive=1`);
if (remote.truncated) throw new Error("Remote tree response is truncated.");
const entries = git(["ls-tree", "-rz", "HEAD"]).split("\0").filter(Boolean).map((record) => {
  const match = record.match(/^(\d+) blob ([a-f0-9]+)\t([\s\S]+)$/);
  if (!match) throw new Error("Only regular Git blob entries are supported.");
  return { mode: match[1], sha: match[2], path: match[3], type: "blob" };
});
const local = new Map(entries.map((entry) => [entry.path, entry]));
const remoteBlobs = new Map(remote.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry]));
const changed = entries.filter((entry) => remoteBlobs.get(entry.path)?.sha !== entry.sha || remoteBlobs.get(entry.path)?.mode !== entry.mode);
const removed = [...remoteBlobs.keys()].filter((path) => !local.has(path));
if (removed.length) {
  throw new Error(`Remote files are missing locally; review these files before publishing: ${removed.join(", ")}`);
}
for (const filename of ["package.json", "plugin.json"]) {
  const manifest = JSON.parse(git(["cat-file", "blob", local.get(filename).sha]));
  if (manifest.version !== version) throw new Error(`${filename} must be version ${version}.`);
}
const tag = `v${version}`;
if (!syncOnly && api(`git/ref/tags/${tag}`, undefined, true)) {
  throw new Error(`${tag} already exists. Check its Release instead of creating it again.`);
}
if (dryRun) {
  console.log(JSON.stringify({ repository, expectedHead, version, syncOnly, changed: changed.map((entry) => entry.path) }, null, 2));
  process.exit(0);
}

for (const entry of changed) {
  const bytes = git(["cat-file", "blob", entry.sha], true);
  const uploaded = api("git/blobs", { encoding: "base64", content: bytes.toString("base64") });
  if (uploaded.sha !== entry.sha) throw new Error(`Uploaded blob hash differs for ${entry.path}.`);
  console.log(`Uploaded ${entry.path}`);
}
let publishedHead = head;
if (changed.length) {
  const tree = api("git/trees", { base_tree: remote.sha, tree: changed });
  const commit = api("git/commits", {
    message: syncOnly ? "Maintain direct GitHub API release workflow" : `Release ${tag}`,
    tree: tree.sha,
    parents: [head]
  });
  if (api("git/ref/heads/main").object.sha !== head) {
    throw new Error("Remote main changed during upload; no branch update was made.");
  }
  api("git/refs/heads/main", { sha: commit.sha, force: false }, false, "PATCH");
  publishedHead = commit.sha;
  console.log(`Updated main to ${publishedHead}`);
}
if (!syncOnly) {
  if (api("git/ref/heads/main").object.sha !== publishedHead) {
    throw new Error("Remote main changed before tagging; no tag was created.");
  }
  api("git/refs", { ref: `refs/tags/${tag}`, sha: publishedHead });
  console.log(`Created ${tag}; GitHub Actions will build package.zip.`);
}
