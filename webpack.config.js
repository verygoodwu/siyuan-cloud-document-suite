const path = require("path");
const CopyPlugin = require("copy-webpack-plugin");
const ZipPlugin = require("zip-webpack-plugin");
const { EsbuildPlugin } = require("esbuild-loader");

module.exports = (_env, argv) => {
  const production = argv.mode === "production";
  const outputDirectory = production ? "dist" : ".";

  return {
    mode: argv.mode || "development",
    devtool: production ? false : "inline-source-map",
    entry: {
      index: {
        import: "./src/index.ts",
        library: {
          type: "commonjs2",
          export: "default"
        }
      }
    },
    output: {
      filename: `${outputDirectory}/index.js`,
      path: __dirname,
      clean: false
    },
    externals: { siyuan: "siyuan" },
    resolve: { extensions: [".ts", ".js"] },
    module: {
      rules: [
        {
          test: /\.ts$/,
          include: path.resolve(__dirname, "src"),
          loader: "esbuild-loader",
          options: { target: "es2020" }
        }
      ]
    },
    optimization: {
      minimize: production,
      minimizer: [new EsbuildPlugin({ target: "es2020" })]
    },
    plugins: [
      ...(production
        ? [
            new CopyPlugin({
              patterns: [
                { from: "plugin.json", to: "dist/plugin.json" },
                { from: "README.md", to: "dist/README.md" },
                { from: "README.zh-CN.md", to: "dist/README.zh-CN.md" }
              ]
            }),
            new ZipPlugin({
              filename: "package.zip",
              include: [/dist/],
              pathMapper: (assetPath) => assetPath.replace(/^dist\//, "")
            })
          ]
        : [])
    ]
  };
};
