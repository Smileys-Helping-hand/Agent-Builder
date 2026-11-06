/**
 * GameDirector — a game built continuously, for hours or days, with a
 * playable version at every milestone.
 *
 * The continuous builder does the building (roadmap, steps, checks, fixes,
 * upgrades forever, approvals). This is what makes that a game studio:
 *
 *   goal      the owner's prompt turned into a production plan: an original
 *             design, the core loop first, then content, art, animation,
 *             sound, multiplayer when asked for, polish, and upgrades
 *   seed      a new game starts from the web starter plus a real engine (Phaser
 *             3, or three.js when it is 3D: scenes, input, sound, saving, tested
 *             rules; templates/game-engines), its pictures drawn by the local
 *             image engine (ArtStudio), with ASSETS.md, and the multiplayer kit
 *             when the prompt asks for players together
 *   guide     what every step is told: the quality bar and the asset rules
 *   check     part of every check run: nothing loaded from the internet, every
 *             asset file listed in ASSETS.md with a free source (generated,
 *             procedural, original, CC0, public domain, OFL fonts), and no
 *             names from someone else's game
 *   release   after each finished milestone (and kept upgrade) the game is
 *             built and kept as the next version, playable from a link:
 *             data/game-demos/<session>/v<N>/. The newest also goes to
 *             games/made-<name>/, where SaveState's Mini Games finds it, and any
 *             version downloads as a zip that plays on its own (bundle)
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { packageTool } from "../utils/packageTool.js";
import { makeZip } from "../utils/Zip.js";
import { NetKit } from "./NetKit.js";

const run = promisify(execFile);

const DEMOS_DIR = () => path.resolve(process.env.GAME_DEMOS_DIR ?? "data/game-demos");
const STARTER_DIR = () => path.resolve(process.env.STARTERS_DIR ?? "templates/starters", "web");
const ENGINES_DIR = () => path.resolve(process.env.GAME_ENGINES_DIR ?? "templates/game-engines");
/** Where SaveState's Mini Games looks for what Agent Builder has finished. */
const SHELF_DIR = () => path.resolve(process.env.GAME_SHELF_DIR ?? "games");
export type GameEngine = "phaser" | "three";
const ENGINE_PACKAGES: Record<GameEngine, { dependencies: Record<string, string>; devDependencies: Record<string, string> }> = {
  phaser: { dependencies: { phaser: "3.80.1" }, devDependencies: {} },
  three: { dependencies: { three: "0.164.1" }, devDependencies: { "@types/three": "0.164.1" } }
};
const BUILD_LIMIT_MS = 15 * 60_000;
/** Older versions' files are let go; their records stay. */
const KEEP_VERSIONS = 25;

const GAME = /\b(games?|arcade|platformer|shooter|rpg|roguelike|roguelite|metroidvania|puzzler|racing|runner|tower defen[cs]e|strategy|base builder|survival|sandbox|card battler|fighting|bullet hell|idle|clicker)\b/i;

/** Asset files: pictures, sound, 3D models, fonts. */
const ASSET_FILE = /\.(png|jpe?g|gif|webp|avif|bmp|svg|mp3|ogg|wav|m4a|flac|glb|gltf|fbx|obj|ttf|otf|woff2?)$/i;
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|css|html|json)$/i;
const REMOTE_ASSET = /https?:\/\/[^\s"'`)]+?\.(png|jpe?g|gif|webp|avif|svg|mp3|ogg|wav|m4a|glb|gltf|fbx|obj|ttf|otf|woff2?)\b/gi;
/** Sources whose files may be shipped as they are. */
const FREE_SOURCE = /\b(generated|procedural|original|made (in|with) code|drawn in code|synthesi[sz]ed|cc0|public domain|ofl|open font licen[cs]e|agent builder)\b/i;
const NOT_FREE = /\b(cc[- ]by(?![- ]?0)|cc[- ]by[- ]sa|cc[- ]by[- ]nc|all rights reserved|royalty[- ]free|licensed from|purchased|ripped|extracted from)\b|©/i;
/** Other people's games, characters and worlds: never in an original game. */
const FRANCHISES =
  /\b(mario|luigi|bowser|pok[eé]mon|pikachu|zelda|hyrule|sonic the hedgehog|minecraft|creeper|fortnite|tetris|pac-?man|kirby|donkey kong|call of duty|overwatch|league of legends|among us|angry birds|candy crush|street fighter|mortal kombat|final fantasy|metroid|assassin'?s creed|grand theft auto|star wars|jedi|harry potter|hogwarts|spider-?man|batman|master chief|lara croft|hollow knight|stardew|terraria|undertale|cuphead)\b/i;

export interface GameRelease {
  version: number;
  /** The milestone or upgrade it shipped with. */
  title: string;
  at: string;
  commit: string | null;
  multiplayer: boolean;
  sizeKb: number;
  /** False once its files were let go to keep the newest versions. */
  kept: boolean;
}

interface ReleaseLog {
  releases: GameRelease[];
  lastError: { at: string; title: string; error: string } | null;
}

const logFile = (sessionId: string) => path.join(DEMOS_DIR(), sessionId, "releases.json");

const readLog = (sessionId: string): ReleaseLog => {
  try {
    const log = JSON.parse(fs.readFileSync(logFile(sessionId), "utf8")) as Partial<ReleaseLog>;
    return { releases: log.releases ?? [], lastError: log.lastError ?? null };
  } catch {
    return { releases: [], lastError: null };
  }
};

const writeLog = (sessionId: string, log: ReleaseLog) => {
  fs.mkdirSync(path.dirname(logFile(sessionId)), { recursive: true });
  fs.writeFileSync(logFile(sessionId), `${JSON.stringify(log, null, 2)}\n`, "utf8");
};

const walk = (root: string, dir = root, out: string[] = []): string[] => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (/^(node_modules|dist|build|out|\.git)$/.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, full, out);
    else out.push(path.relative(root, full).replace(/\\/g, "/"));
  }
  return out;
};

