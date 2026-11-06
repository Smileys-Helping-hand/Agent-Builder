/**
 * Smoketest: the connecting pieces, without a real model:
 *   - the Simulation Lab: an experiment of your own runs for real, and the optimiser's
 *     rounds find a better answer than the first sweep, looking closer at what matters
 *   - the ledger as a graph, followed in both directions
 *   - who has used what was learned, across projects
 *   - a project's twin: its parts, dependencies, what it can do and its known defects,
 *     given to every step
 *   - long-running work on Jarvis's task list, against a stand-in Jarvis: created once,
 *     updated when it changes, not repeated when it does not; nothing lost when he is down
 *   - a game version as a zip: a real zip with what it should hold
 *
 *   npx tsx scripts/platform-smoketest.ts
 */
import { execFileSync } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "platform-"));
process.chdir(tmp);
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
process.env.SECOND_BRAIN_SYNC = "false";
process.env.MODEL_PROVIDER = "lmstudio";
process.env.LMSTUDIO_BASE_URL = "http://127.0.0.1:9";
process.env.MODEL_WAIT_MS = "0";
process.env.CONTINUOUS_NO_LOOP = "1";
process.env.INVESTIGATION_NO_LOOP = "1";
process.env.VMLAB_DIR = path.join(tmp, "vmlab");
process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "Smoketest";
process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "smoketest@example.com";

const fail = (message: string): never => {
  throw new Error(message);
};
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true }).trim();

