import { EventEmitter } from "events";
import path from "path";
import fs from "fs";
import { Logger } from "../utils/Logger.js";
import { AutoCodeEngine } from "../utils/AutoCodeEngine.js";
import { CollaborationHub } from "./CollaborationHub.js";
import { VoicePlanner } from "./VoicePlanner.js";
import { MergeEngine } from "./MergeEngine.js";
import { emitServerEvent } from "../server/eventBus.js";
import { FeedbackStore } from "../utils/FeedbackStore.js";
import { VectorMemory } from "../state/VectorMemory.js";
import {
  type AutonomyLevel,
  type BuildJobSnapshot,
  type BuildMode,
  type BuildPlan,
  type BuildStep,
  type BuildJobStatus
} from "../models/BuildTypes.js";

export type BuildRequest = {
  prompt: string;
  mode?: BuildMode;
  autonomy?: AutonomyLevel;
  repositories?: string[];
  planOverride?: BuildPlan;
  sessionId?: string;
};

type InternalStep = BuildStep;

type InternalJob = BuildJobSnapshot & {
  sessionId?: string;
  repositories: string[];
  cancellationRequested?: boolean;
};

const defaultOutputRoot = process.env.PROJECT_OUTPUT ?? path.resolve("./projects");

const ensureDirectory = async (target: string) => {
  await fs.promises.mkdir(target, { recursive: true });
};

export class BuildEngine extends EventEmitter {
  private static instance: BuildEngine | null = null;
  private readonly jobs = new Map<string, InternalJob>();
  private readonly autocode = new AutoCodeEngine();
  private readonly hub = CollaborationHub.getInstance();
  private readonly mergeEngine = MergeEngine.getInstance();

  static getInstance() {
    if (!this.instance) {
      this.instance = new BuildEngine();
    }
    return this.instance;
  }

