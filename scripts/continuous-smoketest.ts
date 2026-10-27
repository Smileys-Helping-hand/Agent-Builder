/**
 * Smoketest: continuous improvement's approval gate — the part that touches a
 * real repository. On a throwaway git project in a temporary folder:
 *   - an approved change is applied and committed on the live branch, and only its files
 *   - a change to a file the owner edited since is a conflict: nothing applied, the edit kept
 *   - approvals and rejections reward the improve.kind policy
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
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Smoketest";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "smoketest@example.com";

const fail = (message: string): never => {
  throw new Error(message);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

const main = async () => {
  const { ProjectBuilds } = await import("../src/ecosystem/ProjectBuilds.js");
  const { BuildService } = await import("../src/orchestrator/BuildService.js");
  const { ContinuousImprover } = await import("../src/agent/ContinuousImprover.js");
  const { Reinforcement } = await import("../src/learning/Reinforcement.js");

  // A project with two files on its live branch.
  const project = path.join(tmp, "proj");
  fs.mkdirSync(project);
  git(project, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(project, "app.js"), "export const greet = () => 'hi';\n");
  fs.writeFileSync(path.join(project, "util.js"), "export const add = (a, b) => a + b;\n");
  git(project, "add", "-A");
  git(project, "commit", "-q", "-m", "start");

  // An improvement as the loop leaves it: a build on a copy that changed a file and committed it.
  const propose = async (file: string, content: string, title: string) => {
    const record = await ProjectBuilds.start({ id: "p1", name: "proj", path: project }, title, { startedBy: "smoketest" });
    for (let i = 0; i < 120 && BuildService.isRunning(record.buildId); i++) await new Promise((r) => setTimeout(r, 500));
    if (BuildService.isRunning(record.buildId)) BuildService.control(record.buildId, "stop");
    fs.writeFileSync(path.join(record.workDir, file), content);
    git(record.workDir, "add", "-A");
    git(record.workDir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", title);
    const kind = Reinforcement.choose("improve.kind", { bucket: "p1", agent: "smoketest" });
    const store = JSON.parse(fs.existsSync("data/agent/continuous.json") ? fs.readFileSync("data/agent/continuous.json", "utf8") : '{"sessions":[],"candidates":[]}');
    const candidate = {
      id: `imp_${store.candidates.length + 1}`,
      sessionId: "s1",
      projectId: "p1",
      projectName: "proj",
      buildId: record.buildId,
      title,
      why: "test",
      kind: kind.arm.id,
      instruction: title,
      state: "awaiting",
      createdAt: new Date().toISOString(),
      decidedAt: null,
      files: [file],
      test: { passed: true, score: 100, failing: [] },
      commit: null,
      note: null,
      episodeId: kind.episodeId
    };
    store.candidates.push(candidate);
    fs.mkdirSync("data/agent", { recursive: true });
    fs.writeFileSync("data/agent/continuous.json", JSON.stringify(store));
    return candidate;
  };

  // 1. Approve: applied and committed on main, only that file.
  const good = await propose("app.js", "export const greet = (name = 'you') => `hi ${name}`;\n", "Greet by name");
  fs.writeFileSync(path.join(project, "notes.txt"), "the owner's own unrelated work\n"); // must not be swept into the commit
  const approved = await ContinuousImprover.approve(good.id);
  if (approved.state !== "approved" || !approved.commit) fail(`approve: ${JSON.stringify(approved)}`);
  if (!fs.readFileSync(path.join(project, "app.js"), "utf8").includes("name = 'you'")) fail("the change was not applied");
  if (git(project, "rev-parse", "--abbrev-ref", "HEAD") !== "main" || approved.commit.branch !== "main") fail("not committed on the live branch");
  const committed = git(project, "show", "--name-only", "--format=", "HEAD").split("\n").filter(Boolean);
  if (committed.join(",") !== "app.js") fail(`the commit took more than the change: ${committed}`);
  if (git(project, "status", "--porcelain").indexOf("notes.txt") < 0) fail("the owner's own file was touched");
  console.log(`[PASS] approve: applied and committed on main (${approved.commit.hash.slice(0, 7)}), only app.js; the owner's other work untouched`);

  // 2. Conflict: the owner edited util.js after the improvement was built from it.
  const clash = await propose("util.js", "export const add = (a, b) => Number(a) + Number(b);\n", "Coerce numbers in add");
  fs.writeFileSync(path.join(project, "util.js"), "export const add = (a, b) => a + b; // the owner's edit\n");
  const conflicted = await ContinuousImprover.approve(clash.id);
  if (conflicted.state !== "conflict") fail(`expected a conflict, got ${conflicted.state}`);
  if (!fs.readFileSync(path.join(project, "util.js"), "utf8").includes("the owner's edit")) fail("the owner's edit was overwritten");
  console.log("[PASS] conflict: a file the owner changed since is refused; their edit stays");

  // 3. Reject, and the learning.
  const rejected = ContinuousImprover.reject(clash.id, "not needed");
  if (rejected.state !== "rejected") fail("reject failed");
  const episodes = Reinforcement.recent(10).filter((e) => e.policy === "improve.kind");
  const rewards = episodes.map((e) => e.reward).sort();
  if (JSON.stringify(rewards) !== JSON.stringify([0, 1])) fail(`improve.kind rewards ${JSON.stringify(rewards)}`);
  console.log("[PASS] decisions teach it: approved → 1, rejected → 0 for that kind of improvement");

  console.log("All continuous-improvement checks passed.");
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
