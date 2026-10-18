/**
 * Self-heal leaves practice builds to the academy; the repair hints say how
 * this project's tests are written.
 *
 *   npx tsx scripts/practice-and-hints-check.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { noDomHint } from "../src/orchestrator/DisputedTests.js";
import { candidates } from "../src/orchestrator/SelfHeal.js";
import type { BuildView } from "../src/orchestrator/BuildService.js";

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "ab-heal-"));
const later = Date.parse("2026-10-18T12:00:00Z");
const build = (over: Partial<BuildView>): BuildView =>
  ({
    buildId: "b",
    projectName: "P",
    state: "completed",
    passed: false,
    bestScore: 77,
    qualityThreshold: 90,
    outputDir: folder,
    startedAt: "2026-10-18T08:00:00Z",
    finishedAt: "2026-10-18T09:00:00Z",
    startedBy: "agent:jarvis",
    orderId: null,
    continuedFrom: null,
    live: false,
    ...over
  }) as BuildView;

const runs = [
  build({ buildId: "habits", projectName: "Habit Tracker" }),
  build({ buildId: "re-1", projectName: "Real Estate Agency", startedBy: "academy:idea-1", startedAt: "2026-10-17T08:00:00Z" }),
  build({ buildId: "re-2", projectName: "Real Estate Agency", startedBy: "self-heal", continuedFrom: "re-1" })
];
assert.deepEqual(candidates(runs, "v1", { healed: {} }, later).map((b) => b.buildId), ["habits"]);
console.log("ok  self-heal retries a person's build, never an academy practice (or its own continuation of one)");

const site = fs.mkdtempSync(path.join(os.tmpdir(), "ab-nodom-"));
fs.mkdirSync(path.join(site, "src", "lib"), { recursive: true });
fs.writeFileSync(path.join(site, "src", "lib", "testing.tsx"), "export const renderAt = (node: unknown, hash = '') => '';\nexport const esc = (s: string) => s;\n");
const hint = noDomHint(site, " FAIL  src/App.test.tsx > App > renders the home page\nReferenceError: document is not defined");
assert.match(hint, /renderAt\(<App \/>\)/);
assert.match(hint, /Do not add jsdom/);
assert.equal(noDomHint(site, "AssertionError: expected 1 to be 2"), "");
assert.equal(noDomHint(folder, "ReferenceError: document is not defined"), "", "no renderAt helper: no hint");
console.log("ok  a browser-style test in a no-DOM project gets told how its tests are written");
fs.rmSync(site, { recursive: true, force: true });
fs.rmSync(folder, { recursive: true, force: true });
