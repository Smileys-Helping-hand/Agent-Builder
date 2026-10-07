/**
 * BuildService — the one place that owns running builds.
 *
 * Previously this bookkeeping lived inside the HTTP routes, which meant only an
 * HTTP caller could start a build. The order pipeline needs to start one too,
 * and needs to know when it finishes, so it moved here: routes and the pipeline
 * are now both clients of the same service, and there is a single answer to
 * "what is building right now".
 *
 * Every build is written to data/builds.json as it goes: its passes, what each
 * check said, what it is doing right now, and a log of everything that
 * happened. So a build is never lost — not when the app is refreshed, not when
 * the phone is closed, and not when the builder itself restarts. A build that
 * was running when the builder stopped comes back as "interrupted", and can be
 * continued from where it got to.
 */
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";

import {
  AutonomousOrchestrator,
  PROFILE_DEFAULTS,
  type AutonomousConfig,
  type BuildGuidance,
  type BuildIteration,
  type BuildProfile,
  type BuildThought
} from "./AutonomousOrchestrator.js";
import { Logger } from "../utils/Logger.js";
import type { AuditFinding } from "./SiteAudit.js";
import { buildActivity, buildScope, type BuildScope } from "../utils/BuildContext.js";

export type BuildState = "running" | "paused" | "completed" | "stopped" | "error" | "interrupted";

/** One objective check, as the app shows it: enough to see what failed, not the whole log. */
export interface CheckSummary {
  name: string;
  applicable: boolean;
  passed: boolean;
  durationMs: number;
}

/** A pass, as it is kept after the build: scores, checks, and the error that blocked it. */
export interface IterationSummary {
  iteration: number;
  at: string;
  qualityScore: number;
  objectiveScore: number;
  status: string;
  improvements: string[];
  files: number;
  passed: boolean;
  checks: CheckSummary[];
  /** The first check that failed, with the end of its output — the reason it is not done. */
  blocker: { name: string; output: string } | null;
  metrics: BuildIteration["metrics"];
}

export interface BuildEventEntry {
  at: string;
  kind: "start" | "pass" | "stage" | "repair" | "score" | "guidance" | "lesson" | "package" | "control" | "warn" | "error" | "done";
  message: string;
}

/** The last "Test & audit" run on a build: its checks, what the site audit found, and what the preview reported. */
export interface BuildAudit {
  at: string;
  passed: boolean;
  score: number;
  checks: CheckSummary[];
  blocker: { name: string; output: string } | null;
  findings: AuditFinding[];
  /** Errors the preview reported while someone clicked through it. */
  runtime: Array<{ kind: string; message: string; page?: string }>;
  pages: number;
  /** Whether it had a built site to audit, or only the project checks ran. */
  site: boolean;
  /** Whether the site was rendered in a real browser (Chrome/Edge), not only read. */
  rendered?: boolean;
}

/** A thought, as kept: when it happened, on top of what the orchestrator said. */
export interface BuildThoughtEntry extends BuildThought {
  at: string;
}

export interface BuildRecord {
  buildId: string;
  projectName: string;
  description: string;
  startedAt: string;
  finishedAt: string | null;
  state: BuildState;
  iterations: number;
  qualityScore: number;
  outputDir: string;
  startedBy: string;
  /** Set when this build is serving a customer order. */
  orderId: string | null;
  error?: string;
  profile: BuildProfile;
  qualityThreshold: number;
  maxIterations: number;
  /** The build this one carries on from, when it was started with "Continue". */
  continuedFrom: string | null;
  /** Whether every applicable check passed on the best pass. Null until a pass finishes. */
  passed: boolean | null;
  /** Best score any pass reached. The workspace is always left at that pass. */
  bestScore: number;
  /** Why it ended, in a sentence. */
  outcome: string | null;
  /** What the current pass is doing, while it runs. */
  stage: string | null;
  /** Which repair attempt the current pass is on, while repairing. */
  repairAttempt: number | null;
  /** When the current stage began, so the app can say how long it has been at it. */
  stageSince: string | null;
  /** When the current pass began. */
  passSince: string | null;
  guidance: BuildGuidance[];
  iterationDetail: IterationSummary[];
  events: BuildEventEntry[];
  /** The live "what it is thinking" feed: plans, check results, repairs, decisions. */
  thoughts: BuildThoughtEntry[];
  /** The last "Test & audit" of what it made. */
  audit: BuildAudit | null;
}

