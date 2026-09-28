import { EventEmitter } from "events";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { QualityAnalyzer } from "./QualityAnalyzer.js";
import { ImprovementEngine, type ImprovementPlan, type ImprovementSuggestion } from "./ImprovementEngine.js";
import { HardwareScaler } from "../utils/HardwareScaler.js";
import { PackagingAgent } from "../agents/PackagingAgent.js";
import { Workspace } from "./Workspace.js";
import { Verifier, type VerificationReport } from "./Verifier.js";
import { createPatch } from "diff";
import { LessonMemory, type Lesson } from "../learning/LessonMemory.js";
import { WorkloadCoordinator } from "../utils/WorkloadCoordinator.js";
import { toKey } from "../knowledge/KnowledgeDb.js";
import { ProjectSnapshot } from "./ProjectSnapshot.js";
import { ensureOllama } from "../utils/Ollama.js";

export interface BuildIteration {
  iteration: number;
  timestamp: Date;
  qualityScore: number;
  objectiveScore: number;
  improvements: string[];
  artifacts: string[];
  status: "running" | "verifying" | "repairing" | "analyzing" | "improving" | "packaging" | "complete" | "error";
  metrics: {
    completeness: number;
    security: number;
    performance: number;
    usability: number;
    testCoverage: number;
  };
  verification?: VerificationReport;
}

/** A further instruction given while the build is already running. */
export interface BuildGuidance {
  text: string;
  at: string;
  from: string;
  /** Which iteration first saw it; null until one does. */
  appliedAtIteration: number | null;
}

export type BuildProfile = "fast" | "balanced" | "deep";

/**
 * How long each profile keeps going when nobody says otherwise. maxIterations
 * is the hard cap; patience is how many passes in a row may fail to beat the
 * best score before the build accepts it has stopped getting better. Without
 * patience a build that could not get a check green spun for 100 passes.
 */
export const PROFILE_DEFAULTS: Record<BuildProfile, { maxIterations: number; patience: number }> = {
  fast: { maxIterations: 8, patience: 3 },
  balanced: { maxIterations: 25, patience: 5 },
  deep: { maxIterations: 60, patience: 8 }
};

/** Passes that fail outright (the model server dropped, a timeout) are retried this many times in a row. */
const MAX_CONSECUTIVE_PASS_FAILURES = 3;

export interface AutonomousConfig {
  projectName: string;
  description: string;
  targetPlatforms: string[];
  qualityThreshold: number;
  maxIterations: number;
  enableContinuousLearning: boolean;
  hardwareOptimization: boolean;
  autoPackaging: boolean;
  /** Bounded repair attempts per iteration when an objective check fails. Overrides the profile's default. */
  maxRepairAttempts?: number;
  /**
   * Speed/quality dial. "fast": fewer repair attempts, no critique step.
   * "balanced" (default): the normal repair loop. "deep": more repair
   * attempts, and before each one a bigger model (CPU-resident on an 8GB
   * card, per the hardware plan) is asked for a short root-cause critique
   * that's fed to the fast model doing the actual patch — the big model
   * never generates code, only a few sentences, so CPU offload costs
   * seconds, not the minutes a full generation would take.
   */
  profile?: BuildProfile;
  /** Passes without a new best score before stopping. Overrides the profile's default. */
  patience?: number;
  /**
   * An existing project to change instead of generating one from nothing: a
   * copy prepared by ProjectBuilds, already a git repo with the project as its
   * first commit. Each pass is shown the project and returns only the files it
   * changes.
   */
  workingDir?: string;
}

type ProfileSettings = {
  maxRepairAttempts: number;
  reviewModel?: string;
};

export class AutonomousOrchestrator extends EventEmitter {
  private isRunning: boolean = false;
  private isPaused: boolean = false;
  private currentIteration: number = 0;
  private iterations: BuildIteration[] = [];
  private buildId: string;
  private outputDir: string;
  
  private qualityAnalyzer: QualityAnalyzer;
  private improvementEngine: ImprovementEngine;
  private hardwareScaler: HardwareScaler;
  private packagingAgent: PackagingAgent;
  private workspace: Workspace;

  // Further instructions given mid-build. They are cumulative direction rather
  // than a queue of one-shot commands, so every later iteration keeps seeing
  // all of them — an instruction you gave at iteration 3 still holds at 30.
  private guidance: BuildGuidance[] = [];

  // Set by stop(), so the run loop can tell "the user ended this" apart
  // from "it finished" - both leave the loop the same way.
  private stoppedByUser = false;

  // Ratchet: never let the workspace end an iteration worse than its best-known state.
  private bestObjectiveScore: number = -1;
  private bestCommitHash?: string;

