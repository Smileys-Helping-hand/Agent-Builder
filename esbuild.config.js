import { build } from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const entryPoint = path.resolve(__dirname, "dist/index.js");
const outFile = path.resolve(__dirname, "dist/server/index.js");

await fs.promises.mkdir(path.dirname(outFile), { recursive: true });

await build({
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  sourcemap: true,
  external: [
    "better-sqlite3",
    "bcrypt",
    "sqlite3"
  ]
});
