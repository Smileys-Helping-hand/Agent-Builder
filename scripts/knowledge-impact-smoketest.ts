/**
 * Knowledge measured against evaluations: what hurts is benched, what recovers is released.
 *
 *   npm run test:knowledge-impact
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-impact-"));
process.env.EVALUATIONS_PATH = path.join(dir, "evaluations.json");
process.env.BENCHED_PATH = path.join(dir, "benched.json");

const { impactsFrom, KnowledgeImpact } = await import("../src/learning/KnowledgeImpact.js");

const run = (withKnowledge: boolean, results: Array<[string, number, string[]]>) => ({ withKnowledge, state: "done", results: results.map(([id, passRate, knowledgeUsed]) => ({ id, passRate, knowledgeUsed })) });
const without = [run(false, [["race", 1, []], ["dedupe", 1, []], ["wsl", 0.33, []]]), run(false, [["race", 1, []], ["dedupe", 1, []], ["wsl", 0.33, []]])];
const withK = (raceRate: number) => run(true, [["race", raceRate, ["lesson:434", "finding:310"]], ["dedupe", 1, ["lesson:1980"]], ["wsl", 1, ["lesson:1960"]]]);

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`[PASS] ${name}`);
};

check("each item's impact is its pass rate against the same challenge without knowledge", () => {
  const impacts = impactsFrom([...without, withK(0), withK(0), withK(1)]);
  const by = new Map(impacts.map((i) => [i.ref, i]));
  assert.equal(by.get("lesson:434")?.impact, -0.67);
  assert.equal(by.get("lesson:434")?.uses, 3);
  assert.equal(by.get("finding:310")?.impact, -0.67, "items always given together share the result");
  assert.equal(by.get("lesson:1980")?.impact, 0);
  assert.equal(by.get("lesson:1960")?.impact, 0.67);
  assert.equal(impacts[0].impact <= impacts[impacts.length - 1].impact, true, "worst first");
});

check("what hurts across enough uses is benched; one bad run is not enough; what helps is never benched", () => {
  fs.writeFileSync(process.env.EVALUATIONS_PATH!, JSON.stringify([...without, withK(0), withK(0)]));
  let change = KnowledgeImpact.refresh();
  assert.deepEqual(change.benched, [], "two uses are not evidence enough");
  fs.writeFileSync(process.env.EVALUATIONS_PATH!, JSON.stringify([...without, withK(0), withK(0), withK(0.5)]));
  change = KnowledgeImpact.refresh();
  assert.deepEqual(change.benched.sort(), ["finding:310", "lesson:434"]);
  assert.equal(KnowledgeImpact.isBenched("lesson:434"), true);
  assert.equal(KnowledgeImpact.isBenched("lesson:1980"), false);
  assert.equal(KnowledgeImpact.isBenched("lesson:1960"), false);
  assert.match(KnowledgeImpact.benched()[0].reason, /given 3 time\(s\) on race/);
});

check("an item that recovers is released; a benched one comes back for a trial after its probation", () => {
  fs.writeFileSync(process.env.EVALUATIONS_PATH!, JSON.stringify([...without, withK(1), withK(1), withK(1), withK(1)]));
  const change = KnowledgeImpact.refresh();
  assert.deepEqual(change.released.sort(), ["finding:310", "lesson:434"]);
  assert.equal(KnowledgeImpact.isBenched("lesson:434"), false);
  fs.writeFileSync(process.env.BENCHED_PATH!, JSON.stringify([{ ref: "lesson:7", impact: -1, uses: 5, since: new Date(Date.now() - 15 * 86_400_000).toISOString(), reason: "old" }]));
  KnowledgeImpact._reset();
  assert.equal(KnowledgeImpact.isBenched("lesson:7"), false, "after 14 days it is given again, to be measured again");
});

console.log(`\nAll ${passed} knowledge-impact checks passed.`);
process.exit(0);
