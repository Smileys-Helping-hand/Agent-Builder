/**
 * Smoketest: deep investigations (src/research/Investigation.ts, Experiments.ts)
 * with a stand-in model and search, but real computed experiments:
 *   - an objective becomes a plan: domain, specialists, questions, variables, hypotheses
 *   - each specialist is a research topic, and is finished by what it found, not by a clock
 *   - a simulation really runs: every combination, ranked, with sensitivity and a repeat
 *   - broken simulation code gets fixed and run; what needs the real world stays a physical test
 *   - the sandbox: no environment, no files outside it, no children; endless loops are stopped
 *   - contradictions need real findings on both sides; citations of nothing are removed
 *   - open questions go back for another round; then conclusions become candidate knowledge
 *   - the report's evidence parts come from the records; feedback becomes a question
 *
 *   npx tsx scripts/investigation-smoketest.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "investigation-"));
process.chdir(tmp);
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";
process.env.MODEL_PROVIDER = "lmstudio";
process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
process.env.MODEL_WAIT_MS = "0";
process.env.INVESTIGATION_NO_LOOP = "1";
process.env.INVESTIGATION_MIN_FINDINGS = "2";
process.env.TOP_SECRET_FOR_TEST = "the-secret";

const fail = (message: string): never => {
  throw new Error(message);
};

const EXTRACTION = `function simulate(p) {
  // Extraction rises with temperature and grind fineness; too far is over-extraction.
  const extraction = 12 + (p.temperature - 85) * 0.5 + (40 - p.grind) * 0.15;
  const closeness = 1 - Math.abs(extraction - 20) / 20;
  return { extraction, score: closeness * 100 };
}`;

const main = async () => {
  const { Experiments } = await import("../src/research/Experiments.js");
  const { Investigations } = await import("../src/research/Investigation.js");
  const { ResearchEngine } = await import("../src/research/ResearchEngine.js");
  const { ResearchStore } = await import("../src/research/ResearchStore.js");
  const { ModelRouter } = await import("../src/tools/ModelRouter.js");
  const { LessonMemory } = await import("../src/learning/LessonMemory.js");
  const { Evidence } = await import("../src/knowledge/Evidence.js");

  // 1. The sandbox, with real runs.
  const variables = { temperature: [85, 90, 93, 96], grind: [20, 30, 40] };
  const ran = await Experiments.run({ code: EXTRACTION, variables, baseline: { temperature: 85, grind: 40 }, objective: "score" });
  if (ran.evaluated !== 12 || !ran.repeatable) fail(`ran: ${JSON.stringify(ran)}`);
  const check = 12 + (ran.best.params.temperature as number - 85) * 0.5 + (40 - (ran.best.params.grind as number)) * 0.15;
  if (Math.abs(check - ran.best.metrics.extraction) > 1e-6 || ran.best.metrics.score < ran.baseline!.metrics.score) fail(`the numbers are wrong: ${JSON.stringify(ran.best)}`);
  if (ran.sensitivity[0].variable !== "temperature" || ran.sensitivity.length !== 2) fail(`sensitivity: ${JSON.stringify(ran.sensitivity)}`);
  console.log(`[PASS] a simulation really runs: ${ran.evaluated} combinations, best ${JSON.stringify(ran.best.params)} (score ${ran.best.metrics.score} vs baseline ${ran.baseline!.metrics.score}), most sensitive to ${ran.sensitivity[0].variable}, reproduced`);

  const random = await Experiments.run({ code: "function simulate(p) { return { score: Math.random() + p.a }; }", variables: { a: [1] }, objective: "score" });
  const again = await Experiments.run({ code: "function simulate(p) { return { score: Math.random() + p.a }; }", variables: { a: [1] }, objective: "score" });
  if (random.best.metrics.score !== again.best.metrics.score || !random.repeatable) fail("seeded runs differ");

  const outside = path.join(tmp, "secret.txt");
  fs.writeFileSync(outside, "the-secret");
  const hostile = (body: string) => `function simulate(p) { const host = this.constructor.constructor("return process")(); ${body} }`;
  const denied = [
    ["read a file", hostile(`const data = host.getBuiltinModule("fs").readFileSync(${JSON.stringify(outside)}, "utf8"); return { score: data.length };`)],
    ["start a process", hostile(`host.getBuiltinModule("child_process").execSync("whoami"); return { score: 1 };`)],
    ["write a file", hostile(`host.getBuiltinModule("fs").writeFileSync(${JSON.stringify(path.join(tmp, "written.txt"))}, "x"); return { score: 1 };`)]
  ];
  for (const [what, code] of denied) {
    let blocked = false;
    await Experiments.run({ code, variables: { a: [1] }, objective: "score" }).catch(() => (blocked = true));
    if (!blocked) fail(`the sandbox let it ${what}`);
  }
  if (fs.existsSync(path.join(tmp, "written.txt"))) fail("the sandbox let it write a file");
  const env = await Experiments.run({ code: hostile(`return { score: Object.keys(host.env).filter((k) => /SECRET/.test(k)).length };`), variables: { a: [1] }, objective: "score" }).catch(() => null);
  if (env && env.best.metrics.score !== 0) fail("the sandbox saw the environment");
  let stopped = false;
  await Experiments.run({ code: "function simulate(p) { while (true) {} }", variables: { a: [1] }, objective: "score" }).catch(() => (stopped = true));
  if (!stopped) fail("an endless loop was not stopped");
  console.log("[PASS] the sandbox: seeded and reproducible; no file reads or writes, no child processes, no secrets; endless loops are stopped");

  // 2. A whole investigation, with a stand-in model and search.
  const engine = ResearchEngine.getInstance() as unknown as { start: (t: string, q: string) => { id: string }; pause: (id: string) => unknown; resume: (id: string) => unknown };
  const started: string[] = [];
  engine.start = (title, question) => {
    const topic = ResearchStore.createTopic(title, question);
    started.push(topic.id);
    return topic;
  };
  engine.pause = () => null;
  engine.resume = () => null;

  let fixedAsked = 0;
  let synthCalls = 0;
  const model = ModelRouter as unknown as { generate: (prompt: string) => Promise<string> };
  model.generate = async (prompt) => {
    if (/You lead a research investigation/.test(prompt)) {
      return JSON.stringify({
        domain: "culinary science",
        scope: "Filter coffee at home",
        success: "A procedure backed by evidence",
        specialists: [
          { id: "water", name: "Water chemistry", objective: "What water does", questions: ["What hardness suits extraction?"], evidenceNeeded: "SCA standards", dependsOn: [] },
          { id: "extraction", name: "Extraction", objective: "Temperature and grind", questions: ["What temperature extracts best?"], evidenceNeeded: "Papers", dependsOn: ["water"] }
        ],
        variables: [{ name: "temperature", unit: "°C", range: "85-96", why: "drives extraction" }],
        hypotheses: ["Hotter water extracts more"]
      });
    }
    if (/This simulation failed when run/.test(prompt)) {
      fixedAsked += 1;
      return "```js\n" + EXTRACTION + "\n```";
    }
    if (/Design 2-5 experiments/.test(prompt)) {
      return JSON.stringify({
        experiments: [
          { title: "Temperature and grind", hypothesis: "Hotter water extracts more", kind: "simulation", method: "Sweep", assumptions: ["Linear extraction, from the findings"], expected: "93-96", criteria: "Score", variables, baseline: { temperature: 85, grind: 40 }, objective: "score", direction: "max", code: "function simulate(p) { return { score: notDefinedAnywhere(p) }; }" },
          { title: "A taste panel", hypothesis: "People prefer it", kind: "physical", method: "Blind tasting", physicalProtocol: "Brew both, have 5 people rank them blind" }
        ]
      });
    }
    if (/An experiment ran/.test(prompt)) return JSON.stringify({ supported: true, conclusion: "Under these assumptions the model favours hotter water." });
    if (/Find the real contradictions/.test(prompt)) {
      const claims = ResearchStore.listFindings(started[1], 5, "strongest").map((f) => f.id);
      return JSON.stringify({
        contradictions: [
          { about: "Water temperature", sideA: { claim: "93 C", findings: [claims[0]] }, sideB: { claim: "96 C", findings: [claims[1]] }, assessment: "Unsettled" },
          { about: "Invented", sideA: { claim: "x", findings: [999999] }, sideB: { claim: "y", findings: [888888] }, assessment: "Should be dropped" }
        ]
      });
    }
    if (/Write the conclusions/.test(prompt)) {
      synthCalls += 1;
      const ids = started.flatMap((id) => ResearchStore.listFindings(id, 5, "strongest").map((f) => f.id));
      return JSON.stringify({
        executiveSummary: "Hotter water helps, under the model's assumptions.",
        scope: "Home filter coffee",
        methodology: "Specialists, then a computed sweep",
        recommendations: [
          { title: "Brew at about 94 C", detail: "It extracts well", confidence: "high", findings: ids.slice(0, 3), experiments: [] },
          { title: "Use a magic spoon", detail: "Invented", confidence: "high", findings: [424242], experiments: [] }
        ],
        procedure: ["Heat the water", "Pour"],
        confidenceNotes: "Moderate",
        limitations: ["Nothing was tasted"],
        unresolved: synthCalls === 1 ? ["How long should it bloom?"] : [],
        physicalTestsNeeded: ["A taste panel"]
      });
    }
    return "{}";
  };

  const item = Investigations.start("Research how to make the best-tasting coffee possible");
  const { advance } = Investigations.testHooks;
  await advance(item.id).catch(() => undefined);
  await advance(item.id);
  let current = Investigations.get(item.id)!;
  if (current.state !== "researching" || current.plan?.domain !== "culinary science" || current.specialists.length !== 2) fail(`plan: ${JSON.stringify({ s: current.state, p: current.plan })}`);
  if (started.length !== 1 || current.specialists[1].status !== "waiting") fail(`dependencies were not respected: ${started.length} started`);
  if (!ResearchStore.nextQuestions(started[0], 5).some((q) => /hardness/.test(q.text))) fail("the specialist did not get its questions");
  console.log("[PASS] the objective becomes a plan for this subject; a specialist that depends on another waits for it");

  const add = (topic: string, claim: string) => ResearchStore.addOrReinforceFinding(topic, { claim, sourceId: null, confidence: 0.8 }, 1);
  add(started[0], "Water of 50-175 ppm hardness extracts well.");
  add(started[0], "Very soft water tastes flat in coffee.");
  await advance(item.id);
  await advance(item.id);
  current = Investigations.get(item.id)!;
  if (current.specialists[0].status !== "done" || !/2 findings/.test(current.specialists[0].doneWhy ?? "") || started.length !== 2) fail(`specialists: ${JSON.stringify(current.specialists.map((s) => [s.status, s.doneWhy]))}`);
  add(started[1], "93 C is the common extraction temperature.");
  add(started[1], "96 C extracts light roasts better.");
  await advance(item.id);
  current = Investigations.get(item.id)!;
  if (current.state !== "experimenting") fail(`state: ${current.state}`);
  console.log("[PASS] each specialist is a research topic, finished by what it found");

  await advance(item.id);
  current = Investigations.get(item.id)!;
  const sim = current.experiments.find((e) => e.kind === "simulation")!;
  const physical = current.experiments.find((e) => e.kind === "physical")!;
  if (fixedAsked !== 1 || sim.state !== "done" || sim.result?.evaluated !== 12 || !sim.conclusion) fail(`simulation: ${JSON.stringify({ fixedAsked, state: sim?.state, error: sim?.error })}`);
  if (physical.state !== "needs-physical-test" || !physical.physicalProtocol) fail(`physical: ${physical?.state}`);
  if (!Evidence.trace(`experiment:${sim.id}`).records.length) fail("no ledger record for the experiment");
  console.log("[PASS] broken simulation code is fixed and really runs; what needs the real world stays a physical test with its protocol");

  await advance(item.id);
  current = Investigations.get(item.id)!;
  if (current.state !== "researching" || current.round !== 2 || !ResearchStore.nextQuestions(started[0], 10).concat(ResearchStore.nextQuestions(started[1], 10)).some((q) => /bloom/.test(q.text))) fail(`round 2: ${current.state} ${current.round}`);
  if (current.contradictions.length !== 1 || current.contradictions[0].about !== "Water temperature") fail(`contradictions: ${JSON.stringify(current.contradictions)}`);
  console.log("[PASS] a contradiction needs real findings on both sides; open questions go back to the specialists for another round");

  add(started[0], "Blooming for 30 seconds releases gas.");
  add(started[0], "Blooming evens extraction.");
  add(started[1], "A 30-45 s bloom is common practice.");
  add(started[1], "Longer blooms cool the bed.");
  await advance(item.id);
  await advance(item.id);
  await advance(item.id);
  current = Investigations.get(item.id)!;
  if (current.state !== "done" || !current.report) fail(`state: ${current.state} ${current.error}`);
  const spoon = current.report.recommendations.find((r) => /magic spoon/.test(r.title))!;
  if (!spoon.uncited || spoon.findings.length || spoon.confidence !== "medium") fail(`the invented citation: ${JSON.stringify(spoon)}`);
  const brew = current.report.recommendations.find((r) => /94 C/.test(r.title))!;
  if (brew.uncited || brew.findings.length !== 3 || brew.confidence !== "high") fail(`the real one: ${JSON.stringify(brew)}`);
  if (current.knowledge.length !== 1 || !LessonMemory.list("research").some((l) => /Brew at about 94 C/.test(l.lesson))) fail(`knowledge: ${JSON.stringify(current.knowledge)}`);
  if (LessonMemory.list("research").some((l) => /magic spoon/.test(l.lesson))) fail("an uncited claim became knowledge");
  console.log("[PASS] citations of nothing are removed and flagged; only what the evidence supports becomes candidate knowledge");

  const full = Investigations.full(item.id)!;
  if (!full.evidenceMatrix[0].findings.length || full.counts.experimentsRun !== 1 || full.counts.physicalTests !== 1 || full.specialistsDetail[0].findings.length < 2) fail(`full: ${JSON.stringify(full.counts)}`);
  const noted = Investigations.feedback(item.id, { text: "Does grinder type matter?", kind: "suggestion" });
  if (!noted.feedback[0].followUp || !ResearchStore.nextQuestions(started[0], 20).some((q) => /grinder/.test(q.text))) fail("the feedback did not become a question");
  if (!Evidence.trace(`investigation:${item.id}`).incoming.some((l) => l.relation === "feedback-on")) fail("the feedback is not linked");
  console.log("[PASS] the evidence matrix and counts come from the records; feedback becomes a question and is linked");
  console.log("All investigation checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Investigation smoketest failed:", error?.message ?? error);
    finish(1);
  });
