/**
 * AutoFix.fixJestDomImport on a real build: tests that died with "expect is
 * not defined" run once jest-dom is imported through its Vitest entry.
 * Pass a COPY of a build folder (with node_modules):
 *
 *   npx tsx scripts/jest-dom-check.ts <copy of builds/...>
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AutoFix } from "../src/orchestrator/AutoFix.js";

const root = path.resolve(process.argv[2] ?? "");
assert.ok(fs.existsSync(path.join(root, "package.json")), "pass a copy of a build folder");

const run = (): string => {
  try {
    return execSync("npx vitest run", { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 300_000 });
  } catch (error: any) {
    return `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
  }
};
const plain = (text: string) => text.replace(/\u001b\[[0-9;]*m/g, "");

const before = plain(run());
const deadBefore = (before.match(/ReferenceError: expect is not defined/g) ?? []).length;
console.log(`before: ${deadBefore} test file(s) die with "expect is not defined"`);

const notes = await AutoFix.fixJestDomImport(root);
console.log(notes.map((note) => `  ${note}`).join("\n"));

const after = plain(run());
const deadAfter = (after.match(/ReferenceError: expect is not defined/g) ?? []).length;
console.log(`after: ${deadAfter}; ${/Tests\s+(.+)/.exec(after)?.[1] ?? "no summary"}`);
assert.equal(deadAfter, 0);
assert.ok(notes.length >= deadBefore);
console.log("ok  every test file runs again");
