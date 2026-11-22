/**
 * The Model Laboratory's graders and recommendation, the learning scorecard,
 * and a build's model call waiting through Gaming Mode. No model is called.
 *
 *   npm run test:model-lab
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-lab-"));
process.env.EVALUATIONS_PATH = path.join(dir, "evaluations.json");
process.env.BENCHED_PATH = path.join(dir, "benched.json");
process.env.GAME_MODE_PATH = path.join(dir, "game-mode.json");
process.env.MODEL_PROVIDER = "ollama";

const { LAB_CHALLENGES, recommend } = await import("../src/learning/ModelLab.js");
const { grade } = await import("../src/learning/Evaluations.js");
const { scorecard } = await import("../src/learning/Scorecard.js");
const { KnowledgeImpact } = await import("../src/learning/KnowledgeImpact.js");

let passed = 0;
const check = async (name: string, fn: () => unknown | Promise<unknown>) => {
  await fn();
  passed++;
  console.log(`[PASS] ${name}`);
};
const lab = (id: string) => LAB_CHALLENGES.find((c) => c.id === id)!;
const run = async (id: string, answer: string) => {
  const challenge = lab(id);
  return "check" in challenge ? challenge.check(answer) : grade(challenge, answer);
};

await check("the lab's graders: structured JSON and tool calls are judged exactly", async () => {
  assert.equal((await run("lab-json", '```json\n{"title":"Save broken in Firefox","tags":["bug","firefox","settings"],"priority":2,"browser":"Firefox"}\n```')).passed, true);
  assert.equal((await run("lab-json", '{"title":"x","tags":["Bug","a","b"],"priority":2,"browser":"Firefox"}')).passed, false, "an uppercase tag fails");
  assert.equal((await run("lab-json", '{"title":"x","tags":["a","b","c"],"priority":2,"browser":"Firefox","extra":1}')).passed, false, "an extra key fails");
  assert.equal((await run("lab-json", "Here is the JSON you asked for")).passed, false);
  assert.equal((await run("lab-tool", '{"tool":"read_file","args":{"path":"src/game/physics.ts"}}')).passed, true);
  assert.equal((await run("lab-tool", '{"tool":"search_web","args":{"query":"TS2322"}}')).passed, false);
});

await check("the lab's graders: long context, synthesis, and code run against hidden tests", async () => {
  assert.equal((await run("lab-long", "The code is 7413-ALPHA.")).passed, true);
  assert.equal((await run("lab-long", "I could not find it.")).passed, false);
  assert.match(lab("lab-long").prompt, /7413-ALPHA/);
  assert.ok(lab("lab-long").prompt.length > 30_000, "the needle is in a long document");
  assert.equal((await run("lab-synthesis", "Intercropping raised yield [1][2], but in dry soils it fell because of water competition [3], so the sources disagree.")).passed, true);
  assert.equal((await run("lab-synthesis", "Intercropping helps [1][2].")).passed, false);
  const good = "function median(xs){const s=[...xs].sort((a,b)=>a-b);const m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2;}";
  assert.equal((await run("lab-repair", good)).passed, true, "the fixed median passes");
  assert.equal((await run("lab-repair", "function median(xs){xs.sort();return xs[Math.floor(xs.length/2)];}")).passed, false, "the original bug fails");
});

const result = (model: string, score: number | null, tps: number, state = "done") => ({ model, state, reason: null, loadMs: 1000, gpuPercent: 100, loadedGB: 1, peakVramMB: 1, peakRamUsedMB: 1, ramIncreaseMB: 1, calls: [], score, byCategory: {}, medianTokensPerSec: tps, medianTtftMs: 50, errors: 0 }) as never;

await check("the recommendation keeps production unless a candidate clearly beats it, and never acts", () => {
  assert.match(recommend([result("base", 0.8, 8), result("small", 0.56, 141)], "base"), /^Keep base: no candidate beat it/);
  assert.match(recommend([result("base", 0.8, 8), result("big", 0.85, 12)], "base"), /^Keep base: big scored 5 points higher, inside one run's noise/);
  assert.match(recommend([result("base", 0.7, 8), result("big", 0.9, 12)], "base"), /^Recommend big over base \(\+20 points\).*your decision/);
  assert.match(recommend([result("big", null, 0, "skipped")], "base"), /No model finished/);
});

await check("the scorecard compares the same model with and without knowledge, and finds benched items handed out later", () => {
  const challenge = (id: string, passRate: number, knowledgeUsed: string[] = []) => ({ id, passRate, knowledgeUsed });
  const evaluation = (id: string, at: string, withKnowledge: boolean, score: number, results: unknown[], model = "qwen2.5-coder:14b") => ({ id, startedAt: at, withKnowledge, state: "done", model, score, results });
  fs.writeFileSync(
    process.env.EVALUATIONS_PATH!,
    JSON.stringify([
      evaluation("w0", "2026-11-01", false, 0.8, [challenge("race", 1), challenge("dedupe", 1)], "gpt-4o-mini"),
      evaluation("k1", "2026-11-02", true, 0.5, [challenge("race", 0, ["lesson:1"]), challenge("dedupe", 1, ["lesson:2"])]),
      evaluation("k2", "2026-11-03", true, 0.5, [challenge("race", 0, ["lesson:1"]), challenge("dedupe", 1, ["lesson:2"])]),
      evaluation("k3", "2026-11-04", true, 0.5, [challenge("race", 0, ["lesson:1"]), challenge("dedupe", 1, ["lesson:2"])])
    ])
  );
  KnowledgeImpact.refresh();
  let card = scorecard();
  assert.equal(card.model, "qwen2.5-coder:14b");
  assert.equal(card.latest.without, 0.8, "a run recorded under the old wrong name counts as the 14B");
  assert.match(card.verdict, /still makes answers worse: 0.5 with it against 0.8 without/);
  assert.deepEqual(card.regressions, ["race"]);
  assert.equal(card.harmfulExcluded.benched, 1);
  assert.equal(card.retrievalPrecision, 0.5, "one of the two evidenced items did not hurt");
  const later = new Date(Date.now() + 60_000).toISOString();
  const runs = JSON.parse(fs.readFileSync(process.env.EVALUATIONS_PATH!, "utf8"));
  runs.push(evaluation("k4", later, true, 1, [challenge("race", 1, ["lesson:1"]), challenge("dedupe", 1)]));
  runs.push(evaluation("w4", later, false, 0.8, [challenge("race", 1), challenge("dedupe", 1)]));
  fs.writeFileSync(process.env.EVALUATIONS_PATH!, JSON.stringify(runs));
  card = scorecard();
  assert.deepEqual(card.harmfulExcluded.handedOutAfterBenching, ["lesson:1"], "a benched item given out after benching is reported");
  assert.equal(card.sinceBenching?.withRuns, 1);
});

await check("in Gaming Mode a build's model call waits until Resume; a direct question is refused at once", async () => {
  const { GameMode } = await import("../src/utils/GameMode.js");
  const { ModelRouter } = await import("../src/tools/ModelRouter.js");
  const { buildScope } = await import("../src/utils/BuildContext.js");
  GameMode.patch({ on: true, profile: "gaming-balanced" });
  await assert.rejects(() => ModelRouter.generate("hi", { provider: "ollama" }), /Game mode is on/);
  let settled = false;
  const waiting = buildScope.run({ buildId: "b1" } as never, () => ModelRouter.generate("hi", { provider: "ollama" })).then(
    () => (settled = true),
    () => (settled = true)
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(settled, false, "the build's call is waiting, not failed");
  GameMode.off();
  void waiting;
});

console.log(`\nAll ${passed} model-lab checks passed.`);
process.exit(0);
