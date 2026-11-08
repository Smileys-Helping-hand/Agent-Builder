/**
 * Smoketest: the Iteration Explorer (src/agent/Iterations.ts), on a throwaway
 * git project with real commits, without a model:
 *   - every step gets a lasting number; the timeline shows the one in progress first
 *   - one iteration in full: real files, lines, functions, its diff, the lessons from
 *     its time, its checks, and a ledger record
 *   - the one in progress shows what is being written right now, uncommitted
 *   - two iterations compare from real commits
 *   - feedback is kept, linked to the iteration, and handed to the session as an instruction
 *
 *   npx tsx scripts/iterations-smoketest.ts
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "iterations-"));
process.chdir(tmp);
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";
process.env.MODEL_PROVIDER = "lmstudio";
process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
process.env.MODEL_WAIT_MS = "0";
process.env.CONTINUOUS_NO_LOOP = "1";
process.env.VMLAB_DIR = path.join(tmp, "vmlab");
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Smoketest";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "smoketest@example.com";

const fail = (message: string): never => {
  throw new Error(message);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

const main = async () => {
  const { EcosystemStore } = await import("../src/ecosystem/EcosystemStore.js");
  const { ContinuousImprover } = await import("../src/agent/ContinuousImprover.js");
  const { Iterations } = await import("../src/agent/Iterations.js");
  const { Evidence } = await import("../src/knowledge/Evidence.js");
  const { LessonMemory } = await import("../src/learning/LessonMemory.js");
  const hooks = ContinuousImprover.testHooks;

  const project = path.join(tmp, "proj");
  fs.mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(project, "app.js"), "export const greet = () => 'hi';\n");
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "start");
  EcosystemStore.upsertProject({
    id: "p1", name: "proj", path: project, root: tmp, kind: "node", description: null, stack: [], scripts: {},
    gitBranch: "main", gitRemote: null, gitDirty: 0, gitAhead: 0, gitBehind: 0, lastCommitAt: null, lastCommitSubject: null, hasClaudeMd: false, readmeExcerpt: null
  });
  const session = ContinuousImprover.start("p1", { goal: "Greet people" });
  await hooks.prepareWorkspace(session, EcosystemStore.getProject("p1")!);
  const dir = hooks.getSession(session.id)!.workspace!.dir;
  const check = { at: new Date().toISOString(), passed: true, verified: true, failing: [], output: "", command: null };

  // Iteration 1: a real change, a lesson learned during it.
  const before1 = git(dir, "rev-parse", "HEAD");
  fs.writeFileSync(path.join(dir, "app.js"), "export const greet = (name) => `hi ${name}`;\nexport function farewell(name) {\n  return `bye ${name}`;\n}\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "greet by name");
  const commit1 = git(dir, "rev-parse", "HEAD");
  const { lesson } = LessonMemory.recordTaught("build", "smoke: template strings", "Use template strings to put a name in a greeting.", null);
  hooks.patchSession(session.id, { lastCheck: check });
  await new Promise((r) => setTimeout(r, 15));
  hooks.journal(session.id, { at: new Date().toISOString(), stage: "building", title: "Greet by name", outcome: "kept", note: "milestone done", commit: commit1, success: true, from: before1 });

  // Iteration 2: another change and a failing check.
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"proj","private":true}\n');
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "add package.json");
  const commit2 = git(dir, "rev-parse", "HEAD");
  hooks.patchSession(session.id, { lastCheck: { ...check, at: new Date().toISOString(), passed: false, failing: ["test"] } });
  await new Promise((r) => setTimeout(r, 15));
  hooks.journal(session.id, { at: new Date().toISOString(), stage: "building", title: "Add a package file", outcome: "kept", note: "checks failing: test", commit: commit2, success: false, from: commit1 });

  // 1. The timeline.
  const timeline = Iterations.timeline(session.id);
  if (timeline.iterations.length !== 2 || timeline.iterations[0].n !== 2 || timeline.iterations[1].n !== 1) fail(`numbers: ${JSON.stringify(timeline.iterations.map((i) => i.n))}`);
  if (!timeline.current || timeline.current.status !== "in-progress" || timeline.current.n !== 3) fail(`current: ${JSON.stringify(timeline.current)}`);
  if (timeline.iterations[0].checksPassed !== false || timeline.iterations[1].checksPassed !== true) fail("the steps did not keep their checks");
  console.log("[PASS] every step has a lasting number; the one in progress comes first; each keeps its checks");

  // 2. One in full.
  const one = await Iterations.detail(session.id, 1);
  const file = one.changes.files.find((f) => f.path === "app.js");
  if (!file || file.added !== 4 || file.removed !== 1 || file.change !== "modified") fail(`files: ${JSON.stringify(one.changes.files)}`);
  if (!/\+export function farewell/.test(one.changes.patch)) fail("the diff is not the real one");
  if (!one.changes.symbols.includes("farewell")) fail(`symbols: ${one.changes.symbols}`);
  if (!one.changes.commits.some((c) => /greet by name/.test(c))) fail(`commits: ${one.changes.commits}`);
  if (!one.learning.lessons.some((l) => l.id === lesson.id)) fail("the lesson from its time is missing");
  if (one.testing.check?.passed !== true) fail("its check is missing");
  if (!Evidence.trace(`step:${session.id}:1`).records.some((r) => r.title === "Greet by name")) fail("no ledger record for the step");
  const two = await Iterations.detail(session.id, 2);
  if (two.changes.dependencies[0] !== "package.json" || two.testing.check?.failing[0] !== "test") fail(`iteration 2: ${JSON.stringify(two.changes.dependencies)}`);
  if (two.learning.lessons.length) fail("a lesson from before it was counted in iteration 2");
  if (!/\+export function farewell/.test(await Iterations.fileDiff(session.id, 1, "app.js"))) fail("one file's diff");
  console.log("[PASS] one in full: real files, lines, functions and diff, the lessons from its time, its checks, a ledger record");

  // 3. The one in progress: what is being written right now.
  fs.writeFileSync(path.join(dir, "app.js"), `${fs.readFileSync(path.join(dir, "app.js"), "utf8")}export const wave = () => 'o/';\n`);
  const current = await Iterations.detail(session.id, "current");
  if (!current.changes.files.some((f) => f.path === "app.js") || !/wave/.test(current.changes.patch) || current.entry?.status !== "in-progress") fail(`current: ${JSON.stringify(current.changes.files)}`);
  git(dir, "checkout", "--", "app.js");
  console.log("[PASS] the one in progress shows what is being written right now");

  // 4. Compare.
  const compared = await Iterations.compare(session.id, 2, 1);
  if (compared.a.n !== 1 || compared.b.n !== 2 || compared.files.length !== 1 || compared.files[0].path !== "package.json" || compared.a.checksPassed !== true || compared.b.checksPassed !== false) fail(`compare: ${JSON.stringify({ a: compared.a, b: compared.b, files: compared.files })}`);
  console.log("[PASS] two iterations compare from real commits and results");

  // 5. Feedback.
  const answer = Iterations.feedback(session.id, 1, { text: "Greet in Afrikaans too", kind: "feature" });
  if (!answer.ok || !hooks.getSession(session.id)!.notes.some((n) => /Greet in Afrikaans too/.test(n))) fail("the feedback did not reach the session");
  const again = await Iterations.detail(session.id, 1);
  if (!again.feedback.some((r) => /Greet in Afrikaans too/.test(r.title))) fail("the feedback is not linked to the iteration");
  console.log("[PASS] feedback is kept, linked to the iteration and handed to the session as an instruction");
  // 6. The step's breakdown: what changed from git, what it learned and what to do next time, kept.
  const { ModelRouter } = await import("../src/tools/ModelRouter.js");
  (ModelRouter as unknown as { generate: (p: string) => Promise<string> }).generate = async (prompt) =>
    /Write its breakdown/.test(prompt) && /package\.json/.test(prompt) && /failing: test/.test(prompt)
      ? JSON.stringify({ did: ["Added a package file"], learned: "The test check needs a test script.", nextTime: "Add a test script to package.json before adding the package file, so the test check has something to run." })
      : "{}";
  await hooks.retrospect(session.id);
  const retro = hooks.getSession(session.id)!.journal.find((s) => s.n === 2)!.retro;
  if (!retro || retro.changed.files !== 1 || retro.changed.list[0] !== "package.json" || !/test script/.test(retro.nextTime) || !retro.lessonId) fail(`breakdown: ${JSON.stringify(retro)}`);
  if (!LessonMemory.list("build").some((l) => l.id === retro.lessonId && /retro: proj/.test(l.signature))) fail("the next-time note was not kept as a lesson");
  const detail = await Iterations.detail(session.id, 2);
  if (detail.retro?.nextTime !== retro.nextTime) fail("the breakdown is not in the iteration's detail");
  console.log("[PASS] each step writes a breakdown: what changed (from git), what it learned, what to do next time, kept as a lesson");
  console.log("All Iteration Explorer checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Iteration Explorer smoketest failed:", error?.message ?? error);
    finish(1);
  });