const folderKb = (dir: string): number =>
  Math.round(
    walk(dir)
      .map((file) => fs.statSync(path.join(dir, file)).size)
      .reduce((a, b) => a + b, 0) / 1024
  );

const ASSETS_MD = `# Assets

Every picture, sound, model and font this game ships, and where it came from. Only sources that are free to use
with no strings go in it: drawn by Agent Builder's image engine (generated), made in code (procedural), made for
this game (original), CC0 or public domain, and fonts under the OFL.

| File | What it is | Source | Licence |
| --- | --- | --- | --- |
`;

const PLAY_BAT = `@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0play.ps1"
`;
const PLAY_PS1 = `# Serves the game on this computer only, and opens it in your browser. Close this window to stop.
$root = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'game'
$types = @{ '.html'='text/html'; '.js'='text/javascript'; '.mjs'='text/javascript'; '.css'='text/css'; '.json'='application/json'; '.png'='image/png'; '.jpg'='image/jpeg'; '.jpeg'='image/jpeg'; '.webp'='image/webp'; '.svg'='image/svg+xml'; '.gif'='image/gif'; '.mp3'='audio/mpeg'; '.ogg'='audio/ogg'; '.wav'='audio/wav'; '.glb'='model/gltf-binary'; '.woff2'='font/woff2' }
$listener = New-Object Net.HttpListener
$port = 8765
while ($true) {
  try { $listener.Prefixes.Clear(); $listener.Prefixes.Add("http://localhost:$port/"); $listener.Start(); break } catch { $port++; if ($port -gt 8865) { throw } ; $listener = New-Object Net.HttpListener }
}
Write-Host "Playing at http://localhost:$port/  (close this window to stop)"
Start-Process "http://localhost:$port/"
$full = [IO.Path]::GetFullPath($root)
while ($listener.IsListening) {
  $context = $listener.GetContext()
  $path = [Uri]::UnescapeDataString($context.Request.Url.AbsolutePath).TrimStart('/')
  if ($path -eq '') { $path = 'index.html' }
  $file = [IO.Path]::GetFullPath((Join-Path $root $path))
  if ($file.StartsWith($full) -and (Test-Path $file -PathType Leaf)) {
    $bytes = [IO.File]::ReadAllBytes($file)
    $type = $types[[IO.Path]::GetExtension($file).ToLower()]
    if ($type) { $context.Response.ContentType = $type }
    $context.Response.OutputStream.Write($bytes, 0, $bytes.Length)
  } else { $context.Response.StatusCode = 404 }
  $context.Response.Close()
}
`;
const PLAY_SH = `#!/bin/sh
# Serves the game on this computer only, and opens it in your browser. Ctrl+C to stop.
cd "$(dirname "$0")/game" || exit 1
PORT=8765
(sleep 1; (xdg-open "http://localhost:$PORT/" || open "http://localhost:$PORT/") >/dev/null 2>&1) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
`;

