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

/** A build as the API and the UI see it: the record plus whatever is live. */
export interface BuildView extends BuildRecord {
  live: boolean;
  stage?: string;
  guidance: BuildGuidance[];
  iterationDetail: BuildIteration[];
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
      const updated = { ...current(), iterations: iteration.iteration, qualityScore: iteration.qualityScore };
      remember(updated);
      buildEvents.emit("iteration", updated, iteration);
    });

    orchestrator.on("completed", ({ finalQuality }: { finalQuality: number }) => {
      Logger.log("Build completed", { buildId, finalQuality });
      buildEvents.emit("completed", settle("completed"));
      setTimeout(() => orchestrators.delete(buildId), RELEASE_AFTER_MS).unref?.();
    });

    orchestrator.on("error", (error: Error) => {
      Logger.error("Build error", { buildId, error: error.message });
      buildEvents.emit("failed", settle("error", { error: error.message }));
    });

    orchestrator.on("stopped", () => {
      Logger.log("Build stopped", { buildId });
      buildEvents.emit("stopped", settle("stopped"));
      orchestrators.delete(buildId);
    });

    // Deliberately not awaited: a build runs for minutes to hours.
    orchestrator.start().catch((error: unknown) => {
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

    if (!orchestrator) return { ...record, live: false, guidance: [], iterationDetail: [] };

    const status = orchestrator.getStatus();
    const iterations: BuildIteration[] = status.iterations ?? [];
    const latest = iterations[iterations.length - 1];

    return {
      ...record,
      live: true,
      state: status.isPaused ? "paused" : status.isRunning ? "running" : record.state,
      iterations: status.currentIteration,
      qualityScore: latest?.qualityScore ?? record.qualityScore,
      stage: latest?.status ?? "starting",
      outputDir: status.outputDir as string,
      guidance: status.guidance ?? [],
      iterationDetail: iterations
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
