/**
 * Asking Agent Builder in words: reading the planner's answer, and what it
 * may and may not choose (the model call itself is tried live).
 *
 *   npm run test:builder-ask
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-ask-"));
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.ACADEMY_DIR = path.join(tmp, "academy");
process.env.BUILDS_DB_PATH = path.join(tmp, "builds.json");

const { ASKABLE, parsePlan, planPrompt } = await import("../src/server/builderAsk.js");
const { BRIDGE_ACTIONS } = await import("../src/server/jarvisActions.js");

// Its answer, however it was wrapped.
assert.deepEqual(parsePlan('{"action":"art.draw","params":{"subject":"a fox"},"say":"Drawing a fox."}'), { action: "art.draw", params: { subject: "a fox" }, say: "Drawing a fox." });
assert.equal(parsePlan('Sure! ```json\n{"action": "Build", "params": {"title": "Bakery"}}\n```')?.action, "build");
assert.deepEqual(parsePlan('{"action":"none","say":"Not a builder thing."}'), { action: "none", params: {}, say: "Not a builder thing." });
assert.equal(parsePlan("I am not sure."), null);
assert.equal(parsePlan('{"params":{}}'), null);
assert.equal(parsePlan("{not json}"), null);

// Everything it may choose exists; the risky ones are never offered.
const names = new Set(BRIDGE_ACTIONS.map((action) => action.name));
for (const action of ASKABLE) assert.ok(names.has(action), `${action} is in the catalogue`);
for (const risky of ["settings.set", "model.restart", "services.start", "service.toggle", "art.delete", "project.repair", "order.build", "academy.publish", "ask"]) {
  assert.ok(!ASKABLE.includes(risky), `${risky} is not offered`);
}

// The prompt carries the actions and the request, not the risky ones.
const prompt = planPrompt("make me a logo for a bakery");
assert.match(prompt, /- art\.draw: /);
assert.match(prompt, /- build: /);
assert.doesNotMatch(prompt, /settings\.set|art\.delete/);
assert.match(prompt, /Request: make me a logo for a bakery$/);

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // The test database is still open on Windows; left in the temp folder.
}
console.log("builder ask: all checks passed");
