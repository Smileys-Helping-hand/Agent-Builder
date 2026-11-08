/**
 * ContinuousImprover — the continuous builder: give it a project and a goal,
 * and it works on it 24/7 until you stop it.
 *
 *   plan      it reads the goal (your instructions) and the project and writes a
 *             roadmap of milestones; your later notes revise it
 *   build     milestone by milestone, in its own workspace: one copy of the
 *             project that every step builds on, so a long goal (a whole
 *             operating system, an emulator) accumulates instead of starting
 *             over each time. A milestone that keeps failing is parked and
 *             tried again later, never dropped
 *   fix       when the roadmap is done it runs the checks — the project's own
 *             (install, typecheck, build, tests, lint), your check command
 *             (`make`, `cargo test`…) or one it detects — and fixes until they
 *             all pass; a fix that makes things worse is rolled back
 *   complete  it asks itself whether the goal is fully met and adds what is
 *             missing; a "complete" session stops when it is
 *   improve   a "keep going" session never stops: it keeps a research topic
 *             running on the project and keeps making it better — fixes first,
 *             then reliability, performance, features — and every few
 *             improvements plans bigger upgrades and builds them
 *
 * Your project is never touched by any of this. Whenever the workspace is
 * clean (its checks pass) and has something new, it waits for you as one
 * delivery in Approvals: what changed since your last approval, file by file,
 * with major changes (many files, deletions, build or dependency files)
 * flagged. You choose the parts to add; those are applied to the project
 * three-way (a file you edited since is never overwritten) and committed on
 * its live branch. Parts you decline are taken back out of the workspace, so
 * later work does not build on them. Your own commits to the project are
 * brought into the workspace, so it builds on your work too.
 *
 * It waits while game mode is on, backs off when something fails (the model
 * server down, a build crashing) and never gives up on its own. Sessions and
 * workspaces survive restarts (data/agent/continuous.json, builds/continuous_*).
 */
import { execFile, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

import { ContextPack } from "../ecosystem/ContextPack.js";
import { EcosystemStore, type EcosystemProject } from "../ecosystem/EcosystemStore.js";
import { commitPaths, copyForBuild, ProjectBuilds } from "../ecosystem/ProjectBuilds.js";
import { ProjectScanner } from "../ecosystem/ProjectScanner.js";
import { ProjectTwin } from "../ecosystem/ProjectTwin.js";
import { GameDirector } from "../game/GameDirector.js";
import { Evidence } from "../knowledge/Evidence.js";
import { VmCheck, type VmTestConfig } from "../lab/VmCheck.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { Verifier } from "../orchestrator/Verifier.js";
import { Workspace } from "../orchestrator/Workspace.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { MachineProfile } from "../learning/MachineProfile.js";
import { EpisodicMemory } from "../learning/EpisodicMemory.js";
import { SystemPromptPatcher } from "../repair/SystemPromptPatcher.js";
import { Reinforcement } from "../learning/Reinforcement.js";
import { ResearchEngine } from "../research/ResearchEngine.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { DiskGuard } from "../utils/DiskGuard.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";

const run = promisify(execFile);

export type SessionState = "running" | "waiting" | "stopped";
export type Stage = "planning" | "building" | "fixing" | "improving" | "complete";
export type Mode = "complete" | "forever";

export interface Milestone {
  id: string;
  title: string;
  detail: string;
  status: "todo" | "doing" | "done" | "parked";
  attempts: number;
  note: string | null;
  doneAt: string | null;
  /** The last failure's signature and how many attempts in a row ended with it. */
  lastSignature?: string | null;
  repeats?: number;
  /** The approaches (continuous.step arms) that already failed it the same way. */
  failedApproaches?: string[];
  /** The root cause, diagnosed once it kept failing the same way. */
  diagnosis?: string | null;
}

export interface Step {
  at: string;
  stage: Stage;
  title: string;
  outcome: "kept" | "rolled-back" | "no-change" | "stopped" | "failed";
  note: string | null;
  commit: string | null;
  episodeId?: number;
  /** The episode of how it worked through the step (continuous.step), when that is not episodeId. */
  approachEpisodeId?: number;
  /** The step did what it set out to do (a milestone done, checks greener, an improvement kept). */
  success?: boolean;
  /** Its number in the session, for good. */
  n?: number;
  startedAt?: string;
  /** The commit it started from. */
  from?: string | null;
  /** The build that ran it. */
  buildId?: string | null;
  /** The checks as they stood when it ended. */
  check?: { at: string; passed: boolean; verified: boolean; failing: string[]; vmRun?: string | null } | null;
  /** The step's own breakdown, written after it: what it did, what changed, what it learned, what to do next time. */
  retro?: Retro | null;
}

export interface Retro {
  at: string;
  did: string[];
  /** From git: files and lines, not the model's account. */
  changed: { files: number; added: number; removed: number; list: string[] };
  outcome: string;
  learned: string;
  /** One concrete thing to do differently, given to the next steps. */
  nextTime: string;
  lessonId: number | null;
}

export interface CheckRun {
  at: string;
  /** Every check that applies passed (true too when none apply; see verified). */
  passed: boolean;
  /** Whether anything was actually checked. */
  verified: boolean;
  failing: string[];
  /** The failing checks' output, for the next fix. */
  output: string;
  command: string | null;
  /** When the failure comes from this PC (a tool missing or broken), not the code: why. */
  environment?: string | null;
  /** The VM test run behind this check, when the project's OS was booted and tested. */
  vmRun?: string | null;
}

export interface ImproveSession {
  id: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  /** The branch the project was on when it started: approvals commit there. */
  liveBranch: string | null;
  /** The owner's goal and instructions. */
  goal: string;
  /** A game: every step gets the game guide, the checks include the asset rules, and each milestone is released. */
  kind?: "app" | "game";
  /** The newest playable version (games). */
  lastRelease?: { version: number; at: string; title: string } | null;
  /** Why the last release did not build, if it did not. */
  releaseError?: string | null;
  /** An operating system: its ISO must build, boot in a real VM and pass these test profiles. */
  vmTest?: VmTestConfig | null;
  /** Kept for sessions started before goals: the old one-line focus. */
  focus: string;
  /** Later instructions, newest last. */
  notes: string[];
  mode: Mode;
  stage: Stage;
  /** The owner's check command, run in the workspace after every step. */
  checkCommand: string | null;
  state: SessionState;
  phase: string;
  startedAt: string;
  stoppedAt: string | null;
  startedBy: string;
  cycles: number;
  currentBuildId: string | null;
  lastError: string | null;
  workspace: { dir: string; baseCommit: string; approvedCommit: string } | null;
  /** The project's HEAD when its commits were last brought into the workspace. */
  projectHead: string | null;
  plan: Milestone[];
  journal: Step[];
  lastCheck: CheckRun | null;
  researchTopicId: string | null;
  improvementsSincePlan: number;
  needsReplan: boolean;
  /** Files to set back to the approved version before the next step (a decision made mid-step). */
  pendingRevert: string[];
}

export interface DeliveryFile {
  path: string;
  change: "added" | "modified" | "deleted";
  added: number;
  removed: number;
}

export interface Delivery {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  fromCommit: string;
  toCommit: string;
  title: string;
  /** What went into it: the steps since the last approval. */
  summary: string[];
  files: DeliveryFile[];
  major: boolean;
  majorWhy: string[];
  check: CheckRun | null;
  state: "awaiting" | "approved" | "partly" | "declined" | "superseded";
  createdAt: string;
  decidedAt: string | null;
  applied: string[];
  declined: string[];
  conflicts: string[];
  commit: { hash: string; branch: string } | null;
  note: string | null;
  episodeIds: number[];
}

/** One change from the first version of continuous improvement, kept so its approvals still work. */
export interface Candidate {
  id: string;
  sessionId: string;
  projectId: string;
  projectName: string;
  buildId: string;
  title: string;
  why: string;
  kind: string;
  instruction: string;
  state: "building" | "testing" | "awaiting" | "approved" | "rejected" | "failed" | "conflict";
  createdAt: string;
  decidedAt: string | null;
  files: string[];
  test: { passed: boolean; score: number | null; failing: string[] } | null;
  commit: { hash: string; branch: string } | null;
  note: string | null;
  episodeId?: number;
}

interface Store {
  sessions: ImproveSession[];
  candidates: Candidate[];
  deliveries: Delivery[];
}

const COOLDOWN_MS = Number(process.env.CONTINUOUS_COOLDOWN_MS) || 60_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const STEP_LIMIT_MS = Number(process.env.CONTINUOUS_STEP_LIMIT_MS) || 6 * 3_600_000;
const CHECK_LIMIT_MS = Number(process.env.CONTINUOUS_CHECK_LIMIT_MS) || 60 * 60_000;
const ATTEMPTS_BEFORE_PARKING = 4;
const IMPROVEMENTS_PER_UPGRADE_PLAN = 6;
const NEW_PROJECTS_DIR = () => process.env.CONTINUOUS_NEW_PROJECTS_DIR || "E:/Projects";
const FILE = () => path.resolve("data", "agent", "continuous.json");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Agent Builder",
  GIT_AUTHOR_EMAIL: "agent-builder@local",
  GIT_COMMITTER_NAME: "Agent Builder",
  GIT_COMMITTER_EMAIL: "agent-builder@local"
};

/* ─── storage ─── */

const withDefaults = (session: Partial<ImproveSession> & { id: string }): ImproveSession =>
  ({
    goal: session.goal ?? session.focus ?? "",
    focus: session.focus ?? "",
    notes: [],
    mode: "forever",
    stage: "planning",
    checkCommand: null,
    workspace: null,
    projectHead: null,
    plan: [],
    journal: [],
    lastCheck: null,
    researchTopicId: null,
    improvementsSincePlan: 0,
    needsReplan: false,
    pendingRevert: [],
    ...session
  }) as ImproveSession;

const read = (): Store => {
  try {
    const raw = JSON.parse(fs.readFileSync(FILE(), "utf8")) as Partial<Store>;
    return { sessions: (raw.sessions ?? []).map(withDefaults), candidates: raw.candidates ?? [], deliveries: raw.deliveries ?? [] };
  } catch {
    return { sessions: [], candidates: [], deliveries: [] };
  }
};
const write = (store: Store) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify({ sessions: store.sessions.slice(-50), candidates: store.candidates.slice(-300), deliveries: store.deliveries.slice(-300) }, null, 2),
    "utf8"
  );
  fs.renameSync(tmp, FILE());
};
const update = (fn: (store: Store) => void) => {
  const store = read();
  fn(store);
  write(store);
  return store;
};
const getSession = (id: string) => read().sessions.find((s) => s.id === id) ?? null;
const patchSession = (id: string, patch: Partial<ImproveSession>) => update((s) => Object.assign(s.sessions.find((x) => x.id === id) ?? {}, patch));
const patchCandidate = (id: string, patch: Partial<Candidate>) => update((s) => Object.assign(s.candidates.find((x) => x.id === id) ?? {}, patch));
const JOURNAL_LIMIT = 2000;

