/**
 * Smoketest: the continuous builder's machinery, on a throwaway git project
 * in a temporary folder, without a model (each step of the loop is driven by
 * hand through ContinuousImprover.testHooks):
 *   - the project is copied into its own workspace; the original is never touched
 *   - a clean workspace with something new waits as one delivery; a newer one replaces it
 *   - the owner's own commits come into the workspace
 *   - a major change (a dependency file) must have its parts chosen
 *   - approving some parts applies and commits only those, on the live branch;
 *     the declined parts are taken back out of the workspace
 *   - a file the owner changed since is never overwritten, and the workspace takes their version
 *   - the owner's check command decides whether checks pass
 *   - a brand-new project starts from its goal
 *
 *   npx tsx scripts/continuous-smoketest.ts
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "continuous-"));
process.chdir(tmp); // every data/ and builds/ path below is relative: keep them out of the real ones
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";
process.env.MODEL_PROVIDER = "lmstudio";
process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
process.env.MODEL_WAIT_MS = "0";
process.env.CONTINUOUS_NO_LOOP = "1";
process.env.CONTINUOUS_NEW_PROJECTS_DIR = path.join(tmp, "new-projects");
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Smoketest";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "smoketest@example.com";

const fail = (message: string): never => {
  throw new Error(message);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
const read = (file: string) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null);
const passed = { at: new Date().toISOString(), passed: true, verified: true, failing: [], output: "", command: null };

const main = async () => {
  const { EcosystemStore } = await import("../src/ecosystem/EcosystemStore.js");
  const { ContinuousImprover } = await import("../src/agent/ContinuousImprover.js");
  const hooks = ContinuousImprover.testHooks;

  // A project with two files on its live branch.
  const project = path.join(tmp, "proj");
  fs.mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(project, "app.js"), "export const greet = () => 'hi';\n");
  fs.writeFileSync(path.join(project, "util.js"), "export const add = (a, b) => a + b;\n");
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "start");
  EcosystemStore.upsertProject({
    id: "p1", name: "proj", path: project, root: tmp, kind: "node", description: null, stack: [], scripts: {},
    gitBranch: "main", gitRemote: null, gitDirty: 0, gitAhead: 0, gitBehind: 0, lastCommitAt: null, lastCommitSubject: null, hasClaudeMd: false, readmeExcerpt: null
  });

  // 1. Its own workspace.
  const session = ContinuousImprover.start("p1", { goal: "Greet people by name and add maths helpers", mode: "forever" });
  await hooks.prepareWorkspace(session, EcosystemStore.getProject("p1")!);
  const ws = hooks.getSession(session.id)!.workspace!;
  if (!fs.existsSync(path.join(ws.dir, "app.js")) || ws.dir.startsWith(project)) fail("no separate workspace");
  console.log("[PASS] workspace: a copy of the project of its own");

  // 2. A step's work, then a delivery; a newer one replaces it.
  fs.writeFileSync(path.join(ws.dir, "app.js"), "export const greet = (name = 'you') => `hi ${name}`;\n");
  fs.mkdirSync(path.join(ws.dir, "lib"));
  fs.writeFileSync(path.join(ws.dir, "lib", "maths.js"), "export const square = (x) => x * x;\n");
  git(ws.dir, "add", "-A");
  git(ws.dir, "commit", "-q", "-m", "step 1");
  await hooks.deliverIfReady(session.id, passed);
  const first = ContinuousImprover.list().deliveries[0];
  if (!first || first.state !== "awaiting" || first.files.length !== 2 || first.major) fail(`first delivery: ${JSON.stringify(first)}`);
  if (read(path.join(project, "app.js"))!.includes("name")) fail("the project was touched before approval");

  // 3. The owner commits to the project meanwhile; it comes into the workspace.
  fs.writeFileSync(path.join(project, "util.js"), "export const add = (a, b) => a + b;\nexport const sub = (a, b) => a - b;\n");
  git(project, "commit", "-q", "-am", "owner: sub");
  await hooks.syncOwnerCommits(session.id);
  if (!read(path.join(ws.dir, "util.js"))!.includes("sub")) fail("the owner's commit did not come into the workspace");
  console.log("[PASS] the original stays untouched until approved; the owner's commits come into the workspace");

  // 4. More work, including a dependency file: a major change, replacing the first delivery.
  fs.writeFileSync(path.join(ws.dir, "app.js"), "export const greet = (name = 'you') => `hello ${name}`;\n");
  fs.writeFileSync(path.join(ws.dir, "package.json"), JSON.stringify({ name: "proj", type: "module" }, null, 2));
  git(ws.dir, "add", "-A");
  git(ws.dir, "commit", "-q", "-m", "step 2");
  await hooks.deliverIfReady(session.id, passed);
  const deliveries = ContinuousImprover.list().deliveries;
  const second = deliveries[0];
  if (deliveries.find((d) => d.id === first.id)?.state !== "superseded") fail("the older delivery was not replaced");
  if (!second.major || !second.majorWhy.some((w) => w.includes("package.json"))) fail(`not flagged major: ${JSON.stringify(second.majorWhy)}`);
  if (second.files.some((f) => f.path === "util.js")) fail("the owner's own change came back as a delivery");
  let refused = false;
  await ContinuousImprover.approve(second.id).catch(() => (refused = true));
  if (!refused) fail("a major change was approved without choosing parts");
  console.log("[PASS] one delivery at a time, the newest; a major change (package.json) must have its parts chosen");

  // 5. Approve some parts: only those reach the project, committed on main; the rest leaves the workspace.
  const decided = (await ContinuousImprover.approve(second.id, ["app.js", "lib/maths.js"])) as { state: string; applied: string[]; declined: string[]; commit: { branch: string } | null };
  if (decided.state !== "partly" || decided.applied.length !== 2 || decided.declined.join() !== "package.json") fail(`partial approval: ${JSON.stringify(decided)}`);
  if (!read(path.join(project, "app.js"))!.includes("hello") || !fs.existsSync(path.join(project, "lib", "maths.js"))) fail("approved parts not applied");
  if (fs.existsSync(path.join(project, "package.json"))) fail("a declined part reached the project");
  const committed = git(project, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean).sort();
  if (committed.join() !== "app.js,lib/maths.js" || decided.commit?.branch !== "main") fail(`commit: ${committed} on ${decided.commit?.branch}`);
  if (fs.existsSync(path.join(ws.dir, "package.json"))) fail("the declined part stayed in the workspace");
  await hooks.deliverIfReady(session.id, passed);
  if (ContinuousImprover.list().deliveries.some((d) => d.state === "awaiting")) fail("an empty delivery appeared after the decision");
  console.log("[PASS] approving parts: only those applied and committed on main; the declined part left the workspace");

  // 6. A file the owner is editing is never overwritten; the workspace takes their version.
  fs.writeFileSync(path.join(ws.dir, "util.js"), "export const add = (a, b) => Number(a) + Number(b);\n");
  git(ws.dir, "commit", "-q", "-am", "step 3");
  fs.writeFileSync(path.join(project, "util.js"), "export const add = (a, b) => a + b; // the owner's edit in progress\n");
  await hooks.deliverIfReady(session.id, passed);
  const third = ContinuousImprover.list().deliveries[0];
  const conflicted = (await ContinuousImprover.approve(third.id, ["util.js"])) as { conflicts: string[]; state: string };
  if (conflicted.conflicts.join() !== "util.js" || conflicted.state !== "partly") fail(`conflict: ${JSON.stringify(conflicted)}`);
  if (!read(path.join(project, "util.js"))!.includes("the owner's edit")) fail("the owner's edit was overwritten");
  if (!read(path.join(ws.dir, "util.js"))!.includes("the owner's edit")) fail("the workspace did not take the owner's version");
  console.log("[PASS] a file the owner changed since is kept as theirs, in the project and the workspace");

  // 7. The owner's check command decides.
  const failing = await hooks.runChecks({ ...hooks.getSession(session.id)!, checkCommand: 'node -e "process.exit(3)"' }, ws.dir);
  const ok = await hooks.runChecks({ ...hooks.getSession(session.id)!, checkCommand: 'node -e "process.exit(0)"' }, ws.dir);
  if (failing.passed || !failing.verified || ok.passed !== true) fail(`check command: ${JSON.stringify({ failing, ok })}`);
  console.log("[PASS] the check command decides whether the workspace is clean");

  // 8. A brand-new project from its goal.
  const fresh = await ContinuousImprover.startNew("My Tiny OS", { goal: "A tiny operating system that boots and prints hello", mode: "complete" });
  const readme = read(path.join(process.env.CONTINUOUS_NEW_PROJECTS_DIR!, "My-Tiny-OS", "README.md"));
  if (!readme?.includes("boots and prints hello") || fresh.mode !== "complete" || !EcosystemStore.getProject(fresh.projectId)) fail("new project");
  console.log("[PASS] a new project starts from nothing: folder, repository, its goal, in the project list");

  ContinuousImprover.stop(session.id);
  ContinuousImprover.stop(fresh.id);

  // 8b. A roadmap is read however the model wrote it, even cut off half way.
  const shapes = [
    '{"milestones": [{"title": "Boot", "detail": "a"}, {"title": "Shell", "detail": "b"}]}',
    '```json\n[{"name": "Boot", "description": "a"}, {"name": "Shell", "description": "b"}]\n```',
    '{"roadmap": [{"title": "Boot", "details": "a"}, {"title": "Shell", "details": "b"}]}',
    '{"milestones": [{"title": "Boot", "detail": "a"}, {"title": "Shell", "detail": "b"}, {"title": "Desk'
  ];
  for (const shape of shapes) {
    const items = hooks.itemsFrom(shape, ["milestones"]);
    if (items.length !== 2 || items[0].title !== "Boot" || items[1].detail !== "b") fail(`roadmap not read from ${shape.slice(0, 40)}: ${JSON.stringify(items)}`);
  }
  console.log("[PASS] roadmaps are read from any shape of answer, including one cut off half way");

  // 9. The loop's stages, with a stand-in model and build: plan → build → check → deliver → fix → complete.
  const { ModelRouter } = await import("../src/tools/ModelRouter.js");
  const { BuildService } = await import("../src/orchestrator/BuildService.js");
  (ModelRouter as unknown as { generate: (p: string) => Promise<string> }).generate = async (prompt: string) =>
    /Write the roadmap/.test(prompt)
      ? JSON.stringify({ milestones: [{ title: "Print hello", detail: "A hello.txt that says hello" }] })
      : /Is the goal fully met/.test(prompt)
        ? JSON.stringify({ complete: true, missing: [] })
        : "{}";
  const builds = BuildService as unknown as { start: (o: { workingDir: string; description?: string }) => { buildId: string }; isRunning: (id: string) => boolean };
  builds.start = (options) => {
    fs.writeFileSync(path.join(options.workingDir, "hello.txt"), "hello\n");
    return { buildId: "stand-in" };
  };
  builds.isRunning = () => false;
  const tiny = await ContinuousImprover.startNew("Tiny", { goal: "Print hello and nothing else, done properly", mode: "complete", checkCommand: 'node -e "process.exit(0)"' });
  const stages: string[] = [];
  for (let i = 0; i < 6 && hooks.getSession(tiny.id)!.state !== "stopped"; i++) {
    await hooks.cycle(tiny.id);
    stages.push(hooks.getSession(tiny.id)!.stage);
  }
  const end = hooks.getSession(tiny.id)!;
  if (end.stage !== "complete" || end.state !== "stopped") fail(`stages: ${stages.join(" → ")}; ended ${end.stage}/${end.state}`);
  if (end.plan[0]?.status !== "done") fail(`milestone: ${JSON.stringify(end.plan)}`);
  if (!ContinuousImprover.list().deliveries.some((d) => d.sessionId === tiny.id && d.state === "awaiting" && d.files.some((f) => f.path === "hello.txt"))) fail("no delivery of the work");
  console.log(`[PASS] the loop: ${stages.join(" → ")}; the milestone is done, the work waits for approval, and a "complete" session stops`);

  // 10. It learns from it: the step's approach was rewarded for finishing its milestone, and its progress shows.
  const { Reinforcement } = await import("../src/learning/Reinforcement.js");
  const stepEpisodes = Reinforcement.recent(50).filter((e) => e.policy === "continuous.step" && e.reward !== null);
  if (!stepEpisodes.some((e) => e.reward === 1)) fail(`continuous.step rewards: ${JSON.stringify(stepEpisodes.map((e) => e.reward))}`);
  const progress = (ContinuousImprover.list().sessions.find((x) => x.id === tiny.id) as { progress?: { recentSuccess: number | null; steps: number } }).progress;
  if (!progress || progress.steps < 1 || progress.recentSuccess !== 1) fail(`progress: ${JSON.stringify(progress)}`);
  const policy = Reinforcement.stats().find((p) => p.id === "continuous.step");
  if (!policy || policy.trend.recent === null) fail("no trend for continuous.step");
  const delivery = ContinuousImprover.list().deliveries.find((d) => d.sessionId === tiny.id && d.state === "awaiting")!;
  await ContinuousImprover.approve(delivery.id, delivery.files.map((f) => f.path));
  const ownerRewarded = Reinforcement.recent(50).find((e) => e.policy === "continuous.step" && e.rewards.some((r) => r.source === "owner-decision"));
  if (!ownerRewarded) fail("the owner's approval did not reach the step's approach");
  console.log(`[PASS] it learns: the step's approach was rewarded (milestone done, then your approval), progress ${Math.round(progress.recentSuccess! * 100)}% of ${progress.steps} step(s), trend ${policy.trend.recent}`);

  // 11. A whole forever-mode life: plan → build (fails, then refined) → fix → goal met → improve → upgrade → build the upgrade.
  const { LessonMemory } = await import("../src/learning/LessonMemory.js");
  (ModelRouter as unknown as { generate: (p: string) => Promise<string> }).generate = async (prompt: string) => {
    if (/list every distinct thing they ask for/.test(prompt)) return JSON.stringify({ requirements: ["A hello file"] });
    if (/Write the roadmap/.test(prompt)) return JSON.stringify({ milestones: [{ title: "Write the hello file", detail: "hello.txt says hello", covers: ["R1"] }] });
    if (/Is the goal fully met/.test(prompt)) return JSON.stringify({ complete: true, missing: [] });
    if (/A check was failing and this change fixed it/.test(prompt)) return "When a stale flag file makes a check fail, remove the flag and rerun the check.";
    if (/Pick ONE improvement/.test(prompt)) return JSON.stringify({ title: "Louder hello", instruction: "Make the greeting in hello.txt louder, with capitals and an exclamation mark." });
    if (/Plan its next upgrades/.test(prompt)) return JSON.stringify({ upgrades: [{ title: "Add a goodbye file", detail: "goodbye.txt says goodbye" }] });
    return "{}";
  };
  let firstTry = true;
  builds.start = (options: { workingDir: string; description?: string }) => {
    const dir = options.workingDir;
    const description = options.description ?? "";
    const write = (file: string, text: string) => fs.writeFileSync(path.join(dir, file), text);
    if (/Make every check pass|left these checks failing/.test(description)) fs.rmSync(path.join(dir, "broken.flag"), { force: true });
    if (/Louder hello/.test(description)) write("hello.txt", "HELLO!\n");
    else if (/goodbye/.test(description)) write("goodbye.txt", "goodbye\n");
    else if (/Write the hello file/.test(description)) {
      write("hello.txt", "hello\n");
      // The first try leaves a check failing; the next one refines it.
      if (firstTry) write("broken.flag", "x");
      firstTry = false;
    }
    return { buildId: "stand-in" };
  };
  const life = await ContinuousImprover.startNew("Forever", {
    goal: "A hello file. Then keep making it better forever.",
    mode: "forever",
    checkCommand: `node -e "process.exit(require('fs').existsSync('broken.flag')?1:0)"`
  });
  const at = () => hooks.getSession(life.id)!;
  const outcomes = () => at().journal.map((s) => `${s.stage}:${s.outcome}${s.success ? "+" : ""}`).join(" ");
  await hooks.cycle(life.id); // plan
  if (at().stage !== "building" || at().plan.length !== 1) fail(`plan: ${JSON.stringify(at().plan)}`);
  await hooks.cycle(life.id); // build: checks fail
  if (at().plan[0].status === "done" || at().lastCheck?.passed) fail("the first try should have left a check failing");
  await hooks.cycle(life.id); // build again: refined, milestone done
  if (at().plan[0].status !== "done") fail(`refine: ${outcomes()}`);
  await hooks.cycle(life.id); // nothing left to build → fixing
  // Something breaks: the fix stage repairs it and learns a lesson.
  fs.writeFileSync(path.join(at().workspace!.dir, "broken.flag"), "x");
  execFileSync("git", ["add", "-A"], { cwd: at().workspace!.dir });
  execFileSync("git", ["commit", "-q", "-m", "break it"], { cwd: at().workspace!.dir });
  await hooks.cycle(life.id); // fixing: fix step
  if (!at().journal.some((s) => s.stage === "fixing" && s.success)) fail(`fix: ${outcomes()}`);
  if (!LessonMemory.list("build").some((l) => /stale flag file/.test(l.lesson))) fail("no lesson recorded from the fix");
  await hooks.cycle(life.id); // fixing: clean, goal met → improving
  if (at().stage !== "improving" || at().state === "stopped") fail(`after the goal: ${at().stage}/${at().state}`);
  await hooks.cycle(life.id); // improve
  if (!at().journal.some((s) => s.stage === "improving" && s.success)) fail(`improve: ${outcomes()}`);
  hooks.patchSession(life.id, { improvementsSincePlan: 6 });
  await hooks.cycle(life.id); // plan upgrades
  if (at().stage !== "building" || !at().plan.some((m) => m.title === "Add a goodbye file")) fail(`upgrade: ${JSON.stringify(at().plan.map((m) => m.title))}`);
  await hooks.cycle(life.id); // build the upgrade
  if (at().plan.find((m) => m.title === "Add a goodbye file")?.status !== "done") fail(`upgrade build: ${outcomes()}`);
  const ws2 = at().workspace!.dir;
  if (read(path.join(ws2, "hello.txt")) !== "HELLO!\n" || !fs.existsSync(path.join(ws2, "goodbye.txt"))) fail("the work is not in the workspace");
  ContinuousImprover.stop(life.id);
  console.log(`[PASS] a forever session's whole life: ${outcomes()} (plan, build, refine, fix + lesson, goal met, improve, upgrade, build the upgrade)`);

  // 12. A project that is already broken gets that fixed first.
  const broken = path.join(tmp, "broken-proj");
  fs.mkdirSync(broken);
  git(broken, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(broken, "broken.flag"), "x");
  git(broken, "add", "-A");
  git(broken, "commit", "-q", "-m", "start");
  EcosystemStore.upsertProject({
    id: "p-broken", name: "broken", path: broken, root: tmp, kind: "unknown", description: null, stack: [], scripts: {},
    gitBranch: "main", gitRemote: null, gitDirty: 0, gitAhead: 0, gitBehind: 0, lastCommitAt: null, lastCommitSubject: null, hasClaudeMd: false, readmeExcerpt: null
  });
  const repair = ContinuousImprover.start("p-broken", { goal: "A hello file", mode: "complete", checkCommand: `node -e "process.exit(require('fs').existsSync('broken.flag')?1:0)"` });
  await hooks.cycle(repair.id);
  const firstMilestone = hooks.getSession(repair.id)!.plan.find((m) => m.status !== "done");
  if (firstMilestone?.title !== "Make the existing checks pass") fail(`broken project's plan: ${JSON.stringify(hooks.getSession(repair.id)!.plan.map((m) => m.title))}`);
  ContinuousImprover.stop(repair.id);
  console.log("[PASS] a project whose checks already fail gets that fixed first");

  console.log("All continuous-builder checks passed.");
};

// Exit once open sockets have closed: process.exit() while a socket is still
// closing trips a libuv assertion on Windows (exit 127) about one run in three.
const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Continuous smoketest failed:", error?.message ?? error);
    finish(1);
  });
