/**
 * The model-free doctors and the repair ledger, on throwaway projects shaped
 * like the real failures (Lanternfall's Vue stack, Driftworks' missing package,
 * NexusOS's JSX in a .ts file).
 *
 *   npm run test:repair-doctors
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-doctors-"));
process.env.REPAIR_LEDGER_PATH = path.join(dir, "ledger.jsonl");
process.env.REPAIR_BUDGET = "3";

const { diagnoseInstall, InstallDoctor } = await import("../src/repair/InstallDoctor.js");
const SourceDoctorModule = await import("../src/repair/SourceDoctor.js");
const { SourceDoctor, looksLikeJsx, tsFilesWithJsxErrors } = SourceDoctorModule;
const { RepairLedger, patchHash, resultOf } = await import("../src/repair/RepairLedger.js");
const { madeWorse } = await import("../src/agent/ContinuousImprover.js");

let passed = 0;
const check = async (name: string, fn: () => unknown | Promise<unknown>) => {
  await fn();
  passed++;
  console.log(`[PASS] ${name}`);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString();

const ERESOLVE = `npm error code ERESOLVE
npm error ERESOLVE unable to resolve dependency tree
npm error While resolving: lanternfall@1.0.0
npm error Found: vite@5.4.21
npm error Could not resolve dependency:
npm error peer vite@"^3.0.0" from @vitejs/plugin-vue@3.2.0
npm error node_modules/@vitejs/plugin-vue`;
const E404 = `npm error code E404
npm error 404 Not Found - GET https://registry.npmjs.org/vite-plugin-livereload - Not found
npm error 404  The requested resource 'vite-plugin-livereload@^1.0.3' could not be found`;

await check("npm's errors are read: a missing package, a peer conflict, and the PC's own problems", () => {
  assert.deepEqual(diagnoseInstall(E404), { problem: "missing-package", packages: ["vite-plugin-livereload"], detail: "a package that does not exist on npm" });
  const conflict = diagnoseInstall(ERESOLVE);
  assert.equal(conflict.problem, "conflict");
  assert.deepEqual(conflict.packages, ["@vitejs/plugin-vue"]);
  assert.equal(diagnoseInstall("npm error code ENOSPC\nnpm error nospc ENOSPC: no space left on device").problem, "environment");
  assert.equal(diagnoseInstall("npm error code ECONNRESET\nnpm error network").problem, "environment");
  assert.equal(diagnoseInstall("npm error No matching version found for phaser@9.9.9.").packages[0], "phaser");
  assert.equal(diagnoseInstall("npm error 404 Not Found - GET https://registry.npmjs.org/@scope%2fthing - Not found").packages[0], "@scope/thing");
});

const project = (name: string, base: Record<string, string>, later: Record<string, string>, files: Record<string, string>) => {
  const root = path.join(dir, name);
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name, scripts: { test: "vitest run", typecheck: "tsc --noEmit" }, dependencies: base }, null, 2));
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name, scripts: { test: "vitest run", typecheck: "tsc --noEmit" }, dependencies: base, devDependencies: later }, null, 2));
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(root, file), text);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "a repair that added packages");
  return root;
};

await check("a broken install is fixed by removing what was added since the start and is not used; what the code uses is kept", async () => {
  const root = project(
    "game",
    { phaser: "3.80.1", vite: "^5.4.11" },
    { vue: "^3.2.37", "@vitejs/plugin-vue": "^3.0.0", "vue-router": "^4.1.5", howler: "^2.2.4", vitest: "^2.1.8", typescript: "^5.6.3", "eslint-plugin-react": "^7.0.0", "@types/howler": "^2.2.11" },
    { "src/main.ts": `import Phaser from "phaser";\nimport { Howl } from "howler";\nexport const game = new Phaser.Game({});\n`, "vite.config.ts": `import { defineConfig } from "vite";\nexport default defineConfig({ plugins: [] });\n` }
  );
  const dry = await InstallDoctor.repair(root, ERESOLVE, null, { dryRun: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).devDependencies.vue, "^3.2.37", "a dry run writes nothing");
  const fix = await InstallDoctor.repair(root, ERESOLVE);
  assert.deepEqual(fix.removed, dry.removed);
  assert.deepEqual(fix.removed, ["@vitejs/plugin-vue", "eslint-plugin-react", "vue", "vue-router"]);
  assert.deepEqual(fix.keptInUse.sort(), ["@types/howler", "howler", "typescript", "vitest"], "imports, their types and the tools the scripts run stay");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies.phaser, "3.80.1", "nothing from the start is touched");
  assert.equal(pkg.devDependencies.vue, undefined);
});

await check("the PC's problems change nothing in the project", async () => {
  const root = project("pc", { phaser: "3.80.1" }, { vue: "^3" }, {});
  const before = fs.readFileSync(path.join(root, "package.json"), "utf8");
  const fix = await InstallDoctor.repair(root, "npm error code ENOSPC: no space left on device");
  assert.equal(fix.changed, false);
  assert.match(fix.summary, /because of the PC/);
  assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), before);
});

const TYPECHECK = `src/app/ai-assistant/page.ts(12,17): error TS1005: ')' expected.\nsrc/app/ai-assistant/page.ts(12,30): error TS1161: Unterminated regular expression literal.\nsrc/app/lone.ts(3,5): error TS1005: ';' expected.\nsrc/lib/types.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.`;

await check("JSX in a .ts file: a stray duplicate is removed, a lone one renamed, everything else left alone", () => {
  const root = path.join(dir, "nexus");
  fs.mkdirSync(path.join(root, "src", "app", "ai-assistant"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "lib"), { recursive: true });
  const jsx = `import { useState } from "react";\nconst Page = () => {\n  return (\n    <div className="x">hi</div>\n  );\n};\nexport default Page;\n`;
  fs.writeFileSync(path.join(root, "src/app/ai-assistant/page.ts"), jsx);
  fs.writeFileSync(path.join(root, "src/app/ai-assistant/page.tsx"), jsx);
  fs.writeFileSync(path.join(root, "src/app/lone.ts"), jsx);
  fs.writeFileSync(path.join(root, "src/lib/types.ts"), "export const xs: Array<string> = [];\nexport const ok = 1 < 2 && 3 > 2;\n");
  assert.deepEqual(tsFilesWithJsxErrors(TYPECHECK), ["src/app/ai-assistant/page.ts", "src/app/lone.ts"], "only syntax errors count, not type errors");
  assert.equal(looksLikeJsx("export const xs: Array<string> = []; const y = a < b && c > d;"), false, "generics and comparisons are not JSX");
  const fix = SourceDoctor.fixJsxInTs(root, TYPECHECK);
  assert.equal(fix.actions.length, 2);
  assert.ok(!fs.existsSync(path.join(root, "src/app/ai-assistant/page.ts")) && fs.existsSync(path.join(root, "src/app/ai-assistant/page.tsx")));
  assert.ok(fs.existsSync(path.join(root, "src/app/lone.tsx")) && !fs.existsSync(path.join(root, "src/app/lone.ts")));
  assert.ok(fs.existsSync(path.join(root, "src/lib/types.ts")), "a file without JSX is never touched");
});

await check("a tsconfig with paths but no baseUrl (TS5090) gets one; a rewritten core module is restored from the starting point", () => {
  const root = path.join(dir, "nexus2");
  const lines = (...parts: string[]) => parts.join("\n") + "\n";
  fs.mkdirSync(path.join(root, "src", "utils"), { recursive: true });
  fs.writeFileSync(path.join(root, "tsconfig.json"), lines("{", '  "compilerOptions": {', '    "strict": true,', '    "paths": { "@/*": ["src/*"] }', "  }", "}"));
  const fixed = SourceDoctor.fixTsconfigBaseUrl(root, "tsconfig.json(4,16): error TS5090: Non-relative paths are not allowed when 'baseUrl' is not set.");
  assert.equal(fixed.changed, true);
  assert.match(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"), /"baseUrl": "\."/);
  JSON.parse(fs.readFileSync(path.join(root, "tsconfig.json"), "utf8"));
  assert.equal(SourceDoctor.fixTsconfigBaseUrl(root, "tsconfig.json(4,16): error TS5090: x").changed, false, "never twice");
  fs.writeFileSync(path.join(root, "src/utils/Logger.ts"), lines("export class Logger {", "  static warn(...a: unknown[]) {}", "  static log(...a: unknown[]) {}", "}"));
  fs.writeFileSync(path.join(root, "src/app.ts"), lines('import { Logger } from "./utils/Logger";', 'Logger.warn("x");'));
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
  const base = git(root, "rev-parse", "HEAD").trim();
  fs.writeFileSync(path.join(root, "src/utils/Logger.ts"), lines("export class Logger {", "  constructor(private name: string) {}", "}"));
  fs.mkdirSync(path.join(root, "src/build"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/build/Logger.ts"), lines("export class Logger {}"));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "a step rewrote the Logger");
  const errors = Array.from({ length: 9 }, (_, i) => `src/app.ts(${i + 2},8): error TS2339: Property 'warn' does not exist on type 'typeof Logger'.`);
  assert.equal(SourceDoctor.restoreRewrittenModules(root, errors.slice(0, 3).join("\n"), base).changed, false, "a few errors are not enough");
  const restored = SourceDoctor.restoreRewrittenModules(root, errors.join("\n"), base);
  assert.equal(restored.changed, true);
  assert.match(restored.summary, /src\/utils\/Logger\.ts/, "the file that defined it at the start, not a new one with the same name");
  assert.match(fs.readFileSync(path.join(root, "src/utils/Logger.ts"), "utf8"), /static warn/);
});

await check("no restore without evidence: an import is not a declaration, and the good version must have the missing members", () => {
  const { declares } = SourceDoctorModule;
  assert.equal(declares('import { addScore, type GameState } from "../game/rules";', "GameState"), false, "an import of a type is not its declaration");
  assert.equal(declares("export interface GameState {\n  lives: number;\n}", "GameState"), true);
  const root = path.join(dir, "game3");
  const lines = (...parts: string[]) => parts.join("\n") + "\n";
  fs.mkdirSync(path.join(root, "src", "game"), { recursive: true });
  fs.mkdirSync(path.join(root, "src", "engine"), { recursive: true });
  fs.writeFileSync(path.join(root, "src/game/rules.ts"), lines("export interface GameState {", "  lit: string[];", "  tide: number;", "}"));
  fs.writeFileSync(path.join(root, "src/engine/game.ts"), lines('import { type GameState } from "../game/rules";', "export const show = (s: GameState) => s.lit.length + s.tide;"));
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "a good version");
  const good = git(root, "rev-parse", "HEAD").trim();
  // A later step makes the engine expect members the rules never had (score, level): the rules were not rewritten.
  fs.writeFileSync(path.join(root, "src/engine/game.ts"), lines('import { type GameState } from "../game/rules";', "export const show = (s: GameState) => s.score + s.level;"));
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "Iteration 1: repair attempt 1 (typecheck)");
  const errors = Array.from({ length: 10 }, (_, i) => `src/engine/game.ts(${i + 2},5): error TS2339: Property '${i % 2 ? "score" : "level"}' does not exist on type 'GameState'.`).join("\n");
  const result = SourceDoctor.restoreRewrittenModules(root, errors, good);
  assert.equal(result.changed, false, "the good version of the rules never had score or level: nothing to restore");
  assert.match(fs.readFileSync(path.join(root, "src/engine/game.ts"), "utf8"), /s\.score/, "and the engine is not reverted for importing the type");
});

await check("a stopped build writes nothing: an answer that arrives after the stop does not land", async () => {
  const { Workspace } = await import("../src/orchestrator/Workspace.js");
  const root = path.join(dir, "frozen");
  fs.mkdirSync(root, { recursive: true });
  const workspace = new Workspace(root);
  await workspace.writeFiles({ "a.txt": "before" }, "first");
  workspace.freeze();
  const late = await workspace.writeFiles({ "a.txt": "after the stop" }, "Iteration 1: repair attempt 1");
  assert.deepEqual(late.writtenPaths, []);
  assert.equal(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "before");
  assert.equal(await workspace.commitCurrentState("late"), undefined);
});

await check("a step that leaves the checks worse is recognised: a new failing check, a newly broken project, or more errors", () => {
  const base = { passed: false, failing: ["typecheck"], output: "a.ts(1,1): error TS1: x\n" };
  assert.equal(madeWorse({ passed: true, failing: [], output: "" }, { passed: false, failing: ["typecheck"], output: "x" }), true);
  assert.equal(madeWorse(base, { passed: false, failing: ["typecheck", "install"], output: "" }), true);
  assert.equal(madeWorse(base, { passed: false, failing: ["typecheck"], output: Array.from({ length: 6 }, (_, i) => `a.ts(${i},1): error TS${i}: y`).join("\n") }), true);
  assert.equal(madeWorse(base, { passed: false, failing: ["typecheck"], output: "a.ts(1,1): error TS1: x\n" }), false, "the same failure is not worse");
  assert.equal(madeWorse(base, { passed: true, failing: [], output: "" }), false);
  assert.equal(madeWorse(null, { passed: false, failing: ["typecheck"], output: "" }), false, "with nothing to compare, it is not judged worse");
  // Fixing install lets typecheck, build and test run for the first time: progress, not a regression.
  assert.equal(madeWorse({ passed: false, failing: ["install"], output: "npm error" }, { passed: false, failing: ["typecheck", "build", "test"], output: "a.ts(1,1): error TS1: x" }), false);
  assert.equal(madeWorse({ passed: false, failing: ["test"], output: "" }, { passed: false, failing: ["install"], output: "" }), true, "breaking install is worse than a failing test");
});

await check("the repair ledger: the history is briefed, an identical failed patch is a repeat, and the budget stops the loop", () => {
  const a = { "src/a.ts": "one" };
  const b = { "src/a.ts": "two" };
  const first = patchHash(a, b);
  assert.deepEqual(first.files, ["src/a.ts"]);
  assert.equal(first.hash, patchHash(a, { "src/a.ts": "two" }).hash, "the same change hashes the same");
  assert.notEqual(first.hash, patchHash(a, { "src/a.ts": "three" }).hash);
  assert.equal(resultOf(5, 5, false), "same");
  assert.equal(resultOf(5, 2, false), "better");
  assert.equal(resultOf(5, 0, true), "fixed");
  const fp = "fp-test";
  RepairLedger.record({ project: "p", fingerprint: fp, check: "typecheck", by: "build repair", files: first.files, patchHash: first.hash, errorsBefore: 3, errorsAfter: 3, result: "same" });
  assert.ok(RepairLedger.repeated(fp, first.hash), "the same patch again is a repeat");
  assert.equal(RepairLedger.repeated("other", first.hash), null, "only for the same errors");
  const brief = RepairLedger.brief(fp, "p");
  assert.match(brief, /Already tried for these same errors/);
  assert.match(brief, /src\/a\.ts; changed nothing/);
  assert.match(brief, /Do not repeat/);
  assert.equal(RepairLedger.stuck(fp, "p").stuck, false);
  RepairLedger.record({ project: "p", fingerprint: fp, check: "typecheck", by: "build repair", files: [], patchHash: "x", errorsBefore: 3, errorsAfter: 4, result: "worse" });
  RepairLedger.record({ project: "p", fingerprint: fp, check: "typecheck", by: "build repair", files: [], patchHash: "y", errorsBefore: 3, errorsAfter: 3, result: "repeat" });
  assert.equal(RepairLedger.stuck(fp, "p").stuck, true, "three failed attempts spend a budget of three");
  assert.equal(RepairLedger.stuck(fp, "other-project").stuck, false, "the budget is per project");
  RepairLedger._reset();
  assert.equal(RepairLedger.history(fp).length, 3, "it is kept on disk");
});

console.log(`\nAll ${passed} repair checks passed.`);
process.exit(0);