/** Where the step in progress began, for its journal entry. */
const stepStarts = new Map<string, { at: string; from: string | null; buildId: string | null }>();

const journal = (id: string, step: Step) => {
  let n = 0;
  update((s) => {
    const session = s.sessions.find((x) => x.id === id);
    if (!session) return;
    const last = session.journal[session.journal.length - 1];
    n = (last?.n ?? session.journal.length) + 1;
    const started = stepStarts.get(id);
    stepStarts.delete(id);
    const check = session.lastCheck;
    session.journal = [
      ...session.journal,
      {
        ...step,
        n,
        startedAt: step.startedAt ?? started?.at,
        from: step.from ?? started?.from ?? null,
        buildId: step.buildId ?? started?.buildId ?? null,
        check: check ? { at: check.at, passed: check.passed, verified: check.verified, failing: check.failing, vmRun: check.vmRun ?? null } : null
      }
    ].slice(-JOURNAL_LIMIT);
  });
  // The ledger: every step, for good, linked to its session and to the VM run that tested it.
  const vmRun = getSession(id)?.lastCheck?.vmRun;
  if (n) {
    Evidence.record({
      kind: "step",
      ref: `step:${id}:${n}`,
      task: `session:${id}`,
      agent: "continuous-builder",
      title: step.title,
      outcome: step.outcome,
      data: { stage: step.stage, note: step.note, commit: step.commit, success: step.success ?? null },
      links: [{ to: `session:${id}`, relation: "part-of" }, ...(vmRun ? [{ to: `vmrun:${vmRun}`, relation: "tested-by" }] : [])]
    });
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const loops = new Set<string>();
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const extractJson = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

const list = (value: unknown): Array<{ title: string; detail: string }> =>
  (Array.isArray(value) ? value : [])
    .map((entry) => (typeof entry === "string" ? { title: entry } : entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {}))
    .map((entry) => ({
      title: String(entry.title ?? entry.name ?? entry.milestone ?? "").trim().slice(0, 120),
      detail: String(entry.detail ?? entry.details ?? entry.description ?? entry.what ?? "").trim().slice(0, 1500)
    }))
    .filter((entry) => entry.title.length > 2);

/**
 * The milestones in a model's answer, however it wrote them: an object with
 * the list under the expected key (or a near one), a bare list, or — when the
 * answer was cut off — every complete {"title": …, "detail": …} that made it.
 */
const itemsFrom = (answer: string, keys: string[]): Array<{ title: string; detail: string }> => {
  const parsed = extractJson(answer);
  if (parsed) {
    for (const key of [...keys, "milestones", "roadmap", "plan", "steps", "items", "upgrades", "missing"]) {
      const found = list(parsed[key]);
      if (found.length) return found;
    }
  }
  const start = answer.indexOf("[");
  const end = answer.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const found = list(JSON.parse(answer.slice(start, end + 1)));
      if (found.length) return found;
    } catch {
      /* cut off or not JSON: salvage below */
    }
  }
  const salvaged: Array<{ title: string; detail: string }> = [];
  const pattern = /"(?:title|name)"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"(?:detail|details|description)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  for (const match of answer.matchAll(pattern)) {
    try {
      salvaged.push({ title: JSON.parse(`"${match[1]}"`), detail: JSON.parse(`"${match[2]}"`) });
    } catch {
      /* a broken escape: skip it */
    }
  }
  return list(salvaged);
};

/* ─── git in the workspace ─── */