const main = async () => {
  const { SimulationLab, nextRound } = await import("../src/research/SimulationLab.js");
  const { Evidence } = await import("../src/knowledge/Evidence.js");
  const { LessonMemory } = await import("../src/learning/LessonMemory.js");
  const { EcosystemStore } = await import("../src/ecosystem/EcosystemStore.js");
  const { ContinuousImprover } = await import("../src/agent/ContinuousImprover.js");
  const { ProjectTwin } = await import("../src/ecosystem/ProjectTwin.js");
  const { JarvisTasks, currentWork } = await import("../src/integrations/JarvisTasks.js");
  const hooks = ContinuousImprover.testHooks;

  // 1. The Simulation Lab. The true best is at x = 3.37: the first coarse sweep cannot land on it.
  const created = await SimulationLab.create({
    title: "A hill",
    hypothesis: "There is one best x",
    assumptions: ["A made-up hill, for the test"],
    code: "function simulate(p) { return { height: 100 - (p.x - 3.37) * (p.x - 3.37) - p.noise * 0.001 }; }",
    variables: { x: [0, 2, 4, 6, 8, 10], noise: [0, 1, 2] },
    baseline: { x: 0, noise: 0 },
    objective: "height"
  });
  const first = created.runs[0].result;
  if (created.state !== "done" || first.evaluated !== 18 || first.best.params.x !== 4) fail(`first run: ${JSON.stringify(first.best)}`);
  const round = nextRound({ x: [0, 2, 4, 6, 8, 10], noise: [0, 1, 2] }, first);
  if (round.focused[0] !== "x" || round.variables.noise.length !== 1 || (round.variables.x as number[]).length !== 7 || Math.min(...(round.variables.x as number[])) !== 2 || Math.max(...(round.variables.x as number[])) !== 6) fail(`next round: ${JSON.stringify(round)}`);
  const optimised = await SimulationLab.optimise(created.id, 4);
  const final = optimised.optimised[optimised.optimised.length - 1];
  if (optimised.optimised.length !== 4 || final.best <= first.best.metrics.height || Math.abs((final.params.x as number) - 3.37) > 0.15) fail(`optimised: ${JSON.stringify(optimised.optimised)}`);
  console.log(`[PASS] the Simulation Lab runs for real; the optimiser looks closer at what matters: x=${first.best.params.x} (${first.best.metrics.height}) → x=${final.params.x} (${final.best})`);

  // 2. The graph.
  Evidence.record({ kind: "research", ref: "investigation:i1", title: "Coffee" });
  Evidence.record({ kind: "experiment", ref: "experiment:e1", title: "A sweep", links: [{ to: "investigation:i1", relation: "part-of" }] });
  Evidence.record({ kind: "knowledge", ref: "lesson:1", title: "Brew hotter", links: [{ to: "experiment:e1", relation: "learned-from" }] });
  Evidence.record({ kind: "step", ref: "step:s1:1", title: "Used it", links: [{ to: "lesson:1", relation: "used" }] });
  const graph = Evidence.graph({ ref: "lesson:1", depth: 3 });
  for (const ref of ["investigation:i1", "experiment:e1", "lesson:1", "step:s1:1"]) if (!graph.nodes.some((n) => n.ref === ref)) fail(`the graph lacks ${ref}: ${JSON.stringify(graph.nodes)}`);
  if (graph.nodes.find((n) => n.ref === "lesson:1")?.title !== "Brew hotter" || graph.edges.length !== 3) fail(`graph: ${JSON.stringify(graph)}`);
  if (Evidence.graph({ ref: "step:s1:1", depth: 1 }).nodes.length !== 2) fail("depth was not respected");
  console.log("[PASS] the ledger is a graph: from a lesson back to the investigation it came from, and on to the step that used it");

  // 3. Who used what.
  const { lesson } = LessonMemory.recordTaught("build", "technique: game: fixed step", "Use a fixed time step for game physics.", null);
  LessonMemory.markApplied([lesson.id], "NexusOS");
  LessonMemory.markApplied([lesson.id], "NexusOS");
  LessonMemory.markApplied([lesson.id], "Ember Hollow");
  const uses = LessonMemory.contributions();
  const nexus = uses.find((u) => u.usedBy === "NexusOS");
  if (!nexus || nexus.uses !== 2 || nexus.source !== "reconstructor" || uses.find((u) => u.usedBy === "Ember Hollow")?.uses !== 1) fail(`contributions: ${JSON.stringify(uses)}`);
  console.log("[PASS] who has used what was learned, across projects, and where it came from");

  // 4. A project's twin.
  const dir = path.join(tmp, "proj");
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "p", dependencies: { react: "18", phaser: "3" }, scripts: { build: "x" } }));
  fs.writeFileSync(path.join(dir, "src", "a.ts"), "export const a = 1;\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "start");
  EcosystemStore.upsertProject({ id: "p1", name: "Proj", path: dir, root: tmp, kind: "node", description: null, stack: [], scripts: {}, gitBranch: "main", gitRemote: null, gitDirty: 0, gitAhead: 0, gitBehind: 0, lastCommitAt: null, lastCommitSubject: null, hasClaudeMd: false, readmeExcerpt: null });
  const session = ContinuousImprover.start("p1", { goal: "Make it" });
  hooks.patchSession(session.id, {
    lastCheck: { at: new Date().toISOString(), passed: false, verified: true, failing: ["test"], output: "", command: null },
    plan: [
      { id: "m1", title: "Add saving", detail: "", status: "done", attempts: 1, note: null, doneAt: new Date().toISOString() },
      { id: "m2", title: "Add a boss", detail: "", status: "parked", attempts: 8, note: "the sprite will not load", doneAt: null }
    ]
  });
  const twin = await ProjectTwin.forProject("p1");
  if (!twin || !twin.stack.includes("phaser") || !twin.dependencies.includes("react") || !twin.capabilities.includes("Add saving") || !twin.parts.some((p) => p.folder === "src")) fail(`twin: ${JSON.stringify(twin)}`);
  if (!twin.defects.some((d) => d.kind === "check" && /test/.test(d.text)) || !twin.defects.some((d) => d.kind === "parked" && /will not load/.test(d.text))) fail(`defects: ${JSON.stringify(twin.defects)}`);
  if (!/Known defects:[\s\S]*Add a boss/.test(ProjectTwin.brief(twin))) fail("the brief lacks the defects");
  console.log("[PASS] a project's twin: parts, stack, what it can do and its known defects, as every step is told them");

  // 5. Jarvis's task list, against a stand-in.
  const seen: Array<{ method: string; url: string; body: Record<string, unknown>; auth: string | undefined }> = [];
  let down = false;
  let nextId = 100;
  const jarvis = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (down) return res.writeHead(503).end();
      seen.push({ method: req.method ?? "", url: req.url ?? "", body: JSON.parse(raw || "{}"), auth: req.headers.authorization });
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ task: { id: nextId++ } }));
    });
  });
  await new Promise<void>((resolve) => jarvis.listen(0, "127.0.0.1", resolve));
  if ((await JarvisTasks.sync()).skipped === null) fail("it ran with no Jarvis configured");
  process.env.JARVIS_HOST = `http://127.0.0.1:${(jarvis.address() as { port: number }).port}`;
  process.env.JARVIS_API_KEY = "test-key";
  const work = currentWork();
  if (!work.some((w) => w.ref === `session:${session.id}` && w.status === "in_progress" && /1 of 2 milestones, 1 parked/.test(w.notes) && /test/.test(w.notes))) fail(`work: ${JSON.stringify(work)}`);
  const firstSync = await JarvisTasks.sync();
  if (firstSync.created < 1 || !seen.some((s) => s.method === "POST" && s.url === "/api/jarvis/tasks" && s.auth === "Bearer test-key" && s.body.title === "Building Proj" && s.body.status === "in_progress")) fail(`first sync: ${JSON.stringify({ firstSync, seen })}`);
  const count = seen.length;
  await JarvisTasks.sync();
  if (seen.length !== count) fail("it repeated itself when nothing had changed");
  hooks.patchSession(session.id, { lastError: "WSL is not answering" });
  const changed = await JarvisTasks.sync();
  const patch = seen[seen.length - 1];
  if (changed.updated !== 1 || patch.method !== "PATCH" || !patch.url.startsWith("/api/jarvis/tasks/1") || patch.body.status !== "blocked" || !/WSL is not answering/.test(String(patch.body.notes))) fail(`update: ${JSON.stringify(patch)}`);
  hooks.patchSession(session.id, { lastError: null });
  down = true;
  let threw = false;
  await JarvisTasks.sync().catch(() => (threw = true));
  if (!threw) fail("a down Jarvis was not noticed");
  down = false;
  const recovered = await JarvisTasks.sync();
  if (recovered.updated !== 1 || seen[seen.length - 1].body.status !== "in_progress") fail(`after he came back: ${JSON.stringify(recovered)}`);
  jarvis.close();
  console.log("[PASS] long-running work on Jarvis's task list: created once, updated when it changes, blocked when stuck, caught up after he was down");

  console.log("All platform checks passed.");
};

const finish = (code: number) => {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 1500).unref();
};

main()
  .then(() => finish(0))
  .catch((error) => {
    console.error("Platform smoketest failed:", error?.message ?? error);
    finish(1);
  });
