/**
 * Smoketest: games built continuously (src/game/GameDirector.ts), without a
 * model, in a temporary folder:
 *   - a prompt becomes a production plan, with multiplayer when it asks for it
 *   - a new game starts from the web starter with ASSETS.md and, when wanted, the multiplayer kit
 *   - the asset and originality rules: internet assets, unlisted or non-free files,
 *     someone else's characters; drawn-by-the-engine and CC0 files pass
 *   - a game session's checks include those rules
 *   - a finished milestone is released as the next playable version, and a build that fails says why
 *
 *   npx tsx scripts/game-director-smoketest.ts
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const repo = process.cwd();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "game-director-"));
process.chdir(tmp); // data/ and builds/ stay out of the real ones
process.env.STARTERS_DIR = path.join(repo, "templates", "starters");
process.env.NET_KIT_DIR = path.join(repo, "templates", "net-kit");
process.env.GAME_ENGINES_DIR = path.join(repo, "templates", "game-engines");
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";
process.env.MODEL_PROVIDER = "lmstudio";
process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
process.env.MODEL_WAIT_MS = "0";
process.env.CONTINUOUS_NO_LOOP = "1";
process.env.CONTINUOUS_NEW_PROJECTS_DIR = path.join(tmp, "new-projects");
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Smoketest";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "smoketest@example.com";

const fail = (message: string): never => {
  throw new Error(message);
};
const write = (file: string, text: string) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

const main = async () => {
  const { GameDirector } = await import("../src/game/GameDirector.js");
  const { ContinuousImprover } = await import("../src/agent/ContinuousImprover.js");
  const hooks = ContinuousImprover.testHooks;

  // 1. The plan.
  const solo = GameDirector.goal("A cosy farming game with seasons");
  const online = GameDirector.goal("A co-op dungeon crawler for 4 friends online");
  if (!/GAME_DESIGN\.md/.test(solo) || !/original/i.test(solo) || /src\/lib\/net/.test(solo)) fail(`solo plan: ${solo}`);
  if (!/src\/lib\/net/.test(online) || !/lobby/.test(online)) fail("the online plan has no multiplayer");
  if (!GameDirector.isGame("a roguelike with bosses") || GameDirector.isGame("an invoicing dashboard")) fail("isGame misjudged");
  console.log("[PASS] a prompt becomes a production plan, with multiplayer when it asks for it");

  // 2. A new game's first files.
  const game = path.join(tmp, "seeded");
  fs.mkdirSync(game);
  GameDirector.seed(game, "Ember Hollow", "A co-op dungeon crawler online");
  for (const file of ["package.json", "vite.config.ts", "src/App.tsx", "src/lib/art.ts", "ASSETS.md", ".gitignore", "src/lib/net/index.ts", "server/room-server.mjs"]) {
    if (!fs.existsSync(path.join(game, file))) fail(`the new game has no ${file}`);
  }
  if (!fs.readFileSync(path.join(game, "README.md"), "utf8").includes("Ember Hollow")) fail("the README was not named");
  const solitary = path.join(tmp, "solitary");
  fs.mkdirSync(solitary);
  GameDirector.seed(solitary, "Quiet Fields", "A cosy farming game");
  if (fs.existsSync(path.join(solitary, "src", "lib", "net"))) fail("a single-player game got the multiplayer kit");
  console.log("[PASS] a new game starts from the starter, with ASSETS.md, and the multiplayer kit only when wanted");

  // 3. The asset rules.
  const clean = GameDirector.assetProblems(game);
  if (clean.length) fail(`a fresh game has problems: ${clean.join(" | ")}`);
  write(path.join(game, "src", "Sky.ts"), `export const sky = "https://example.com/art/sky.png";\n`);
  if (!GameDirector.assetProblems(game).some((p) => /from the internet/.test(p))) fail("an internet asset passed");
  fs.rmSync(path.join(game, "src", "Sky.ts"));
  write(path.join(game, "public", "hero.png"), "png");
  if (!GameDirector.assetProblems(game).some((p) => /not in ASSETS\.md/.test(p))) fail("an unlisted file passed");
  fs.appendFileSync(path.join(game, "ASSETS.md"), "| hero.png | the hero | an asset store | CC-BY 4.0 |\n");
  if (!GameDirector.assetProblems(game).some((p) => /not from a free source/.test(p))) fail("a CC-BY file passed");
  fs.writeFileSync(path.join(game, "ASSETS.md"), fs.readFileSync(path.join(game, "ASSETS.md"), "utf8").replace("an asset store | CC-BY 4.0", "drawn for this game | CC0"));
  write(path.join(game, "public", "assets", "slime.png"), "png");
  write(path.join(game, "public", "assets", "manifest.json"), JSON.stringify({ assets: { slime: { file: "assets/slime.png" } } }));
  const listed = GameDirector.assetProblems(game);
  if (listed.length) fail(`CC0 and engine-drawn files should pass: ${listed.join(" | ")}`);
  write(path.join(game, "src", "Hero.ts"), `export const hero = { name: "Pikachu" };\n`);
  if (!GameDirector.assetProblems(game).some((p) => /Not original/.test(p))) fail("someone else's character passed");
  fs.rmSync(path.join(game, "src", "Hero.ts"));
  console.log("[PASS] assets: nothing from the internet, every file listed with a free source, nothing from someone else's game");

  // 4. A game session: its checks include the rules, and a finished milestone is released.
  const session = await ContinuousImprover.startNew("Tiny Arena", { goal: "A small arena shooter game with waves of enemies", kind: "game" });
  if (session.kind !== "game" || !/GAME_DESIGN\.md/.test(session.goal)) fail(`the session is not a game: ${session.kind}`);
  const project = path.join(tmp, "new-projects", "Tiny-Arena");
  if (!fs.existsSync(path.join(project, "ASSETS.md")) || !fs.existsSync(path.join(project, "src", "lib", "art.ts"))) fail("the new game was not seeded");
  // A workspace stand-in whose build is quick: no install, a build that writes dist/index.html.
  const ws = path.join(tmp, "ws");
  fs.mkdirSync(path.join(ws, "node_modules"), { recursive: true });
  write(path.join(ws, "package.json"), JSON.stringify({ name: "w", private: true, scripts: { build: "node build.js" } }));
  write(path.join(ws, "build.js"), `require("fs").mkdirSync("dist",{recursive:true});require("fs").writeFileSync("dist/index.html","<!doctype html><title>Tiny Arena</title><canvas></canvas>");\n`);
  write(path.join(ws, "ASSETS.md"), "# Assets\n");
  write(path.join(ws, "public", "boom.wav"), "wav");
  git(ws, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(ws, ".gitignore"), "node_modules/\ndist/\n");
  git(ws, "add", "-A");
  git(ws, "commit", "-q", "-m", "ws");
  hooks.patchSession(session.id, { workspace: { dir: ws, baseCommit: git(ws, "rev-parse", "HEAD"), approvedCommit: git(ws, "rev-parse", "HEAD") } });
  const check = await hooks.runChecks(hooks.getSession(session.id)!, ws);
  if (!check.failing.includes("assets and originality") || !/boom\.wav/.test(check.output)) fail(`the checks missed the asset rules: ${JSON.stringify(check.failing)}`);
  console.log("[PASS] a game session's checks include the asset rules");

  await hooks.releaseIfGame(session.id, "Waves of enemies");
  await hooks.releaseIfGame(session.id, "A boss every fifth wave");
  const log = GameDirector.releases(session.id);
  if (log.releases.length !== 2 || log.releases[1].version !== 2 || log.releases[1].title !== "A boss every fifth wave") fail(`releases: ${JSON.stringify(log)}`);
  const folder = GameDirector.demoFolder(`${session.id}~v2`);
  if (!folder || !fs.readFileSync(path.join(folder, "index.html"), "utf8").includes("Tiny Arena")) fail("version 2 cannot be played");
  if (GameDirector.demoFolder(`${session.id}~v9`) || GameDirector.demoFolder("../etc~v1")) fail("a missing or crooked version resolved");
  const after = hooks.getSession(session.id)!;
  if (after.lastRelease?.version !== 2 || !after.journal.some((s) => /Released version 2/.test(s.title))) fail("the session does not show the release");
  console.log("[PASS] each finished milestone is released as the next playable version");

  // It downloads, and the shelf SaveState reads has the newest.
  const bundle = GameDirector.bundle(session.id, 2, "Tiny Arena")!;
  const names = bundle.data.toString("latin1");
  if (bundle.file !== "Tiny-Arena-v2.zip" || bundle.data.subarray(0, 2).toString() !== "PK") fail(`bundle: ${bundle.file}`);
  for (const name of ["Tiny-Arena/game/index.html", "Tiny-Arena/Play.bat", "Tiny-Arena/play.ps1", "Tiny-Arena/play.sh", "Tiny-Arena/README.txt"]) if (!names.includes(name)) fail(`the zip has no ${name}`);
  if (GameDirector.bundle(session.id, 9, "x")) fail("a version that does not exist was bundled");
  const shelf = path.join(tmp, "games", "made-tiny-arena", "index.html");
  if (!fs.existsSync(shelf) || !fs.readFileSync(shelf, "utf8").includes("Tiny Arena")) fail("the newest version is not on the shelf for SaveState");
  console.log("[PASS] a version downloads as a zip that plays on its own; the newest is on the shelf SaveState reads");

  // The engine: Phaser for 2D, three.js for 3D, its files and packages in the new game.
  const twoD = path.join(tmp, "two-d");
  fs.mkdirSync(twoD);
  GameDirector.seed(twoD, "Flat", "A platformer about a fox");
  const threeD = path.join(tmp, "three-d");
  fs.mkdirSync(threeD);
  GameDirector.seed(threeD, "Deep", "A 3D open world survival game");
  const deps = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).dependencies as Record<string, string>;
  if (!deps(twoD).phaser || deps(twoD).three || !fs.readFileSync(path.join(twoD, "src", "engine", "game.ts"), "utf8").includes("Phaser")) fail("the 2D game is not on Phaser");
  if (!deps(threeD).three || deps(threeD).phaser || !fs.readFileSync(path.join(threeD, "src", "engine", "game.ts"), "utf8").includes("THREE")) fail("the 3D game is not on three.js");
  if (!/Phaser 3/.test(GameDirector.guide(twoD)) || !/three\.js/.test(GameDirector.guide(threeD))) fail("the guide does not name the engine");
  console.log("[PASS] a new game gets a real engine: Phaser for 2D, three.js for 3D");

  write(path.join(ws, "build.js"), `process.stderr.write("TS2304: Cannot find name 'enemy'");process.exit(1);\n`);
  await hooks.releaseIfGame(session.id, "Broken step");
  const broken = hooks.getSession(session.id)!;
  if (!broken.releaseError || !/enemy/.test(broken.releaseError) || GameDirector.releases(session.id).releases.length !== 2) fail(`a failed build: ${broken.releaseError}`);
  console.log("[PASS] a release whose build fails says why, and takes no version number");

  console.log("All game director checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Game director smoketest failed:", error?.message ?? error);
    finish(1);
  });
