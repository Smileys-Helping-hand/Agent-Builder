/**
 * Iterations — every step of a continuous build, open to inspection, while it
 * runs and for good after.
 *
 *   timeline   each iteration: status, what it set out to do, its commit, whether
 *              its checks passed; the one in progress first
 *   detail     for one iteration: the changes (files, lines, functions touched,
 *              real diffs from git); why (the objective, the diagnosis, the
 *              approach chosen, the build's passes and decisions); what it learned
 *              (lessons created, approaches that worked or failed, what the
 *              ledger recorded); its tests (checks, build passes, VM test runs);
 *              and your feedback on it, each with what it led to
 *   compare    any two iterations side by side, from real commits and results
 *   feedback   your comment on an iteration: recorded, linked to it, and given
 *              to the session as an instruction, so it leads to follow-up work
 *
 * It records no reasoning of its own: what shows is what the steps did and
 * recorded. Numbers come from git and the checks, never from a model's opinion.
 */
import { execFile } from "child_process";
import { promisify } from "util";

import { Evidence, type EvidenceRecord } from "../knowledge/Evidence.js";
import { VmTests } from "../lab/VmTests.js";
import { LessonMemory, type Lesson } from "../learning/LessonMemory.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { ContinuousImprover, type ImproveSession, type Step } from "./ContinuousImprover.js";

const run = promisify(execFile);
const MAX_PATCH = 120_000;

const git = async (dir: string, args: string[]): Promise<string> => {
  const { stdout } = await run("git", args, { cwd: dir, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return stdout;
};

export type IterationStatus = "in-progress" | "completed" | "no-change" | "failed" | "rolled-back" | "stopped";

export interface IterationEntry {
  n: number;
  at: string;
  startedAt: string | null;
  stage: string;
  title: string;
  status: IterationStatus;
  note: string | null;
  commit: string | null;
  success: boolean | null;
  buildId: string | null;
  checksPassed: boolean | null;
  failing: string[];
  vmRun: string | null;
}

const statusOf = (step: Step): IterationStatus =>
  step.outcome === "kept" ? "completed" : step.outcome === "rolled-back" ? "rolled-back" : step.outcome === "failed" ? "failed" : step.outcome === "stopped" ? "stopped" : "no-change";

const session = (id: string): ImproveSession => {
  const found = ContinuousImprover.testHooks.getSession(id);
  if (!found) throw new Error("Unknown session.");
  return found;
};

const numbered = (s: ImproveSession) => s.journal.map((step, index) => ({ step, n: step.n ?? index + 1 }));

const entry = ({ step, n }: { step: Step; n: number }): IterationEntry => ({
  n,
  at: step.at,
  startedAt: step.startedAt ?? null,
  stage: step.stage,
  title: step.title,
  status: statusOf(step),
  note: step.note,
  commit: step.commit,
  success: step.success ?? null,
  buildId: step.buildId ?? null,
  checksPassed: step.check?.passed ?? null,
  failing: step.check?.failing ?? [],
  vmRun: step.check?.vmRun ?? null
});

export interface FileChange {
  path: string;
  change: "added" | "modified" | "deleted" | "renamed";
  added: number;
  removed: number;
}

const changesBetween = async (dir: string, from: string, to: string | null): Promise<FileChange[]> => {
  const range = to ? [from, to] : [from];
  const status = (await git(dir, ["diff", "--no-renames", "--name-status", "-z", ...range])).split("\0").filter(Boolean);
  const kinds = new Map<string, FileChange["change"]>();
  for (let i = 0; i + 1 < status.length; i += 2) kinds.set(status[i + 1], status[i] === "A" ? "added" : status[i] === "D" ? "deleted" : "modified");
  const files: FileChange[] = [];
  for (const line of (await git(dir, ["diff", "--no-renames", "--numstat", ...range])).split("\n").filter(Boolean)) {
    const [added, removed, ...name] = line.split("\t");
    const file = name.join("\t");
    files.push({ path: file, change: kinds.get(file) ?? "modified", added: Number(added) || 0, removed: Number(removed) || 0 });
  }
  return files;
};

/** Function, class and component names the diff's hunks are in, and new ones it adds. */
const symbolsIn = (patch: string): string[] => {
  const names = new Set<string>();
  const declared = /(?:function\s+|class\s+|interface\s+|type\s+|(?:const|let|var)\s+|def\s+|fn\s+)([A-Za-z_$][\w$]*)/;
  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      const match = declared.exec(line.slice(line.indexOf("@@", 2) + 2));
      if (match) names.add(match[1]);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      const match = /^\+\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+|class\s+|interface\s+|type\s+|const\s+(?=[A-Z_]|\w+\s*=\s*(?:async\s*)?\())([A-Za-z_$][\w$]*)/.exec(line);
      if (match) names.add(match[1]);
    }
  }
  return [...names].slice(0, 60);
};

