/**
 * DisputedTests on a real build, and on a small made-up one. Pass a COPY of a
 * build folder whose tests fail (with node_modules):
 *
 *   npx tsx scripts/disputed-tests-check.ts <copy of builds/...>
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { failingCases, onlyAssertions, setAside, sharedStateHint } from "../src/orchestrator/DisputedTests.js";

const root = path.resolve(process.argv[2] ?? "");
assert.ok(fs.existsSync(path.join(root, "package.json")), "pass a copy of a build folder");

const test = (): { ok: boolean; output: string } => {
  try {
    return { ok: true, output: execSync("npm test", { cwd: root, encoding: "utf8", stdio: "pipe", timeout: 300_000 }) };
  } catch (error: any) {
    return { ok: false, output: `${error.stdout ?? ""}\n${error.stderr ?? ""}` };
  }
};

const before = test();
console.log(`real build: tests ${before.ok ? "pass" : "fail"}`);
if (!before.ok) {
  assert.ok(onlyAssertions(before.output), "its failures are assertions, not crashes");
  const cases = failingCases(before.output);
  const total = (fs.readFileSync(path.join(root, cases[0].file), "utf8").match(/\b(?:it|test)\s*\(/g) ?? []).length;
  const hint = sharedStateHint(root, before.output);
  console.log(`  ${cases.length} of ${total} failing; hint: ${hint.trim().slice(0, 140)}…`);
  const set = setAside(root, before.output);
  if (cases.length > 3 || cases.length > total / 2) {
    // Half the tests failing is not a disagreement to set aside: the repair is told about the shared data instead.
    assert.equal(set, null);
    assert.match(hint, /top-level variable/);
    console.log("ok  too many to set aside; the repair is told which data the tests share");
  } else {
    assert.ok(set, "the disputed cases can be set aside");
    for (const [file, text] of Object.entries(set.files)) fs.writeFileSync(path.join(root, file), text);
    assert.ok(test().ok, "after setting them aside the tests pass");
    console.log("ok  set aside; the tests pass");
  }
}

// A small disagreement: one case of four is set aside with a note, the rest kept.
const tmp = fs.mkdtempSync(path.join(path.dirname(root), "disputed-"));
fs.mkdirSync(path.join(tmp, "src", "lib"), { recursive: true });
fs.writeFileSync(
  path.join(tmp, "src", "lib", "streaks.test.ts"),
  [
    'import { it, expect } from "vitest";',
    'it("adds", () => expect(1 + 1).toBe(2));',
    'it("counts streaks", () => expect(3).toBe(2));',
    'it("loads", () => expect(true).toBe(true));',
    'it("saves", () => expect(1).toBe(1));',
    ""
  ].join("\n")
);
const report = [" FAIL  src/lib/streaks.test.ts > counts streaks", "AssertionError: expected 3 to be 2 // Object.is equality", "- Expected", "+ Received"].join("\n");
const small = setAside(tmp, report);
assert.ok(small, "a single disagreement is set aside");
assert.deepEqual(small.cases, ["src/lib/streaks.test.ts: counts streaks"]);
const text = small.files["src/lib/streaks.test.ts"];
assert.ok(text.includes('// Set aside by the builder') && text.includes('it.skip("counts streaks"'), text);
assert.ok(text.includes('it("adds"') && text.includes('it("saves"'), "the other cases still run");
fs.rmSync(tmp, { recursive: true, force: true });
console.log("ok  one disagreeing case of four is set aside with a note; the others still run");

// What it must refuse: a crash is a bug, not a disagreement.
assert.equal(onlyAssertions("TypeError: habits.map is not a function\n AssertionError: expected 1 to be 2"), false);
assert.equal(onlyAssertions("Error: Cannot find module './habitTracker'"), false);
assert.equal(setAside(root, " FAIL  src/App.test.tsx > renders\nAssertionError: expected 1 to be 2"), null);
console.log("ok  crashes, missing modules and the starter's own tests are never set aside");