export const GameDirector = {
  isGame(text: string): boolean {
    return GAME.test(text);
  },

  /** The engine a game is built on: three.js when it is 3D, otherwise Phaser. */
  engineFor(prompt: string): GameEngine {
    return /\b(3d|three\.?js|first[- ]person|third[- ]person|fps|open[- ]world|voxel|flight sim)\b/i.test(prompt) ? "three" : "phaser";
  },

  /** The owner's prompt as a production plan the roadmap is written from. */
  goal(prompt: string, options: { multiplayer?: boolean } = {}): string {
    const multiplayer = options.multiplayer ?? NetKit.wanted(prompt);
    return `${prompt.trim()}

Make this a complete, original, polished game, built up milestone by milestone, every milestone leaving a version that
plays from start to finish:
1. Design (GAME_DESIGN.md): an original name, world, characters and story of its own — nothing taken from an existing
   game, film or book — the core loop, controls (keyboard, mouse and touch), how it is won and lost, progression.
2. The core loop, playable: the player, the main challenge, scoring or winning and losing, restart. Fun first.
3. Content: levels or waves, enemies and items with distinct behaviour, rising difficulty, a reason to play again.
4. Art: a consistent style; every character, object and background has real art (listed in art.json so the image
   engine draws it, or drawn in code), never coloured boxes; parallax or lighting where it suits.
5. Animation: idle, move, attack, hit and death states; tweened UI; particles for impacts and pickups; screen shake;
   smooth 60 fps with delta time.
6. Sound: effects for every action and music, synthesised with the Web Audio API (no sound files needed), with a mute
   toggle.
7. Menus and feel: title screen, pause, settings, game-over and win screens, saved progress and high scores.${
      multiplayer
        ? `
8. Multiplayer with src/lib/net (already in the project): a lobby to create or join a room by code, the shared game
   as one set of host-run rules, smooth remote players, reconnecting, and what happens when someone leaves.`
        : ""
    }
${multiplayer ? 9 : 8}. Polish: tutorial or first-level teaching, juice, balance, performance on a phone, accessibility.
Then keep upgrading: new content, mechanics and modes that make it better, one milestone at a time.
Every asset file is listed in ASSETS.md with its source; nothing is loaded from the internet.`;
  },

  /** A new game's first files: the web starter, ASSETS.md, and the multiplayer kit when it is wanted. */
  seed(dir: string, name: string, prompt: string, options: { multiplayer?: boolean; engine?: GameEngine } = {}): void {
    const starter = STARTER_DIR();
    if (fs.existsSync(path.join(starter, "package.json"))) {
      fs.cpSync(starter, dir, { recursive: true, filter: (source) => !/[\\/](node_modules|dist)([\\/]|$)/.test(source) });
      // The engine: its files over the starter, and its packages.
      const engine = options.engine ?? GameDirector.engineFor(`${name} ${prompt}`);
      for (const part of ["shared", engine]) {
        const from = path.join(ENGINES_DIR(), part);
        if (fs.existsSync(from)) fs.cpSync(from, dir, { recursive: true });
      }
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { name: string; dependencies: Record<string, string>; devDependencies: Record<string, string>; engineChoice?: string };
      Object.assign(manifest.dependencies, ENGINE_PACKAGES[engine].dependencies);
      Object.assign(manifest.devDependencies, ENGINE_PACKAGES[engine].devDependencies);
      manifest.name = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "game";
      fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
      const html = name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      for (const [file, value] of [["index.html", html], ["src/App.tsx", html], ["README.md", name]] as const) {
        const target = path.join(dir, file);
        if (fs.existsSync(target)) fs.writeFileSync(target, fs.readFileSync(target, "utf8").split("__NAME__").join(value));
      }
      fs.appendFileSync(path.join(dir, "README.md"), `\n## The game\n\n${prompt.trim()}\n`, "utf8");
    }
    const ignore = path.join(dir, ".gitignore");
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "node_modules/\ndist/\n.env\n", "utf8");
    if (!fs.existsSync(path.join(dir, "ASSETS.md"))) fs.writeFileSync(path.join(dir, "ASSETS.md"), ASSETS_MD, "utf8");
    if (options.multiplayer ?? NetKit.wanted(prompt)) NetKit.install(dir);
  },

  /** What every step of a game is told, after its instruction. */
  guide(dir?: string): string {
    const engine = dir && fs.existsSync(path.join(dir, "node_modules", "three")) ? "three" : dir && fs.existsSync(path.join(dir, "src", "engine", "game.ts")) && /from "three"/.test(fs.readFileSync(path.join(dir, "src", "engine", "game.ts"), "utf8")) ? "three" : dir && fs.existsSync(path.join(dir, "src", "engine", "game.ts")) ? "phaser" : null;
    const engineNote =
      engine === "phaser"
        ? "- Engine: Phaser 3 (src/engine/game.ts: Boot, Title, Play, Over scenes). Build with its sprites, arcade physics, tweens, particles, cameras, tilemaps and scenes; do not write your own canvas loop. Rules stay in src/game/; sound in src/engine/sound.ts; saving in src/engine/save.ts.\n"
        : engine === "three"
          ? "- Engine: three.js (src/engine/game.ts: lit world, shadows, fixed-step loop, camera, HUD). Build with meshes, materials, lights and animation made in code. Rules stay in src/game/; sound in src/engine/sound.ts; saving in src/engine/save.ts.\n"
          : "";
    return `This is a game. Quality bar: it must look and feel like a finished indie game, not a one-page prototype.
${engineNote}- Several levels, scenes or areas in their own files; real game structure; never everything in one file.
- Original: its own name, characters and world. Never use names, characters, levels or art from an existing game.
- Art: real art for everything (art.json for the image engine, or drawn in code with gradients, outlines and shading);
  one consistent style and palette.
- Animation: frame or tween animation for every state, easing, particles, screen shake on impact; requestAnimationFrame
  with delta time.
- Sound: Web Audio synthesised effects and music, started on the first click or key (browsers block it before).
- Assets: never load a file from the internet. Put any file in public/ and add a row to ASSETS.md (file, what it is,
  source, licence): generated, procedural, original, CC0 or public domain only (OFL for fonts).
- Keep game rules in plain .ts modules with tests; keep it playable at the end of this step.
`;
  },

  /** What breaks the asset and originality rules, one line each; empty when it is clean. */
  assetProblems(dir: string): string[] {
    const problems: string[] = [];
    const files = walk(dir);
    const ledger = fs.existsSync(path.join(dir, "ASSETS.md")) ? fs.readFileSync(path.join(dir, "ASSETS.md"), "utf8") : null;
    let generated = new Set<string>();
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, "public", "assets", "manifest.json"), "utf8")) as { assets?: Record<string, { file?: string }> };
      generated = new Set(Object.values(manifest.assets ?? {}).map((asset) => path.basename(String(asset.file ?? ""))));
    } catch {
      // No pictures drawn yet.
    }

    for (const file of files.filter((f) => CODE_FILE.test(f) && !/(^|\/)(package(-lock)?\.json|art\.json|manifest\.json)$/.test(f))) {
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      for (const match of text.matchAll(REMOTE_ASSET)) {
        if (/fonts\.(googleapis|gstatic)\.com/.test(match[0])) continue;
        problems.push(`${file} loads ${match[0]} from the internet: make it (art.json or in code) or ship a free file in public/ and list it in ASSETS.md.`);
      }
    }

    const assets = files.filter((f) => ASSET_FILE.test(f) && /^(public|src|assets)\//.test(f));
    const unlisted = assets.filter((f) => !generated.has(path.basename(f)) && !(ledger ?? "").includes(path.basename(f)));
    if (unlisted.length) {
      problems.push(`${ledger === null ? "There is no ASSETS.md, and these" : "These"} asset files are not in ASSETS.md with their source: ${unlisted.slice(0, 12).join(", ")}${unlisted.length > 12 ? "…" : ""}.`);
    }
    for (const line of (ledger ?? "").split("\n")) {
      const named = assets.find((f) => line.includes(path.basename(f)));
      if (!named) continue;
      if (NOT_FREE.test(line) || !FREE_SOURCE.test(line)) {
        problems.push(`ASSETS.md: ${path.basename(named)} is not from a free source (generated, procedural, original, CC0, public domain, OFL): replace it. "${line.trim().slice(0, 160)}"`);
      }
    }

    const shown = ["GAME_DESIGN.md", "index.html", ...files.filter((f) => /^src\/.*\.(tsx?|jsx?)$/.test(f) && !/^src\/lib\/net\//.test(f))];
    const borrowed = new Set<string>();
    for (const file of shown) {
      const target = path.join(dir, file);
      if (!fs.existsSync(target)) continue;
      const match = fs.readFileSync(target, "utf8").match(FRANCHISES);
      if (match) borrowed.add(`${match[0]} (${file})`);
    }
    if (borrowed.size) problems.push(`Not original: it uses ${[...borrowed].slice(0, 6).join(", ")}. Give it its own names, characters and world.`);
    return problems;
  },

  /** Build the game in its workspace and keep it as the next version. */
  async release(sessionId: string, dir: string, title: string, commit: string | null, name?: string): Promise<{ release: GameRelease | null; error: string | null }> {
    const log = readLog(sessionId);
    const at = new Date().toISOString();
    try {
      if (!fs.existsSync(path.join(dir, "package.json"))) throw new Error("There is no package.json to build.");
      const options = { cwd: dir, timeout: BUILD_LIMIT_MS, maxBuffer: 20 * 1024 * 1024, windowsHide: true, shell: process.platform === "win32", env: { ...process.env, BASE_PATH: "./", NODE_ENV: "production" } };
      if (!fs.existsSync(path.join(dir, "node_modules"))) {
        const install = packageTool("npm", ["install", "--no-audit", "--no-fund"]);
        await run(install.file, install.args, { ...options, env: { ...options.env, NODE_ENV: "development" } });
      }
      const build = packageTool("npm", ["run", "build"]);
      await run(build.file, build.args, options).catch((error: { stdout?: string; stderr?: string; message?: string }) => {
        throw new Error(`The build failed: ${`${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n") || error.message}`);
      });
      const output = ["dist", "build", "out"].map((name) => path.join(dir, name)).find((folder) => fs.existsSync(path.join(folder, "index.html")));
      if (!output) throw new Error("The build made no index.html (dist/, build/ or out/).");
      const version = (log.releases[log.releases.length - 1]?.version ?? 0) + 1;
      const target = path.join(DEMOS_DIR(), sessionId, `v${version}`);
      fs.rmSync(target, { recursive: true, force: true });
      fs.cpSync(output, target, { recursive: true });
      const release: GameRelease = { version, title: title.slice(0, 200), at, commit, multiplayer: NetKit.installed(dir), sizeKb: folderKb(target), kept: true };
      log.releases.push(release);
      log.lastError = null;
      for (const old of log.releases.filter((r) => r.kept).slice(0, -KEEP_VERSIONS)) {
        fs.rmSync(path.join(DEMOS_DIR(), sessionId, `v${old.version}`), { recursive: true, force: true });
        old.kept = false;
      }
      writeLog(sessionId, log);
      // The newest version on the shelf, for SaveState's Mini Games.
      if (name) {
        const shelf = path.join(SHELF_DIR(), `made-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || sessionId}`);
        try {
          fs.rmSync(shelf, { recursive: true, force: true });
          fs.cpSync(target, shelf, { recursive: true });
        } catch {
          // The version itself is what matters.
        }
      }
      return { release, error: null };
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1500);
      log.lastError = { at, title: title.slice(0, 200), error: message };
      writeLog(sessionId, log);
      return { release: null, error: message };
    }
  },

  /** A version as a zip that plays on its own: Play.bat (Windows) or play.sh start a tiny local server and open it. */
  bundle(sessionId: string, version: number, name: string): { file: string; data: Buffer } | null {
    const folder = GameDirector.demoFolder(`${sessionId}~v${version}`);
    if (!folder) return null;
    const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "game";
    const files = walk(folder).map((file) => ({ name: `${slug}/game/${file}`, data: fs.readFileSync(path.join(folder, file)) }));
    files.push(
      { name: `${slug}/Play.bat`, data: Buffer.from(PLAY_BAT.replace(/\n/g, "\r\n")) },
      { name: `${slug}/play.ps1`, data: Buffer.from(PLAY_PS1.replace(/\n/g, "\r\n")) },
      { name: `${slug}/play.sh`, data: Buffer.from(PLAY_SH) },
      { name: `${slug}/README.txt`, data: Buffer.from(`${name}, version ${version}.\r\n\r\nWindows: double-click Play.bat.\r\nMac and Linux: sh play.sh (needs python3).\r\nIt runs on this computer and opens in your browser.\r\n`) }
    );
    return { file: `${slug}-v${version}.zip`, data: makeZip(files) };
  },

  releases(sessionId: string): ReleaseLog {
    return readLog(sessionId);
  },

  /** The folder a version is played from: id is "<session>~v<N>". */
  demoFolder(id: string): string | null {
    const match = /^([A-Za-z0-9_-]+)~v(\d+)$/.exec(id);
    if (!match) return null;
    const folder = path.join(DEMOS_DIR(), match[1], `v${match[2]}`);
    return fs.existsSync(path.join(folder, "index.html")) ? folder : null;
  }
};