const dependencyFiles = /(^|\/)(package\.json|requirements\.txt|pyproject\.toml|Cargo\.toml|go\.mod|packages\.list)$/;
const configFiles = /(^|\/)(\.env[^/]*|.*\.config\.[a-z]+|tsconfig[^/]*\.json|Makefile|Dockerfile|.*\.ya?ml|.*\.toml)$/;

const lessonsBetween = (from: string | null, to: string): Lesson[] => {
  const all = [...LessonMemory.list("build")];
  return all.filter((l) => l.createdAt <= to && (!from || l.createdAt > from)).slice(0, 40);
};

/** What a step cost and decided, from the build that ran it. */
const buildOf = (buildId: string | null) => {
  if (!buildId) return null;
  const view = BuildService.view(buildId);
  if (!view) return null;
  const events = (view.events ?? []).filter((e) => e.kind === "lesson" || e.kind === "guidance" || e.kind === "repair" || e.kind === "warn" || e.kind === "error").slice(-40);
  return {
    buildId,
    state: view.state,
    startedAt: view.startedAt,
    finishedAt: view.finishedAt,
    qualityScore: view.qualityScore ?? null,
    passes: (view.iterationDetail ?? []).map((p) => ({
      iteration: p.iteration,
      at: p.at,
      commit: p.commit ?? null,
      qualityScore: p.qualityScore,
      passed: p.passed,
      status: p.status,
      improvements: p.improvements.slice(0, 12),
      checks: p.checks.map((c) => ({ name: c.name, passed: c.passed, applicable: c.applicable })),
      blocker: p.blocker ? { name: p.blocker.name, output: p.blocker.output.slice(-1500) } : null
    })),
    events
  };
};