const git = async (cwd: string, args: string[], env: NodeJS.ProcessEnv = GIT_ENV): Promise<string> => {
  const { stdout } = await run("git", args, { cwd, env, windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
  return stdout.toString();
};

const blobAt = async (cwd: string, commit: string, file: string): Promise<Buffer | null> => {
  try {
    const { stdout } = await run("git", ["show", `${commit}:${file}`], { cwd, windowsHide: true, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 });
    return stdout as unknown as Buffer;
  } catch {
    return null;
  }
};

const readOrNull = (file: string): Buffer | null => {
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
};
const same = (a: Buffer | null, b: Buffer | null) => (a === null || b === null ? a === b : a.equals(b));

const head = async (dir: string) => (await git(dir, ["rev-parse", "HEAD"])).trim();

/** Commit everything in the workspace; the new head, or null when there was nothing. */
const commitAll = async (dir: string, message: string): Promise<string | null> => {
  await git(dir, ["add", "-A"]);
  if (!(await git(dir, ["status", "--porcelain"])).trim()) return null;
  await git(dir, ["commit", "-q", "--no-verify", "-m", message]);
  return head(dir);
};

const isGitRepo = async (dir: string) => {
  try {
    return (await git(dir, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch {
    return false;
  }
};

/** Writes a file (or removes it, for null) under root; false for a path outside it. */
const writeUnder = (root: string, file: string, content: Buffer | null): boolean => {
  const target = path.resolve(root, file);
  if (!target.startsWith(path.resolve(root) + path.sep)) return false;
  if (content === null) fs.rmSync(target, { force: true });
  else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return true;
};

/**
 * A new "approved" commit: the old one with these files set to new contents
 * (null removes one). Built on a private index, so neither the workspace's
 * files nor its branch move. A ref keeps it from being garbage-collected.
 */
const approvedWith = async (dir: string, approved: string, files: Map<string, Buffer | null>, message: string): Promise<string> => {
  const index = path.join(dir, ".git", `continuous-index-${process.pid}-${Date.now()}`);
  const env = { ...GIT_ENV, GIT_INDEX_FILE: index };
  try {
    await git(dir, ["read-tree", approved], env);
    for (const [file, content] of files) {
      if (content === null) {
        await git(dir, ["update-index", "--force-remove", "--", file], env);
        continue;
      }
      const tmp = path.join(os.tmpdir(), `continuous-blob-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      fs.writeFileSync(tmp, content);
      try {
        const sha = (await git(dir, ["hash-object", "-w", "--no-filters", tmp], env)).trim();
        await git(dir, ["update-index", "--add", "--cacheinfo", `100644,${sha},${file}`], env);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
    const tree = (await git(dir, ["write-tree"], env)).trim();
    const commit = (await git(dir, ["commit-tree", tree, "-p", approved, "-m", message], env)).trim();
    await git(dir, ["update-ref", "refs/continuous/approved", commit]);
    return commit;
  } finally {
    fs.rmSync(index, { force: true });
  }
};

/* ─── checks ─── */

const tools = new Map<string, boolean>();
const hasTool = async (name: string): Promise<boolean> => {
  if (!tools.has(name)) {
    const found = await run(process.platform === "win32" ? "where" : "which", [name], { windowsHide: true })
      .then(() => true)
      .catch(() => false);
    tools.set(name, found);
  }
  return tools.get(name)!;
};

/** A check for projects the built-in checks do not cover, when its tool is installed. */
const detectCheck = async (dir: string): Promise<string | null> => {
  const has = (name: string) => fs.existsSync(path.join(dir, name));
  if (has("Cargo.toml") && (await hasTool("cargo"))) return "cargo build";
  if (has("go.mod") && (await hasTool("go"))) return "go build ./...";
  if ((has("Makefile") || has("makefile") || has("GNUmakefile")) && (await hasTool("make"))) return "make";
  if (has("CMakeLists.txt") && (await hasTool("cmake"))) return "cmake -S . -B .continuous-check && cmake --build .continuous-check";
  return null;
};

/** Runs the owner's check command in the workspace; the exit code decides. */
const runShell = (command: string, cwd: string, limitMs: number): Promise<{ passed: boolean; output: string }> =>
  new Promise((resolve) => {
    const child = spawn(command, { cwd, shell: true, windowsHide: true });
    let output = "";
    const keep = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-12_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      output += `\n(stopped after ${Math.round(limitMs / 60_000)} minutes)`;
      if (process.platform === "win32" && child.pid) execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], () => undefined);
      else child.kill("SIGKILL");
    }, limitMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ passed: false, output: `${output}\n${error.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ passed: code === 0, output });
    });
  });

const runChecks = async (session: ImproveSession, dir: string): Promise<CheckRun> => {
  const failing: string[] = [];
  const outputs: string[] = [];
  let verified = false;
  try {
    // The project's own checks only: never scaffold tests or "fix" someone's code behind their back.
    const report = await Verifier.verify(new Workspace(dir), { scaffoldTests: false, autofix: false });
    for (const check of report.checks.filter((c) => c.applicable)) {
      verified = true;
      if (!check.passed) {
        failing.push(check.name);
        outputs.push(`## ${check.name}\n${check.output.split("\n").slice(-40).join("\n")}`);
      }
    }
  } catch (error) {
    failing.push("checks");
    outputs.push(`The checks could not run: ${(error as Error)?.message ?? error}`);
  }
  const command = session.checkCommand || (await detectCheck(dir));
  if (command) {
    verified = true;
    const result = await runShell(command, dir, CHECK_LIMIT_MS);
    if (!result.passed) {
      failing.push(command);
      outputs.push(`## ${command}\n${result.output.split("\n").slice(-60).join("\n")}`);
    }
  }
  // A game's assets: free sources only, nothing from the internet, nothing from someone else's game.
  if (session.kind === "game") {
    verified = true;
    const problems = GameDirector.assetProblems(dir);
    if (problems.length) {
      failing.push("assets and originality");
      outputs.push(`## assets and originality\n${problems.map((p) => `- ${p}`).join("\n")}`);
    }
  }
  // An operating system must really boot: built, run in a VM and tested, once everything else passes.
  let vmRun: string | null = null;
  if (session.vmTest && failing.length === 0) {
    verified = true;
    const config = getSession(session.id)?.vmTest ?? session.vmTest;
    const result = await VmCheck.run(config, dir, {
      name: session.projectName,
      task: `session:${session.id}`,
      projectId: session.projectId,
      onPhase: (phase) => patchSession(session.id, { phase })
    }).catch((error: Error) => ({ passed: false, report: `The VM test could not run: ${error.message}`, runId: null, reused: false, tree: null, failure: "test" as const }));
    vmRun = result.runId;
    if (!result.reused && getSession(session.id)) {
      patchSession(session.id, { vmTest: { ...config, lastTree: result.tree, lastRun: result.runId, lastPassed: result.passed, lastReport: result.report.slice(0, 6000) } });
    }
    if (!result.passed) {
      failing.push(result.failure === "build" || result.failure === "iso" ? "OS image build" : "VM test");
      outputs.push(`## ${failing[failing.length - 1]}\n${result.report}`);
    }
  }
  const output = outputs.join("\n\n").slice(-8000);
  // A tool that is missing or broken here fails the check whatever the code says: name it, so no step retries it.
  const environment = failing.length ? await MachineProfile.environmentProblem(output).catch(() => null) : null;
  return { at: new Date().toISOString(), passed: failing.length === 0, verified, failing, output, command, environment, vmRun };
};

/* ─── the model ─── */

const roadmapText = (plan: Milestone[], current?: Milestone) =>
  plan
    .map((m) => `${m.status === "done" ? "✓" : m === current ? "→" : m.status === "parked" ? "‖" : "·"} ${m.title}${m.status === "parked" && m.note ? ` (parked: ${m.note})` : ""}`)
    .join("\n") || "(no roadmap yet)";

const ownerWords = (session: ImproveSession) =>
  `The owner's goal and instructions:\n${session.goal || "(none: make it better and stronger)"}${
    session.notes.length ? `\n\nTheir later notes (newest last):\n${session.notes.map((n) => `- ${n}`).join("\n")}` : ""
  }`;

const projectBriefing = async (session: ImproveSession): Promise<string> => {
  const context = await ContextPack.forProject(session.projectId).catch(() => null);
  let files = "";
  if (session.workspace) {
    const all = (await git(session.workspace.dir, ["ls-files"]).catch(() => "")).split("\n").filter(Boolean);
    files = `\n\nFiles in the work so far (${all.length}):\n${all.slice(0, 250).join("\n")}${all.length > 250 ? "\n…" : ""}`;
  }
  return `${(context?.markdown ?? "(no briefing could be read)").slice(0, 7000)}${files}`;
};

const declinedText = (session: ImproveSession, deliveries: Delivery[]) => {
  const declined = deliveries.filter((d) => d.sessionId === session.id && d.declined.length).slice(-10);
  return declined.length ? `\nThe owner declined these before (do not bring them back unless asked):\n${declined.map((d) => `- ${d.title}: ${d.declined.slice(0, 8).join(", ")}${d.note ? ` (${d.note})` : ""}`).join("\n")}\n` : "";
};

const researchText = (session: ImproveSession) => {
  if (!session.researchTopicId) return "";
  const claims = ResearchStore.strongestClaims(session.researchTopicId, 8);
  return claims.length ? `\nWhat research found about doing this well:\n${claims.map((c) => `- ${c}`).join("\n")}\n` : "";
};

/** The first milestone of a project whose checks already fail. */
const BASELINE_TITLE = "Make the existing checks pass";

/** Work outside the code that a build step cannot do (checks already run after every step). */
const CHORE = /^(commit|push|deploy|release|stable release|final (testing|release)|monitor|merge|branch|code review|review|gather|collect|(beta|user) (testing|feedback)|feedback|post-release|(user |customer )?support (and||feedback|post-release|support|finali) maintenance|post-release support|finali[sz]e|verify|check branch|ensure clean|initial testing|testing and bug|prepare (for )?release)/i;

/**
 * The owner's requirements, in the order they gave them: what the roadmap
 * must cover. Asked separately because, shown the whole project, the model
 * tends to plan what the code already suggests and drop what was asked for.
 */
const requirementsOf = async (session: ImproveSession): Promise<string[]> => {
  const answer = await ModelRouter.generate(
    `Read the owner's goal and list every distinct thing they ask for, in the order they ask for it, keeping their own words and
specifics (names, paths, tools). Where they say what comes first, put it first. 3-25 short items; no commentary.
${ownerWords(session)}

Answer with JSON only: {"requirements": ["<one requirement>", "..."]}`
  );
  const parsed = extractJson(answer);
  const raw = Array.isArray(parsed?.requirements) ? parsed.requirements : [];
  return raw.map((r) => String(r).trim().slice(0, 300)).filter((r) => r.length > 3).slice(0, 25);
};

const makePlan = async (session: ImproveSession): Promise<Milestone[]> => {
  const done = session.plan.filter((m) => m.status === "done");
  const requirements = session.goal.trim() || session.notes.length ? await requirementsOf(session).catch(() => [] as string[]) : [];
  const numbered = requirements.map((r, i) => `R${i + 1}. ${r}`).join("\n");
  const answer = await ModelRouter.generate(
    `You are the lead engineer on "${session.projectName}", working on it continuously until the goal is fully met.
${ownerWords(session)}
${numbered ? `\nThe owner's requirements, in their order. Every one must be covered, starting with the first:\n${numbered}\n` : ""}
The project as it is (for context only; the owner's requirements decide what to build):
${(await projectBriefing(session)).slice(0, 5000)}
${done.length ? `\nAlready built:\n${done.map((m) => `- ${m.title}`).join("\n")}\n` : ""}${declinedText(session, read().deliveries)}
Write the roadmap of what is still left, in the order to build it. Use as many milestones as the goal really needs: one or two for
a small tool, dozens for something as big as an operating system (up to 30 now; more are added as these are built). Each must be a
concrete, verifiable chunk of code or content that one build session can write in this repository (a subsystem, a package, a
screen, a driver, a test suite), with a specific title naming what it builds (not "Project setup" or "Add new capabilities").
Never include chores outside the code: no committing, pushing, deploying, releasing, beta testing, feedback, support, reviews or
"final testing" — checks run after every step on their own.${numbered ? `\nFor each milestone, list the requirements it covers (e.g. ["R1"]).` : ""}

Answer with JSON only: {"milestones": [{"title": "<specific>", "detail": "<what to build, precisely, and how to know it works>"${numbered ? `, "covers": ["R1"]` : ""}}]}`
  );
  let milestones = itemsFrom(answer, ["milestones"]).filter((m) => !CHORE.test(m.title));
  if (!milestones.length) {
    Logger.warn("Continuous build: the roadmap could not be read from the model's answer", { answer: answer.slice(0, 2000) });
    throw new Error("The model did not write a usable roadmap.");
  }
  // Whatever the owner asked for that no milestone covers is added, in their order: nothing they asked for is dropped.
  if (requirements.length) {
    const covered = new Set((answer.match(/R\d{1,2}\b/g) ?? []).map((r) => Number(r.slice(1))));
    const text = milestones.map((m) => `${m.title} ${m.detail}`.toLowerCase()).join(" ");
    const missing = requirements
      .map((r, i) => ({ r, n: i + 1 }))
      .filter(({ r, n }) => !covered.has(n) && !r.toLowerCase().split(/\W+/).filter((w) => w.length > 5).some((w) => text.includes(w)));
    milestones = [...milestones, ...missing.map(({ r }) => ({ title: r.slice(0, 120), detail: `The owner asked for this: ${r}` }))];
  }
  return [
    ...done,
    ...milestones.slice(0, 40).map((m) => ({ id: newId("ms"), title: m.title, detail: m.detail, status: "todo" as const, attempts: 0, note: null, doneAt: null }))
  ];
};

/** Whether the goal is fully met; what is missing if not. */
const whatIsMissing = async (session: ImproveSession): Promise<Array<{ title: string; detail: string }>> => {
  const answer = await ModelRouter.generate(
    `You are reviewing "${session.projectName}" against its goal.
${ownerWords(session)}

Roadmap built so far:
${roadmapText(session.plan)}

The project now:
${await projectBriefing(session)}

Is the goal fully met, with nothing important missing? If not, list what is still missing as milestones (code or content to write
in the repository only; no committing, deploying, reviewing or other chores).
Answer with JSON only: {"complete": true|false, "missing": [{"title": "<short>", "detail": "<what to build>"}]}`
  );
  const parsed = extractJson(answer);
  if (parsed?.complete === true) return [];
  const missing = itemsFrom(answer, ["missing"]).slice(0, 10);
  if (!parsed && !missing.length) throw new Error("The model could not judge whether the goal is met.");
  return missing;
};

/** Bigger upgrades for a project that already works. */
const planUpgrades = async (session: ImproveSession): Promise<Array<{ title: string; detail: string }>> => {
  const answer = await ModelRouter.generate(
    `"${session.projectName}" meets its goal and its checks pass. Plan its next upgrades: what would make it clearly better,
stronger and more complete — new capabilities, important missing features, robustness, speed, polish.
${ownerWords(session)}
${researchText(session)}${declinedText(session, read().deliveries)}
Built so far:
${roadmapText(session.plan)}

Answer with JSON only: {"upgrades": [{"title": "<short>", "detail": "<what to build, precisely>"}]} (1-5 upgrades)`
  );
  return itemsFrom(answer, ["upgrades"]).slice(0, 5);
};

/** One improvement for a project that works. */
const nextImprovement = async (session: ImproveSession, preference: string): Promise<{ title: string; instruction: string }> => {
  const recent = session.journal.slice(-20).map((s) => `- [${s.outcome}] ${s.title}`).join("\n") || "- nothing yet";
  const answer = await ModelRouter.generate(
    `You are improving "${session.projectName}" continuously, one complete, verifiable change at a time.
${ownerWords(session)}

The project:
${await projectBriefing(session)}
${researchText(session)}${declinedText(session, read().deliveries)}
Recent work (do not repeat):
${recent}

Pick ONE improvement. A real bug or a rough edge always comes first. Otherwise: ${preference}.
Be specific to this code — name the file, screen or behaviour.
Answer with JSON only: {"title": "<short commit-style title>", "instruction": "<precisely what to change, in 2-6 sentences>"}`
  );
  const parsed = extractJson(answer);
  const title = typeof parsed?.title === "string" ? parsed.title.trim().slice(0, 100) : "";
  const instruction = typeof parsed?.instruction === "string" ? parsed.instruction.trim().slice(0, 3000) : "";
  if (!title || instruction.length < 20) throw new Error("The model did not propose a usable improvement.");
  return { title, instruction };
};

/* ─── the work ─── */

/** Builds one step in the workspace; the commits it made. */
const buildStep = async (
  session: ImproveSession,
  title: string,
  instruction: string,
  avoid: string[] = []
): Promise<{ before: string; after: string; stopped: boolean; episodeId: number; approach: string }> => {
  const dir = session.workspace!.dir;
  const before = await head(dir);
  // How to work through it is learned per stage, from what the steps achieve and what the owner approves;
  // a step that keeps failing the same way must try a way that has not failed it yet.
  const approach = Reinforcement.choose("continuous.step", {
    bucket: session.stage,
    agent: "continuous-builder",
    ref: `step:${session.id}:${Date.now()}`,
    prompt: title,
    avoid
  });
  const machine = await MachineProfile.promptText().catch(() => "");
  let antiStagnation = "";
  if (SystemPromptPatcher.shouldMutate(session.projectName)) {
    antiStagnation = SystemPromptPatcher.mutatePrompt(
      session.projectName,
      session.lastCheck?.output ?? "",
      session.lastCheck?.passed ? 100 : 38
    );
  } else {
    const banned = EpisodicMemory.getBannedApproaches(session.projectName);
    const counters = session.lastCheck
      ? EpisodicMemory.getCounterStrategies(session.projectName, session.lastCheck.output)
      : [];
    if (banned.length || counters.length) {
      antiStagnation = `\n[ANTI-STAGNATION MEMORY]\nBANNED STRATEGIES: ${banned.join("; ")}\nCOUNTER-STRATEGIES: ${counters.join("; ")}\n`;
    }
  }

  const description = `${antiStagnation ? antiStagnation + "\n" : ""}${title.replace(/^(Building|Fixing|Improving): /, "")}

${approach.arm.instruction}${instruction}

Context: this is one step of a long-running build of "${session.projectName}".
${ownerWords(session)}
${session.kind === "game" ? `${GameDirector.guide(dir)}\n` : ""}${await ProjectTwin.of(session).then(ProjectTwin.brief).catch(() => "")}${machine}
${lessonsFromLastRuns(session)}Work in the existing code and keep everything that already works working.`;
  // Only this session works in its workspace: a stray build there (one carried on by something else) is stopped first.
  const strays = () => BuildService.active().filter((b) => path.resolve(b.outputDir) === path.resolve(dir));
  for (const stray of strays()) BuildService.control(stray.buildId, "stop");
  for (let i = 0; i < 60 && strays().length; i++) await sleep(1000);
  const build = BuildService.start({
    projectName: session.projectName,
    description,
    workingDir: dir,
    profile: "balanced",
    maxIterations: 3,
    qualityThreshold: 85,
    autoPackaging: false,
    startedBy: `continuous:${session.id}`
  });
  patchSession(session.id, { currentBuildId: build.buildId, phase: title });
  stepStarts.set(session.id, { at: new Date().toISOString(), from: before, buildId: build.buildId });
  const started = Date.now();
  let stopped = false;
  while (BuildService.isRunning(build.buildId)) {
    if (getSession(session.id)?.state === "stopped" || Date.now() - started > STEP_LIMIT_MS) {
      BuildService.control(build.buildId, "stop");
      stopped = true;
      for (let i = 0; i < 60 && BuildService.isRunning(build.buildId); i++) await sleep(1000);
      break;
    }
    await sleep(15_000);
  }
  patchSession(session.id, { currentBuildId: null });
  await commitAll(dir, `${title}\n\nContinuous build step.`);
  const after = await head(dir);
  // A step cut off by a stop says nothing about the approach.
  if (stopped && getSession(session.id)?.state === "stopped") Reinforcement.forget(approach.episodeId);
  return { before, after, stopped, episodeId: approach.episodeId, approach: approach.arm.id };
};

/** Why a milestone keeps failing the same way: the root cause, in a few sentences. */
const diagnose = async (session: ImproveSession, milestone: Milestone, failure: CheckRun): Promise<string | null> => {
  const answer = await ModelRouter.generate(
    `A build step for "${session.projectName}" has failed the same way ${milestone.repeats} times in a row while building "${milestone.title}".
Do not write code. Find the ROOT CAUSE: read the failure carefully and say what is really wrong and what must change. Consider that
the cause may be the machine (a tool missing or broken here), the check itself, or a wrong assumption the attempts kept making.

${await MachineProfile.promptText().catch(() => "")}
${failure.environment ? `Known: ${failure.environment}.\n` : ""}
The failure:
${failure.output.slice(-5000)}

Answer in 2-4 sentences: the root cause, then what to do differently.`
  );
  const text = answer.trim().slice(0, 800);
  return text.length > 20 ? text : null;
};

/** Rewards a step's approach by what it achieved (0..1). */
const rewardStep = (episodeId: number, value: number, why: string) => {
  try {
    Reinforcement.reward(episodeId, Math.max(0, Math.min(1, value)), "step-outcome", why);
  } catch {
    /* forgotten (a stopped step) */
  }
};

/** A one-line, general lesson from a fix that turned checks green, kept for every later build. */
const learnFromFix = async (session: ImproveSession, failing: CheckRun, before: string, after: string) => {
  try {
    const stat = (await git(session.workspace!.dir, ["diff", "--no-renames", "--stat", before, after])).slice(0, 1500);
    const patch = (await git(session.workspace!.dir, ["diff", "--no-renames", before, after])).slice(0, 4000);
    const answer = await ModelRouter.generate(
      `A check was failing and this change fixed it. Write ONE general lesson (one or two sentences) that would help fix the same kind of failure in another project. No project names.

Failing output:
${failing.output.slice(-2500)}

The fix (${stat}):
${patch}

Answer with the lesson only.`
    );
    const lesson = answer.trim().replace(/^["'\s]+|["'\s]+$/g, "").slice(0, 400);
    if (lesson.length < 20) return;
    const first = failing.failing[0] ?? "checks";
    LessonMemory.recordFix("build", LessonMemory.errorSignature(first, failing.output), lesson, patch.slice(0, 1500));
  } catch (error) {
    Logger.warn("Continuous build: could not record the lesson from a fix", { error: (error as Error)?.message });
  }
};

const rollBack = async (dir: string, to: string) => {
  await git(dir, ["reset", "-q", "--hard", to]);
  await git(dir, ["clean", "-q", "-fd"]);
};

/** The project as it is now becomes the session's workspace. */
const prepareWorkspace = async (session: ImproveSession, project: EcosystemProject) => {
  patchSession(session.id, { phase: "Copying the project into its own workspace (the original stays untouched)" });
  const { workDir, startCommit } = await copyForBuild(project.path, project.name, "continuous", {
    maxFiles: Number(process.env.CONTINUOUS_MAX_FILES) || 250_000,
    maxBytes: Number(process.env.CONTINUOUS_MAX_BYTES) || 6 * 1024 * 1024 * 1024,
    allowEmpty: true
  });
  // Dependencies and build output stay out of every commit and every delivery.
  fs.appendFileSync(path.join(workDir, ".git", "info", "exclude"), "\nnode_modules/\n.next/\ntarget/\n__pycache__/\n.continuous-check/\n*.o\n*.obj\n");
  await git(workDir, ["update-ref", "refs/continuous/approved", startCommit]);
  const projectHead = (await isGitRepo(project.path)) ? (await git(project.path, ["rev-parse", "HEAD"]).catch(() => "")).trim() || null : null;
  patchSession(session.id, { workspace: { dir: workDir, baseCommit: startCommit, approvedCommit: startCommit }, projectHead });
};

/**
 * The owner's own commits since last time come into the workspace: files the
 * workspace has not touched take the owner's version; files both changed keep
 * ours, which the next delivery then shows against theirs.
 */
const syncOwnerCommits = async (sessionId: string) => {
  const session = getSession(sessionId);
  if (!session?.workspace || !session.projectHead || !(await isGitRepo(session.projectPath))) return;
  const now = (await git(session.projectPath, ["rev-parse", "HEAD"]).catch(() => "")).trim();
  if (!now || now === session.projectHead) return;
  const changed = (await git(session.projectPath, ["diff", "--no-renames", "--name-only", "-z", session.projectHead, now]).catch(() => ""))
    .split("\0")
    .filter(Boolean);
  const dir = session.workspace.dir;
  const theirs = new Map<string, Buffer | null>();
  let taken = 0;
  for (const file of changed) {
    const content = await blobAt(session.projectPath, now, file);
    theirs.set(file, content);
    const approved = await blobAt(dir, session.workspace.approvedCommit, file);
    const ours = readOrNull(path.join(dir, file));
    if (same(ours, approved) && !same(ours, content) && writeUnder(dir, file, content)) taken += 1;
  }
  const approvedCommit = theirs.size ? await approvedWith(dir, session.workspace.approvedCommit, theirs, "The owner's commits") : session.workspace.approvedCommit;
  if (taken) await commitAll(dir, `Brought in the owner's commits (${taken} file${taken === 1 ? "" : "s"})`);
  patchSession(sessionId, { projectHead: now, workspace: { ...session.workspace, approvedCommit } });
  if (taken) journal(sessionId, { at: new Date().toISOString(), stage: session.stage, title: `Brought in your commits (${taken} files)`, outcome: "kept", note: null, commit: await head(dir) });
};

/** Files the owner declined (or edited themselves) go back to the approved version before the next step. */
const applyPendingRevert = async (sessionId: string) => {
  const session = getSession(sessionId);
  if (!session?.workspace || !session.pendingRevert.length) return;
  const dir = session.workspace.dir;
  for (const file of session.pendingRevert) writeUnder(dir, file, await blobAt(dir, session.workspace.approvedCommit, file));
  await commitAll(dir, `Took out what the owner declined (${session.pendingRevert.length} file${session.pendingRevert.length === 1 ? "" : "s"})`);
  patchSession(sessionId, { pendingRevert: [] });
};

const MAJOR_FILE = /(^|\/)(package\.json|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.(toml|lock)|go\.(mod|sum)|requirements\.txt|pyproject\.toml|Makefile|CMakeLists\.txt|Dockerfile|tsconfig\.json|[^/]*\.config\.[cm]?[jt]s|\.github\/.*|.*\.sql|migrations?\/.*)$/i;

/** When the workspace is clean and has something new: one delivery waiting for the owner, replacing any older one. */
/** What the last runs' breakdowns said to do differently, for the next step. */
const lessonsFromLastRuns = (session: ImproveSession): string => {
  const notes = session.journal
    .filter((step) => step.retro?.nextTime)
    .slice(-4)
    .map((step) => `- After "${step.title}" (${step.outcome}): ${step.retro!.nextTime}`);
  return notes.length ? `What the last runs taught (apply it):\n${notes.join("\n")}\n` : "";
};

/**
 * After a step: its breakdown. What changed comes from git; what it did, what it learned and the one thing to do
 * differently next time are written by the model from that and the checks. The "next time" goes to the following
 * steps, and a concrete one becomes a lesson that is kept only if it helps (LessonMemory verifies by use).
 */
const retrospect = async (sessionId: string) => {
  const session = getSession(sessionId);
  if (!session?.workspace) return;
  const index = session.journal.length - 1;
  const step = session.journal[index];
  if (!step || step.retro || step.stage === "planning" || /^Brought in your commits|^Roadmap:/.test(step.title)) return;
  const dir = session.workspace.dir;
  let list: string[] = [];
  let added = 0;
  let removed = 0;
  if (step.commit && step.from && step.commit !== step.from) {
    for (const line of (await git(dir, ["diff", "--numstat", step.from, step.commit]).catch(() => "")).split("\n").filter(Boolean)) {
      const [a, r, ...file] = line.split("\t");
      added += Number(a) || 0;
      removed += Number(r) || 0;
      list.push(file.join("\t"));
    }
  }
  list = list.slice(0, 40);
  const check = step.check;
  const answer = await ModelRouter.generate(`You just finished one step of building "${session.projectName}". Write its breakdown, honestly, from these facts only.

The step: ${step.title}
Outcome: ${step.outcome}${step.note ? ` (${step.note})` : ""}
Files changed (${list.length}, +${added} -${removed}): ${list.join(", ") || "none"}
Checks after it: ${check ? (check.passed ? "all passed" : `failing: ${check.failing.join(", ")}`) : "not run"}
${session.lastCheck && !session.lastCheck.passed ? `What the failing checks said:\n${session.lastCheck.output.slice(-1500)}` : ""}

Answer with JSON only:
{"did": ["what this step actually did, 1-4 short points"],
 "learned": "what this taught about this project or this kind of work, one or two sentences",
 "nextTime": "ONE concrete thing to do differently next time, specific enough to act on (a file, a check, an order of work); empty if nothing"}`).catch(() => "");
  const parsed = extractJson(answer);
  const did = Array.isArray(parsed?.did) ? (parsed!.did as unknown[]).map(String).filter(Boolean).slice(0, 6) : [];
  const learned = String(parsed?.learned ?? "").slice(0, 600);
  const nextTime = String(parsed?.nextTime ?? "").slice(0, 400);
  let lessonId: number | null = null;
  // A concrete correction is worth keeping; it stays a candidate until it proves itself in later steps.
  if (nextTime.length > 25 && step.success !== true) {
    lessonId = LessonMemory.recordTaught("build", `retro: ${session.projectName}: ${nextTime.slice(0, 80)}`, nextTime, `From step "${step.title}" of ${session.projectName}`).lesson.id;
  }
  update((s) => {
    const target = s.sessions.find((x) => x.id === sessionId)?.journal[index];
    if (target && target.at === step.at) target.retro = { at: new Date().toISOString(), did, changed: { files: list.length, added, removed, list }, outcome: step.outcome, learned, nextTime, lessonId };
  });
  if (step.n) {
    Evidence.record({ kind: "step", ref: `retro:${sessionId}:${step.n}`, task: `session:${sessionId}`, agent: "continuous-builder", title: `Breakdown of "${step.title}": ${nextTime || learned || "no lesson"}`.slice(0, 300), outcome: step.outcome, data: { did, learned, nextTime }, links: [{ to: `step:${sessionId}:${step.n}`, relation: "breakdown-of" }, ...(lessonId ? [{ to: `lesson:${lessonId}`, relation: "taught" }] : [])] });
  }
};

/** A game: what it has become is built and kept as the next playable version. */
const releaseIfGame = async (sessionId: string, title: string) => {
  const session = getSession(sessionId);
  if (session?.kind !== "game" || !session.workspace) return;
  patchSession(sessionId, { phase: `Releasing the next version: ${title}` });
  const commit = await head(session.workspace.dir).catch(() => null);
  const { release, error } = await GameDirector.release(sessionId, session.workspace.dir, title, commit, session.projectName);
  patchSession(sessionId, release ? { lastRelease: { version: release.version, at: release.at, title: release.title }, releaseError: null } : { releaseError: error });
  journal(sessionId, {
    at: new Date().toISOString(),
    stage: getSession(sessionId)?.stage ?? "building",
    title: release ? `Released version ${release.version}: ${title}` : `Could not release: ${title}`,
    outcome: release ? "kept" : "failed",
    note: release ? `${release.sizeKb} KB, playable from the Game Maker` : (error ?? "").slice(0, 300),
    commit
  });
};

const deliverIfReady = async (sessionId: string, check: CheckRun) => {
  const session = getSession(sessionId);
  if (!session?.workspace || !check.passed) return;
  const dir = session.workspace.dir;
  const to = await head(dir);
  const from = session.workspace.approvedCommit;
  if (to === from) return;
  const store = read();
  if (store.deliveries.some((d) => d.sessionId === sessionId && d.state === "awaiting" && d.toCommit === to)) return;

  const status = (await git(dir, ["diff", "--no-renames", "--name-status", "-z", from, to])).split("\0").filter(Boolean);
  const changes = new Map<string, DeliveryFile["change"]>();
  for (let i = 0; i + 1 < status.length; i += 2) changes.set(status[i + 1], status[i] === "A" ? "added" : status[i] === "D" ? "deleted" : "modified");
  if (!changes.size) return;
  const counts = new Map<string, [number, number]>();
  for (const line of (await git(dir, ["diff", "--no-renames", "--numstat", from, to])).split("\n").filter(Boolean)) {
    const [added, removed, ...file] = line.split("\t");
    counts.set(file.join("\t"), [Number(added) || 0, Number(removed) || 0]);
  }
  const files: DeliveryFile[] = [...changes].map(([file, change]) => ({ path: file, change, added: counts.get(file)?.[0] ?? 0, removed: counts.get(file)?.[1] ?? 0 }));

  const lines = files.reduce((sum, f) => sum + f.added + f.removed, 0);
  const majorWhy = [
    files.length > 12 ? `${files.length} files` : "",
    lines > 600 ? `${lines} lines changed` : "",
    files.some((f) => f.change === "deleted") ? `${files.filter((f) => f.change === "deleted").length} file(s) deleted` : "",
    files.some((f) => MAJOR_FILE.test(f.path)) ? `build, dependency or config files: ${files.filter((f) => MAJOR_FILE.test(f.path)).slice(0, 4).map((f) => f.path).join(", ")}` : ""
  ].filter(Boolean);

  const since = session.journal.filter((s) => s.outcome === "kept" && s.at > (store.deliveries.filter((d) => d.sessionId === sessionId && d.state !== "awaiting" && d.state !== "superseded").slice(-1)[0]?.decidedAt ?? ""));
  const summary = since.map((s) => s.title).slice(-30);
  const done = session.plan.filter((m) => m.status === "done").length;
  const delivery: Delivery = {
    id: newId("dlv"),
    sessionId,
    projectId: session.projectId,
    projectName: session.projectName,
    fromCommit: from,
    toCommit: to,
    title: summary.length === 1 ? summary[0] : `${summary.length || "Several"} changes · roadmap ${done}/${session.plan.length}`,
    summary,
    files,
    major: majorWhy.length > 0,
    majorWhy,
    check,
    state: "awaiting",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    applied: [],
    declined: [],
    conflicts: [],
    commit: null,
    note: null,
    episodeIds: since.flatMap((s) => [s.episodeId, s.approachEpisodeId]).filter((e): e is number => typeof e === "number")
  };
  update((s) => {
    for (const older of s.deliveries) if (older.sessionId === sessionId && older.state === "awaiting") older.state = "superseded";
    s.deliveries.push(delivery);
  });
  Logger.log("Continuous build: delivery waiting for approval", { session: sessionId, files: files.length, major: delivery.major });
};

const ensureResearch = (sessionId: string) => {
  const session = getSession(sessionId);
  if (!session || session.researchTopicId) return;
  try {
    const topic = ResearchEngine.getInstance().start(
      `Making ${session.projectName} better`,
      `How can ${session.projectName} be made better, more robust and more complete? ${session.goal.slice(0, 400)} What do the best projects of this kind do, what are the common problems and how are they solved?`
    );
    patchSession(sessionId, { researchTopicId: topic.id });
  } catch (error) {
    Logger.warn("Continuous build: could not start its research", { error: (error as Error)?.message });
  }
};

/** One cycle of work, by stage. */
async function cycle(sessionId: string) {
  let session = getSession(sessionId)!;
  const project = EcosystemStore.getProject(session.projectId);
  if (!project) throw new Error("The project is no longer in the project list.");
  if (!session.workspace) {
    await prepareWorkspace(session, project);
    session = getSession(sessionId)!;
  }
  await applyPendingRevert(sessionId);
  await syncOwnerCommits(sessionId);
  session = getSession(sessionId)!;
  const dir = session.workspace!.dir;

  if (session.stage === "planning" || session.needsReplan || session.plan.length === 0) {
    patchSession(sessionId, { phase: session.plan.length ? "Revising the roadmap with your notes" : "Reading the goal and planning the roadmap" });
    const plan = await makePlan(session);
    // A project whose checks already fail gets that fixed first, so everything after builds on a working base.
    patchSession(sessionId, { phase: "Checking what already works" });
    const baseline = session.lastCheck ?? (await runChecks(session, dir));
    if (!baseline.passed && !plan.some((m) => m.status !== "done" && m.title === BASELINE_TITLE)) {
      const first = plan.findIndex((m) => m.status !== "done");
      plan.splice(first < 0 ? plan.length : first, 0, {
        id: newId("ms"),
        title: BASELINE_TITLE,
        detail: `These checks were already failing before this milestone's work: ${baseline.failing.join(", ")}. Fix what is broken (keep everything that works working), so every later step starts from a clean project.

${baseline.output.slice(-3000)}`,
        status: "todo",
        attempts: 0,
        note: null,
        doneAt: null
      });
    }
    patchSession(sessionId, { plan, lastCheck: baseline, stage: plan.some((m) => m.status === "todo") ? "building" : "fixing", needsReplan: false });
    journal(sessionId, { at: new Date().toISOString(), stage: "planning", title: `Roadmap: ${plan.filter((m) => m.status !== "done").length} milestones to go`, outcome: "kept", note: null, commit: null });
    return;
  }

  if (session.stage === "building") {
    // The next milestone; parked ones get another go once the rest are built.
    let milestone = session.plan.find((m) => m.status === "doing" || m.status === "todo");
    if (!milestone) {
      const parked = session.plan.filter((m) => m.status === "parked");
      if (parked.length && parked.some((m) => m.attempts < ATTEMPTS_BEFORE_PARKING * 3)) {
        update((s) => {
          for (const m of s.sessions.find((x) => x.id === sessionId)!.plan) if (m.status === "parked" && m.attempts < ATTEMPTS_BEFORE_PARKING * 3) m.status = "todo";
        });
        return;
      }
      patchSession(sessionId, { stage: "fixing" });
      return;
    }
    const mid = milestone.id;
    update((s) => Object.assign(s.sessions.find((x) => x.id === sessionId)!.plan.find((m) => m.id === mid)!, { status: "doing" }));
    const lastFailure = milestone.attempts > 0 && session.lastCheck && !session.lastCheck.passed ? session.lastCheck : null;
    // Stuck: the same failure again and again. Find the root cause once, and stop repeating the ways that failed.
    const stuck = (milestone.repeats ?? 0) >= 2 && lastFailure;
    let diagnosis = milestone.diagnosis ?? null;
    if (stuck && !diagnosis) {
      patchSession(sessionId, { phase: `Diagnosing why "${milestone.title}" keeps failing` });
      diagnosis = await diagnose(session, milestone, lastFailure).catch(() => null);
      if (diagnosis) update((s) => Object.assign(s.sessions.find((x) => x.id === sessionId)!.plan.find((m) => m.id === mid)!, { diagnosis }));
    }
    const instruction = `Build this milestone of the roadmap: ${milestone.title}
${milestone.detail}

Roadmap (✓ done, → this one):
${roadmapText(session.plan, milestone)}${
      lastFailure ? `\n\nThe last attempt left these checks failing; fix them as part of this:\n${lastFailure.output.slice(-4000)}` : ""
    }${
      lastFailure?.environment
        ? `\n\nThis failure is the PC's, not the code's: ${lastFailure.environment}. Change the check or script so it does not need that here (see "This PC"); do not try it again.`
        : ""
    }${stuck ? `\n\nThis has failed the same way ${milestone.repeats} times in a row; the earlier attempts did not work, so do it differently.${diagnosis ? `\nRoot cause, diagnosed: ${diagnosis}` : ""}` : ""}`;
    const step = await buildStep(session, `Building: ${milestone.title}`, instruction, stuck ? milestone.failedApproaches ?? [] : []);
    if (step.stopped && getSession(sessionId)?.state === "stopped") return;
    patchSession(sessionId, { phase: `Checking: ${milestone.title}` });
    const check = await runChecks(session, dir);
    const changed = step.after !== step.before;
    const finished = changed && check.passed;
    update((s) => {
      const m = s.sessions.find((x) => x.id === sessionId)!.plan.find((x) => x.id === mid)!;
      m.attempts += 1;
      // The same failure as last time: count it, and remember the approach that did not get past it.
      const signature = finished || check.passed ? null : LessonMemory.errorSignature(check.failing[0] ?? "checks", check.output);
      if (signature && signature === m.lastSignature) {
        m.repeats = (m.repeats ?? 1) + 1;
        m.failedApproaches = [...new Set([...(m.failedApproaches ?? []), step.approach])];
      } else {
        m.repeats = signature ? 1 : 0;
        m.failedApproaches = signature ? [step.approach] : [];
        if (!signature) m.diagnosis = null;
        else if (signature !== m.lastSignature) m.diagnosis = null;
      }
      m.lastSignature = signature;
      if (finished) Object.assign(m, { status: "done", doneAt: new Date().toISOString(), note: null });
      else if (m.attempts % ATTEMPTS_BEFORE_PARKING === 0) Object.assign(m, { status: "parked", note: changed ? `checks failing: ${check.failing.join(", ")}` : "no progress" });
      else m.status = "doing";
      s.sessions.find((x) => x.id === sessionId)!.lastCheck = check;
    });
    const bScore = check.passed ? 100 : Math.max(10, Math.round(((check.failing.length === 0 ? 1 : 0) / (check.failing.length + 1)) * 100));
    const bDelta = finished ? 50 : changed ? 10 : 0;
    EpisodicMemory.recordRun(session.projectName, {
      runId: `run_${session.cycles}`,
      pass: session.cycles,
      score: bScore,
      delta: bDelta,
      failureReason: check.passed ? undefined : `checks failing: ${check.failing.join(", ")}`
    });
    if (finished) {
      EpisodicMemory.recordSuccessPattern(session.projectName, {
        signature: milestone.title,
        diffSummary: `Completed milestone ${milestone.title}`,
        scoreDelta: 50
      });
    }
    rewardStep(step.episodeId, finished ? 1 : changed ? 0.4 : 0.1, finished ? "milestone done" : changed ? "progress, checks failing" : "no change");
    journal(sessionId, {
      at: new Date().toISOString(),
      stage: "building",
      title: milestone.title,
      outcome: changed ? "kept" : "no-change",
      note: finished ? "milestone done" : changed ? `checks failing: ${check.failing.join(", ")}` : "the build changed nothing",
      commit: changed ? step.after : null,
      episodeId: changed ? step.episodeId : undefined,
      success: finished
    });
    await deliverIfReady(sessionId, check);
    if (finished) await releaseIfGame(sessionId, milestone.title);
    return;
  }

  if (session.stage === "fixing") {
    patchSession(sessionId, { phase: "Running every check" });
    const check = await runChecks(session, dir);
    patchSession(sessionId, { lastCheck: check });
    if (check.passed) {
      await deliverIfReady(sessionId, check);
      patchSession(sessionId, { phase: "Clean. Checking whether the goal is fully met" });
      const missing = await whatIsMissing(getSession(sessionId)!);
      if (missing.length) {
        update((s) => {
          const target = s.sessions.find((x) => x.id === sessionId)!;
          target.plan.push(...missing.map((m) => ({ id: newId("ms"), title: m.title, detail: m.detail, status: "todo" as const, attempts: 0, note: null, doneAt: null })));
          target.stage = "building";
        });
        journal(sessionId, { at: new Date().toISOString(), stage: "fixing", title: `Not finished yet: ${missing.length} more milestone(s)`, outcome: "kept", note: missing.map((m) => m.title).join("; "), commit: null });
        return;
      }
      if (session.mode === "complete") {
        patchSession(sessionId, { stage: "complete", state: "stopped", stoppedAt: new Date().toISOString(), phase: "Goal complete: everything built and every check passing. Approve the last delivery to have it all." });
        journal(sessionId, { at: new Date().toISOString(), stage: "complete", title: "Goal complete", outcome: "kept", note: null, commit: await head(dir) });
        return;
      }
      patchSession(sessionId, { stage: "improving", improvementsSincePlan: 0 });
      ensureResearch(sessionId);
      return;
    }
    const before = await head(dir);
    // What fixed this kind of failure before, in any project.
    const lessons = LessonMemory.relevant("build", `${check.failing.join(" ")}\n${check.output.slice(0, 2000)}`, 4);
    if (lessons.length) LessonMemory.markApplied(lessons.map((l) => l.id), session.projectName);
    const step = await buildStep(
      session,
      `Fixing: ${check.failing.join(", ")}`,
      `Make every check pass. These are failing:\n\n${check.output}${lessons.length ? `\n\nWhat fixed failures like this before:\n${LessonMemory.formatForPrompt(lessons)}` : ""}${
        check.environment ? `\n\nThis failure is the PC's, not the code's: ${check.environment}. Change the check or script so it does not need that here; do not try it again.` : ""
      }`
    );
    if (step.stopped && getSession(sessionId)?.state === "stopped") return;
    const after = await runChecks(session, dir);
    // A fix that leaves more failing than before is undone.
    const worse = after.failing.length > check.failing.length;
    const better = after.passed || after.failing.length < check.failing.length;
    if (worse) await rollBack(dir, before);
    if (lessons.length) LessonMemory.recordOutcome(lessons.map((l) => l.id), better && !worse);
    rewardStep(step.episodeId, worse ? 0 : after.passed ? 1 : better ? 0.6 : 0.2, worse ? "made it worse" : after.passed ? "checks green" : better ? "fewer failing" : "no better");
    if (after.passed && !worse && step.after !== step.before) await learnFromFix(session, check, step.before, step.after);
    const fScore = after.passed ? 100 : Math.max(10, Math.round(((after.failing.length === 0 ? 1 : 0) / (after.failing.length + 1)) * 100));
    const fDelta = after.passed ? 60 : better ? 20 : worse ? -20 : 0;
    EpisodicMemory.recordRun(session.projectName, {
      runId: `run_${session.cycles}`,
      pass: session.cycles,
      score: fScore,
      delta: fDelta,
      failureReason: after.passed ? undefined : `checks failing: ${after.failing.join(", ")}`
    });
    if (after.passed && !worse && step.after !== step.before) {
      EpisodicMemory.recordSuccessPattern(session.projectName, {
        signature: `Fixed: ${check.failing.join(", ")}`,
        diffSummary: `Fixed ${check.failing.join(", ")}`,
        scoreDelta: 60
      });
    }
    patchSession(sessionId, { lastCheck: worse ? check : after });
    journal(sessionId, {
      at: new Date().toISOString(),
      stage: "fixing",
      title: `Fixing ${check.failing.join(", ")}`,
      outcome: worse ? "rolled-back" : step.after === step.before ? "no-change" : "kept",
      note: worse ? `made it worse (${after.failing.join(", ")})` : after.passed ? "all checks pass" : `still failing: ${after.failing.join(", ")}`,
      commit: worse ? null : step.after,
      episodeId: worse ? undefined : step.episodeId,
      success: !worse && better
    });
    if (after.passed && !worse) await deliverIfReady(sessionId, after);
    return;
  }

  if (session.stage === "improving") {
    ensureResearch(sessionId);
    if (session.improvementsSincePlan >= IMPROVEMENTS_PER_UPGRADE_PLAN) {
      patchSession(sessionId, { phase: "Planning the next upgrades" });
      const upgrades = await planUpgrades(getSession(sessionId)!);
      update((s) => {
        const target = s.sessions.find((x) => x.id === sessionId)!;
        target.improvementsSincePlan = 0;
        if (upgrades.length) {
          target.plan.push(...upgrades.map((m) => ({ id: newId("ms"), title: m.title, detail: m.detail, status: "todo" as const, attempts: 0, note: null, doneAt: null })));
          target.stage = "building";
        }
      });
      if (upgrades.length) journal(sessionId, { at: new Date().toISOString(), stage: "improving", title: `Next upgrades: ${upgrades.map((u) => u.title).join("; ")}`, outcome: "kept", note: null, commit: null });
      return;
    }
    patchSession(sessionId, { phase: "Choosing the next improvement" });
    const kind = Reinforcement.choose("improve.kind", { bucket: session.projectId, agent: "continuous-improver", ref: `session:${sessionId}:${Date.now()}` });
    const idea = await nextImprovement(session, kind.arm.instruction.replace(/^Prefer:\s*/, ""));
    const step = await buildStep(session, `Improving: ${idea.title}`, idea.instruction);
    if (step.stopped && getSession(sessionId)?.state === "stopped") return;
    const check = await runChecks(session, dir);
    const changed = step.after !== step.before;
    // An improvement that breaks the checks is undone: the workspace stays clean.
    if (changed && !check.passed) {
      await rollBack(dir, step.before);
      Reinforcement.reward(kind.episodeId, 0.2, "checks-failed");
      rewardStep(step.episodeId, 0, "broke the checks");
    } else if (!changed) {
      Reinforcement.forget(kind.episodeId);
      rewardStep(step.episodeId, 0.1, "no change");
    } else {
      rewardStep(step.episodeId, 0.8, "kept, checks pass");
    }
    patchSession(sessionId, { lastCheck: changed && !check.passed ? session.lastCheck : check, improvementsSincePlan: session.improvementsSincePlan + 1 });
    journal(sessionId, {
      at: new Date().toISOString(),
      stage: "improving",
      title: idea.title,
      outcome: !changed ? "no-change" : check.passed ? "kept" : "rolled-back",
      note: changed && !check.passed ? `broke ${check.failing.join(", ")}` : null,
      commit: changed && check.passed ? step.after : null,
      episodeId: changed && check.passed ? kind.episodeId : undefined,
      approachEpisodeId: changed && check.passed ? step.episodeId : undefined,
      success: changed && check.passed
    });
    if (changed && check.passed) {
      await deliverIfReady(sessionId, check);
      await releaseIfGame(sessionId, idea.title);
    }
  }
}

async function loop(id: string) {
  if (loops.has(id)) return;
  loops.add(id);
  let failures = 0;
  try {
    for (;;) {
      const session = getSession(id);
      if (!session || session.state === "stopped") return;
      if (GameMode.isOn()) {
        patchSession(id, { phase: "Paused while everything is paused (game mode)" });
        await sleep(60_000);
        continue;
      }
      if (DiskGuard.low()) {
        patchSession(id, { phase: `Waiting: ${DiskGuard.reason()}` });
        await sleep(5 * 60_000);
        continue;
      }
      try {
        await cycle(id);
        await retrospect(id).catch((error) => Logger.warn("Could not write a step's breakdown", { session: id, error: (error as Error).message }));
        failures = 0;
        patchSession(id, { cycles: (getSession(id)?.cycles ?? 0) + 1, lastError: null });
      } catch (error) {
        failures += 1;
        const message = (error as Error)?.message ?? String(error);
        Logger.warn("Continuous build cycle failed", { session: id, error: message });
        patchSession(id, { lastError: message, currentBuildId: null });
        journal(id, { at: new Date().toISOString(), stage: getSession(id)?.stage ?? "building", title: "A step failed", outcome: "failed", note: message.slice(0, 300), commit: null });
      }
      if (getSession(id)?.state === "stopped") return;
      // It never gives up on its own: after a failure it waits longer, up to half an hour, and tries again.
      const wait = failures ? Math.min(MAX_BACKOFF_MS, COOLDOWN_MS * 2 ** Math.min(failures, 6)) : COOLDOWN_MS;
      patchSession(id, { phase: failures ? `Something went wrong; trying again in ${Math.round(wait / 60_000)} min` : "Resting before the next step" });
      await sleep(wait);
    }
  } finally {
    loops.delete(id);
  }
}

/* ─── approving deliveries ─── */

const decide = async (deliveryId: string, chosen: string[] | null, note: string): Promise<Delivery> => {
  const store = read();
  const delivery = store.deliveries.find((d) => d.id === deliveryId);
  if (!delivery) throw new Error("Unknown delivery.");
  if (delivery.state !== "awaiting") throw new Error(`It is ${delivery.state}, not waiting for you.`);
  const session = store.sessions.find((s) => s.id === delivery.sessionId);
  if (!session?.workspace) throw new Error("That session's workspace is gone.");
  const dir = session.workspace.dir;
  const project = EcosystemStore.getProject(delivery.projectId);
  const all = delivery.files.map((f) => f.path);
  const take = chosen === null ? [] : chosen.filter((file) => all.includes(file));
  if (chosen !== null && take.length === 0) throw new Error("Choose at least one part to add, or decline it.");
  if (take.length && session.liveBranch && project?.gitBranch && project.gitBranch !== session.liveBranch) {
    throw new Error(`The project is on ${project.gitBranch} now, not ${session.liveBranch}; switch back before approving.`);
  }

  // Three-way into the project: only where the project file is still what the last approval left.
  const applied: string[] = [];
  const conflicts: string[] = [];
  const settled = new Map<string, Buffer | null>();
  for (const file of take) {
    const base = await blobAt(dir, delivery.fromCommit, file);
    const next = await blobAt(dir, delivery.toCommit, file);
    const current = readOrNull(path.join(session.projectPath, file));
    if (same(current, next)) {
      settled.set(file, next);
    } else if (same(current, base) && writeUnder(session.projectPath, file, next)) {
      applied.push(file);
      settled.set(file, next);
    } else {
      conflicts.push(file);
      settled.set(file, current);
    }
  }
  const declined = all.filter((file) => !take.includes(file));
  for (const file of declined) settled.set(file, await blobAt(dir, delivery.fromCommit, file));

  let commit: Delivery["commit"] = null;
  let commitNote: string | null = null;
  if (applied.length && (await isGitRepo(session.projectPath))) {
    try {
      const made = await commitPaths(
        session.projectPath,
        applied,
        (delivery.summary.length === 1 ? delivery.summary[0] : `Continuous build: ${delivery.title}`).replace(/\s+/g, " ").slice(0, 72),
        `${delivery.summary.slice(0, 20).map((s) => `- ${s}`).join("\n")}\n\nBuilt by Agent Builder's continuous builder, approved by the owner.`
      );
      commit = { hash: made.hash, branch: made.branch };
    } catch (error) {
      commitNote = `Applied, not committed: ${(error as Error)?.message}`;
    }
  }

  const approvedCommit = await approvedWith(dir, session.workspace.approvedCommit, settled, `Owner's decision on ${delivery.id}`);
  // Declined files, and files the owner had changed themselves, go back to what the project has.
  const revert = [...declined, ...conflicts];
  update((s) => {
    const target = s.sessions.find((x) => x.id === session.id)!;
    target.workspace = { ...target.workspace!, approvedCommit };
    target.pendingRevert = [...new Set([...target.pendingRevert, ...revert])];
    if (applied.length && commit && target.projectHead) target.projectHead = commit.hash;
  });
  if (!loops.has(session.id) && revert.length) await applyPendingRevert(session.id);

  const state: Delivery["state"] = take.length === 0 ? "declined" : declined.length || conflicts.length ? "partly" : "approved";
  const notes = [
    note.trim().slice(0, 300),
    conflicts.length ? `You changed ${conflicts.length} of these yourself since; your version was kept: ${conflicts.slice(0, 6).join(", ")}` : "",
    commitNote ?? ""
  ].filter(Boolean);
  update((s) =>
    Object.assign(s.deliveries.find((d) => d.id === deliveryId)!, {
      state,
      decidedAt: new Date().toISOString(),
      applied,
      declined,
      conflicts,
      commit,
      note: notes.join(" · ") || null
    })
  );
  const reward = state === "approved" ? 1 : state === "partly" ? take.length / all.length : 0;
  for (const episode of delivery.episodeIds) Reinforcement.reward(episode, reward, "owner-decision", note);
  if (applied.length) EcosystemStore.recordEvent(delivery.projectId, "build", `Approved from the continuous builder: ${delivery.title} (${applied.length} files)`);
  return read().deliveries.find((d) => d.id === deliveryId)!;
};

/* ─── is it getting better? ─── */

export interface Progress {
  /** Share of the last 20 work steps that achieved what they set out to (0..1), and of the 20 before. */
  recentSuccess: number | null;
  earlierSuccess: number | null;
  steps: number;
  milestonesDone: number;
  milestones: number;
  /** Work steps in a row that succeeded, counting back from now. */
  cleanStreak: number;
  approved: number;
  declined: number;
}

const rateOf = (steps: Step[]) => (steps.length ? Math.round((steps.filter((s) => s.success).length / steps.length) * 100) / 100 : null);

const progressOf = (session: ImproveSession, deliveries: Delivery[]): Progress => {
  const work = session.journal.filter((s) => typeof s.success === "boolean");
  let cleanStreak = 0;
  for (let i = work.length - 1; i >= 0 && work[i].success; i--) cleanStreak += 1;
  const mine = deliveries.filter((d) => d.sessionId === session.id);
  return {
    recentSuccess: rateOf(work.slice(-20)),
    earlierSuccess: work.length > 20 ? rateOf(work.slice(-40, -20)) : null,
    steps: work.length,
    milestonesDone: session.plan.filter((m) => m.status === "done").length,
    milestones: session.plan.length,
    cleanStreak,
    approved: mine.filter((d) => d.state === "approved" || d.state === "partly").length,
    declined: mine.filter((d) => d.state === "declined").length
  };
};

/* ─── the API ─── */

export interface StartOptions {
  goal?: string;
  mode?: Mode;
  checkCommand?: string | null;
  /** A game (see GameDirector); by default when the goal describes one and the project is new. */
  kind?: "app" | "game";
  /** A new game: add the multiplayer kit (by default when the goal asks for players together). */
  multiplayer?: boolean;
}

const slugName = (name: string) =>
  name
    .trim()
    .replace(/[^A-Za-z0-9 _-]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);

export const ContinuousImprover = {
  list() {
    const store = read();
    return {
      sessions: [...store.sessions].reverse().map((session) => ({ ...session, progress: progressOf(session, store.deliveries) })),
      deliveries: [...store.deliveries].reverse(),
      candidates: [...store.candidates].reverse()
    };
  },

  running(): string[] {
    return read()
      .sessions.filter((s) => s.state !== "stopped")
      .map((s) => s.projectName);
  },

  approvedCount(): number {
    const store = read();
    return store.candidates.filter((c) => c.state === "approved").length + store.deliveries.filter((d) => d.state === "approved" || d.state === "partly").length;
  },

  /** Across every session: how often its steps succeed now against before, for the agent's profile. */
  progress(): { recentSuccess: number | null; earlierSuccess: number | null; steps: number; milestonesDone: number } {
    const store = read();
    const work = store.sessions
      .flatMap((s) => s.journal)
      .filter((s) => typeof s.success === "boolean")
      .sort((a, b) => (a.at < b.at ? -1 : 1));
    return {
      recentSuccess: rateOf(work.slice(-30)),
      earlierSuccess: work.length > 30 ? rateOf(work.slice(-60, -30)) : null,
      steps: work.length,
      milestonesDone: store.sessions.reduce((sum, s) => sum + s.plan.filter((m) => m.status === "done").length, 0)
    };
  },

  waitingCount(): number {
    const store = read();
    return store.deliveries.filter((d) => d.state === "awaiting").length + store.candidates.filter((c) => c.state === "awaiting" || c.state === "conflict").length;
  },

  start(projectId: string, options: StartOptions | string = {}, startedBy = "owner"): ImproveSession {
    const opts: StartOptions = typeof options === "string" ? { goal: options } : options;
    const project = EcosystemStore.getProject(projectId);
    if (!project) throw new Error("Unknown project.");
    const existing = read().sessions.find((s) => s.projectId === projectId && s.state !== "stopped");
    if (existing) {
      // Already running: new instructions become a note, and the roadmap is revised.
      if (opts.goal?.trim()) ContinuousImprover.instruct(existing.id, opts.goal);
      return getSession(existing.id)!;
    }
    const goal = (opts.goal ?? "").trim().slice(0, 6000);
    const session = withDefaults({
      id: newId("cont"),
      projectId,
      projectName: project.name,
      projectPath: project.path,
      liveBranch: project.gitBranch,
      goal,
      focus: goal.slice(0, 500),
      kind: opts.kind === "game" ? "game" : "app",
      mode: opts.mode === "complete" ? "complete" : "forever",
      checkCommand: opts.checkCommand?.trim().slice(0, 500) || null,
      state: "running",
      phase: "Starting",
      startedAt: new Date().toISOString(),
      stoppedAt: null,
      startedBy,
      cycles: 0,
      currentBuildId: null,
      lastError: null
    });
    update((s) => s.sessions.push(session));
    if (process.env.CONTINUOUS_NO_LOOP !== "1") void loop(session.id);
    return session;
  },

  /** A brand-new project (a folder and a git repository) and a session building it from nothing. */
  async startNew(name: string, options: StartOptions, startedBy = "owner"): Promise<ImproveSession> {
    const folder = slugName(name);
    if (folder.length < 2) throw new Error("Give the new project a name.");
    const root = NEW_PROJECTS_DIR();
    const dir = path.join(root, folder);
    if (fs.existsSync(dir) && fs.readdirSync(dir).length) throw new Error(`${dir} already exists. Pick it from your projects instead, or choose another name.`);
    fs.mkdirSync(dir, { recursive: true });
    // A game starts from the web starter with its asset ledger (and the multiplayer kit), and its goal becomes a production plan.
    const game = options.kind === "game" || (options.kind !== "app" && GameDirector.isGame(`${name} ${options.goal ?? ""}`));
    if (game) GameDirector.seed(dir, name.trim(), options.goal ?? "", { multiplayer: options.multiplayer });
    else fs.writeFileSync(path.join(dir, "README.md"), `# ${name.trim()}\n\n${(options.goal ?? "").trim()}\n`, "utf8");
    await git(dir, ["init", "-q", "-b", "main"]);
    await git(dir, ["add", "-A"]);
    await git(dir, ["commit", "-q", "-m", "Start: the goal"]);
    const project = await ProjectScanner.addProject(dir.replace(/\\/g, "/"), root);
    const goal = game ? GameDirector.goal(options.goal ?? "", { multiplayer: options.multiplayer }) : options.goal;
    return ContinuousImprover.start(project.id, { ...options, goal, kind: game ? "game" : "app" }, startedBy);
  },

  /** New instructions for a running session: added to its notes, and the roadmap is revised. */
  instruct(sessionId: string, text: string): ImproveSession {
    const note = text.trim().slice(0, 2000);
    if (!note) throw new Error("Write the instruction.");
    const session = getSession(sessionId);
    if (!session) throw new Error("Unknown session.");
    patchSession(sessionId, { notes: [...session.notes, note].slice(-30), needsReplan: true });
    // The owner's new direction counts now: the step in progress stops, and the roadmap is revised next.
    if (session.currentBuildId && BuildService.isRunning(session.currentBuildId)) BuildService.control(session.currentBuildId, "stop");
    return getSession(sessionId)!;
  },

  /** Change how it runs: finish and stop, or keep going forever; the check command. */
  configure(sessionId: string, options: { mode?: Mode; checkCommand?: string | null; vmTest?: VmTestConfig | null }): ImproveSession {
    const session = getSession(sessionId);
    if (!session) throw new Error("Unknown session.");
    patchSession(sessionId, {
      ...(options.mode ? { mode: options.mode === "complete" ? "complete" : "forever" } : {}),
      ...(options.checkCommand !== undefined ? { checkCommand: options.checkCommand?.trim().slice(0, 500) || null } : {}),
      ...(options.vmTest !== undefined ? { vmTest: options.vmTest } : {})
    });
    return getSession(sessionId)!;
  },

  stop(sessionId: string): ImproveSession | null {
    const store = update((s) => {
      const session = s.sessions.find((x) => x.id === sessionId);
      if (session && session.state !== "stopped") Object.assign(session, { state: "stopped", stoppedAt: new Date().toISOString(), phase: "Stopped by you" });
    });
    const session = store.sessions.find((s) => s.id === sessionId) ?? null;
    if (session?.currentBuildId && BuildService.isRunning(session.currentBuildId)) BuildService.control(session.currentBuildId, "stop");
    if (session?.researchTopicId) ResearchEngine.getInstance().pause(session.researchTopicId);
    return session;
  },

  /** Carries on a stopped session from where it got to (its workspace, roadmap and history). */
  restart(sessionId: string): ImproveSession {
    const session = getSession(sessionId);
    if (!session) throw new Error("Unknown session.");
    if (read().sessions.some((s) => s.projectId === session.projectId && s.state !== "stopped" && s.id !== sessionId)) {
      throw new Error("Another session is already working on this project.");
    }
    patchSession(sessionId, {
      state: "running",
      stoppedAt: null,
      phase: "Carrying on",
      ...(session.stage === "complete" ? { stage: "fixing" as const } : {})
    });
    if (session.researchTopicId) ResearchEngine.getInstance().resume(session.researchTopicId);
    if (process.env.CONTINUOUS_NO_LOOP !== "1") void loop(sessionId);
    return getSession(sessionId)!;
  },

  async diff(id: string, file?: string): Promise<string> {
    const delivery = read().deliveries.find((d) => d.id === id);
    if (delivery) {
      const session = getSession(delivery.sessionId);
      if (!session?.workspace) throw new Error("That session's workspace is gone.");
      const out = await git(session.workspace.dir, ["diff", "--no-renames", delivery.fromCommit, delivery.toCommit, "--", ...(file ? [file] : [])]);
      return out.length > 120_000 ? `${out.slice(0, 120_000)}\n… (diff truncated; open one file at a time)` : out;
    }
    const candidate = read().candidates.find((c) => c.id === id);
    const record = candidate ? ProjectBuilds.get(candidate.buildId) : null;
    if (!record) throw new Error("That change is gone.");
    return ProjectBuilds.diff(record);
  },

  /**
   * Approve a delivery (all of it, or only `files`: the parts to add) or an
   * older single change. Applies to the project and commits on its live branch.
   */
  async approve(id: string, files?: string[]): Promise<Delivery | Candidate> {
    const delivery = read().deliveries.find((d) => d.id === id);
    if (delivery) {
      if (delivery.major && !files) throw new Error("This is a major change: choose which parts to add.");
      return decide(id, files ?? delivery.files.map((f) => f.path), "");
    }
    return approveCandidate(id);
  },

  async reject(id: string, note = ""): Promise<Delivery | Candidate> {
    if (read().deliveries.some((d) => d.id === id)) return decide(id, null, note);
    const candidate = read().candidates.find((c) => c.id === id);
    if (!candidate) throw new Error("Unknown change.");
    patchCandidate(id, { state: "rejected", decidedAt: new Date().toISOString(), note: note.slice(0, 300) || null });
    if (candidate.episodeId) Reinforcement.reward(candidate.episodeId, 0, "owner-decision", note);
    return read().candidates.find((c) => c.id === id)!;
  },

  /** Picks up running sessions after a restart. */
  resume() {
    if (process.env.CONTINUOUS_NO_LOOP === "1") return;
    for (const session of read().sessions.filter((s) => s.state !== "stopped")) {
      update((s) => {
        for (const c of s.candidates) if (c.sessionId === session.id && (c.state === "building" || c.state === "testing")) Object.assign(c, { state: "failed", note: "Agent Builder restarted during it." });
        const target = s.sessions.find((x) => x.id === session.id);
        if (target) target.currentBuildId = null;
      });
      void loop(session.id);
    }
  },

  /** For tests: the steps the loop takes, one at a time. */
  testHooks: { prepareWorkspace, syncOwnerCommits, deliverIfReady, applyPendingRevert, getSession, patchSession, runChecks, cycle, itemsFrom, releaseIfGame, journal, retrospect }
};

/** The first version's single changes: applied whole, as before. */
async function approveCandidate(candidateId: string): Promise<Candidate> {
  const candidate = read().candidates.find((c) => c.id === candidateId);
  if (!candidate) throw new Error("Unknown change.");
  if (candidate.state !== "awaiting" && candidate.state !== "conflict") throw new Error(`It is ${candidate.state}, not waiting for approval.`);
  const record = ProjectBuilds.get(candidate.buildId);
  if (!record) throw new Error("That change's build is gone.");
  const result = await ProjectBuilds.apply(record);
  if (result.conflicts.length) {
    patchCandidate(candidateId, { state: "conflict", note: `Changed in the project since: ${result.conflicts.join(", ")}. Nothing was applied from those files.` });
    return read().candidates.find((c) => c.id === candidateId)!;
  }
  let commit: Candidate["commit"] = null;
  let note: string | null = null;
  try {
    const made = await ProjectBuilds.commitApplied(ProjectBuilds.get(candidate.buildId) ?? record, `${candidate.title}\n\n${candidate.why}\n\nContinuous improvement, approved by the owner.`);
    commit = { hash: made.hash, branch: made.branch };
  } catch (error) {
    note = `Applied, not committed: ${(error as Error)?.message}`;
  }
  patchCandidate(candidateId, { state: "approved", decidedAt: new Date().toISOString(), commit, note });
  if (candidate.episodeId) Reinforcement.reward(candidate.episodeId, 1, "owner-decision");
  return read().candidates.find((c) => c.id === candidateId)!;
}
