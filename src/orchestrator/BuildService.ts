/**
 * BuildService — the one place that owns running builds.
 *
 * Previously this bookkeeping lived inside the HTTP routes, which meant only an
 * HTTP caller could start a build. The order pipeline needs to start one too,
 * and needs to know when it finishes, so it moved here: routes and the pipeline
 * are now both clients of the same service, and there is a single answer to
 * "what is building right now".
 *
 * A finished build stays listed. The orchestrator instance is released shortly
 * after it ends, but the summary survives, so the phone you started a build
 * from still shows the outcome an hour later.
 */
import { EventEmitter } from "events";

import { AutonomousOrchestrator, type AutonomousConfig, type BuildGuidance, type BuildIteration } from "./AutonomousOrchestrator.js";
import { Logger } from "../utils/Logger.js";
import { buildActivity, buildScope, type StepKind } from "../utils/BuildContext.js";

export interface BuildRecord {
  buildId: string;
  projectName: string;
  description: string;
  startedAt: string;
  finishedAt: string | null;
  state: "running" | "paused" | "completed" | "stopped" | "error";
  iterations: number;
  qualityScore: number;
  outputDir: string;
  startedBy: string;
  /** Set when this build is serving a customer order. */
  orderId: string | null;
  error?: string;
}

/** The steps a pass goes through, in order. */
export type StageId = "starting" | "writing" | "checking" | "fixing" | "scoring" | "improving" | "finished";

export type CheckState = "running" | "passed" | "failed" | "skipped";

/** What a build is doing right now, for the progress bars and the live log. */
export interface BuildProgress {
  pass: number;
  maxPasses: number;
  target: number;
  stage: StageId;
  /** The same, in words: "Fixing typecheck (attempt 2 of 3)". */
  stageLabel: string;
  stageStartedAt: string | null;
  passStartedAt: string | null;
  /** How far through this pass, 0-100: an estimate from the stage and the checks done. */
  passPercent: number;
  /** Seconds left in this pass, from how long earlier passes took; null until one has finished. */
  passEtaSeconds: number | null;
  /** Quality as a share of the target, 0-100. */
  qualityPercent: number;
  checks: Partial<Record<string, CheckState>>;
  /** The model's answer as it is being written. */
  thinking: { phase: string; model: string; tail: string; chars: number; tokensPerSecond: number; done: boolean; at: string } | null;
  log: Array<{ at: string; text: string; kind: StepKind }>;
}

/** A build as the API and the UI see it: the record plus whatever is live. */
export interface BuildView extends BuildRecord {
  live: boolean;
  stage?: string;
  guidance: BuildGuidance[];
  iterationDetail: BuildIteration[];
  progress: BuildProgress | null;
}

export interface StartBuildOptions extends Partial<AutonomousConfig> {
  projectName: string;
  description: string;
  startedBy?: string;
  orderId?: string | null;
}

const HISTORY_LIMIT = 100;
/** How long a finished orchestrator is kept so late status polls still see detail. */
const RELEASE_AFTER_MS = 60_000;

const orchestrators = new Map<string, AutonomousOrchestrator>();
const history = new Map<string, BuildRecord>();

/** Live progress per build, kept a while after it ends so a late look still sees the story. */
interface ProgressState extends Omit<BuildProgress, "passPercent" | "passEtaSeconds" | "qualityPercent"> {
  passDurationsMs: number[];
  quality: number;
}
const progress = new Map<string, ProgressState>();
const LOG_KEEP = 120;

const STAGE_FROM_STATUS: Record<string, StageId> = {
  verifying: "checking",
  repairing: "fixing",
  analyzing: "scoring",
  improving: "improving"
};

/** Where each stage sits within a pass, for the pass bar. */
const STAGE_SPAN: Record<StageId, [number, number]> = {
  starting: [0, 2],
  writing: [2, 35],
  checking: [35, 62],
  fixing: [62, 85],
  scoring: [85, 90],
  improving: [90, 99],
  finished: [100, 100]
};
const CHECK_ORDER = ["install", "typecheck", "build", "test", "lint"];

const passPercent = (state: ProgressState): number => {
  const [from, to] = STAGE_SPAN[state.stage];
  if (state.stage === "checking" || state.stage === "fixing") {
    // Within checking, move along as checks finish.
    const done = CHECK_ORDER.filter((name) => state.checks[name] && state.checks[name] !== "running").length;
    return Math.round(from + ((to - from) * done) / CHECK_ORDER.length);
  }
  if (state.stage === "writing" && state.thinking && !state.thinking.done) {
    // Within writing, move along with the answer; a typical project is 12-20k characters.
    return Math.round(from + (to - from) * Math.min(state.thinking.chars / 16000, 0.95));
  }
  return from;
};