  constructor(private config: AutonomousConfig) {
    super();
    this.buildId = `build_${Date.now()}`;
    this.outputDir = config.workingDir ?? `./builds/${this.buildId}`;

    this.qualityAnalyzer = new QualityAnalyzer();
    this.improvementEngine = new ImprovementEngine();
    this.hardwareScaler = new HardwareScaler();
    this.packagingAgent = new PackagingAgent();
    this.workspace = new Workspace(this.outputDir);

    Logger.log("AutonomousOrchestrator initialized", { buildId: this.buildId, config });
  }

  /**
   * Start the autonomous build process
   * This runs continuously until stopped or quality threshold is met
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error("Orchestrator is already running");
    }

    this.isRunning = true;
    this.isPaused = false;
    this.stoppedByUser = false;
    this.currentIteration = 0;

    Logger.log("Starting autonomous orchestration", { 
      projectName: this.config.projectName,
      qualityThreshold: this.config.qualityThreshold 
    });

    this.emit("started", { buildId: this.buildId });

    try {
      // Every pass needs the model server; start it rather than fail with "fetch failed".
      if (this.isOllamaProvider() && !(await ensureOllama())) {
        throw new Error("Ollama is not running and could not be started. Start it (ollama serve), then try again.");
      }

      // Optimize for current hardware
      if (this.config.hardwareOptimization) {
        await this.hardwareScaler.optimize();
        this.emit("hardware-optimized", await this.hardwareScaler.getSpecs());
      }

      const patience = this.config.patience ?? PROFILE_DEFAULTS[this.config.profile ?? "balanced"].patience;
      let consecutiveFailures = 0;
      let passesWithoutProgress = 0;
      let bestSoFar = -1;
      let endReason: string | undefined;

      // Main autonomous loop
      while (this.isRunning && this.currentIteration < this.config.maxIterations) {
        if (this.isPaused) {
          await this.sleep(1000);
          continue;
        }

        this.currentIteration++;
        let iteration: BuildIteration;
        try {
          iteration = await this.runIteration(this.currentIteration);
          consecutiveFailures = 0;
        } catch (error: any) {
          // One bad pass (the model server restarting, a request timing out) is
          // not a failed build. Several in a row is — say so and stop.
          consecutiveFailures += 1;
          const retrying = consecutiveFailures < MAX_CONSECUTIVE_PASS_FAILURES && this.isRunning;
          this.emit("iteration-failed", { iteration: this.currentIteration, error: error?.message ?? String(error), retrying });
          if (!retrying) {
            if (!this.isRunning) break;
            throw new Error(
              `${consecutiveFailures} passes in a row failed. The last one said: ${error?.message ?? String(error)}`
            );
          }
          await this.sleep(5000 * consecutiveFailures);
          continue;
        }
        this.iterations.push(iteration);

        this.emit("iteration-complete", iteration);

        if (iteration.qualityScore > bestSoFar) {
          bestSoFar = iteration.qualityScore;
          passesWithoutProgress = 0;
        } else {
          passesWithoutProgress += 1;
        }

        // Check if quality threshold is met
        if (iteration.qualityScore >= this.config.qualityThreshold) {
          Logger.log("Quality threshold met", {
            score: iteration.qualityScore,
            threshold: this.config.qualityThreshold
          });

          // A score above threshold isn't the same as every applicable check
          // passing — e.g. a heavily-weighted install pass can clear a low
          // threshold even while tests fail. Package only a genuinely green build.
          if (this.config.autoPackaging) {
            if (iteration.verification?.passed) {
              await this.packageBuild(iteration);
            } else {
              Logger.warn("Skipping auto-package: score met threshold but verification did not fully pass", {
                score: iteration.qualityScore,
                blockingCheck: iteration.verification?.blockingCheck?.name
              });
            }
          }

          break;
        }

        if (passesWithoutProgress >= patience) {
          endReason = `Stopped improving: ${patience} passes without beating a score of ${bestSoFar}`;
          Logger.warn("Build plateaued", { buildId: this.buildId, bestSoFar, patience });
          break;
        }

        // Learn from this iteration
        if (this.config.enableContinuousLearning) {
          await this.learnFromIteration(iteration);
        }

        // Adaptive delay based on hardware performance
        const delay = this.hardwareScaler.getOptimalDelay();
        await this.sleep(delay);
      }

      if (!endReason && this.currentIteration >= this.config.maxIterations) {
        endReason = `Reached the limit of ${this.config.maxIterations} passes`;
        Logger.warn("Max iterations reached", { iterations: this.currentIteration });
      }

      // stop() leaves the loop by clearing isRunning, which lands here just the
      // same as finishing properly. Emitting "completed" for it told everything
      // downstream the work was done — for a customer order that meant a
      // cancelled job was announced as ready to hand over. stop() emits
      // "stopped" itself, so there is nothing more to say here.
      if (!this.stoppedByUser) {
        this.emit("completed", {
          buildId: this.buildId,
          iterations: this.currentIteration,
          finalQuality: this.iterations[this.iterations.length - 1]?.qualityScore ?? 0,
          reason: endReason
        });
      }

    } catch (error: any) {
      Logger.error("Autonomous orchestration failed", { error: error.message });
      this.emit("error", error);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run a single iteration of build -> analyze -> improve
   */
  private async runIteration(iterationNum: number): Promise<BuildIteration> {
    Logger.log(`Starting iteration ${iterationNum}`);

    const iteration: BuildIteration = {
      iteration: iterationNum,
      timestamp: new Date(),
      qualityScore: 0,
      objectiveScore: 0,
      improvements: [],
      artifacts: [],
      status: "running",
      metrics: {
        completeness: 0,
        security: 0,
        performance: 0,
        usability: 0,
        testCoverage: 0
      }
    };

    this.emit("iteration-started", { iteration: iterationNum });

    try {
      // Phase 1: Generate/Update Build
      iteration.status = "running";
      const buildContext = this.getBuildContext(iterationNum);
      const generatedCode = await this.generateCode(buildContext);
      iteration.artifacts.push(...generatedCode.artifacts);

      let currentFiles = generatedCode.files;
      if (!this.config.workingDir && Object.keys(currentFiles).length === 0) {
        // Nothing to write means nothing to verify; scoring an empty folder only
        // burns a pass. Failing it lets the loop retry, and stop if it persists.
        throw new Error(
          "The model answered without any files in the FILE: format. Check that the model is running and able to write code (OLLAMA_MODEL)."
        );
      }

      const generateWrite = await this.workspace.writeFiles(
        currentFiles,
        `Iteration ${iterationNum}: generate (${this.config.projectName})`
      );
      Logger.log(`Iteration ${iterationNum}: wrote ${generateWrite.writtenPaths.length} file(s) to ${this.workspace.root}`, {
        skipped: generateWrite.skippedPaths,
        commit: generateWrite.commitHash
      });

      // Phase 1.5: Verify objectively — install, typecheck, build, test, lint.
      // Facts, not model opinion. This is the gate; QualityAnalyzer below is advisory.
      iteration.status = "verifying";
      this.emit("iteration-status", { iteration: iterationNum, status: "verifying" });

      let verification = await Verifier.verify(this.workspace);
      const profileSettings = this.resolveProfile();
      let repairAttempt = 0;

      while (!verification.passed && repairAttempt < profileSettings.maxRepairAttempts) {
        repairAttempt += 1;
        iteration.status = "repairing";
        this.emit("iteration-status", { iteration: iterationNum, status: "repairing", attempt: repairAttempt });

        Logger.log(`Iteration ${iterationNum}: repair attempt ${repairAttempt}/${profileSettings.maxRepairAttempts}`, {
          failingCheck: verification.blockingCheck?.name
        });

        // Pull what earlier builds learned about this kind of failure into the repair prompt.
        const failingBefore = verification.blockingCheck;
        const signature = failingBefore ? LessonMemory.errorSignature(failingBefore.name, failingBefore.output) : null;
        const repairLessons =
          failingBefore && signature
            ? LessonMemory.relevant("build", `${signature}\n${failingBefore.output.slice(0, 1500)}`, 4)
            : [];
        const repairLessonIds = repairLessons.map((lesson) => lesson.id);
        LessonMemory.markApplied(repairLessonIds);

        let critique: string | null = null;
        if (profileSettings.reviewModel && this.isOllamaProvider()) {
          critique = await this.getRepairCritique(profileSettings.reviewModel, currentFiles, verification);
          if (critique) {
            Logger.log(`Iteration ${iterationNum}: deep-mode critique (${profileSettings.reviewModel})`, { critique });
          }
        }

        const filesBeforeRepair = currentFiles;
        const repaired = await this.repairFiles(currentFiles, verification, iterationNum, repairAttempt, critique, repairLessons);
        if (!repaired) {
          LessonMemory.recordOutcome(repairLessonIds, false);
          Logger.warn(`Iteration ${iterationNum}: repair attempt ${repairAttempt} produced no usable patch, stopping repair`);
          break;
        }

        currentFiles = repaired;
        const repairWrite = await this.workspace.writeFiles(
          currentFiles,
          `Iteration ${iterationNum}: repair attempt ${repairAttempt} (${verification.blockingCheck?.name ?? "unknown"})`
        );
        Logger.log(`Iteration ${iterationNum}: repair wrote ${repairWrite.writtenPaths.length} file(s)`, {
          commit: repairWrite.commitHash
        });

        verification = await Verifier.verify(this.workspace);

        // Learn from the attempt: the question is whether the check that was blocking now passes.
        const blockerCleared =
          failingBefore !== undefined &&
          !verification.checks.some((check) => check.name === failingBefore.name && check.applicable && !check.passed);
        LessonMemory.recordOutcome(repairLessonIds, blockerCleared);
        if (blockerCleared && failingBefore && signature) {
          const alreadyCredited = repairLessons.some((lesson) => toKey(lesson.signature) === toKey(signature));
          if (!alreadyCredited) {
            await this.learnFromFix(signature, failingBefore, filesBeforeRepair, currentFiles, iterationNum);
          }
        }
      }

      iteration.verification = verification;
      iteration.objectiveScore = verification.score;

      Logger.log(`Iteration ${iterationNum} objective score: ${verification.score}`, {
        passed: verification.passed,
        checks: verification.checks.map((c) => ({ name: c.name, applicable: c.applicable, passed: c.passed }))
      });

      // Phase 2: Advisory quality read — heuristics + model opinion. Informs the
      // improvement step below; does not gate anything.
      iteration.status = "analyzing";
      this.emit("iteration-status", { iteration: iterationNum, status: "analyzing" });

      const analysis = await this.qualityAnalyzer.analyze({
        code: currentFiles,
        iteration: iterationNum,
        previousAnalysis: this.getPreviousAnalysis()
      });

      iteration.metrics = analysis.metrics;
      iteration.qualityScore = verification.score;

      // Phase 3: Generate Improvements
      if (iteration.qualityScore < this.config.qualityThreshold) {
        iteration.status = "improving";
        this.emit("iteration-status", { iteration: iterationNum, status: "improving" });

        const improvements = await this.improvementEngine.generateImprovements({
          code: currentFiles,
          analysis: analysis,
          iteration: iterationNum,
          targetQuality: this.config.qualityThreshold
        });

        iteration.improvements = improvements.suggestions;

        // Apply improvements and persist the result — this used to be a no-op.
        currentFiles = await this.applyImprovements(improvements, currentFiles, iterationNum);

        // Improvements can break something that was passing — re-verify before finalizing.
        const postImprovementVerification = await Verifier.verify(this.workspace);
        iteration.verification = postImprovementVerification;
        iteration.objectiveScore = postImprovementVerification.score;
        iteration.qualityScore = postImprovementVerification.score;
      }

      // Ratchet: never let the workspace end an iteration worse than its best-known state.
      const headHash = await this.workspace.getHead();
      if (iteration.qualityScore > this.bestObjectiveScore) {
        this.bestObjectiveScore = iteration.qualityScore;
        this.bestCommitHash = headHash;
        Logger.log(`Iteration ${iterationNum}: new best objective score ${iteration.qualityScore}`, { commit: headHash });
      } else if (this.bestCommitHash && iteration.qualityScore < this.bestObjectiveScore) {
        Logger.log(
          `Iteration ${iterationNum}: score ${iteration.qualityScore} regressed below best ${this.bestObjectiveScore}; resetting workspace to best commit`,
          { commit: this.bestCommitHash }
        );
        await this.workspace.resetTo(this.bestCommitHash);
      }

      iteration.status = "complete";
      return iteration;

    } catch (error: any) {
      iteration.status = "error";
      Logger.error(`Iteration ${iterationNum} failed`, { error: error.message });
      throw error;
    }
  }