  startBuild(request: BuildRequest): BuildJobSnapshot {
    const id = `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const mode: BuildMode = request.mode ?? ((process.env.BUILD_MODE as BuildMode) || "app");
    const autonomy: AutonomyLevel = request.autonomy ?? ((process.env.AUTONOMY_LEVEL as AutonomyLevel) || "semi");
    const createdAt = new Date().toISOString();
    const job: InternalJob = {
      id,
      prompt: request.prompt,
      mode,
      autonomy,
      status: "queued",
      plan: request.planOverride?.steps.map((step) => step.title),
      steps: [],
      logs: [],
      createdAt,
      updatedAt: createdAt,
      outputDir: undefined,
      metadata: { repositories: request.repositories ?? [] },
      repositories: request.repositories ?? [],
      sessionId: request.sessionId
    };
    this.jobs.set(id, job);
    this.emitUpdate(job);
    void this.processJob(job, request.planOverride);
    return this.toSnapshot(job);
  }

  cancelBuild(id: string): BuildJobSnapshot | null {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.cancellationRequested = true;
    job.status = "canceled";
    job.updatedAt = new Date().toISOString();
    job.logs.push("Cancellation requested by user");
    this.emitUpdate(job);
    return this.toSnapshot(job);
  }

  listBuilds(): BuildJobSnapshot[] {
    return [...this.jobs.values()]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((job) => this.toSnapshot(job));
  }

  getBuild(id: string): BuildJobSnapshot | null {
    const job = this.jobs.get(id);
    return job ? this.toSnapshot(job) : null;
  }

  private async processJob(job: InternalJob, planOverride?: BuildPlan) {
    try {
      this.updateStatus(job, "planning", "Planning build pipeline");
      const plan = planOverride ?? (await VoicePlanner.planBuild(job.prompt, job.mode));
      job.plan = plan.steps.map((step) => step.title);
      job.steps = plan.steps.map<InternalStep>((step) => ({
        id: step.id,
        label: step.title,
        description: step.detail,
        agent: step.agent,
        status: "pending"
      }));
      this.emitUpdate(job);

      this.updateStatus(job, "running", plan.overview);
      await FeedbackStore.append({
        id: `${job.id}-plan`,
        source: "build-engine",
        message: `Planned ${job.mode} build: ${plan.overview}`,
        metadata: { plan: plan.steps },
        createdAt: new Date().toISOString()
      });

      const outputDir = path.join(defaultOutputRoot, job.id);
      job.outputDir = outputDir;
      await ensureDirectory(outputDir);

      for (const step of job.steps) {
        if (job.cancellationRequested) {
          break;
        }
        await this.runStep(job, step);
      }

      if (job.cancellationRequested) {
        job.status = "canceled";
        job.updatedAt = new Date().toISOString();
        this.emitUpdate(job);
        return;
      }

      if (job.steps.every((step) => step.status === "done")) {
        this.updateStatus(job, "completed", "Build completed successfully");
        await FeedbackStore.append({
          id: `${job.id}-complete`,
          source: "build-engine",
          message: `Build ${job.id} completed in mode ${job.mode}`,
          metadata: { outputDir: job.outputDir },
          createdAt: new Date().toISOString()
        });
      } else if (job.steps.some((step) => step.status === "failed")) {
        this.updateStatus(job, "failed", "One or more steps failed");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.logs.push(`Build failed: ${message}`);
      this.updateStatus(job, "failed", message);
      await FeedbackStore.append({
        id: `${job.id}-error`,
        source: "build-engine",
        message,
        metadata: { mode: job.mode },
        createdAt: new Date().toISOString()
      });
      Logger.error("BuildEngine process failure", error);
    }
  }

  private async runStep(job: InternalJob, step: InternalStep) {
    this.markStep(job, step, "running", `Starting ${step.label}`);
    try {
      switch (step.id) {
        case "requirements":
        case "concept":
        case "timeline":
        case "analyze": {
          await this.captureVector(job, step, `${step.label}: ${step.description}`);
          break;
        }
        case "scaffold": {
          await this.captureVector(job, step, "Scaffolding project structure");
          break;
        }
        case "implement": {
          const history = this.autocode.getHistory();
          await this.captureVector(job, step, `Implementing features (history entries: ${history.length})`);
          break;
        }
        case "qa":
        case "validate": {
          this.updateStatus(job, "testing", step.label);
          await this.captureVector(job, step, "Running quality checks");
          break;
        }
        case "deploy": {
          this.updateStatus(job, "deploying", step.label);
          job.logs.push("Deployment artifacts prepared (simulated)");
          break;
        }
        case "world":
        case "npcs":
        case "sync":
        case "actors":
        case "run": {
          await this.captureVector(job, step, `Simulation update: ${step.label}`);
          break;
        }
        case "integrate": {
          const [first, second] = job.repositories;
          if (first && second) {
            this.updateStatus(job, "merging", "Merging repositories");
            const report = await this.mergeEngine.merge({ sourceA: first, sourceB: second, outputDir: job.outputDir });
            job.logs.push(`Merged repositories into ${report.outputDir}`);
          } else {
            job.logs.push("No repositories provided for integration step");
          }
          break;
        }
        default: {
          await this.captureVector(job, step, `Completed ${step.label}`);
        }
      }

      this.markStep(job, step, "done", `${step.label} completed`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.markStep(job, step, "failed", message);
      throw error;
    }
  }

  private async captureVector(job: InternalJob, step: InternalStep, description: string) {
    job.logs.push(description);
    if (VectorMemory.isEnabled()) {
      await VectorMemory.storeConversationTurn(`${job.prompt}\nStep: ${step.label}\n${description}`, {
        type: "build",
        mode: job.mode,
        autonomy: job.autonomy,
        jobId: job.id
      });
    }
  }

  private markStep(job: InternalJob, step: InternalStep, status: BuildStep["status"], log?: string) {
    step.status = status;
    const now = new Date().toISOString();
    if (status === "running") {
      step.startedAt = now;
    }
    if (status === "done" || status === "failed" || status === "skipped") {
      step.finishedAt = now;
    }
    if (log) {
      step.log = log;
      job.logs.push(log);
    }
    job.updatedAt = now;
    this.emitUpdate(job);
  }

  private updateStatus(job: InternalJob, status: BuildJobStatus, log?: string) {
    job.status = status;
    job.updatedAt = new Date().toISOString();
    if (log) {
      job.logs.push(log);
    }
    this.emitUpdate(job);
  }

  private emitUpdate(job: InternalJob) {
    const snapshot = this.toSnapshot(job);
    emitServerEvent({ type: "build", payload: { job: snapshot } });
    this.hub.broadcastBuild(snapshot, job.sessionId);
    this.emit("update", snapshot);
  }

  private toSnapshot(job: InternalJob): BuildJobSnapshot {
    return {
      id: job.id,
      prompt: job.prompt,
      mode: job.mode,
      autonomy: job.autonomy,
      status: job.status,
      plan: job.plan,
      steps: job.steps.map((step) => ({ ...step })),
      logs: [...job.logs].slice(-200),
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      outputDir: job.outputDir,
      metadata: job.metadata ? { ...job.metadata } : undefined
    };
  }
}
