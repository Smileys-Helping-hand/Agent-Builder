/**
 * DesktopPackage — a game version as a Windows program: a folder with an .exe that
 * opens the game in its own window (Electron), zipped. It is built on request, not
 * at every release, because it takes minutes and about 300 MB, and Electron is
 * downloaded the first time. The game is served to its window from inside the
 * program on 127.0.0.1, so everything a browser build can load works the same.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { Logger } from "../utils/Logger.js";
import { GameDirector } from "./GameDirector.js";

const DEMOS_DIR = () => path.resolve(process.env.GAME_DEMOS_DIR ?? "data/game-demos");
const ELECTRON_VERSION = "31.7.7";
const LIMIT_MS = 30 * 60_000;

export interface DesktopBuild {
  state: "building" | "done" | "failed";
  at: string;
  error: string | null;
  sizeMb: number | null;
}

const statusFile = (sessionId: string, version: number) => path.join(DEMOS_DIR(), sessionId, `windows-v${version}.json`);
export const zipFile = (sessionId: string, version: number) => path.join(DEMOS_DIR(), sessionId, `windows-v${version}.zip`);

const MAIN = `const { app, BrowserWindow } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "game");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav", ".glb": "model/gltf-binary", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  const wanted = decodeURIComponent((req.url || "/").split("?")[0]);
  const file = path.normalize(path.join(root, wanted === "/" ? "index.html" : wanted));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": types[path.extname(file).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
app.whenReady().then(() => {
  server.listen(0, "127.0.0.1", () => {
    const win = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true, title: GAME_NAME, webPreferences: { contextIsolation: true, nodeIntegration: false } });
    win.loadURL("http://127.0.0.1:" + server.address().port + "/");
  });
});
app.on("window-all-closed", () => { server.close(); app.quit(); });
`;

const run = (command: string, cwd: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = "";
    const add = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-3000);
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`It took longer than ${LIMIT_MS / 60_000} minutes.`));
    }, LIMIT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(output.split(/\r?\n/).filter(Boolean).slice(-6).join(" ").slice(-700) || `exit ${code}`));
    });
  });

export const DesktopPackage = {
  status(sessionId: string, version: number): DesktopBuild | null {
    try {
      return JSON.parse(fs.readFileSync(statusFile(sessionId, version), "utf8")) as DesktopBuild;
    } catch {
      return null;
    }
  },

  /** Starts in the background. */
  build(sessionId: string, version: number, name: string): DesktopBuild {
    const folder = GameDirector.demoFolder(`${sessionId}~v${version}`);
    if (!folder) throw new Error("That version's files are gone.");
    const current = DesktopPackage.status(sessionId, version);
    if (current?.state === "building" && Date.now() - Date.parse(current.at) < LIMIT_MS) return current;
    if (current?.state === "done" && fs.existsSync(zipFile(sessionId, version))) return current;
    const write = (build: DesktopBuild) => fs.writeFileSync(statusFile(sessionId, version), JSON.stringify(build));
    const started: DesktopBuild = { state: "building", at: new Date().toISOString(), error: null, sizeMb: null };
    write(started);
    const work = async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "game-desktop-"));
      try {
        const slug = name.replace(/[^A-Za-z0-9 ]+/g, "").trim().replace(/\s+/g, "-") || "Game";
        fs.cpSync(folder, path.join(dir, "app", "game"), { recursive: true });
        fs.writeFileSync(path.join(dir, "app", "main.js"), `const GAME_NAME = ${JSON.stringify(name)};\n${MAIN}`);
        fs.writeFileSync(path.join(dir, "app", "package.json"), JSON.stringify({ name: slug.toLowerCase(), productName: name, version: `1.0.${version}`, main: "main.js", private: true }));
        await run(`npx --yes @electron/packager@18.3.6 app "${slug}" --platform=win32 --arch=x64 --electron-version=${ELECTRON_VERSION} --out=out --overwrite --asar=false`, dir);
        const built = fs.readdirSync(path.join(dir, "out")).find((entry) => entry.startsWith(slug));
        if (!built || !fs.existsSync(path.join(dir, "out", built, `${slug}.exe`))) throw new Error("The packager made no .exe.");
        const target = zipFile(sessionId, version);
        // Windows' own tar writes zips, in its own process: this much data would stall the builder.
        await run(`tar -a -c -f "${target}" -C out "${built}"`, dir);
        write({ state: "done", at: new Date().toISOString(), error: null, sizeMb: Math.round(fs.statSync(target).size / 1048576) });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    };
    void work().catch((error) => {
      Logger.warn("Could not package a game for Windows", { error: (error as Error).message });
      write({ state: "failed", at: new Date().toISOString(), error: (error as Error).message.slice(0, 800), sizeMb: null });
    });
    return started;
  }
};