const etaSeconds = (state: ProgressState): number | null => {
  if (state.passDurationsMs.length === 0 || !state.passStartedAt || state.stage === "finished") return null;
  const typical = state.passDurationsMs.reduce((sum, ms) => sum + ms, 0) / state.passDurationsMs.length;
  const left = typical - (Date.now() - new Date(state.passStartedAt).getTime());
  return Math.max(Math.round(left / 1000), 0);
};

const publicProgress = (state: ProgressState | undefined): BuildProgress | null => {
  if (!state) return null;
  const { passDurationsMs: _durations, quality, ...rest } = state;
  return {
    ...rest,
    passPercent: passPercent(state),
    passEtaSeconds: etaSeconds(state),
    qualityPercent: Math.min(Math.round((quality / Math.max(state.target, 1)) * 100), 100)
  };
};

const addLog = (state: ProgressState, text: string, kind: StepKind, at = new Date().toISOString()) => {
  state.log.push({ at, text, kind });
  if (state.log.length > LOG_KEEP) state.log.splice(0, state.log.length - LOG_KEEP);
};

// Everything a build reports through BuildContext lands here.
buildActivity.on("step", ({ buildId, text, kind, at }: { buildId: string; text: string; kind: StepKind; at: string }) => {
  const state = progress.get(buildId);
  if (!state) return;
  addLog(state, text, kind, at);
  if (kind === "info") state.stageLabel = text;
});
buildActivity.on("check", ({ buildId, name, state: checkState }: { buildId: string; name: string; state: CheckState }) => {
  const state = progress.get(buildId);
  if (!state) return;
  // A new round of checks starts with install: clear the last round's ticks.
  if (name === "install" && checkState === "running") state.checks = {};
  state.checks[name] = checkState;
});
buildActivity.on("thinking", (event: NonNullable<BuildProgress["thinking"]> & { buildId: string }) => {
  const state = progress.get(event.buildId);
  if (!state) return;
  const { buildId: _id, ...thinking } = event;
  state.thinking = thinking;
  if (thinking.done) {
    addLog(state, `The model finished its answer: ${thinking.chars.toLocaleString("en-ZA")} characters at ${thinking.tokensPerSecond} tokens/s`, "model");
  }
});

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const remember = (record: BuildRecord): void => {
  history.set(record.buildId, record);
  while (history.size > HISTORY_LIMIT) {
    const oldest = history.keys().next().value;
    if (oldest === undefined) break;
    history.delete(oldest);
  }
};

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
    const config: AutonomousConfig = {
      projectName: options.projectName,
      description: options.description,
      targetPlatforms: options.targetPlatforms ?? ["web"],
      qualityThreshold: options.qualityThreshold ?? 90,
      maxIterations: options.maxIterations ?? 100,
      enableContinuousLearning: options.enableContinuousLearning !== false,
      hardwareOptimization: options.hardwareOptimization !== false,
      autoPackaging: options.autoPackaging !== false,
      profile: options.profile,
      maxRepairAttempts: options.maxRepairAttempts,
      workingDir: options.workingDir
    };

    const orchestrator = new AutonomousOrchestrator(config);
    const status = orchestrator.getStatus();
    const buildId = status.buildId as string;

    orchestrators.set(buildId, orchestrator);
    const record: BuildRecord = {
      buildId,
      projectName: config.projectName,
      description: config.description,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      state: "running",
      iterations: 0,
      qualityScore: 0,
      outputDir: status.outputDir as string,
      startedBy: options.startedBy ?? "unknown",
      orderId: options.orderId ?? null
    };
    remember(record);

    const current = (): BuildRecord => history.get(buildId) ?? record;

    const live: ProgressState = {
      pass: 0,
      maxPasses: config.maxIterations,
      target: config.qualityThreshold,
      stage: "starting",
      stageLabel: "Getting ready",
      stageStartedAt: new Date().toISOString(),
      passStartedAt: null,
      checks: {},
      thinking: null,
      log: [],
      passDurationsMs: [],
      quality: 0
    };
    progress.set(buildId, live);
    // Keep the story for the builds still listed, and no more.
    for (const id of progress.keys()) if (!history.has(id) && id !== buildId) progress.delete(id);
    addLog(live, `Started: ${config.projectName}`, "info");

    const setStage = (stage: StageId) => {
      if (live.stage !== stage) live.stageStartedAt = new Date().toISOString();
      live.stage = stage;
    };
    orchestrator.on("iteration-started", ({ iteration }: { iteration: number }) => {
      live.pass = iteration;
      live.passStartedAt = new Date().toISOString();
      live.checks = {};
      live.thinking = null;
      setStage("writing");
    });
    orchestrator.on("iteration-status", ({ status }: { status: string }) => {
      const stage = STAGE_FROM_STATUS[status];
      if (stage) setStage(stage);
    });

    const settle = (state: BuildRecord["state"], extra: Partial<BuildRecord> = {}): BuildRecord => {
      const live = orchestrator.getStatus();
      const iterations: BuildIteration[] = live.iterations ?? [];
      const updated: BuildRecord = {
        ...current(),
        ...extra,
        state,
        finishedAt: new Date().toISOString(),
        iterations: live.currentIteration,
        qualityScore: iterations[iterations.length - 1]?.qualityScore ?? 0
      };
      remember(updated);
      return updated;
    };

    orchestrator.on("started", () => {
      Logger.log("Build started", { buildId, projectName: config.projectName, startedBy: record.startedBy });
      buildEvents.emit("started", current());
    });

    orchestrator.on("iteration-complete", (iteration: BuildIteration) => {
      if (live.passStartedAt) live.passDurationsMs.push(Date.now() - new Date(live.passStartedAt).getTime());
      live.quality = iteration.qualityScore;
      const updated = { ...current(), iterations: iteration.iteration, qualityScore: iteration.qualityScore };
      remember(updated);
      buildEvents.emit("iteration", updated, iteration);
    });

    orchestrator.on("completed", ({ finalQuality }: { finalQuality: number }) => {
      Logger.log("Build completed", { buildId, finalQuality });
      setStage("finished");
      live.stageLabel = `Finished at quality ${Math.round(finalQuality)}`;
      addLog(live, live.stageLabel, "good");
      buildEvents.emit("completed", settle("completed"));
      setTimeout(() => orchestrators.delete(buildId), RELEASE_AFTER_MS).unref?.();
    });

    orchestrator.on("error", (error: Error) => {
      Logger.error("Build error", { buildId, error: error.message });
      setStage("finished");
      live.stageLabel = `Stopped by an error: ${error.message}`;
      addLog(live, live.stageLabel, "bad");
      buildEvents.emit("failed", settle("error", { error: error.message }));
    });

    orchestrator.on("stopped", () => {
      Logger.log("Build stopped", { buildId });
      setStage("finished");
      live.stageLabel = "Stopped";
      addLog(live, "Stopped", "bad");
      buildEvents.emit("stopped", settle("stopped"));
      orchestrators.delete(buildId);
    });

    // Deliberately not awaited: a build runs for minutes to hours. Run inside
    // its scope, so the model and the checks can report which build they serve.
    buildScope.run({ buildId }, () => orchestrator.start()).catch((error: unknown) => {
      Logger.error("Build failed to run", { buildId, error: errorMessage(error) });
      buildEvents.emit("failed", settle("error", { error: errorMessage(error) }));
    });

    return record;
  },

  /** The merged view: the stored record, with anything live layered over it. */
  view(buildId: string): BuildView | null {
    const record = history.get(buildId);
    const orchestrator = orchestrators.get(buildId);
    if (!record && !orchestrator) return null;
    if (!record) return null;

    if (!orchestrator) return { ...record, live: false, guidance: [], iterationDetail: [], progress: publicProgress(progress.get(buildId)) };

    const status = orchestrator.getStatus();
    const iterations: BuildIteration[] = status.iterations ?? [];
    const latest = iterations[iterations.length - 1];

    return {
      ...record,
      live: true,
      state: status.isPaused ? "paused" : status.isRunning ? "running" : record.state,
      iterations: status.currentIteration,
      qualityScore: latest?.qualityScore ?? record.qualityScore,
      // What it is doing now, not the status of the last pass to finish, which
      // read "complete" for the whole of the next pass.
      stage: progress.get(buildId)?.stage ?? latest?.status ?? "starting",
      outputDir: status.outputDir as string,
      guidance: status.guidance ?? [],
      iterationDetail: iterations,
      progress: publicProgress(progress.get(buildId))
    };
  },

  /** Everything, newest first. */
  list(): BuildView[] {
    return Array.from(history.keys())
      .map((buildId) => this.view(buildId))
      .filter((build): build is BuildView => build !== null)
      .reverse();
  },

  /** Builds still held in memory: running, or paused waiting on you. */
  active(): BuildView[] {
    return Array.from(orchestrators.keys())
      .map((buildId) => this.view(buildId))
      .filter((build): build is BuildView => build !== null);
  },

  isRunning(buildId: string): boolean {
    // A finished orchestrator is kept for a minute so late status polls still
    // see its detail; that does not make it running.
    if (!orchestrators.has(buildId)) return false;
    const state = history.get(buildId)?.state;
    return state === "running" || state === "paused";
  },

  guide(buildId: string, text: string, from: string): BuildGuidance | null {
    const orchestrator = orchestrators.get(buildId);
    if (!orchestrator) return null;
    return orchestrator.addGuidance(text, from);
  },

  guidance(buildId: string): BuildGuidance[] {
    return orchestrators.get(buildId)?.listGuidance() ?? [];
  },

  control(buildId: string, action: "pause" | "resume" | "stop"): boolean {
    const orchestrator = orchestrators.get(buildId);
    if (!orchestrator) return false;
    orchestrator[action]();
    if (action === "stop") {
      orchestrators.delete(buildId);
    } else {
      const record = history.get(buildId);
      if (record) remember({ ...record, state: action === "pause" ? "paused" : "running" });
    }
    return true;
  }
};
