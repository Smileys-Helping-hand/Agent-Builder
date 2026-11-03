/**
 * SelfImprover — Agent Builder improving its own code from what it has learned.
 *
 * Everything the builder does leaves evidence: milestones it parked after
 * failing the same way again and again, lessons that are applied and do not
 * help, choices (RL policies) whose rewards are falling, features its
 * rebuilds keep missing, game versions that would not build, tools broken on
 * this PC. report() gathers that evidence into findings, each with what to
 * change in the builder.
 *
 * start() hands the findings to the continuous builder as the goal for a
 * session on Agent Builder's own repository: it plans, changes the builder's
 * code (prompts, planning, checks, recovery), and must pass the typecheck and
 * the builder's own smoketests after every step. Nothing reaches the running
 * builder until you approve a delivery, like any other project's; a session
 * already running is given the fresh report as a new instruction instead.
 */
import fs from "fs";
import path from "path";

import { EcosystemStore } from "../ecosystem/EcosystemStore.js";
import { ProjectScanner } from "../ecosystem/ProjectScanner.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { MachineProfile } from "../learning/MachineProfile.js";
import { Reinforcement } from "../learning/Reinforcement.js";
import { ContinuousImprover, type ImproveSession } from "./ContinuousImprover.js";
import { Reconstructor } from "./Reconstructor.js";

export interface Finding {
  area: "continuous" | "lessons" | "choices" | "reconstruct" | "games" | "machine";
  /** What happened, with numbers. */
  evidence: string;
  /** What to change in the builder. */
  change: string;
}

export interface SelfReport {
  at: string;
  findings: Finding[];
  /** The goal a self-improvement session is given. */
  goal: string;
}

/** The checks every self-improvement step must pass: the typecheck and the builder's core smoketests. */
export const SELF_CHECK =
  process.env.SELF_CHECK_COMMAND ||
  "npx tsc --noEmit -p . && npm run test:continuous && npm run test:rl && npm run test:reconstruct && npm run test:net-kit && npm run test:game-director && npm run test:self-improve";

const root = () => path.resolve(process.env.AGENT_BUILDER_ROOT ?? process.cwd());
const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

const selfProject = () => EcosystemStore.listProjects().find((p) => same(p.path, root())) ?? null;

