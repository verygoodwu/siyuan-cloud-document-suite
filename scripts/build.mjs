import { build } from "esbuild";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));

await build({
  absWorkingDir: process.cwd(),
  entryPoints: [resolve("src/index.ts")],
  outfile: resolve("dist/index.js"),
  bundle: true,
  platform: "browser",
  format: "cjs",
  target: "chrome120",
  external: ["siyuan"],
  minify: false,
  sourcemap: false,
  define: {
    __PLUGIN_VERSION__: JSON.stringify(packageJson.version)
  }
});
