/**
 * Play a built web game through its scenario (playtest.json) in a real browser.
 *   npx tsx scripts/playtest.ts <game folder> [dist folder, default <game>/dist]
 */
import path from "path";

import { Playtest } from "../src/game/Playtest.js";

const project = path.resolve(process.argv[2] ?? ".");
const dist = path.resolve(process.argv[3] ?? path.join(project, "dist"));
const scenario = Playtest.scenarioOf(project);
if (!scenario) throw new Error(`No playtest.json in ${project}`);
const result = await Playtest.run(dist, scenario, path.join(project, "playtest-out"));
for (const step of result.steps) console.log(`${step.passed ? "PASS" : "FAIL"}  ${step.label}  (${step.ms} ms) ${step.passed ? "" : step.detail}`);
if (result.errors.length) console.log("errors:", result.errors);
console.log(`frozen: ${result.frozen} · screenshots: ${result.screenshots.length} · ${Math.round(result.durationMs / 1000)} s`);
console.log(result.passed ? "PLAYTEST PASSED" : "PLAYTEST FAILED");
process.exit(result.passed ? 0 : 1);
