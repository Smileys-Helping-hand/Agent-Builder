/**
 * Carrying a build on starts from its best code, and never runs git where a
 * build folder has no repository of its own.
 *
 *   npx tsx scripts/carry-on-check.ts
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { bestCode, resetFolder, type BuildRecord } from "../src/orchestrator/BuildService.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-carry-"));
git(dir, "init", "-q");
git(dir, "config", "user.email", "t@t");
git(dir, "config", "user.name", "t");
const commit = (text: string) => {
  fs.writeFileSync(path.join(dir, "app.ts"), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-qm", text);
  return git(dir, "rev-parse", "HEAD");
};
const at77 = commit("at 77");
const at55 = commit("at 55, half changed");

const record = (over: Partial<BuildRecord>): BuildRecord =>
  ({ buildId: "b1", outputDir: dir, iterationDetail: [], continuedFrom: null, startScore: null, ...over }) as BuildRecord;
const pass = (iteration: number, qualityScore: number, c: string) => ({ iteration, qualityScore, commit: c }) as BuildRecord["iterationDetail"][number];

// The best pass wins; the starting point when no pass beat it.
assert.deepEqual(bestCode(record({ iterationDetail: [pass(1, 77, at77), pass(2, 55, at55)] })), { commit: at77, score: 77 });
assert.deepEqual(bestCode(record({ startScore: { score: 77, passed: false, commit: at77 }, iterationDetail: [pass(1, 55, at55)] })), { commit: at77, score: 77 });
console.log("ok  the best code is the best pass, or the starting point when no pass beat it");

// Reset puts the folder back; a second reset to the same place does nothing.
assert.equal(resetFolder(dir, at77), true);
assert.equal(fs.readFileSync(path.join(dir, "app.ts"), "utf8"), "at 77");
assert.equal(resetFolder(dir, at77), false);
console.log("ok  the folder is put back to its best code");

// Never in a folder without its own repository (it would be the builder's).
const inner = path.join(dir, "builds", "new_app");
fs.mkdirSync(inner, { recursive: true });
assert.equal(resetFolder(inner, at55), false);
assert.equal(fs.readFileSync(path.join(dir, "app.ts"), "utf8"), "at 77", "the parent repository was not touched");
assert.equal(resetFolder(dir, "not-a-commit"), false);
console.log("ok  never runs git in a folder without its own repository, nor on a made-up commit");
fs.rmSync(dir, { recursive: true, force: true });