export const Iterations = {
  timeline(sessionId: string): { current: IterationEntry | null; iterations: IterationEntry[]; stage: string; state: string; phase: string } {
    const s = session(sessionId);
    const iterations = numbered(s).map(entry).reverse();
    const last = iterations[0]?.n ?? 0;
    const running = s.state !== "stopped";
    const current: IterationEntry | null = running
      ? {
          n: last + 1,
          at: new Date().toISOString(),
          startedAt: s.currentBuildId ? BuildService.view(s.currentBuildId)?.startedAt ?? null : null,
          stage: s.stage,
          title: s.phase,
          status: "in-progress",
          note: null,
          commit: null,
          success: null,
          buildId: s.currentBuildId,
          checksPassed: null,
          failing: [],
          vmRun: null
        }
      : null;
    return { current, iterations, stage: s.stage, state: s.state, phase: s.phase };
  },

  /** One iteration in full; n = "current" for the one in progress. */
  async detail(sessionId: string, n: number | "current") {
    const s = session(sessionId);
    const dir = s.workspace?.dir ?? null;
    const steps = numbered(s);
    const taskRef = `session:${sessionId}`;

    if (n === "current") {
      const previous = steps[steps.length - 1]?.step ?? null;
      const from = [...steps].reverse().find((x) => x.step.commit)?.step.commit ?? s.workspace?.approvedCommit ?? null;
      let changes: FileChange[] = [];
      let patch = "";
      let commits: string[] = [];
      if (dir && from) {
        // Committed since the last iteration, and what is being written right now.
        changes = await changesBetween(dir, from, null).catch(() => []);
        patch = (await git(dir, ["diff", from]).catch(() => "")).slice(0, MAX_PATCH);
        commits = (await git(dir, ["log", "--format=%h %s", `${from}..HEAD`, "-30"]).catch(() => "")).split("\n").filter(Boolean);
      }
      return {
        entry: Iterations.timeline(sessionId).current,
        objective: s.phase,
        milestone: s.plan.find((m) => m.status === "doing") ?? null,
        changes: { from, to: null, files: changes, patch, patchCut: patch.length >= MAX_PATCH, symbols: symbolsIn(patch), dependencies: changes.filter((f) => dependencyFiles.test(f.path)).map((f) => f.path), config: changes.filter((f) => configFiles.test(f.path)).map((f) => f.path), commits },
        build: buildOf(s.currentBuildId),
        learning: { lessons: lessonsBetween(previous?.at ?? null, new Date().toISOString()), evidence: previous ? Evidence.between(taskRef, previous.at, new Date().toISOString()) : [] as EvidenceRecord[] },
        testing: { check: s.lastCheck, vmRuns: [] as ReturnType<typeof vmRunsFor> },
        feedback: [] as EvidenceRecord[]
      };
    }

    const index = steps.findIndex((x) => x.n === n);
    if (index < 0) throw new Error("No such iteration.");
    const { step } = steps[index];
    const previous = index > 0 ? steps[index - 1].step : null;
    const from = step.from ?? [...steps.slice(0, index)].reverse().find((x) => x.step.commit)?.step.commit ?? s.workspace?.baseCommit ?? null;
    let files: FileChange[] = [];
    let patch = "";
    let commits: string[] = [];
    let gone: string | null = null;
    if (dir && step.commit && from) {
      try {
        files = await changesBetween(dir, from, step.commit);
        patch = (await git(dir, ["diff", from, step.commit])).slice(0, MAX_PATCH);
        commits = (await git(dir, ["log", "--format=%h %s", `${from}..${step.commit}`, "-30"])).split("\n").filter(Boolean);
      } catch {
        gone = "Its commit is no longer in the workspace.";
      }
    }
    const ref = `step:${sessionId}:${n}`;
    const trace = Evidence.trace(ref);
    const feedback = trace.incoming.filter((l) => l.relation === "feedback-on").flatMap((l) => Evidence.trace(l.from).records);
    return {
      entry: entry(steps[index]),
      objective: step.title,
      milestone: s.plan.find((m) => step.title.includes(m.title)) ?? null,
      changes: {
        from,
        to: step.commit,
        files,
        patch,
        patchCut: patch.length >= MAX_PATCH,
        symbols: symbolsIn(patch),
        dependencies: files.filter((f) => dependencyFiles.test(f.path)).map((f) => f.path),
        config: files.filter((f) => configFiles.test(f.path)).map((f) => f.path),
        commits,
        gone
      },
      build: buildOf(step.buildId ?? null),
      learning: { lessons: lessonsBetween(previous?.at ?? step.startedAt ?? null, step.at), evidence: previous ? Evidence.between(taskRef, previous.at, step.at) : ([] as EvidenceRecord[]) },
      testing: { check: step.check ?? null, vmRuns: vmRunsFor(sessionId, previous?.at ?? null, step.at) },
      feedback
    };
  },

  /** One file's diff in an iteration. */
  async fileDiff(sessionId: string, n: number, file: string): Promise<string> {
    const s = session(sessionId);
    const steps = numbered(s);
    const index = steps.findIndex((x) => x.n === n);
    if (index < 0 || !s.workspace) throw new Error("No such iteration.");
    const { step } = steps[index];
    const from = step.from ?? [...steps.slice(0, index)].reverse().find((x) => x.step.commit)?.step.commit ?? s.workspace.baseCommit;
    if (!step.commit) return "";
    return (await git(s.workspace.dir, ["diff", from, step.commit, "--", file])).slice(0, MAX_PATCH);
  },

  /** Two iterations: what changed between them and how their results differ. Only real numbers. */
  async compare(sessionId: string, a: number, b: number) {
    const s = session(sessionId);
    const steps = numbered(s);
    const find = (n: number) => steps.find((x) => x.n === n)?.step ?? null;
    const [first, second] = a <= b ? [find(a), find(b)] : [find(b), find(a)];
    if (!first || !second) throw new Error("No such iteration.");
    if (!s.workspace) throw new Error("Its workspace is gone.");
    const commitOf = (step: Step) => step.commit ?? [...steps].reverse().find((x) => x.step.at <= step.at && x.step.commit)?.step.commit ?? s.workspace!.baseCommit;
    const from = commitOf(first);
    const to = commitOf(second);
    const files = from === to ? [] : await changesBetween(s.workspace.dir, from, to).catch(() => []);
    const patch = from === to ? "" : (await git(s.workspace.dir, ["diff", from, to]).catch(() => "")).slice(0, MAX_PATCH);
    const side = (step: Step, vm: ReturnType<typeof vmRunsFor>) => ({
      n: step.n ?? null,
      at: step.at,
      title: step.title,
      status: statusOf(step),
      commit: step.commit,
      checksPassed: step.check?.passed ?? null,
      failing: step.check?.failing ?? [],
      vmRun: vm[vm.length - 1] ?? null,
      buildScore: step.buildId ? BuildService.view(step.buildId)?.qualityScore ?? null : null
    });
    const vmUpTo = (step: Step) => vmRunsFor(sessionId, null, step.at);
    return {
      a: side(first, vmUpTo(first)),
      b: side(second, vmUpTo(second)),
      files,
      added: files.reduce((sum, f) => sum + f.added, 0),
      removed: files.reduce((sum, f) => sum + f.removed, 0),
      symbols: symbolsIn(patch),
      patch,
      patchCut: patch.length >= MAX_PATCH,
      lessonsBetween: lessonsBetween(first.at, second.at),
      stepsBetween: steps.filter((x) => x.step.at > first.at && x.step.at <= second.at).length
    };
  },

  /** Your comment on an iteration: kept, linked, and handed to the session as an instruction. */
  feedback(sessionId: string, n: number, input: { text: string; kind?: string; by?: string }) {
    const s = session(sessionId);
    const found = numbered(s).find((x) => x.n === n);
    if (!found) throw new Error("No such iteration.");
    const text = input.text.trim().slice(0, 3000);
    if (!text) throw new Error("Write the feedback.");
    const kind = (input.kind ?? "comment").slice(0, 30);
    const ref = `feedback:step:${sessionId}:${n}:${Date.now().toString(36)}`;
    const running = s.state !== "stopped";
    if (running) ContinuousImprover.instruct(sessionId, `Your ${kind} on "${found.step.title}" (iteration ${n}): ${text}`);
    Evidence.record({
      kind: "feedback",
      ref,
      task: `session:${sessionId}`,
      agent: input.by ?? "owner",
      title: `${kind} on iteration ${n}: ${text.slice(0, 120)}`,
      outcome: running ? "handed to the session" : "recorded; the session is stopped",
      data: { text, kind, iteration: n, step: found.step.title },
      links: [{ to: `step:${sessionId}:${n}`, relation: "feedback-on" }]
    });
    return { ok: true, followUp: running ? "The session has it as a new instruction: the step in progress stops and the roadmap is revised." : "Recorded. Carry the session on and it will see it." };
  }
};

function vmRunsFor(sessionId: string, from: string | null, to: string) {
  return VmTests.list(200)
    .filter((run) => run.task === `session:${sessionId}` && run.startedAt <= to && (!from || run.startedAt > from))
    .map((run) => ({ id: run.id, state: run.state, counts: run.counts, build: run.build, startedAt: run.startedAt }))
    .reverse();
}
