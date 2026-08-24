import { build } from "esbuild";
import { resolve } from "node:path";

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
  sourcemap: false
});
