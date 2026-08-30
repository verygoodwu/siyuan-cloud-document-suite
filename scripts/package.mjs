import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const copyVersionedHtml = async (source, target) => {
  const html = (await readFile(source, "utf8"))
    .replaceAll("__PLUGIN_VERSION__", packageJson.version);
  await writeFile(target, html);
};

await mkdir("dist", { recursive: true });
await Promise.all([
  copyFile("plugin.json", "dist/plugin.json"),
  copyFile("index.css", "dist/index.css"),
  copyFile("README.md", "dist/README.md"),
  copyFile("README.zh-CN.md", "dist/README.zh-CN.md"),
  copyFile("LICENSE", "dist/LICENSE"),
  copyFile("icon.png", "dist/icon.png"),
  copyFile("preview.png", "dist/preview.png")
  ,copyVersionedHtml("static/mm-editor.html", "dist/mm-editor.html")
  ,copyFile("static/mm-editor.js", "dist/mm-editor.js")
  ,copyFile("static/mm-workspace.js", "dist/mm-workspace.js")
  ,copyFile("node_modules/mind-elixir/dist/MindElixir.js", "dist/MindElixir.js")
  ,copyFile("node_modules/mind-elixir/dist/MindElixir.css", "dist/MindElixir.css")
  ,copyVersionedHtml("static/sheet-editor.html", "dist/sheet-editor.html")
  ,copyVersionedHtml("static/sheet-editor.js", "dist/sheet-editor.js")
  ,copyFile("static/sheet-workbook.js", "dist/sheet-workbook.js")
  ,copyFile("static/siyuan-file-store.js", "dist/siyuan-file-store.js")
  ,copyFile("node_modules/xlsx/dist/xlsx.full.min.js", "dist/xlsx.full.min.js")
]);

const zip = new JSZip();
for (const entry of await readdir("dist", { withFileTypes: true })) {
  if (entry.isFile() && entry.name !== "package.zip") {
    zip.file(entry.name, await readFile(`dist/${entry.name}`));
  }
}
await writeFile("package.zip", await zip.generateAsync({
  type: "nodebuffer",
  compression: "DEFLATE",
  compressionOptions: { level: 9 }
}));
