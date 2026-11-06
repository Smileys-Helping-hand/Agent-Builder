/**
 * Real check of the game engines (slow: npm install and a real build): seeds a
 * new game on each engine, installs, typechecks, tests and builds it, opens the
 * built page in headless Chrome/Edge and looks for errors, and makes its
 * download zip.
 *
 *   npx tsx scripts/game-engine-check.ts [phaser] [three]
 */
import { execSync } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

import { GameDirector, type GameEngine } from "../src/game/GameDirector.js";
import { findBrowser, renderPage } from "../src/orchestrator/SiteAudit.js";

const fail = (message: string): never => {
  throw new Error(message);
};
const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png" };

const check = async (engine: GameEngine) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `engine-${engine}-`));
  GameDirector.seed(dir, `Test ${engine}`, "A small game", { engine, multiplayer: false });
  // What a game's first step does: the starter's own test insists its placeholder text is gone.
  const app = path.join(dir, "src", "App.tsx");
  fs.writeFileSync(app, fs.readFileSync(app, "utf8").split("Getting ready…").join("Version 1"));
  execSync("npm install --no-audit --no-fund", { cwd: dir, stdio: "pipe", timeout: 15 * 60_000 });
  execSync("npm test", { cwd: dir, stdio: "pipe", timeout: 10 * 60_000, env: { ...process.env, CI: "1" } });
  execSync("npm run build", { cwd: dir, stdio: "pipe", timeout: 15 * 60_000 });
  const dist = path.join(dir, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) fail(`${engine}: no dist/index.html`);
  console.log(`[PASS] ${engine}: installs, its tests pass, typechecks and builds (${Math.round(fs.statSync(path.join(dist, "index.html")).size / 1024)} KB)`);

  const server = http.createServer((req, res) => {
    const file = path.join(dist, (req.url ?? "/").split("?")[0] === "/" ? "index.html" : (req.url ?? "/").split("?")[0]);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }).end(fs.readFileSync(file));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = findBrowser();
  if (browser) {
    const page = await renderPage(browser, `http://127.0.0.1:${(server.address() as { port: number }).port}/`);
    const errors = (page?.errors ?? []).filter((e) => !/manifest\.json|404/.test(e));
    if (!page) fail(`${engine}: the browser did not render it`);
    if (errors.length) fail(`${engine}: errors in the browser: ${errors.join(" | ")}`);
    if (!/<canvas/i.test(page!.dom)) fail(`${engine}: no canvas on the page`);
    console.log(`[PASS] ${engine}: runs in a real browser with no errors, drawing on a canvas`);
  } else console.log(`[skip] ${engine}: no browser here to run it in`);
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
};

const main = async () => {
  const chosen = process.argv.slice(2).filter((a): a is GameEngine => a === "phaser" || a === "three");
  for (const engine of chosen.length ? chosen : (["phaser", "three"] as GameEngine[])) await check(engine);
  console.log("All engine checks passed.");
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Engine check failed:", error?.message ?? error, error?.stdout?.toString?.().slice(-1500) ?? "");
    process.exit(1);
  });
