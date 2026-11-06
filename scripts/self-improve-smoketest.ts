/**
 * Smoketest: Agent Builder improving itself (src/agent/SelfImprover.ts),
 * without a model, in a temporary folder:
 *   - the evidence becomes findings: a parked milestone, a lesson that does not help,
 *     a tool broken on this PC, a game version that would not build
 *   - starting puts a continuous session on its own repository, with those findings as
 *     the goal and its typecheck and smoketests as the check every step must pass
 *   - starting again gives the running session the fresh findings instead of a second session
 *   - a folder that is not Agent Builder is refused
 *
 *   npx tsx scripts/self-improve-smoketest.ts
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "self-improve-"));
process.chdir(tmp);
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";
process.env.MODEL_PROVIDER = "lmstudio";
process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
process.env.MODEL_WAIT_MS = "0";
process.env.CONTINUOUS_NO_LOOP = "1";
process.env.RECONSTRUCT_NO_LOOP = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Smoketest";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "smoketest@example.com";

const fail = (message: string): never => {
  throw new Error(message);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

const main = async () => {
  const { EcosystemStore } = await import("../src/ecosystem/EcosystemStore.js");
  const { ContinuousImprover } = await import("../src/agent/ContinuousImprover.js");
  const { SelfImprover, SELF_CHECK } = await import("../src/agent/SelfImprover.js");
  const { LessonMemory } = await import("../src/learning/LessonMemory.js");
  const { MachineProfile } = await import("../src/learning/MachineProfile.js");
  const hooks = ContinuousImprover.testHooks;

  // Evidence: an OS project with a parked milestone, a game whose version would not build,
  // a lesson applied five times that helped once, and WSL broken here.
  const os1 = path.join(tmp, "os");
  fs.mkdirSync(os1);
  git(os1, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(os1, "README.md"), "# OS\n");
  git(os1, "add", "-A");
  git(os1, "commit", "-q", "-m", "start");
  EcosystemStore.upsertProject({
    id: "os", name: "NexusOS", path: os1, root: tmp, kind: "node", description: null, stack: [], scripts: {},
    gitBranch: "main", gitRemote: null, gitDirty: 0, gitAhead: 0, gitBehind: 0, lastCommitAt: null, lastCommitSubject: null, hasClaudeMd: false, readmeExcerpt: null
  });
  const osSession = ContinuousImprover.start("os", { goal: "Build an OS" });
  hooks.patchSession(osSession.id, {
    plan: [
      { id: "m1", title: "Boot to a shell", detail: "", status: "parked", attempts: 8, note: "checks failing: check-os.mjs", doneAt: null, diagnosis: "bash -n runs WSL bash, which is broken here" },
      { id: "m2", title: "Window manager", detail: "", status: "doing", attempts: 3, note: null, doneAt: null, repeats: 3 }
    ],
    kind: "game",
    releaseError: "The build failed: TS2304 Cannot find name 'kernel'"
  });
  const { lesson } = LessonMemory.recordTaught("build", "smoke: weak lesson", "Always wrap every function in a try/catch that logs and continues.", null);
  for (let i = 0; i < 5; i++) LessonMemory.markApplied([lesson.id]);
  LessonMemory.recordOutcome([lesson.id], true);
  for (let i = 0; i < 4; i++) LessonMemory.recordOutcome([lesson.id], false);
  MachineProfile.setForTest({ platform: "win32", measuredAt: new Date().toISOString(), tools: [{ name: "wsl", state: "broken", detail: "Virtualization is not enabled" }] });

  // 1. The findings.
  const report = await SelfImprover.report();
  const areas = report.findings.map((f) => f.area);
  for (const [area, pattern] of [
    ["continuous", /Boot to a shell.*parked after 8 attempts.*WSL bash/],
    ["continuous", /Window manager.*3 times in a row/],
    ["lessons", /try\/catch.*applied 5 times and helped 1/],
    ["machine", /wsl.*Virtualization/],
    ["games", /kernel/]
  ] as const) {
    if (!report.findings.some((f) => f.area === area && pattern.test(f.evidence))) fail(`no ${area} finding like ${pattern}: ${JSON.stringify(report.findings)}`);
  }
  if (!/Improve Agent Builder itself/.test(report.goal) || !/Boot to a shell/.test(report.goal) || !/never remove or weaken an existing check/i.test(report.goal)) fail("the goal does not carry the findings and the rules");
  console.log(`[PASS] the evidence becomes findings (${[...new Set(areas)].join(", ")}), each with what to change`);

  // 2. A session on its own repository.
  const notSelf = path.join(tmp, "not-agent-builder");
  fs.mkdirSync(notSelf);
  git(notSelf, "init", "-q", "-b", "main");
  process.env.AGENT_BUILDER_ROOT = notSelf;
  let refused = false;
  await SelfImprover.start().catch(() => (refused = true));
  if (!refused) fail("a folder that is not Agent Builder was accepted");

  const self = path.join(tmp, "agent-builder");
  fs.mkdirSync(path.join(self, "src", "agent"), { recursive: true });
  fs.writeFileSync(path.join(self, "src", "agent", "SelfImprover.ts"), "export {};\n");
  fs.writeFileSync(path.join(self, "package.json"), JSON.stringify({ name: "agent-builder", private: true }));
  git(self, "init", "-q", "-b", "main");
  git(self, "add", "-A");
  git(self, "commit", "-q", "-m", "start");
  process.env.AGENT_BUILDER_ROOT = self;
  const { session } = await SelfImprover.start();
  if (session.checkCommand !== SELF_CHECK || !/tsc --noEmit/.test(SELF_CHECK) || !/scripts\/continuous-smoketest\.ts/.test(SELF_CHECK)) fail(`its check: ${session.checkCommand}`);
  if (path.resolve(session.projectPath).toLowerCase() !== path.resolve(self).toLowerCase() || !/Boot to a shell/.test(session.goal) || session.mode !== "forever") fail(`the session: ${JSON.stringify({ path: session.projectPath, mode: session.mode })}`);
  if (SelfImprover.session()?.id !== session.id) fail("the running session is not found");
  console.log("[PASS] a continuous session on its own repository: the findings as its goal, its typecheck and smoketests as its check");

  // 3. Again: the running session is given the fresh findings.
  const again = await SelfImprover.start();
  if (again.session.id !== session.id) fail("a second session was started");
  const notes = hooks.getSession(session.id)!.notes;
  if (notes.length !== 1 || !/Improve Agent Builder itself/.test(notes[0])) fail(`notes: ${notes.length}`);
  console.log("[PASS] starting again gives the running session the fresh findings, not a second session");

  console.log("All self-improvement checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Self-improvement smoketest failed:", error?.message ?? error);
    finish(1);
  });