/** A build as the API and the UI see it: the record plus whether it is live in memory. */
export interface BuildView extends BuildRecord {
  live: boolean;
  /** The model's answer as it is being written. Live builds only; never saved. */
  writing?: LiveWriting | null;
}

/** What the model is writing right now, as ModelRouter streams it. */
export interface LiveWriting {
  phase: string;
  model: string;
  /** The last part of the answer so far. */
  tail: string;
  chars: number;
  tokensPerSecond: number;
  done: boolean;
  at: string;
}

/**
 * Where a new build starts. "web" is a working React + TypeScript + Vite +
 * Vitest app (templates/starters/web) whose setup the build may not rewrite,
 * so the model writes the app rather than inventing a toolchain; "none" is an
 * empty folder; "auto" picks "web" unless the request is plainly not a web app.
 */
export type StarterChoice = "auto" | "web" | "none";

export interface StartBuildOptions extends Partial<AutonomousConfig> {
  projectName: string;
  description: string;
  startedBy?: string;
  orderId?: string | null;
  continuedFrom?: string | null;
  starter?: StarterChoice;
}

const STARTERS_DIR = path.resolve(process.env.STARTERS_DIR ?? "templates/starters");

/** Requests that are not a browser app, so they start from an empty folder instead. */
const NOT_A_WEB_APP =
  /\b(python|django|flask|fastapi|cli|command[- ]line|terminal (app|tool)|discord bot|telegram bot|whatsapp bot|api server|rest api|backend only|express server|node(\.js)? script|powershell|bash script|roblox|luau?|unity|c#|\.net|java|kotlin|swift|rust|golang|arduino)\b/i;

/** Copy the web starter into a new build folder, or null when the build should start from nothing. */
const prepareStarter = (projectName: string, description: string, choice: StarterChoice = "auto"): string | null => {
  if (choice === "none" || (choice === "auto" && NOT_A_WEB_APP.test(`${projectName} ${description}`))) return null;
  const starter = path.join(STARTERS_DIR, "web");
  if (!fs.existsSync(path.join(starter, "package.json"))) return null;

  const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
  const dir = path.resolve("builds", `new_${slug}_${Date.now()}`);
  fs.cpSync(starter, dir, { recursive: true, filter: (source) => !/[\\/](node_modules|dist)([\\/]|$)/.test(source) });
  const html = projectName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  for (const [file, value] of [["index.html", html], ["src/App.tsx", html], ["README.md", projectName]] as const) {
    const target = path.join(dir, file);
    if (fs.existsSync(target)) fs.writeFileSync(target, fs.readFileSync(target, "utf8").split("__NAME__").join(value));
  }
  return dir;
};

const HISTORY_LIMIT = 150;
const EVENT_LIMIT = 250;
const THOUGHT_LIMIT = 160;
const BLOCKER_OUTPUT_CHARS = 2500;
/** How long a finished orchestrator is kept so late status polls still see detail. */
const RELEASE_AFTER_MS = 60_000;
const STORE_PATH = path.resolve(process.env.BUILDS_DB_PATH ?? "./data/builds.json");

const orchestrators = new Map<string, AutonomousOrchestrator>();
const history = new Map<string, BuildRecord>();

// The model's answer as it streams, per running build. Only the latest is
// kept, in memory: it changes several times a second and is worthless later.
const writing = new Map<string, LiveWriting>();
buildActivity.on("thinking", ({ buildId, ...live }: LiveWriting & { buildId: string }) => {
  if (orchestrators.has(buildId)) writing.set(buildId, live);
});

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const now = (): string => new Date().toISOString();

/** The end of a check's output is where the error is; the start is usually install noise. */
const tail = (text: string, chars: number): string => {
  const clean = text.replace(/\r\n/g, "\n").trim();
  return clean.length > chars ? `…${clean.slice(clean.length - chars)}` : clean;
};

const summarise = (iteration: BuildIteration): IterationSummary => {
  const verification = iteration.verification;
  const blocking = verification?.blockingCheck;
  return {
    iteration: iteration.iteration,
    at: new Date(iteration.timestamp).toISOString(),
    qualityScore: iteration.qualityScore,
    objectiveScore: iteration.objectiveScore,
    status: iteration.status,
    improvements: (iteration.improvements ?? []).slice(0, 8),
    files: iteration.artifacts?.length ?? 0,
    passed: Boolean(verification?.passed),
    checks: (verification?.checks ?? []).map((check) => ({
      name: check.name,
      applicable: check.applicable,
      passed: check.passed,
      durationMs: check.durationMs
    })),
    blocker: blocking ? { name: blocking.name, output: tail(blocking.output ?? "", BLOCKER_OUTPUT_CHARS) } : null,
    metrics: iteration.metrics
  };
};

/* ---------------- persistence ---------------- */

let writeTimer: NodeJS.Timeout | null = null;

const writeNow = (): void => {
  if (writeTimer) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    const temp = `${STORE_PATH}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(Array.from(history.values()), null, 1));
    // Rename is atomic, so a crash mid-write never leaves a half-written file.
    fs.renameSync(temp, STORE_PATH);
  } catch (error) {
    Logger.warn("Could not save build history", { error: errorMessage(error) });
  }
};

/** Coalesce the burst of updates a pass produces into one write. */
const persist = (): void => {
  if (writeTimer) return;
  writeTimer = setTimeout(writeNow, 400);
  writeTimer.unref?.();
};

/** Fill in fields older records (or an older version of this file) did not have. */
const normalise = (raw: Partial<BuildRecord> & { buildId: string }): BuildRecord => ({
  projectName: "Untitled",
  description: "",
  startedAt: now(),
  finishedAt: null,
  state: "stopped",
  iterations: 0,
  qualityScore: 0,
  outputDir: "",
  startedBy: "unknown",
  orderId: null,
  profile: "balanced",
  qualityThreshold: 90,
  maxIterations: PROFILE_DEFAULTS.balanced.maxIterations,
  continuedFrom: null,
  passed: null,
  bestScore: raw.qualityScore ?? 0,
  outcome: null,
  stage: null,
  repairAttempt: null,
  stageSince: null,
  passSince: null,
  guidance: [],
  iterationDetail: [],
  events: [],
  thoughts: [],
  audit: null,
  ...raw
});

const load = (): void => {
  let records: Array<Partial<BuildRecord> & { buildId: string }> = [];
  try {
    if (fs.existsSync(STORE_PATH)) records = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
  } catch (error) {
    Logger.warn("Build history could not be read; starting a fresh one", { error: errorMessage(error) });
    try {
      fs.copyFileSync(STORE_PATH, `${STORE_PATH}.corrupt-${Date.now()}`);
    } catch {
      // Nothing to keep.
    }
  }

  let interrupted = 0;
  for (const raw of Array.isArray(records) ? records : []) {
    if (!raw?.buildId) continue;
    const record = normalise(raw);
    // Nothing survives a restart in memory, so whatever was mid-flight stopped.
    if (record.state === "running" || record.state === "paused") {
      interrupted += 1;
      record.state = "interrupted";
      // When it was last heard from, not now: the restart may be hours later.
      const lastSign = [record.startedAt, ...record.events.map((event) => event.at), ...record.iterationDetail.map((pass) => pass.at)]
        .filter(Boolean)
        .sort()
        .pop();
      record.finishedAt = record.finishedAt ?? lastSign ?? now();
      record.stage = null;
      record.repairAttempt = null;
      record.outcome = "The builder stopped while this was running. Continue it to pick up from its best pass.";
      record.events = [
        ...record.events,
        { at: now(), kind: "warn" as const, message: "The builder restarted while this build was running." }
      ].slice(-EVENT_LIMIT);
    }
    history.set(record.buildId, record);
  }
  if (interrupted > 0) {
    Logger.warn(`${interrupted} build(s) were interrupted by a restart`);
    writeNow();
  }
};

load();

/* ---------------- bookkeeping ---------------- */

const remember = (record: BuildRecord): void => {
  // Map keeps first-insertion order, so the history stays in start order.
  history.set(record.buildId, record);
  while (history.size > HISTORY_LIMIT) {
    const oldest = Array.from(history.values()).find((entry) => !orchestrators.has(entry.buildId));
    if (!oldest) break;
    history.delete(oldest.buildId);
  }
  persist();
};

const patch = (buildId: string, change: Partial<BuildRecord> | ((record: BuildRecord) => Partial<BuildRecord>)): BuildRecord | null => {
  const current = history.get(buildId);
  if (!current) return null;
  const updated = { ...current, ...(typeof change === "function" ? change(current) : change) };
  history.set(buildId, updated);
  persist();
  return updated;
};

const log = (buildId: string, kind: BuildEventEntry["kind"], message: string): void => {
  patch(buildId, (record) => ({ events: [...record.events, { at: now(), kind, message }].slice(-EVENT_LIMIT) }));
};

const STAGE_WORDS: Record<string, string> = {
  running: "Writing code",
  verifying: "Running install, typecheck, build and tests",
  repairing: "Fixing what failed",
  analyzing: "Scoring the result",
  improving: "Improving it",
  packaging: "Packaging it"
};

/** The pass the build is best at, which is where its workspace is left. */
const bestPass = (record: BuildRecord): IterationSummary | undefined =>
  record.iterationDetail.reduce<IterationSummary | undefined>(
    (best, pass) => (!best || pass.qualityScore > best.qualityScore ? pass : best),
    undefined
  );

/**
 * Emits: "started" | "iteration" | "completed" | "failed" | "stopped",
 * each with the build's record. The order pipeline listens here.
 */
export const buildEvents = new EventEmitter();
// The pipeline plus any number of route-level listeners; the default of 10 is
// low enough that a busy machine would start printing spurious leak warnings.
buildEvents.setMaxListeners(50);

export const BuildService = {
  start(options: StartBuildOptions): BuildRecord {
    // Anything that is not a known profile (a typo in a request) is the normal one.
    const profile: BuildProfile = options.profile && options.profile in PROFILE_DEFAULTS ? options.profile : "balanced";
    const defaults = PROFILE_DEFAULTS[profile] ?? PROFILE_DEFAULTS.balanced;

    if (options.workingDir) {
      const clash = this.active().find((build) => path.resolve(build.outputDir) === path.resolve(options.workingDir!));
      if (clash) throw new Error(`${clash.projectName} is already building in that folder. Stop it or wait for it first.`);
    }

    // A fresh web build starts from a working app instead of an empty folder.
    const workingDir =
      options.workingDir ??
      // Phone and PC apps are the web app wrapped (see AppBuilder), so they start from it too.
      ((options.targetPlatforms ?? ["web"]).some((platform) => ["web", "android", "windows", "mobile", "desktop"].includes(platform))
        ? prepareStarter(options.projectName, options.description, options.starter) ?? undefined
        : undefined);

    const config: AutonomousConfig = {
      projectName: options.projectName,
      description: options.description,
      targetPlatforms: options.targetPlatforms ?? ["web"],
      qualityThreshold: options.qualityThreshold ?? 90,
      maxIterations: options.maxIterations ?? defaults.maxIterations,
      enableContinuousLearning: options.enableContinuousLearning !== false,
      hardwareOptimization: options.hardwareOptimization !== false,
      autoPackaging: options.autoPackaging !== false,
      profile,
      maxRepairAttempts: options.maxRepairAttempts,
      patience: options.patience,
      workingDir
    };

    const orchestrator = new AutonomousOrchestrator(config);
    const status = orchestrator.getStatus();
    const buildId = status.buildId as string;
    // Carried through every await of this build, so the model router can say
    // which build its streaming answer belongs to; phase follows the stage.
    const scope: BuildScope = { buildId, phase: "Getting ready", orderId: options.orderId ?? null };

    orchestrators.set(buildId, orchestrator);
    const record: BuildRecord = {
      buildId,
      projectName: config.projectName,
      description: config.description,
      startedAt: now(),
      finishedAt: null,
      state: "running",
      iterations: 0,
      qualityScore: 0,
      outputDir: path.resolve(status.outputDir as string),
      startedBy: options.startedBy ?? "unknown",
      orderId: options.orderId ?? null,
      profile,
      qualityThreshold: config.qualityThreshold,
      maxIterations: config.maxIterations,
      continuedFrom: options.continuedFrom ?? null,
      passed: null,
      bestScore: 0,
      outcome: null,
      stage: "starting",
      repairAttempt: null,
      stageSince: now(),
      passSince: now(),
      guidance: [],
      iterationDetail: [],
      thoughts: [],
      audit: null,
      events: [
        {
          at: now(),
          kind: "start",
          message: `${options.continuedFrom ? "Continuing" : "Started"} (${profile}, target quality ${config.qualityThreshold}, up to ${config.maxIterations} passes)`
        }
      ]
    };
    remember(record);

    const current = (): BuildRecord => history.get(buildId) ?? record;

    const settle = (state: BuildState, extra: Partial<BuildRecord> = {}): BuildRecord => {
      writing.delete(buildId);
      const base = current();
      const best = bestPass(base);
      const updated: BuildRecord = {
        ...base,
        ...extra,
        state,
        stage: null,
        repairAttempt: null,
        finishedAt: now(),
        iterations: Math.max(base.iterations, orchestrator.getStatus().currentIteration ?? 0),
        // The workspace is reset to the best pass, so that is the score of what is on disk.
        qualityScore: best?.qualityScore ?? base.qualityScore,
        bestScore: best?.qualityScore ?? base.bestScore,
        passed: best ? best.passed : base.passed,
        guidance: orchestrator.listGuidance()
      };
      remember(updated);
      return updated;
    };

    orchestrator.on("started", () => {
      Logger.log("Build started", { buildId, projectName: config.projectName, startedBy: record.startedBy });
      buildEvents.emit("started", current());
    });

    orchestrator.on("iteration-started", ({ iteration }: { iteration: number }) => {
      scope.phase = `${STAGE_WORDS.running} (pass ${iteration})`;
      const begun = patch(buildId, { iterations: iteration, stage: "running", repairAttempt: null, stageSince: now(), passSince: now() });
      if (begun) buildEvents.emit("stage", begun);
      log(buildId, "pass", `Pass ${iteration} started`);
    });

    orchestrator.on("iteration-status", ({ iteration, status: stage, attempt }: { iteration: number; status: string; attempt?: number }) => {
      scope.phase = `${STAGE_WORDS[stage] ?? stage} (pass ${iteration}${stage === "repairing" && attempt ? `, attempt ${attempt}` : ""})`;
      const staged = patch(buildId, { stage, repairAttempt: attempt ?? null, stageSince: now() });
      // Lets anything following a build (the order pipeline, the Hub) see it move within a pass.
      if (staged) buildEvents.emit("stage", staged);
      if (stage === "repairing") {
        log(buildId, "repair", `Pass ${iteration}: repair attempt ${attempt ?? 1}`);
      } else if (STAGE_WORDS[stage]) {
        log(buildId, "stage", `Pass ${iteration}: ${STAGE_WORDS[stage].toLowerCase()}`);
      }
    });

    orchestrator.on("iteration-complete", (iteration: BuildIteration) => {
      const summary = summarise(iteration);
      const updated = patch(buildId, (existing) => {
        const detail = [...existing.iterationDetail.filter((pass) => pass.iteration !== summary.iteration), summary];
        const best = bestPass({ ...existing, iterationDetail: detail });
        return {
          iterations: iteration.iteration,
          qualityScore: iteration.qualityScore,
          bestScore: best?.qualityScore ?? 0,
          passed: best?.passed ?? null,
          iterationDetail: detail,
          stage: "between passes",
          repairAttempt: null,
          stageSince: now()
        };
      });
      const failing = summary.checks.filter((check) => check.applicable && !check.passed).map((check) => check.name);
      log(
        buildId,
        "score",
        `Pass ${iteration.iteration} scored ${Math.round(iteration.qualityScore)}${
          summary.passed ? " — every check passes" : failing.length ? ` — still failing: ${failing.join(", ")}` : ""
        }`
      );
      if (updated) buildEvents.emit("iteration", updated, iteration);
    });

    orchestrator.on("iteration-failed", ({ iteration, error, retrying }: { iteration: number; error: string; retrying: boolean }) => {
      log(buildId, "warn", `Pass ${iteration} failed: ${error}${retrying ? " — trying again" : ""}`);
    });

    orchestrator.on("thought", (thought: BuildThought) => {
      patch(buildId, (existing) => ({
        thoughts: [...existing.thoughts, { ...thought, at: now() }].slice(-THOUGHT_LIMIT),
        // The checks just ran: that is the score right now, not at the end of the pass.
        ...(thought.kind === "check" && typeof thought.score === "number" ? { qualityScore: thought.score } : {})
      }));
      if (thought.kind === "critique" || thought.kind === "decision") log(buildId, "stage", thought.title);
    });

    orchestrator.on("guidance", (note: BuildGuidance) => {
      patch(buildId, { guidance: orchestrator.listGuidance() });
      log(buildId, "guidance", `Instruction from ${note.from}: ${note.text}`);
    });

    orchestrator.on("lesson-learned", ({ lesson }: { lesson: string }) => {
      log(buildId, "lesson", `Learned: ${lesson}`);
    });

    orchestrator.on("packaged", ({ packages }: { packages: unknown[] }) => {
      log(buildId, "package", `Packaged ${Array.isArray(packages) ? packages.length : 0} bundle(s)`);
    });

    orchestrator.on("paused", () => {
      patch(buildId, { state: "paused" });
      log(buildId, "control", "Paused");
    });

    orchestrator.on("resumed", () => {
      patch(buildId, { state: "running" });
      log(buildId, "control", "Resumed");
    });

    orchestrator.on("completed", ({ finalQuality, reason }: { finalQuality: number; reason?: string }) => {
      Logger.log("Build completed", { buildId, finalQuality, reason });
      const base = current();
      const best = bestPass(base);
      const outcome = best?.passed
        ? `Every check passes. Best quality ${Math.round(best.qualityScore)}.`
        : `${reason ?? "Finished"}. Best quality ${Math.round(best?.qualityScore ?? 0)}${
            best?.blocker ? `; ${best.blocker.name} still fails` : ""
          }.`;
      log(buildId, "done", outcome);
      buildEvents.emit("completed", settle("completed", { outcome }));
      setTimeout(() => orchestrators.delete(buildId), RELEASE_AFTER_MS).unref?.();
    });

    orchestrator.on("error", (error: Error) => {
      Logger.error("Build error", { buildId, error: error.message });
      log(buildId, "error", error.message);
      buildEvents.emit("failed", settle("error", { error: error.message, outcome: `Failed: ${error.message}` }));
      setTimeout(() => orchestrators.delete(buildId), RELEASE_AFTER_MS).unref?.();
    });

    orchestrator.on("stopped", () => {
      Logger.log("Build stopped", { buildId });
      log(buildId, "control", "Stopped");
      buildEvents.emit("stopped", settle("stopped", { outcome: "Stopped before it finished. Continue it to carry on." }));
      orchestrators.delete(buildId);
    });

    // Deliberately not awaited: a build runs for minutes to hours. start()
    // emits "error" before it rejects, and that handler has already recorded
    // the failure; this only covers a rejection that happens without one.
    // Inside the build's scope, so the model router can say which build its
    // streaming answer belongs to (see LiveWriting).
    buildScope.run(scope, () => orchestrator.start()).catch((error: unknown) => {
      if (current().state === "error") return;
      Logger.error("Build failed to run", { buildId, error: errorMessage(error) });
      buildEvents.emit("failed", settle("error", { error: errorMessage(error), outcome: `Failed: ${errorMessage(error)}` }));
      orchestrators.delete(buildId);
    });

    return current();
  },

  /**
   * Start a new build that carries on in an earlier build's folder: the code it
   * left (its best pass), plus whatever it should do next. The earlier build is
   * left as it was, so the history reads as what actually happened.
   */
  continue(buildId: string, options: { instruction?: string; profile?: BuildProfile; startedBy?: string } = {}): BuildRecord {
    const previous = history.get(buildId);
    if (!previous) throw new Error("Unknown build.");
    if (this.isRunning(buildId)) throw new Error("That build is still running.");
    if (!previous.outputDir || !fs.existsSync(previous.outputDir)) {
      throw new Error("Its folder is gone, so there is nothing to carry on from. Start a new build instead.");
    }

    const instruction = options.instruction?.trim();
    const blocker = bestPass(previous)?.blocker;
    // Carrying on from a build that was itself carried on: keep the brief, not
    // every earlier "carry on" and its old error, which pile up with each one.
    const brief = previous.description.split(/\n+This project was started by an earlier build and is already in the folder\./)[0].trim();
    const description = [
      brief,
      "",
      "This project was started by an earlier build and is already in the folder.",
      instruction ? `Now do this: ${instruction}` : "Carry on: finish what is missing and fix whatever still fails.",
      blocker ? `\nWhen it last ran, the ${blocker.name} check failed with:\n${blocker.output.slice(-1200)}` : "",
      previous.guidance.length > 0 ? `\nStanding instructions from before:\n${previous.guidance.map((note) => `- ${note.text}`).join("\n")}` : ""
    ]
      .filter((line) => line !== undefined)
      .join("\n")
      .trim();

    return this.start({
      projectName: previous.projectName,
      description,
      profile: options.profile ?? previous.profile,
      qualityThreshold: previous.qualityThreshold,
      workingDir: previous.outputDir,
      startedBy: options.startedBy ?? "user",
      orderId: previous.orderId,
      continuedFrom: previous.buildId
    });
  },

  /** The stored record, with whether it is live in memory. */
  view(buildId: string): BuildView | null {
    const record = history.get(buildId);
    if (!record) return null;
    const orchestrator = orchestrators.get(buildId);
    if (!orchestrator) return { ...record, live: false };

    const status = orchestrator.getStatus();
    const running = record.state === "running" || record.state === "paused";
    return {
      ...record,
      live: running,
      state: running ? (status.isPaused ? "paused" : "running") : record.state,
      guidance: status.guidance ?? record.guidance,
      writing: running ? writing.get(buildId) ?? null : null
    };
  },

  /**
   * A build as a list shows it: without the thought feed, the full log and
   * the error output, which only its own page needs. The list is polled every
   * few seconds and cached on the phone, so it has to stay small.
   */
  summary(build: BuildView): BuildView & { thoughtCount: number } {
    return {
      ...build,
      thoughts: [],
      thoughtCount: build.thoughts.length,
      // The audit's detail is for the build's own page.
      audit: null,
      // How fast it is writing, for a list; the text itself only on its own page.
      writing: build.writing ? { ...build.writing, tail: "" } : null,
      events: build.events.slice(-3),
      iterationDetail: build.iterationDetail.map((pass) => ({
        ...pass,
        improvements: [],
        blocker: pass.blocker ? { name: pass.blocker.name, output: "" } : null
      }))
    };
  },

  /** Everything, newest first. */
  list(): BuildView[] {
    return Array.from(history.keys())
      .map((buildId) => this.view(buildId))
      .filter((build): build is BuildView => build !== null)
      .reverse();
  },

  /** Builds actually in progress: running, or paused waiting on you. */
  active(): BuildView[] {
    return Array.from(orchestrators.keys())
      .map((buildId) => this.view(buildId))
      .filter((build): build is BuildView => build !== null && (build.state === "running" || build.state === "paused"));
  },

  isRunning(buildId: string): boolean {
    // A finished orchestrator is kept for a minute so late status polls still
    // see its detail; that does not make it running.
    if (!orchestrators.has(buildId)) return false;
    const state = history.get(buildId)?.state;
    return state === "running" || state === "paused";
  },

  guide(buildId: string, text: string, from: string): BuildGuidance | null {
    if (!this.isRunning(buildId)) return null;
    const orchestrator = orchestrators.get(buildId);
    return orchestrator ? orchestrator.addGuidance(text, from) : null;
  },

  guidance(buildId: string): BuildGuidance[] {
    return orchestrators.get(buildId)?.listGuidance() ?? history.get(buildId)?.guidance ?? [];
  },

  control(buildId: string, action: "pause" | "resume" | "stop"): boolean {
    if (!this.isRunning(buildId)) return false;
    const orchestrator = orchestrators.get(buildId);
    if (!orchestrator) return false;
    orchestrator[action]();
    if (action === "stop") orchestrators.delete(buildId);
    return true;
  },

  /** Keep the result of a "Test & audit" run with the build. */
  recordAudit(buildId: string, audit: BuildAudit): BuildRecord | null {
    const updated = patch(buildId, { audit });
    const problems = audit.findings.filter((finding) => finding.severity !== "info").length + audit.runtime.length;
    log(
      buildId,
      audit.passed && problems === 0 ? "done" : "warn",
      `Tested and audited: ${audit.passed ? "every check passes" : `${audit.blocker?.name ?? "a check"} fails`}; ${problems} problem(s) on the site`
    );
    return updated;
  },

  /** Drop a finished build from the list. Its files stay where they are. */
  forget(buildId: string): boolean {
    if (this.isRunning(buildId)) return false;
    orchestrators.delete(buildId);
    const removed = history.delete(buildId);
    if (removed) persist();
    return removed;
  },

  /** Write anything pending now; used on shutdown. */
  flush(): void {
    writeNow();
  }
};

// Keep the last few hundred milliseconds of updates when the process is told to stop.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    BuildService.flush();
    process.exit(0);
  });
}
// Covers process.exit() from anywhere else (the Shut down button, the sidecar exit).
process.once("exit", () => BuildService.flush());
