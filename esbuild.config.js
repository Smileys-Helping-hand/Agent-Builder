import { build } from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// dist/server/server.js is tsc's output for src/server/server.ts — the actual
// API entry point. This previously bundled dist/index.js (the one-shot demo
// entry) and wrote it to dist/server/index.js, so the "server bundle" was
// never the server.
const entryPoint = path.resolve(__dirname, "dist/server/server.js");
const outFile = path.resolve(__dirname, "dist/bundle/server.js");

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
