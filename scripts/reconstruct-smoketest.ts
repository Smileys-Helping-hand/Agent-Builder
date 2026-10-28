/**
 * Smoketest: the Reconstructor, with a stand-in model and builds, on a
 * throwaway project in a temporary folder:
 *   - it studies the app into a blueprint of features
 *   - rebuilds it from the blueprint, compares feature by feature
 *   - turns what the rebuild missed into lessons, rebuilds the gap in a second round
 *   - keeps the original as a worked example (it is the owner's)
 *   - reports what it has learned (kinds of apps, first-try coverage)
 *   - reads a Git source's licence: open ones may be kept, others teach lessons only
 *
 *   npx tsx scripts/reconstruct-smoketest.ts
 */
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "reconstruct-"));
process.chdir(tmp);
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";
process.env.MODEL_PROVIDER = "lmstudio";
process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
process.env.MODEL_WAIT_MS = "0";
process.env.RECONSTRUCT_NO_LOOP = "1";
process.env.RECONSTRUCT_ALLOW_LOCAL_GIT = "1";
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Smoketest";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "smoketest@example.com";

const fail = (message: string): never => {
  throw new Error(message);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();
const repo = (name: string, files: Record<string, string>) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  for (const [file, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, file), text);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "start");
  return dir;
};

const main = async () => {
  const { EcosystemStore } = await import("../src/ecosystem/EcosystemStore.js");
  const { Reconstructor } = await import("../src/agent/Reconstructor.js");
  const { ModelRouter } = await import("../src/tools/ModelRouter.js");
  const { BuildService } = await import("../src/orchestrator/BuildService.js");
  const { LessonMemory } = await import("../src/learning/LessonMemory.js");

  const app = repo("todo", {
    "README.md": "# Todo\n\nA small task list.",
    "app.js": "export const tasks = [];\nexport const add = (t) => tasks.push({ t, done: false });\nexport const complete = (i) => (tasks[i].done = true);\nexport const open = () => tasks.filter((x) => !x.done);\n"
  });
  EcosystemStore.upsertProject({
    id: "todo", name: "Todo", path: app, root: tmp, kind: "node", description: null, stack: [], scripts: {},
    gitBranch: "main", gitRemote: null, gitDirty: 0, gitAhead: 0, gitBehind: 0, lastCommitAt: null, lastCommitSubject: null, hasClaudeMd: false, readmeExcerpt: null
  });

  // The stand-in model: a blueprint, comparisons that find a gap and then none, and a lesson.
  let compared = 0;
  (ModelRouter as unknown as { generate: (p: string) => Promise<string> }).generate = async (prompt: string) => {
    if (/write its blueprint/.test(prompt)) {
      if (!/app\.js/.test(prompt)) fail("the blueprint was written without reading the code");
      return JSON.stringify({
        title: "Todo",
        purpose: "Keep a list of tasks.",
        kind: "web app",
        stack: "JavaScript",
        features: [
          { name: "Add tasks", detail: "type a task and add it", check: "a new task shows in the list" },
          { name: "Complete tasks", detail: "tick a task off", check: "it shows as done" },
          { name: "Filter open tasks", detail: "show only what is left", check: "done tasks hide" }
        ],
        screens: ["The list"],
        data: ["tasks"],
        techniques: ["derived lists"]
      });
    }
    if (/Check the rebuilt code below/.test(prompt)) {
      compared += 1;
      return JSON.stringify(compared === 1 ? { present: ["F1", "F2"], missing: ["F3"] } : { present: ["F1", "F2", "F3"], missing: [] });
    }
    if (/missed these features/.test(prompt)) {
      return JSON.stringify({ lessons: [{ feature: "Filter open tasks", lesson: "In any list app, give a way to show only the items still open, derived from the full list rather than stored twice." }] });
    }
    return "{}";
  };

  // Stand-in builds: a folder with a file; carrying on is another build.
  const builds = BuildService as unknown as {
    start: (o: { description: string }) => { buildId: string };
    continue: (id: string, o: { instruction?: string }) => { buildId: string };
    isRunning: (id: string) => boolean;
    view: (id: string) => { outputDir: string; bestScore: number; qualityScore: number } | null;
  };
  const dirs = new Map<string, string>();
  const briefs: string[] = [];
  builds.start = (options) => {
    briefs.push(options.description);
    const dir = path.join(tmp, "rebuild");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "index.js"), "// add and complete tasks\n");
    dirs.set("b1", dir);
    return { buildId: "b1" };
  };
  builds.continue = (_id, options) => {
    briefs.push(options.instruction ?? "");
    fs.writeFileSync(path.join(dirs.get("b1")!, "filter.js"), "// filter open tasks\n");
    dirs.set("b2", dirs.get("b1")!);
    return { buildId: "b2" };
  };
  builds.isRunning = () => false;
  builds.view = (id) => (dirs.has(id) ? { outputDir: dirs.get(id)!, bestScore: 82, qualityScore: 82 } : null);

  const queued = Reconstructor.fromProject("todo");
  if (queued.state !== "queued" || !queued.source.canKeep) fail(`queued: ${JSON.stringify(queued)}`);
  await Reconstructor.testHooks.work(queued.id);
  const done = Reconstructor.list().runs.find((r) => r.id === queued.id)!;

  if (done.blueprint?.features.length !== 3) fail(`blueprint: ${JSON.stringify(done.blueprint)}`);
  if (!/Filter open tasks/.test(briefs[0]) || /export const add/.test(briefs[0])) fail("the rebuild brief should list the features and never contain the original code");
  console.log("[PASS] study: a blueprint of 3 features; the rebuild gets the blueprint, never the code");

  if (done.rounds.length !== 2 || done.rounds[0].coverage !== 0.67 || done.rounds[1].coverage !== 1) fail(`rounds: ${JSON.stringify(done.rounds)}`);
  if (!/Filter open tasks/.test(briefs[1])) fail("round two did not ask for the missing feature");
  console.log("[PASS] compare: round one covered 67% (missed Filter open tasks); round two rebuilt the gap: 100%");

  if (!LessonMemory.list("build").some((l) => /still open, derived from the full list/.test(l.lesson))) fail("the lesson was not kept");
  if (!done.keptAsExample) fail("the owner's app was not kept as a worked example");
  if (done.state !== "done") fail(`state ${done.state}`);
  console.log("[PASS] learn: the missed feature became a lesson for every build; the original is kept as a worked example");

  const skills = Reconstructor.skills();
  if (skills.appsRebuilt !== 1 || skills.kinds[0]?.kind !== "web app" || skills.firstTryCoverage.recent !== 0.67) fail(`skills: ${JSON.stringify(skills)}`);
  console.log(`[PASS] skills: ${skills.appsRebuilt} app rebuilt (${skills.kinds[0].kind}), first-try coverage ${Math.round(skills.firstTryCoverage.recent! * 100)}%`);

  // Git sources: an open licence may be kept as an example; a GPL one teaches lessons only.
  const mit = repo("mit-app", { "LICENSE": "MIT License\n\nPermission is hereby granted, free of charge, to any person…", "main.js": "console.log(1)\n" });
  const gpl = repo("gpl-app", { "COPYING": "GNU GENERAL PUBLIC LICENSE\nVersion 3", "main.js": "console.log(2)\n" });
  const fromMit = await Reconstructor.fromGit(pathToFileURL(mit).href);
  const fromGpl = await Reconstructor.fromGit(pathToFileURL(gpl).href);
  if (fromMit.source.license !== "MIT" || !fromMit.source.canKeep) fail(`MIT: ${JSON.stringify(fromMit.source)}`);
  if (fromGpl.source.license !== "GPL" || fromGpl.source.canKeep) fail(`GPL: ${JSON.stringify(fromGpl.source)}`);
  if (!fs.existsSync(path.join(fromMit.source.path, "main.js"))) fail("not cloned");
  let refused = false;
  await Reconstructor.fromGit("ftp://example.com/repo").catch(() => (refused = true));
  if (!refused) fail("a non-https address was accepted");
  console.log("[PASS] Git sources: cloned; MIT may be kept as an example, GPL teaches lessons only; only https addresses");

  console.log("All Reconstructor checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Reconstructor smoketest failed:", error?.message ?? error);
    finish(1);
  });