  /**
   * Ask the model to fix exactly what a failing objective check reported —
   * the exact error text, against the exact current files — rather than
   * regenerating the whole project from scratch.
   */
  /** Fast/balanced/deep -> concrete repair-loop settings. */
  private resolveProfile(): ProfileSettings {
    const profile = this.config.profile ?? "balanced";
    switch (profile) {
      case "fast":
        return { maxRepairAttempts: this.config.maxRepairAttempts ?? 1 };
      case "deep":
        return {
          maxRepairAttempts: this.config.maxRepairAttempts ?? 5,
          reviewModel: process.env.DEEP_REVIEW_MODEL || "qwen2.5-coder:14b"
        };
      case "balanced":
      default:
        return { maxRepairAttempts: this.config.maxRepairAttempts ?? 3 };
    }
  }

  private isOllamaProvider(): boolean {
    const provider = (process.env.MODEL_PROVIDER ?? process.env.AI_PROVIDER ?? process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
    return provider === "ollama";
  }

  /**
   * Deep mode only: ask a bigger model for a short root-cause diagnosis
   * before the fast model attempts the actual patch. Bounded output on
   * purpose — this model may be running on CPU (spilled off an 8GB card),
   * so keeping its job to a few sentences instead of a full generation is
   * what makes the CPU detour cost seconds instead of minutes.
   */
  private async getRepairCritique(
    reviewModel: string,
    files: Record<string, string>,
    verification: VerificationReport
  ): Promise<string | null> {
    const failing = verification.blockingCheck;
    if (!failing) return null;

    const fileListing = Object.entries(files)
      .slice(0, 6)
      .map(([filePath, content]) => `FILE: ${filePath}\n\`\`\`\n${content.slice(0, 2000)}\n\`\`\``)
      .join("\n\n");

    const prompt = `You are a senior engineer reviewing why an automated check failed.

Failing check: ${failing.name}
Error output:
${failing.output.slice(0, 3000)}

Files:
${fileListing}

In 3-5 sentences, name the ROOT CAUSE of this failure (not a rephrasing of the
error) and the specific change needed to fix it. Do not write code.`;

    try {
      const critique = await ModelRouter.generate(prompt, { model: reviewModel });
      const trimmed = critique.trim().slice(0, 1500);
      return trimmed || null;
    } catch (error: any) {
      Logger.warn("Deep-mode critique failed, continuing without it", { model: reviewModel, error: error.message });
      return null;
    }
  }

  private async repairFiles(
    files: Record<string, string>,
    verification: VerificationReport,
    iterationNum: number,
    attempt: number,
    critique?: string | null,
    lessons: Lesson[] = []
  ): Promise<Record<string, string> | null> {
    const failing = verification.blockingCheck;
    if (!failing) return null;

    const MAX_FILE_CHARS = 4000;
    // Changing an existing project, the error is often in a file this build has
    // not touched; show the model that file too, not only its own changes.
    const shownFiles = this.config.workingDir
      ? { ...ProjectSnapshot.mentionedFiles(this.workspace.root, failing.output), ...files }
      : files;
    const fileListing = Object.entries(shownFiles)
      .map(([filePath, content]) => {
        const body = content.length > MAX_FILE_CHARS ? `${content.slice(0, MAX_FILE_CHARS)}\n…(truncated)` : content;
        return `FILE: ${filePath}\n\`\`\`\n${body}\n\`\`\``;
      })
      .join("\n\n");

    // Heuristic for a failure pattern seen repeatedly in practice: both the
    // model and a bigger critique model tend to diagnose a *symptom* (a
    // missing arg, a missing dependency) without catching that the module
    // executes side-effecting code (argument parsing, process.exit) at load
    // time — so requiring it for a test crashes regardless of what the test
    // actually calls.
    const looksLikeEagerExecutionCrash =
      failing.name === "test" &&
      /process\.exit|process is not defined|require is not defined|Cannot find module/i.test(failing.output);
    const eagerExecutionHint = looksLikeEagerExecutionCrash
      ? "\nThis failure pattern usually means the entry-point file runs its CLI/argument-parsing logic " +
        "as soon as it is loaded (a top-level function call, or a library like yargs whose .argv getter " +
        "runs validation immediately). Requiring/importing that file for a test then executes the whole " +
        "program. Fix: move that execution behind a guard and export the underlying function(s) so the " +
        "test can call them directly. Match the guard to the actual module system in this file — " +
        "`if (require.main === module)` ONLY works in CommonJS (require/module.exports); if this file " +
        "uses import/export or the package is \"type\": \"module\", `require` does not exist at all and " +
        "will itself throw — use `if (import.meta.url === \\`file://${process.argv[1]}\\`)` instead. " +
        "Do not mix the two.\n"
      : "";

    // Lessons retrieved from earlier builds for this failure. When one already
    // covers the CLI-guard fix, the built-in hint would only repeat it.
    const lessonsSection =
      lessons.length > 0
        ? `\nLessons learned from earlier builds that match this failure (apply any that fit):\n${LessonMemory.formatForPrompt(lessons)}\n`
        : "";
    const builtInHint = lessons.some((lesson) => /require\.main|import\.meta\.url/.test(lesson.lesson)) ? "" : eagerExecutionHint;

    const prompt = `You are repairing a generated application that failed an automated check.

Project: ${this.config.projectName}
Description: ${this.config.description}

Failing check: ${failing.name}
Error output:
${failing.output}
${critique ? `\nA senior engineer's diagnosis of the root cause:\n${critique}\n` : ""}${builtInHint}${lessonsSection}
Current files:
${fileListing}

Fix the problem. Return ONLY the corrected file(s) as FILE: blocks, in the same
format as the files above. Only include files you are changing — omit anything
unchanged. Do not explain the fix in prose.`;

    try {
      const response = await ModelRouter.generate(prompt);
      const patched = this.parseGeneratedCode(response);
      if (Object.keys(patched).length === 0) {
        Logger.warn(`Iteration ${iterationNum} repair attempt ${attempt}: model returned no FILE blocks`);
        return null;
      }
      return { ...files, ...patched };
    } catch (error: any) {
      Logger.error(`Iteration ${iterationNum} repair attempt ${attempt} failed`, { error: error.message });
      return null;
    }
  }

  /**
   * Generate code based on current context and previous iterations
   */
  private async generateCode(context: any): Promise<any> {
    // What earlier builds learned that's relevant to this project goes in front of
    // the prompt. Lessons aren't scored here — whether a whole generation passes
    // says little about any single lesson — only in the repair loop, where the
    // failure a lesson targets is known.
    const lessons = LessonMemory.relevant("build", `${this.config.projectName} ${this.config.description}`, 5);
    const lessonPreamble =
      lessons.length > 0
        ? `Lessons learned from earlier builds on this machine — apply them:\n${LessonMemory.formatForPrompt(lessons)}\n\n`
        : "";
    if (this.config.workingDir) {
      const focus = [this.config.description, ...this.guidance.map((note) => note.text)].join(" ");
      context.existing = await ProjectSnapshot.describe(this.workspace.root, focus);
    }
    const systemPrompt = lessonPreamble + (context.existing ? this.existingProjectPrompt(context) : this.buildSystemPrompt(context));

    let response = await ModelRouter.generate(systemPrompt);
    let files = this.parseGeneratedCode(response);

    // A 7B model doesn't always follow the FILE: format on the first try.
    // One retry with the same prompt is cheap insurance against burning a
    // whole iteration's repair budget on an empty project.
    if (Object.keys(files).length === 0) {
      Logger.warn("generateCode: model response had no parseable FILE: blocks, retrying once");
      response = await ModelRouter.generate(systemPrompt);
      files = this.parseGeneratedCode(response);
    }

    return {
      files,
      artifacts: Object.keys(files)
    };
  }

  /**
   * A repair just turned a failing check green. Capture what changed and have the
   * model generalise it into one reusable sentence, so the next build that hits
   * the same failure starts with the answer instead of rediscovering it. Learning
   * is best-effort and never allowed to fail the build.
   */
  private async learnFromFix(
    signature: string,
    failing: { name: string; output: string },
    before: Record<string, string>,
    after: Record<string, string>,
    iterationNum: number
  ): Promise<void> {
    try {
      const changed = Object.keys(after).filter((file) => before[file] !== after[file]);
      if (changed.length === 0) return;
      const patch = changed
        .map((file) => createPatch(file, before[file] ?? "", after[file] ?? "", "before", "after", { context: 2 }))
        .join("\n")
        .slice(0, 3000);

      const reply = await ModelRouter.generate(
        `A build check failed, and the change below fixed it.

Failing check: ${failing.name}
Error:
${failing.output.slice(0, 1500)}

The change that fixed it:
${patch}

Write ONE sentence (under 40 words) stating the general lesson a developer should apply to avoid this failure in any
future project. Imperative voice. No file names, project names or line numbers. Reply with only that sentence.`
      );
      const lesson =
        reply
          .replace(/```[\s\S]*?```/g, "")
          .split("\n")
          .map((line) => line.replace(/^["'\s*-]+|["'\s*]+$/g, "").trim())
          .find((line) => line.length > 0) ?? "";
      if (lesson.length < 20 || lesson.length > 300) {
        Logger.warn(`Iteration ${iterationNum}: fix confirmed but the model's lesson was unusable, not recorded`, { reply });
        return;
      }

      const saved = LessonMemory.recordFix("build", signature, lesson, patch.slice(0, 1500));
      Logger.log(`Iteration ${iterationNum}: learned from a confirmed fix`, { signature, lesson: saved.lesson });
      this.emit("lesson-learned", { iteration: iterationNum, signature, lesson: saved.lesson });
    } catch (error: any) {
      Logger.warn("Could not record a lesson from this fix", { error: error.message });
    }
  }

  // Background research yields the GPU while this build is actually running —
  // not while it's paused, and not after it finishes or fails.
  private readonly workloadTracking = this.trackWorkload();

  private trackWorkload(): true {
    let release: (() => void) | null = null;
    const begin = () => {
      release?.();
      release = WorkloadCoordinator.beginBuild();
    };
    const end = () => {
      release?.();
      release = null;
    };
    this.on("started", begin);
    this.on("resumed", begin);
    this.on("paused", end);
    this.on("stopped", end);
    this.on("completed", end);
    this.on("error", end);
    return true;
  }

  /**
   * Build context-aware prompt with learning from previous iterations
   */
  /**
   * Stable content first (role + fixed requirements + output format), variable
   * per-iteration context last. Ollama's prompt cache keys off a shared
   * prefix, so putting what changes every call at the end — rather than in
   * the first few lines, as before — lets the (large, fixed) instruction
   * block hit cache instead of being reprocessed on every single call.
   */
  private buildSystemPrompt(context: any): string {
    const previousInsights = this.iterations.map(it => ({
      iteration: it.iteration,
      score: it.qualityScore,
      improvements: it.improvements
    }));

    return `You are a senior fullstack engineer. Generate a complete, working application.

Requirements:
- Create production-ready, polished code
- Include comprehensive error handling
- Add proper documentation
- Ensure security best practices
- Optimize for performance
- Include unit tests
- If this is a CLI tool or has a script entry point: put argument parsing and
  execution behind a guard, and export the underlying functions separately.
  A test file will require/import this module directly — if that alone runs
  the CLI or calls process.exit(), every test using it will crash instead of
  running. Use the guard that matches the module system you are actually
  writing:
  - CommonJS (require/module.exports, no "type": "module"):
    \`if (require.main === module) { ... }\`
  - ES modules (import/export, or "type": "module" in package.json):
    \`require\` does not exist here — use
    \`if (import.meta.url === \`file://\${process.argv[1]}\`) { ... }\` instead.
    Do not mix require.main with import/export syntax in the same file.

Return code in structured format:
FILE: path/to/file.ext
\`\`\`language
code content here
\`\`\`

Project: ${this.config.projectName}
Description: ${this.config.description}
Target Platforms: ${this.config.targetPlatforms.join(", ")}

Iteration: ${context.iteration}
Previous Quality Score: ${context.previousScore || "N/A"}
Previous Insights:
${JSON.stringify(previousInsights, null, 2)}
${context.iteration > 1 ? `
Previous Issues to Address:
${context.previousIssues.join("\n")}
` : ""}
${this.guidanceBlock(context.iteration)}Generate the application now. Remember: every file as FILE: path/to/file.ext
followed immediately by a fenced code block on the next line — no other format.`;
  }

  /**
   * The prompt for changing a project that already exists: the project as it
   * stands now (re-read every pass, so later passes see earlier ones), what to
   * do to it, and a strict instruction to return only what changes.
   */
  private existingProjectPrompt(context: any): string {
    const previous = this.iterations[this.iterations.length - 1];
    return `You are a senior engineer continuing work on an existing project. Change it
to do what is asked. Keep its structure, language, framework, libraries and code
style; do not rewrite, rename or reorganise what does not need to change, and do
not start it over.

Project: ${this.config.projectName}

What to do:
${this.config.description}

${context.existing}
${previous ? `\nThe last pass scored ${previous.qualityScore}. Issues found then:\n${(previous.improvements ?? []).join("\n") || "none"}\n` : ""}
${this.guidanceBlock(context.iteration)}Return ONLY the files you create or change, each one complete (never a fragment
or a diff), as FILE: path/relative/to/project followed immediately by a fenced
code block on the next line. Omit every file you are not changing. Do not
explain in prose.`;
  }

  /**
   * Render outstanding guidance for the prompt, and record which iteration
   * first saw each note. Returns an empty string when there is none, so the
   * prompt stays byte-identical for builds nobody has steered — which matters,
   * because a changed prefix costs the whole prompt cache.
   */
  private guidanceBlock(iteration: number): string {
    if (this.guidance.length === 0) return "";
    for (const note of this.guidance) {
      if (note.appliedAtIteration === null) note.appliedAtIteration = iteration;
    }
    const lines = this.guidance.map((note, index) => `${index + 1}. ${note.text}`).join("\n");
    return `
Further instructions from the person who asked for this app. Where they
conflict with the generic requirements above, these win, and they still apply
on every later iteration:
${lines}

`;
  }

  /**
   * Give a running build a further instruction. It takes effect on the next
   * iteration — the current one is already generating against the old prompt.
   */
  addGuidance(text: string, from: string = "user"): BuildGuidance {
    const note: BuildGuidance = { text, at: new Date().toISOString(), from, appliedAtIteration: null };
    this.guidance.push(note);
    Logger.log("Build guidance added", { buildId: this.buildId, iteration: this.currentIteration, text });
    this.emit("guidance", note);
    return note;
  }

  listGuidance(): BuildGuidance[] {
    return [...this.guidance];
  }

  /**
   * Parse generated code into structured files
   */
  private parseGeneratedCode(response: string): Record<string, string> {
    const files: Record<string, string> = {};
    const text = response.replace(/\r\n/g, "\n");

    // Models dress the marker up: "**FILE: `src/app.ts`**", "### File: src/app.ts",
    // a blank line before the fence, "```tsx title=app.tsx". Accept all of it,
    // but still insist on a real path and a fenced block.
    const header = /^[ \t>#*_-]*FILE:[ \t]*[`*"']*([^\n`*"']+?)[`*"']*[ \t]*\n(?:[ \t]*\n)*[ \t]*(`{3,}|~{3,})[^\n]*\n/gim;
    let match: RegExpExecArray | null;
    while ((match = header.exec(text)) !== null) {
      const rawPath = match[1].trim();
      const fence = match[2];
      const bodyStart = header.lastIndex;
      // The block ends at a bare closing fence on its own line, so an inline
      // ``` or a ```bash opener inside the file does not cut it short.
      const closing = new RegExp(`^[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`, "m");
      const rest = text.slice(bodyStart);
      const nextHeader = rest.search(/^[ \t>#*_-]*FILE:/im);
      const closeMatch = closing.exec(rest);
      let end: number;
      if (closeMatch && (nextHeader === -1 || closeMatch.index < nextHeader)) {
        end = closeMatch.index;
        header.lastIndex = bodyStart + closeMatch.index + closeMatch[0].length;
      } else if (nextHeader !== -1) {
        // An unclosed block: take everything up to the next file.
        end = nextHeader;
        header.lastIndex = bodyStart + nextHeader;
      } else {
        end = rest.length;
        header.lastIndex = text.length;
      }

      const filePath = rawPath.replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "");
      if (!filePath || filePath.includes("..") || /\s{2,}|[<>|?]/.test(filePath)) continue;
      const content = rest.slice(0, end).replace(/\s+$/, "");
      files[filePath] = `${content}\n`;
    }

    return files;
  }

  /**
   * Get context for current build iteration
   */
  private getBuildContext(iteration: number): any {
    const previousIteration = this.iterations[iteration - 2];
    
    return {
      iteration,
      projectName: this.config.projectName,
      description: this.config.description,
      previousScore: previousIteration?.qualityScore,
      previousIssues: previousIteration?.improvements || [],
      learnings: this.getLearnings()
    };
  }

  /**
   * Apply improvement suggestions to the codebase and persist the result.
   * Each action is applied sequentially (later actions see earlier ones'
   * edits) since several may target the same file.
   */
  private async applyImprovements(
    improvements: ImprovementPlan,
    code: Record<string, string>,
    iterationNum: number
  ): Promise<Record<string, string>> {
    Logger.log("Applying improvements", { count: improvements.actions.length });

    let currentCode = code;
    const applied: string[] = [];

    for (const action of improvements.actions) {
      currentCode = await this.executeImprovement(action, currentCode);
      applied.push(action.file ? `${action.type}:${action.file}` : action.type);
    }

    if (applied.length > 0) {
      const label = applied.length > 3 ? `${applied.slice(0, 3).join(", ")}, +${applied.length - 3} more` : applied.join(", ");
      const result = await this.workspace.writeFiles(
        currentCode,
        `Iteration ${iterationNum}: apply ${applied.length} improvement(s) — ${label}`
      );
      Logger.log(`Iteration ${iterationNum}: wrote ${result.writtenPaths.length} improved file(s)`, {
        commit: result.commitHash
      });
    }

    return currentCode;
  }

  private async executeImprovement(
    improvement: ImprovementSuggestion,
    code: Record<string, string>
  ): Promise<Record<string, string>> {
    Logger.log("Executing improvement", { type: improvement.type, file: improvement.file });
    try {
      return await this.improvementEngine.applyImprovement(improvement, code);
    } catch (error: any) {
      Logger.error("Improvement application failed", { type: improvement.type, error: error.message });
      return code;
    }
  }

  /**
   * Package the build for distribution
   */
  private async packageBuild(iteration: BuildIteration): Promise<void> {
    Logger.log("Packaging build for distribution");
    
    iteration.status = "packaging";
    this.emit("iteration-status", { iteration: iteration.iteration, status: "packaging" });

    const packages = await this.packagingAgent.package({
      buildId: this.buildId,
      artifacts: iteration.artifacts,
      platforms: this.config.targetPlatforms,
      outputDir: this.outputDir
    });

    this.emit("packaged", { packages });
    Logger.log("Build packaged successfully", { packages: packages.length });
  }

  /**
   * Learn from iteration results and store patterns
   */
  private async learnFromIteration(iteration: BuildIteration): Promise<void> {
    // Store successful patterns, common errors, effective improvements
    Logger.log("Learning from iteration", { 
      iteration: iteration.iteration,
      qualityScore: iteration.qualityScore 
    });

    // This would integrate with WorldMemory to persist learnings
  }

  private getPreviousAnalysis(): any {
    const prev = this.iterations[this.iterations.length - 1];
    return prev ? { metrics: prev.metrics, score: prev.qualityScore } : null;
  }

  private getLearnings(): any[] {
    // Extract patterns from successful iterations
    return this.iterations
      .filter(it => it.qualityScore > 70)
      .map(it => ({
        iteration: it.iteration,
        score: it.qualityScore,
        improvements: it.improvements
      }));
  }

  /**
   * Pause the autonomous process
   */
  pause(): void {
    this.isPaused = true;
    Logger.log("Orchestrator paused");
    this.emit("paused");
  }

  /**
   * Resume the autonomous process
   */
  resume(): void {
    this.isPaused = false;
    Logger.log("Orchestrator resumed");
    this.emit("resumed");
  }

  /**
   * Stop the autonomous process
   */
  stop(): void {
    this.stoppedByUser = true;
    this.isRunning = false;
    this.isPaused = false;
    Logger.log("Orchestrator stopped", { iteration: this.currentIteration });
    this.emit("stopped", { 
      iterations: this.currentIteration,
      finalQuality: this.iterations[this.iterations.length - 1]?.qualityScore 
    });
  }

  /**
   * Get current status
   */
  getStatus(): any {
    return {
      buildId: this.buildId,
      isRunning: this.isRunning,
      isPaused: this.isPaused,
      currentIteration: this.currentIteration,
      iterations: this.iterations,
      guidance: this.guidance,
      outputDir: this.outputDir
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
