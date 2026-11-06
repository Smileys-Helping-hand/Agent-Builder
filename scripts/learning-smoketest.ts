/**
 * Smoketest: unified learning and evaluation, without a real model:
 *   - a lesson is a candidate until its use proves it; one that stops helping is deprecated
 *     and no longer given to builds, but stays searchable; your decision overrides both
 *   - one agent's verified discovery reaches another agent's task (shared knowledge)
 *   - graders: hidden tests really run the answer's code; a wrong answer fails; invented
 *     facts fail; a plan must cover what was asked
 *   - a run with knowledge against one without on the same stand-in model shows a real,
 *     measured difference, and comparing them names improvements and regressions
 *   - a defect once fixed stays in every later run
 *   - the learning loop turns what the builder parks or misses into research questions,
 *     once each, and queues the next project to reconstruct
 *
 *   npx tsx scripts/learning-smoketest.ts
 */
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "learning-"));
process.chdir(tmp);
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";
process.env.MODEL_PROVIDER = "lmstudio";
process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
process.env.MODEL_WAIT_MS = "0";
process.env.CONTINUOUS_NO_LOOP = "1";
process.env.RECONSTRUCT_NO_LOOP = "1";

const fail = (message: string): never => {
  throw new Error(message);
};

const main = async () => {
  const { LessonMemory } = await import("../src/learning/LessonMemory.js");
  const { Evaluations, STANDARD } = await import("../src/learning/Evaluations.js");
  const { LearningLoop, questionsFromRecord } = await import("../src/learning/LearningLoop.js");
  const { ModelRouter } = await import("../src/tools/ModelRouter.js");
  const { ContinuousImprover } = await import("../src/agent/ContinuousImprover.js");
  const { Reconstructor } = await import("../src/agent/Reconstructor.js");
  const { EcosystemStore } = await import("../src/ecosystem/EcosystemStore.js");
  const { ResearchEngine } = await import("../src/research/ResearchEngine.js");
  const { ResearchStore } = await import("../src/research/ResearchStore.js");

  // 1. Verification follows use.
  const { lesson } = LessonMemory.recordTaught("build", "qemu wsl boot iso", "To boot an ISO on this PC run qemu-system-x86_64 inside WSL with the path under /mnt/e; there is no KVM, so it is emulated and slow.", null);
  if (lesson.status !== "candidate") fail(`new lesson: ${lesson.status}`);
  const use = (id: number, helped: boolean) => {
    LessonMemory.markApplied([id]);
    LessonMemory.recordOutcome([id], helped);
  };
  for (let i = 0; i < 3; i++) use(lesson.id, true);
  const proven = LessonMemory.list("build").find((l) => l.id === lesson.id)!;
  if (proven.status !== "verified") fail(`proven lesson: ${proven.status} (${proven.utility})`);

  const bad = LessonMemory.recordTaught("build", "qemu wsl bad advice", "To boot an ISO under qemu wsl always reinstall Windows first.", null).lesson;
  for (let i = 0; i < 6; i++) use(bad.id, false);
  const deprecated = LessonMemory.list("build").find((l) => l.id === bad.id)!;
  if (deprecated.status !== "deprecated") fail(`bad lesson: ${deprecated.status}`);
  const given = LessonMemory.relevant("build", "boot an ISO with qemu in wsl", 5);
  if (given.some((l) => l.id === bad.id) || !given.some((l) => l.id === lesson.id)) fail(`relevant: ${given.map((l) => l.id)}`);
  if (!LessonMemory.list("build").some((l) => l.id === bad.id)) fail("a failed lesson was deleted");
  console.log("[PASS] a lesson is verified by use; one that stops helping is no longer given to builds but stays searchable");

  LessonMemory.decide(bad.id, "verified");
  if (LessonMemory.list("build").find((l) => l.id === bad.id)!.status !== "verified") fail("your decision did not stand");
  LessonMemory.decide(lesson.id, "rejected");
  if (LessonMemory.relevant("build", "boot an ISO with qemu in wsl", 5).some((l) => l.id === lesson.id)) fail("a rejected lesson was given");
  LessonMemory.decide(lesson.id, null);
  LessonMemory.decide(bad.id, null);
  console.log("[PASS] your decision overrides what its use says, both ways");

  // 2. Graders.
  const { grade, knowledgeFor } = Evaluations.testHooks;
  const dedupe = STANDARD.find((c) => c.id === "code-dedupe")!;
  if (!(await grade(dedupe, "```js\nfunction dedupe(list) { return [...new Set(list)]; }\n```")).passed) fail("a right answer failed");
  if ((await grade(dedupe, "function dedupe(list) { return list.sort(); }")).passed) fail("a wrong answer passed");
  if ((await grade(dedupe, "I cannot do that")).passed) fail("a non-answer passed");
  const reading = STANDARD.find((c) => c.id === "read-grounded")!;
  if (!(await grade(reading, "1) 340 C 2) a coolant leak 3) not stated")).passed) fail("a grounded answer failed");
  if ((await grade(reading, "1) 340 C 2) a coolant leak 3) It was government funded")).passed) fail("an invented fact passed");
  const plan = STANDARD.find((c) => c.id === "plan-web")!;
  if ((await grade(plan, "1. Build a booking page")).passed) fail("a thin plan passed");
  console.log("[PASS] graders: hidden tests really run the code; wrong answers, invented facts and thin plans fail");

  // 3. Shared knowledge, measured: the same stand-in model, with and without what was learned.
  // It knows nothing itself: it only gets the procedure challenge right when the lesson is in its prompt.
  const model = ModelRouter as unknown as { generate: (prompt: string) => Promise<string> };
  model.generate = async (prompt) => {
    if (/How do you boot an ISO/.test(prompt)) return /inside WSL with the path under \/mnt\/e/.test(prompt) ? "Run qemu-system-x86_64 inside WSL on /mnt/e/os/x.iso; with no KVM it is emulated and slow." : "Open Hyper-V Manager and add the ISO.";
    if (/named dedupe/.test(prompt)) return "function dedupe(list) { return [...new Set(list)]; }";
    return "no idea";
  };
  const only = ["proc-wsl", "code-dedupe", "plan-web"];
  if (knowledgeFor(STANDARD.find((c) => c.id === "proc-wsl")!).used[0] !== `lesson:${lesson.id}`) fail(`the discovery did not reach another agent's task: ${JSON.stringify(knowledgeFor(STANDARD.find((c) => c.id === "proc-wsl")!).used)}`);
  const without = Evaluations.start({ label: "Baseline", withKnowledge: false, only });
  await without.done;
  const withIt = Evaluations.start({ label: "With knowledge", withKnowledge: true, only, trials: 2 });
  let busy = false;
  try {
    Evaluations.start({ label: "second" });
  } catch {
    busy = true;
  }
  if (!busy) fail("two evaluations ran at once");
  await withIt.done;
  const before = Evaluations.get(without.id)!;
  const after = Evaluations.get(withIt.id)!;
  if (before.state !== "done" || after.state !== "done") fail(`states: ${before.state} ${after.state} ${before.error} ${after.error}`);
  const compared = Evaluations.compare(before.id, after.id);
  if (compared.difference === null || compared.difference <= 0 || !compared.improved.includes("proc-wsl") || compared.regressions.length) fail(`compare: ${JSON.stringify(compared)}`);
  if (after.results.find((r) => r.id === "proc-wsl")!.knowledgeUsed[0] !== `lesson:${lesson.id}`) fail("the run did not record what it used");
  if (!compared.note) fail("few trials were not flagged");
  console.log(`[PASS] one agent's discovery reaches another's task: score ${compared.a.score} without, ${compared.b.score} with, measured on the same model; improved: ${compared.improved.join(", ")}`);

  // Regressions are named. A later run where it forgets.
  model.generate = async () => "no idea";
  const worse = Evaluations.start({ label: "Worse", withKnowledge: true, only });
  await worse.done;
  const against = Evaluations.compare(after.id, worse.id);
  if (!against.regressions.includes("code-dedupe") || (against.difference ?? 0) >= 0) fail(`regressions: ${JSON.stringify(against.regressions)}`);
  console.log(`[PASS] a regression is named (${against.regressions.join(", ")}), and the score falls by ${Math.abs(against.difference!)}`);

  // 4. A defect once fixed stays tested.
  const defect = Evaluations.addChallenge({ title: "Keeps escaped quotes", prompt: "Write function unquote(s).", tests: `eq(unquote('"a"'), "a");`, name: "unquote" });
  if (defect.category !== "regression" || !Evaluations.challenges().some((c) => c.id === defect.id)) fail("the defect is not in the set");
  model.generate = async () => "function unquote(s) { return s.slice(1, -1); }";
  const regression = Evaluations.start({ label: "Regression", only: [defect.id] });
  await regression.done;
  if (Evaluations.get(regression.id)!.score !== 1) fail(`the regression test: ${JSON.stringify(Evaluations.get(regression.id))}`);
  console.log("[PASS] a defect once fixed stays in the set, and really runs");

  // 5. The learning loop.
  const engine = ResearchEngine.getInstance() as unknown as { start: (t: string, q: string) => { id: string } };
  engine.start = (title, question) => ResearchStore.createTopic(title, question);
  const projectDir = path.join(tmp, "app");
  fs.mkdirSync(projectDir);
  const project = (id: string, name: string, dir: string) =>
    EcosystemStore.upsertProject({ id, name, path: dir, root: tmp, kind: "node", description: null, stack: ["react"], scripts: {}, gitBranch: "main", gitRemote: null, gitDirty: 0, gitAhead: 0, gitBehind: 0, lastCommitAt: null, lastCommitSubject: null, hasClaudeMd: false, readmeExcerpt: null });
  project("p1", "OS", projectDir);
  const session = ContinuousImprover.start("p1", { goal: "Build an OS" });
  ContinuousImprover.testHooks.patchSession(session.id, { plan: [{ id: "m1", title: "Boot to a shell", detail: "", status: "parked", attempts: 8, note: "no bootloader", doneAt: null }] });
  if (!questionsFromRecord().some((q) => /Boot to a shell/.test(q) && /no bootloader/.test(q))) fail(`questions: ${questionsFromRecord()}`);
  const otherDir = path.join(tmp, "other");
  fs.mkdirSync(otherDir);
  project("p2", "Shop", otherDir);
  const first = await LearningLoop.tick();
  if (first.asked.length !== 1 || !first.queued) fail(`first tick: ${JSON.stringify(first)}`);
  const state = LearningLoop.state();
  if (!state.topicId || !ResearchStore.nextQuestions(state.topicId, 5).some((q) => /Boot to a shell/.test(q.text))) fail("the question did not reach the research engine");
  if (!Reconstructor.list().runs.length) fail("no project was queued to reconstruct");
  const second = await LearningLoop.tick();
  if (second.asked.length || second.queued) fail(`second tick repeated itself: ${JSON.stringify(second)}`);
  console.log(`[PASS] the learning loop: what is parked becomes a research question, once; ${first.queued} is queued to reconstruct, once a day`);
  console.log("All learning checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Learning smoketest failed:", error?.message ?? error);
    finish(1);
  });