export const SelfImprover = {
  async report(): Promise<SelfReport> {
    const findings: Finding[] = [];
    const { sessions } = ContinuousImprover.list();

    // Milestones it could not get past, and ones failing the same way over and over.
    for (const session of sessions) {
      for (const m of session.plan) {
        if (m.status === "parked") {
          findings.push({
            area: "continuous",
            evidence: `"${m.title}" in ${session.projectName} was parked after ${m.attempts} attempts${m.note ? ` (${m.note})` : ""}${m.diagnosis ? `; diagnosed: ${m.diagnosis}` : ""}.`,
            change: "Make the continuous builder get past this kind of milestone: better instructions, splitting it, or recognising and working around the cause."
          });
        } else if ((m.repeats ?? 0) >= 3) {
          findings.push({
            area: "continuous",
            evidence: `"${m.title}" in ${session.projectName} has failed the same way ${m.repeats} times in a row.`,
            change: "Make a step that keeps failing identically change approach sooner, or diagnose the root cause earlier."
          });
        }
      }
      const failed = session.journal.filter((s) => s.outcome === "failed").slice(-20);
      const reasons = new Map<string, number>();
      for (const step of failed) {
        const reason = (step.note ?? step.title).replace(/\d+/g, "N").slice(0, 120);
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      }
      for (const [reason, count] of reasons) {
        if (count >= 3) findings.push({ area: "continuous", evidence: `${session.projectName}: a step failed ${count} times with "${reason}".`, change: "Find why the builder itself fails here and fix it." });
      }
      if (session.kind === "game" && session.releaseError) {
        findings.push({
          area: "games",
          evidence: `${session.projectName}: the last version did not build: ${session.releaseError.slice(0, 300)}`,
          change: "Make game steps leave the game building (npm run build) at the end of every milestone, or fix the release step."
        });
      }
    }

    // Lessons that are applied and do not help.
    const useless = LessonMemory.list("build").filter((l) => l.timesApplied >= 4 && l.utility < 0.35);
    for (const lesson of useless.slice(0, 8)) {
      findings.push({
        area: "lessons",
        evidence: `The lesson "${lesson.lesson.slice(0, 160)}" was applied ${lesson.timesApplied} times and helped ${lesson.timesHelped}.`,
        change: "Make lesson selection stop offering lessons that do not help, or rewrite this one so it does."
      });
    }

    // Choices whose results are getting worse.
    for (const policy of Reinforcement.stats() as Array<{ id: string; label: string; trend?: { recent: number | null; earlier: number | null; decided: number } }>) {
      const trend = policy.trend;
      if (!trend || trend.recent === null || trend.decided < 20) continue;
      if (trend.earlier !== null && trend.recent < trend.earlier - 0.08) {
        findings.push({
          area: "choices",
          evidence: `${policy.label} (${policy.id}): its average reward fell from ${trend.earlier} to ${trend.recent} over the last ${trend.decided} decided tries.`,
          change: "Find what changed and make this choice's options or reward fit again."
        });
      } else if (trend.recent < 0.3) {
        findings.push({
          area: "choices",
          evidence: `${policy.label} (${policy.id}): its average reward is ${trend.recent}, low across all its options.`,
          change: "Its options are all weak: improve what they instruct or add a better one."
        });
      }
    }

    // Features rebuilds keep missing.
    const missed = new Map<string, number>();
    for (const run of Reconstructor.list().runs) {
      const last = run.rounds[run.rounds.length - 1];
      for (const name of last?.missing ?? []) missed.set(`${run.blueprint?.kind ?? "app"}: ${name}`, (missed.get(`${run.blueprint?.kind ?? "app"}: ${name}`) ?? 0) + 1);
    }
    const stillMissed = [...missed].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (stillMissed.length) {
      findings.push({
        area: "reconstruct",
        evidence: `Rebuilds still missed: ${stillMissed.map(([name, n]) => `${name}${n > 1 ? ` (${n}×)` : ""}`).join("; ")}.`,
        change: "Teach the builder to build these kinds of features: planning that names them, starter code or kits for them."
      });
    }

    // This PC.
    const machine = await MachineProfile.get().catch(() => null);
    for (const tool of machine?.tools.filter((t) => t.state === "broken") ?? []) {
      findings.push({
        area: "machine",
        evidence: `${tool.name} is installed but does not work here: ${tool.detail.slice(0, 160)}.`,
        change: "Make sure builds never depend on it here (plans, checks and scripts route around it)."
      });
    }

    const goal = `Improve Agent Builder itself — the builder, not the apps it builds — from what it has learned.

${
  findings.length
    ? `What the evidence shows (fix the causes in the builder's own code):\n${findings.map((f, i) => `${i + 1}. [${f.area}] ${f.evidence}\n   Change: ${f.change}`).join("\n")}`
    : "Nothing is failing repeatedly right now: make the builder plan better, recover from failures faster and build more complete apps and games."
}

Rules for changing the builder:
- Change prompts, planning, checks and recovery in src/ so these failures stop; keep every change small and focused.
- Every change gets a smoketest in scripts/ (or extends one) that proves it; never remove or weaken an existing check.
- Never touch data/, .env, secrets, builds/ or anything outside this repository.
- Keep the server starting: no new dependencies unless they are needed and small.`;
    return { at: new Date().toISOString(), findings, goal };
  },

  /** The running self-improvement session, if any. */
  session(): ImproveSession | null {
    const project = selfProject();
    if (!project) return null;
    return ContinuousImprover.list().sessions.find((s) => s.projectId === project.id && s.state !== "stopped") ?? null;
  },

  /** Start (or refresh) the continuous session on Agent Builder's own repository. */
  async start(startedBy = "owner"): Promise<{ session: ImproveSession; report: SelfReport }> {
    const repo = root();
    if (!fs.existsSync(path.join(repo, ".git")) || !fs.existsSync(path.join(repo, "src", "agent", "SelfImprover.ts"))) {
      throw new Error(`${repo} is not Agent Builder's repository.`);
    }
    const project = selfProject() ?? (await ProjectScanner.addProject(repo.replace(/\\/g, "/"), path.dirname(repo).replace(/\\/g, "/")));
    const report = await SelfImprover.report();
    const session = ContinuousImprover.start(project.id, { goal: report.goal, mode: "forever", checkCommand: SELF_CHECK }, `self:${startedBy}`);
    return { session, report };
  }
};
