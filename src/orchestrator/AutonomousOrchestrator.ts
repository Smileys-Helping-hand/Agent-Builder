import { EventEmitter } from "events";
import { CodeGuard } from "./CodeGuard.js";
import { AutoFix } from "./AutoFix.js";
import { TypeFixer } from "./TypeFixer.js";
import { appSource, coverage, dropUnrelatedResearch, engineUse, parseReview, relatedTo, reviewPrompt, stubs, unreachableScreens, unshownComponents } from "./Completeness.js";
import { applyFacts, readFacts, sampleFactsLeft, stripInventedContact } from "./Tailoring.js";
import { ExemplarMemory, type Exemplar } from "../learning/ExemplarMemory.js";
import { GameModeOnError } from "../utils/GameMode.js";
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { ModelRouter, getProviderFromEnv, ollamaOptions } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { QualityAnalyzer } from "./QualityAnalyzer.js";
import { ImprovementEngine, type ImprovementPlan, type ImprovementSuggestion } from "./ImprovementEngine.js";
import { HardwareScaler } from "../utils/HardwareScaler.js";
import { PackagingAgent } from "../agents/PackagingAgent.js";
import { Workspace } from "./Workspace.js";
import { Verifier, type CheckResult, type VerificationReport } from "./Verifier.js";
import { Executor } from "./Executor.js";
import { createPatch } from "diff";
import { LessonMemory, type Lesson } from "../learning/LessonMemory.js";
import { ResearchStore } from "../research/ResearchStore.js";
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

/**
 * What the build is thinking, as it happens: the model's own plan, what each
 * check said, why a repair was made, what it decided to improve. Emitted as
 * "thought" so the app can show a live feed, not just a stage name.
 */
export interface BuildThought {
  iteration: number;
  kind: "plan" | "lesson" | "check" | "critique" | "repair" | "review" | "decision";
  title: string;
  text: string;
  files?: string[];
  /** On a check: the score those checks add up to, so progress shows mid-pass. */
  score?: number;
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


/** Packages that need compiling (or a server) and have no place in a browser app. */
const NATIVE_PACKAGES = new Set(["canvas", "node-canvas", "sqlite3", "better-sqlite3", "bcrypt", "node-sass", "robotjs", "serialport", "node-gyp", "puppeteer", "playwright"]);

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
  private bestIteration = 0;

  // The files as the previous pass left them, to say what a new pass changed.
  private lastFiles: Record<string, string> = {};

  constructor(private config: AutonomousConfig) {
    super();
    // What the model reads every pass: the brief, without research about something else.
    this.config = { ...config, description: dropUnrelatedResearch(config.description) };
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

      // A template order starts with the customer's name already in.
      await this.prefillTailoring().catch((error: any) => Logger.warn("Could not pre-fill the template", { error: error?.message }));
      // A new app close to one of our catalogue engines starts with that engine.
      await this.adoptExemplarEngine().catch((error: any) => Logger.warn("Could not start from the example's engine", { error: error?.message }));
      // A project carried on keeps the engine it started from, and gets back what a pass took out of it.
      await this.protectEngine().catch((error: any) => Logger.warn("Could not check the engine", { error: error?.message }));

      // Optimize for current hardware
      if (this.config.hardwareOptimization) {
        await this.hardwareScaler.optimize();
        this.emit("hardware-optimized", await this.hardwareScaler.getSpecs());
      }

      const patience = this.config.patience ?? (PROFILE_DEFAULTS[this.config.profile ?? "balanced"] ?? PROFILE_DEFAULTS.balanced).patience;
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
          this.rememberSuccess(iteration);

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
      // While the app does not even compile, a pass only fixes: generating new
      // code first added fresh errors faster than the repairs cleared the old
      // ones, and a build went round at 20 for pass after pass.
      // A build carried on from another (Continue, self-heal, a restart) knows
      // how that one ended: its first pass is held to the same rule. Pass 1
      // used to rewrite regardless, and took a Pgame left with 1 type error
      // to 7 (score 35 -> 20).
      // When the build it carries on from was cut off before a pass finished,
      // there is no note: the inherited code is checked directly instead.
      const inherited =
        iterationNum === 1
          ? AutonomousOrchestrator.inheritedBlocker(this.config.description) ??
            (this.config.workingDir && this.isStarter() && !this.starterStillPlaceholder() && (TypeFixer.errorCount(this.workspace.root) ?? 0) > 0 ? "typecheck" : undefined)
          : undefined;
      const lastBlocker = this.iterations[this.iterations.length - 1]?.verification?.blockingCheck?.name ?? inherited;
      const fixFirst =
        this.config.workingDir !== undefined &&
        this.isStarter() &&
        !this.starterStillPlaceholder() &&
        (lastBlocker === "install" || lastBlocker === "typecheck" || lastBlocker === "build");
      if (fixFirst) {
        this.think(iterationNum, "decision", "Fixing before adding", `The app does not pass ${lastBlocker} yet, so this pass repairs what is there before writing anything new.`);
      }
      const generatedCode = fixFirst ? { files: {}, artifacts: [] } : await this.generateCode(buildContext);
      iteration.artifacts.push(...generatedCode.artifacts);

      let currentFiles = this.guardFiles(generatedCode.files);
      const nothingWritten = Object.keys(currentFiles).length === 0;
      // A pass that fixes first writes nothing on purpose, the first pass of a carried-on build included.
      if (nothingWritten && this.config.workingDir && this.isStarter() && !this.starterStillPlaceholder() && (this.iterations.length > 0 || fixFirst)) {
        // The app is already there from an earlier pass: an empty answer is a
        // pass without new code, not a failed one. Check and repair what exists.
        if (!fixFirst) this.think(iterationNum, "decision", "No new code this pass", "The model returned no files, so this pass checks and repairs the app as it stands.");
      } else if ((!this.config.workingDir || this.isStarter()) && nothingWritten) {
        // Nothing to write means nothing to verify; scoring an empty folder (or
        // an untouched starter, which passes its checks as it is) only burns a
        // pass. Failing it lets the loop retry, and stop if it persists.
        throw new Error(
          "The model answered without any files in the FILE: format. Check that the model is running and able to write code (OLLAMA_MODEL)."
        );
      }

      const changed = this.changedFiles(this.lastFiles, currentFiles);
      if (changed.length > 0 && !this.config.workingDir && iterationNum > 1) {
        this.think(iterationNum, "decision", `Rewrote ${changed.length} file(s) this pass`, "", changed);
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

      let verification = await this.verifyAndReport(iterationNum, "After writing the code");
      const profileSettings = this.resolveProfile();
      let repairAttempt = 0;
      let emptyRepairs = 0;
      let featureBase: { head: string; files: Record<string, string>; verification: VerificationReport; fixesLeft: number } | null = null;

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
            this.think(iterationNum, "critique", `Root cause, according to ${profileSettings.reviewModel}`, critique);
          }
        }

        const filesBeforeRepair = currentFiles;
        const verificationBeforeRepair = verification;
        const headBeforeRepair = await this.workspace.getHead();
        const repaired = await this.repairFiles(currentFiles, verification, iterationNum, repairAttempt, critique, repairLessons);
        if (!repaired) {
          LessonMemory.recordOutcome(repairLessonIds, false);
          // One empty answer is often just the model losing the format; two in
          // a row means this pass has nothing more to give.
          emptyRepairs += 1;
          Logger.warn(`Iteration ${iterationNum}: repair attempt ${repairAttempt} produced no usable patch${emptyRepairs >= 2 ? ", stopping repair" : ", trying again"}`);
          if (emptyRepairs >= 2) break;
          continue;
        }
        emptyRepairs = 0;

        currentFiles = this.guardFiles(repaired);
        const repairWrite = await this.workspace.writeFiles(
          currentFiles,
          `Iteration ${iterationNum}: repair attempt ${repairAttempt} (${verification.blockingCheck?.name ?? "unknown"})`
        );
        Logger.log(`Iteration ${iterationNum}: repair wrote ${repairWrite.writtenPaths.length} file(s)`, {
          commit: repairWrite.commitHash
        });

        verification = await this.verifyAndReport(iterationNum, `After repair ${repairAttempt}`);

        // Building a missing feature nearly always breaks something on the way
        // (a type, an import). Undoing it at once threw away every new feature,
        // so the app never grew: it gets two attempts to fix what it broke, and
        // is undone only if it still leaves the app worse.
        if (featureBase) {
          if (verification.score >= featureBase.verification.score) {
            featureBase = null;
          } else if (--featureBase.fixesLeft <= 0) {
            await this.workspace.resetTo(featureBase.head);
            this.think(iterationNum, "decision", "Undid the change", `It still left the app worse (score ${verification.score}, was ${featureBase.verification.score}) after trying to fix it; back to the working version.`);
            currentFiles = featureBase.files;
            verification = featureBase.verification;
            featureBase = null;
          }
          continue;
        }
        // The same for a failing test: making the code do what the test expects
        // often breaks a type on the way, and undoing it at once left the test
        // failing for good.
        const grace = failingBefore?.name === "completeness" ? 2 : failingBefore?.name === "test" ? 1 : 0;
        if (headBeforeRepair && grace > 0 && verification.score < verificationBeforeRepair.score && repairAttempt < profileSettings.maxRepairAttempts) {
          featureBase = { head: headBeforeRepair, files: filesBeforeRepair, verification: verificationBeforeRepair, fixesLeft: grace };
          this.think(
            iterationNum,
            "decision",
            failingBefore?.name === "completeness" ? "New feature in; fixing what it broke" : "Test fix in; fixing what it broke",
            `That change broke the ${verification.blockingCheck?.name ?? "checks"}; the next ${grace === 1 ? "attempt fixes" : "attempts fix"} that before deciding whether to keep it.`
          );
          continue;
        }

        // A repair that made things worse is undone, so the next attempt starts
        // from the better version instead of digging deeper.
        if (headBeforeRepair && verification.score < verificationBeforeRepair.score) {
          await this.workspace.resetTo(headBeforeRepair);
          this.think(
            iterationNum,
            "decision",
            `Undid repair ${repairAttempt}`,
            `It took the score from ${verificationBeforeRepair.score} to ${verification.score}; the next attempt starts from the better version.`
          );
          currentFiles = filesBeforeRepair;
          verification = verificationBeforeRepair;
          LessonMemory.recordOutcome(repairLessonIds, false);
          continue;
        }

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

      if (featureBase) {
        // Out of attempts with a half-built feature: keep the working version.
        await this.workspace.resetTo(featureBase.head);
        this.think(iterationNum, "decision", "Undid the change", "This pass ran out of attempts before it worked; back to the working version.");
        currentFiles = featureBase.files;
        verification = featureBase.verification;
        featureBase = null;
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

      // Phase 3: polish — only once every check passes. "Improving" code that does
      // not build yet only adds noise; it is the next pass's repairs that a
      // failing build needs. (Improvements on failing code used to overwrite
      // working files with the model's prose and lock a build at 26.)
      if (iteration.qualityScore < this.config.qualityThreshold && verification.passed) {
        const scoreBeforePolish = verification.score;
        const filesBeforePolish = currentFiles;
        const headBeforePolish = await this.workspace.getHead();
        iteration.status = "improving";
        this.emit("iteration-status", { iteration: iterationNum, status: "improving" });

        const improvements = await this.improvementEngine.generateImprovements({
          code: currentFiles,
          analysis: analysis,
          iteration: iterationNum,
          targetQuality: this.config.qualityThreshold
        });

        iteration.improvements = improvements.suggestions;
        if (improvements.suggestions.length > 0) {
          this.think(
            iterationNum,
            "review",
            `Scored ${iteration.qualityScore}; what it will improve`,
            improvements.suggestions.slice(0, 8).map((suggestion) => `• ${suggestion}`).join("\n")
          );
        }

        // Apply improvements and persist the result — this used to be a no-op.
        currentFiles = await this.applyImprovements(improvements, currentFiles, iterationNum);

        // Improvements can break something that was passing — re-verify, and keep
        // them only if nothing got worse.
        const postImprovementVerification = await this.verifyAndReport(iterationNum, "After the improvements");
        if (headBeforePolish && (postImprovementVerification.score < scoreBeforePolish || !postImprovementVerification.passed)) {
          await this.workspace.resetTo(headBeforePolish);
          currentFiles = filesBeforePolish;
          this.think(
            iterationNum,
            "decision",
            "Undid the polish",
            `The improvements took the score from ${scoreBeforePolish} to ${postImprovementVerification.score}, so the working version stays.`
          );
        } else {
          iteration.verification = postImprovementVerification;
          iteration.objectiveScore = postImprovementVerification.score;
          iteration.qualityScore = postImprovementVerification.score;
        }
      }

      // Ratchet: never let the workspace end an iteration worse than its best-known state.
      const headHash = await this.workspace.getHead();
      if (iteration.qualityScore > this.bestObjectiveScore) {
        this.bestObjectiveScore = iteration.qualityScore;
        this.bestCommitHash = headHash;
        this.bestIteration = iterationNum;
        Logger.log(`Iteration ${iterationNum}: new best objective score ${iteration.qualityScore}`, { commit: headHash });
      } else if (this.bestCommitHash && iteration.qualityScore < this.bestObjectiveScore) {
        Logger.log(
          `Iteration ${iterationNum}: score ${iteration.qualityScore} regressed below best ${this.bestObjectiveScore}; resetting workspace to best commit`,
          { commit: this.bestCommitHash }
        );
        await this.workspace.resetTo(this.bestCommitHash);
        this.think(
          iterationNum,
          "decision",
          `Kept pass ${this.bestIteration}'s code instead`,
          `This pass scored ${iteration.qualityScore}, below the best so far (${this.bestObjectiveScore}), so the folder went back to pass ${this.bestIteration}. Nothing is ever left worse than its best.`
        );
      }

      this.lastFiles = currentFiles;

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
    return getProviderFromEnv() === "ollama";
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

    // Changing an existing project, the error is often in a file this build has
    // not touched; show the model that file too, not only its own changes.
    const shownFiles = this.config.workingDir
      ? { ...ProjectSnapshot.mentionedFiles(this.workspace.root, failing.output), ...files }
      : files;
    // The files the error names are shown whole: a file cut off half way came
    // back cut off, and broke worse. Everything else is an outline (its path and
    // what it exports), which is all a fix needs to know about it.
    const named = Object.keys(shownFiles).filter((file) => failing.output.includes(file) || failing.output.includes(file.replace(/\//g, "\\")));
    const focus = named.length > 0 ? named : Object.keys(shownFiles).filter((file) => /\.(t|j)sx?$/.test(file)).slice(0, 4);
    const MAX_FOCUS_CHARS = 16000;
    const fileListing = [
      ...focus.map((filePath) => {
        const content = shownFiles[filePath] ?? "";
        const body = content.length > MAX_FOCUS_CHARS ? `${content.slice(0, MAX_FOCUS_CHARS)}\n…(truncated)` : content;
        return `FILE: ${filePath}\n\`\`\`\n${body}\n\`\`\``;
      }),
      ...(Object.keys(shownFiles).length > focus.length
        ? [
            `Other files in the project (not shown in full):\n${Object.entries(shownFiles)
              .filter(([filePath]) => !focus.includes(filePath))
              .map(([filePath, content]) => {
                const exports = Array.from(content.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g))
                  .map((match) => match[1])
                  .slice(0, 8);
                return `- ${filePath}${exports.length ? ` (exports ${exports.join(", ")})` : ""}`;
              })
              .join("\n")}`
          ]
        : [])
    ].join("\n\n");
    // The first distinct error lines are what matter; a broken file can produce hundreds.
    const errorLines = Array.from(new Set(failing.output.split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean)));
    const errorOutput = errorLines.length > 60 ? `${errorLines.slice(0, 60).join("\n")}\n…(${errorLines.length - 60} more lines)` : errorLines.join("\n");

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
    const builtInHint =
      (lessons.some((lesson) => /require\.main|import\.meta\.url/.test(lesson.lesson)) ? "" : eagerExecutionHint) +
      (await AutoFix.missingModules(this.workspace.root, failing.output).catch(() => "")) +
      (this.adoptedEngine.length
        ? `\n${this.adoptedEngine.join(", ")} is a tested engine: do not rewrite it. A function it lacks (saving, loading, a new rule) goes in a new module such as src/lib/storage.ts, imported from there.\n`
        : "") +
      this.stuckTestHint(failing.name);

    // The brief without its research notes: a repair needs to know what the app
    // is for, not what the research engine read last week.
    const description = this.config.description.split(/\n(?:What our research confirmed|This is going to a real customer)/i)[0].trim();
    const promptWith = (listing: string) => `You are repairing a generated application that failed an automated check.

Project: ${this.config.projectName}
Description: ${description}

Failing check: ${failing.name}
Error output:
${errorOutput}
${critique ? `\nA senior engineer's diagnosis of the root cause:\n${critique}\n` : ""}${builtInHint}${lessonsSection}
${this.guidanceBlock(this.currentIteration)}Current files:
${listing}

Fix the problem. Start with ONE line beginning "CAUSE:" that says what was wrong
and what you are changing. Then return ONLY the corrected file(s) as FILE:
blocks, in the same format as the files above. Only include files you are
changing — omit anything unchanged — and send each one whole, from its first
import to its last export: never a fragment or a single changed line. No other prose.`;
    let prompt = promptWith(fileListing);
    if (AutonomousOrchestrator.promptTooBig(prompt)) {
      // Too big to leave room for the answer — the "no usable fix" repairs.
      // Show only the first files the error names, in full, and nothing else.
      const slim = focus
        .slice(0, 2)
        .map((filePath) => `FILE: ${filePath}\n\`\`\`\n${(shownFiles[filePath] ?? "").slice(0, 12_000)}\n\`\`\``)
        .join("\n\n");
      prompt = promptWith(slim);
    }

    try {
      const response = await ModelRouter.generate(prompt);
      let patched = this.parseGeneratedCode(response);
      if (Object.keys(patched).length === 0 && named.length === 1) {
        // The fix came back as one fenced block with no FILE: line. The error
        // names one file, so that is the file it means — if the block is a
        // whole module (it imports or exports) that parses.
        const blocks = Array.from(response.matchAll(/```[\w-]*\n([\s\S]*?)```/g)).map((match) => match[1]);
        const [code] = blocks;
        if (blocks.length === 1 && /\b(import|export)\b/.test(code) && CodeGuard.syntaxErrors(named[0], code).length === 0) {
          patched = { [named[0]]: code };
          Logger.log(`Iteration ${iterationNum} repair attempt ${attempt}: took the one code block as ${named[0]}`);
        }
      }
      if (Object.keys(patched).length === 0) {
        Logger.warn(`Iteration ${iterationNum} repair attempt ${attempt}: model returned no FILE blocks`);
        this.think(iterationNum, "repair", `Repair ${attempt} for ${failing.name}: no usable fix`, this.narrative(response) || "The model answered without any files.");
        return null;
      }
      this.think(
        iterationNum,
        "repair",
        `Repair ${attempt} for the ${failing.name} check`,
        this.narrative(response),
        this.changedFiles(files, { ...files, ...patched })
      );
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
      (lessons.length > 0
        ? `Lessons learned from earlier builds on this machine — apply them:\n${LessonMemory.formatForPrompt(lessons)}\n\n`
        : "") +
      this.researchPreamble(context.iteration) +
      this.exemplarPreamble(context.iteration);

    // A new app is planned, then written one file at a time (see generatePlanned).
    if (this.config.workingDir && this.isStarter() && this.starterStillPlaceholder()) {
      const planned = await this.generatePlanned(context.iteration, lessonPreamble).catch((error: any) => {
        if (error instanceof GameModeOnError) throw error;
        Logger.warn("Planned generation failed; writing the app in one go instead", { error: error?.message });
        return null;
      });
      if (planned) return planned;
    }

    // The prompt and the answer share the model's window. A project that grows
    // pass by pass used to push the prompt to the edge of it, leaving no room
    // for the files: the model then answered in prose or stopped mid-file, and
    // three such passes failed the build. Show less of the project instead.
    const focus = [this.config.description, ...this.guidance.map((note) => note.text)].join(" ");
    const promptFor = async (budget: number) => {
      if (this.config.workingDir) context.existing = await ProjectSnapshot.describe(this.workspace.root, focus, budget);
      return lessonPreamble + (context.existing ? this.existingProjectPrompt(context) : this.buildSystemPrompt(context));
    };
    let snapshotBudget = 24_000;
    let systemPrompt = await promptFor(snapshotBudget);
    while (this.config.workingDir && AutonomousOrchestrator.promptTooBig(systemPrompt) && snapshotBudget > 6_000) {
      snapshotBudget = Math.round(snapshotBudget * 0.6);
      systemPrompt = await promptFor(snapshotBudget);
    }
    if (lessons.length > 0) {
      this.think(
        context.iteration,
        "lesson",
        `Using ${lessons.length} lesson(s) from earlier builds`,
        lessons.map((lesson) => `• ${lesson.lesson}`).join("\n")
      );
    }

    let response = await ModelRouter.generate(systemPrompt);
    let files = this.parseGeneratedCode(response);

    // A 7B model doesn't always follow the FILE: format on the first try.
    // One retry with the same prompt is cheap insurance against burning a
    // whole iteration's repair budget on an empty project.
    if (Object.keys(files).length === 0) {
      // Retry with less of the project shown and the format restated at the end,
      // where a small model is most likely to follow it.
      Logger.warn("generateCode: model response had no parseable FILE: blocks, retrying with a shorter prompt");
      if (this.config.workingDir) systemPrompt = await promptFor(Math.min(snapshotBudget, 9_000));
      response = await ModelRouter.generate(
        `${systemPrompt}\n\nIMPORTANT: your answer must contain at least one file, written exactly as\nFILE: path/to/file.ext\n\`\`\`\nthe whole file\n\`\`\``
      );
      files = this.parseGeneratedCode(response);
    }

    this.think(
      context.iteration,
      "plan",
      context.existing ? `Pass ${context.iteration}: what it is changing` : `Pass ${context.iteration}: the plan`,
      this.narrative(response),
      Object.keys(files)
    );

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

Before the files, write 2-4 short sentences starting with "PLAN:" — what you are
building and how. Then return code in structured format:
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
    // A fresh build from the starter is a new app, not a change to one: left to
    // the "change only what is needed" framing, small models write a logic
    // module and tests and never replace the placeholder screen.
    const opening = this.starterStillPlaceholder()
      ? `You are building a new web app on a ready-made starter (React + TypeScript + Vite
+ Vitest; the setup already works and must not be changed). src/App.tsx is only a
placeholder showing "Getting ready…": you MUST replace it with the complete app.
Answer with, in this order: FILE: src/App.tsx (the whole screen: layout, controls,
state and wiring, importing your modules); then each module it imports (put the
logic — rules, calculations — in .ts files); then a test file for that logic whose
expectations match exactly what your code does; then FILE: src/styles.css.
Build every page/screen and every must-have the brief lists, each one really
working (real state, rules and data, saved where the brief says) and reachable
from the app's navigation. This goes to a customer as a finished app: no stubs,
no "coming soon", no buttons that do nothing, no fake progress on a timer.
`
      : `You are a senior engineer continuing work on an existing project. Change it
to do what is asked. Keep its structure, language, framework, libraries and code
style; do not rewrite, rename or reorganise what does not need to change, and do
not start it over.
`;
    return `${opening}
Project: ${this.config.projectName}

What to do:
${this.config.description}

${context.existing}
${previous ? `\nThe last pass scored ${previous.qualityScore}.${this.lastBlocker(previous)}${(previous.improvements ?? []).length ? ` Issues found then:\n${(previous.improvements ?? []).join("\n")}` : ""}\n` : ""}
${this.environmentRules()}
${this.guidanceBlock(context.iteration)}Return ONLY the files you create or change, each one complete (never a fragment
or a diff), as FILE: path/relative/to/project followed immediately by a fenced
code block on the next line. Omit every file you are not changing. Do not
explain in prose, except for 1-3 sentences before the files starting with
"PLAN:" that say what you are changing and why.`;
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

  /** A starter build whose App.tsx is still the starter's placeholder: nothing has been built yet. */
  private starterStillPlaceholder(): boolean {
    if (!this.isStarter()) return false;
    try {
      return fs.readFileSync(path.join(this.workspace.root, "src", "App.tsx"), "utf8").includes("Getting ready…");
    } catch {
      return true;
    }
  }

  /**
   * The template's own sample content for `file`: from the catalogue copy whose
   * template.json has the same name, so a build continued from one that was
   * already tailored is still compared with the sample and not with itself.
   * Falls back to the build folder's first commit.
   */
  private async templateOriginal(file: string): Promise<string> {
    try {
      const name = (JSON.parse(fs.readFileSync(path.join(this.workspace.root, "template.json"), "utf8")) as { name?: string }).name;
      const sites = path.resolve(process.env.TEMPLATES_DIR ?? "templates/sites");
      for (const id of name && fs.existsSync(sites) ? fs.readdirSync(sites) : []) {
        const meta = path.join(sites, id, "template.json");
        if (!fs.existsSync(meta)) continue;
        if ((JSON.parse(fs.readFileSync(meta, "utf8")) as { name?: string }).name !== name) continue;
        const sample = path.join(sites, id, file);
        if (fs.existsSync(sample)) return fs.readFileSync(sample, "utf8");
      }
    } catch {
      // Fall through to the first commit.
    }
    const first = await Executor.run("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd: this.workspace.root });
    return first.exitCode === 0
      ? (await Executor.run("git", ["show", `${first.stdout.trim().split(/\s+/)[0]}:${file}`], { cwd: this.workspace.root })).stdout
      : "";
  }

  /**
   * Whether a prompt leaves too little of a local model's window for the answer
   * (roughly 3.3 characters a token for code and English). Hosted models have
   * windows far larger than any prompt here.
   */
  /** Marks a file the builder wrote itself; repairs leave such files as they are. */
  static readonly BUILT_IN_MARK = "Written by the builder, not the model";

  /**
   * The game screen for an engine with a playable board: the board with the
   * engine's own settings, and the score and state passed up. Null when the
   * engine lacks what it needs (a board component, DEFAULT_SETTINGS, GameState).
   */
  static builtInGameScreen(engine: { file: string; text: string }[]): ((file: string) => string) | null {
    const board = engine.find((e) => e.file.endsWith(".tsx") && /export\s+function\s+[A-Z]\w*/.test(e.text));
    const rules = engine.find((e) => e.file.endsWith(".ts") && /export\s+const\s+DEFAULT_SETTINGS\b/.test(e.text) && /export\s+(interface|type)\s+GameState\b/.test(e.text));
    if (!board || !rules) return null;
    const boardName = /export\s+function\s+([A-Z]\w*)/.exec(board.text)![1];
    const from = (file: string, target: string) => {
      let rel = path.posix.relative(path.posix.dirname(file), target.replace(/\.tsx?$/, ""));
      if (!rel.startsWith(".")) rel = `./${rel}`;
      return rel;
    };
    return (file: string) => {
      const name = path.basename(file, ".tsx");
      return `/**
 * The game itself: the tested board, playing with the engine's own settings.
 * ${AutonomousOrchestrator.BUILT_IN_MARK}: every move, battle and score is the
 * board's. Other screens follow the game through onScore and onChange.
 */
import { ${boardName} } from "${from(file, board.file)}";
import { DEFAULT_SETTINGS, type GameState } from "${from(file, rules.file)}";

export interface ${name}Props {
  /** Called with the final score when a game is won or lost. */
  onScore?: (score: number) => void;
  /** Called whenever the game changes: score, lives, level, status. */
  onChange?: (state: GameState) => void;
  /** When given, a Menu button above the game calls it (back to the title screen). */
  onBack?: () => void;
}

export default function ${name}({ onScore, onChange, onBack }: ${name}Props) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {onBack && (
        <button type="button" className="btn btn-ghost" onClick={onBack} style={{ justifySelf: "start" }}>
          ← Menu
        </button>
      )}
      <${boardName} settings={DEFAULT_SETTINGS} onScore={onScore} onChange={onChange} />
    </div>
  );
}
`;
    };
  }

  /** A planned logic file that would redo what a playable board does: input, controls, the loop, drawing, physics. */
  static duplicatesBoard(file: { path: string; purpose: string }): boolean {
    if (/\.test\./.test(file.path)) return false;
    // Screens for what the board already shows: an RPG build planned a
    // BattleScreen and GameControls beside a board with its own battle panel
    // and pad, and they fought it. The game screen itself, where the board
    // goes, and every other screen (menus, saves, scores) stay.
    if (/\.tsx$/.test(file.path)) {
      const name = path.basename(file.path, ".tsx");
      if (/^(Game|Play|Main)(Screen|Page|View)?$/.test(name)) return false;
      return /^(Battle|Combat|Fight|Arena|Controls?|GameControls|Dpad|DPad|Joystick|Hud|HUD|Canvas|Board|GameBoard|Map|MapView|Dungeon|Field|Playfield)(Screen|Panel|View|Page)?$/.test(name);
    }
    if (!/\.ts$/.test(file.path)) return false;
    // Also a reducer over the game's events or actions, battles, turns or
    // movement: an RPG build's gameLogic.ts dispatched "moved"/"battle" events
    // back into the engine and clashed with it. Saving, scores and progression stay.
    return /\b(input|controls?|keyboard|touch|pointer|game ?loop|frame loop|render(er|ing)?|draw(ing)?|canvas|physics|collisions?|paddle|ball movement|reducer|dispatch(es|ing)?|update(s)? the game( state)?|game state updates?|handles? (game |player )?(events|actions|moves)|process(es)? (player )?actions|battles?|combat|turns?|movement)\b/i.test(
      `${path.basename(file.path).replace(/([a-z])([A-Z])/g, "$1 $2")} ${file.purpose}`
    );
  }

  /**
   * A logic file that keeps high scores, when the engine's score table already
   * does: an RPG build stored the hero (which has no score) as its high score
   * and sorted by hero.score, six type errors five repairs never untangled.
   * Screens that show the table stay.
   */
  static duplicatesScores(file: { path: string; purpose: string }): boolean {
    if (!/\.ts$/.test(file.path) || /\.test\./.test(file.path)) return false;
    // By the file's name: a progression module that also tracks scores keeps its other work.
    return /^(high ?scores?|best ?scores?|leader ?boards?|scores?( ?(board|table|store|storage|history))?|hall ?of ?(fame|heroes|champions))$/i.test(
      path.basename(file.path, ".ts").replace(/([a-z])([A-Z])/g, "$1 $2")
    );
  }

  /** The compile-level check a build carried on from another left failing ("When it last ran, the typecheck check failed"), if any. */
  static inheritedBlocker(description: string): "install" | "typecheck" | "build" | undefined {
    return /When it last ran, the (install|typecheck|build) check failed/.exec(description)?.[1] as "install" | "typecheck" | "build" | undefined;
  }

  static promptTooBig(prompt: string): boolean {
    if (getProviderFromEnv() !== "ollama") return false;
    const { num_ctx } = ollamaOptions();
    return prompt.length / 3.3 > num_ctx - 6_000;
  }

  private kitCache: Set<string> | null = null;

  /**
   * The template's own src/lib files (its kit), read from the catalogue copy
   * with the same template.json name — not from the build folder, where the
   * model's own new files sit beside them and must stay editable.
   */
  private kitFiles(): Set<string> {
    if (this.kitCache) return this.kitCache;
    const kit = new Set<string>();
    try {
      const name = (JSON.parse(fs.readFileSync(path.join(this.workspace.root, "template.json"), "utf8")) as { name?: string }).name;
      const roots = [path.resolve(process.env.TEMPLATES_DIR ?? "templates/sites"), path.resolve("templates/starters")];
      for (const root of roots) {
        for (const id of name && fs.existsSync(root) ? fs.readdirSync(root) : []) {
          const meta = path.join(root, id, "template.json");
          if (!fs.existsSync(meta) || (JSON.parse(fs.readFileSync(meta, "utf8")) as { name?: string }).name !== name) continue;
          const walk = (dir: string) => {
            for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
              const full = path.join(dir, entry.name);
              if (entry.isDirectory()) walk(full);
              else kit.add(path.relative(path.join(root, id), full).split(path.sep).join("/"));
            }
          };
          walk(path.join(root, id, "src", "lib"));
        }
      }
    } catch {
      // No template.json, or an unreadable one: nothing is locked as kit.
    }
    if (kit.size === 0 && fs.existsSync(path.join(this.workspace.root, "template.json"))) {
      // A template the catalogue no longer has under that name: its kit is
      // whatever src/lib held when this build folder was started.
      try {
        const git = (args: string[]) => execFileSync("git", args, { cwd: this.workspace.root, encoding: "utf8" }).trim();
        const first = git(["rev-list", "--max-parents=0", "HEAD"]).split(/\s+/)[0];
        for (const file of git(["ls-tree", "-r", "--name-only", first, "--", "src/lib"]).split(/\r?\n/)) if (file) kit.add(file);
      } catch {
        // No history to read: leave src/lib open rather than guess.
      }
    }
    this.kitCache = kit;
    return kit;
  }

  /** The worked example this build was shown, chosen once so every pass sees the same one (and the prompt cache holds). */
  private exemplar: Exemplar | null | undefined = undefined;

  /**
   * A new app gets the closest app this builder made before (or a catalogue
   * engine) as a worked example: what good looks like, which a small model
   * otherwise never sees. Template orders and the user's own projects have
   * their own code to follow.
   */
  private exemplarPreamble(iteration: number): string {
    if (this.config.workingDir && !this.isStarter()) return "";
    if (this.exemplar === undefined) this.chooseExemplar(iteration);
    return this.exemplar ? `${ExemplarMemory.formatForPrompt(this.exemplar, this.adoptedEngine)}\n` : "";
  }

  private chooseExemplar(iteration: number): void {
    try {
      this.exemplar = ExemplarMemory.relevant(`${this.config.projectName}\n${this.config.description}`);
    } catch (error: any) {
      Logger.warn("Could not look up a worked example", { error: error?.message });
      this.exemplar = null;
    }
    if (this.exemplar) {
      ExemplarMemory.markUsed(this.exemplar.id);
      this.think(iteration, "lesson", `Following a worked example: ${this.exemplar.title}`, "The closest app it knows how to build well. It shows the structure and depth to aim for; the content is this brief's.");
    }
  }

  /** Engine files from the worked example that this build started with. */
  private adoptedEngine: string[] = [];

  /**
   * A fresh app whose closest example is one of our catalogue engines starts
   * with that engine in it. Shown the engine as an example, the model wrote a
   * real brick-breaker around it — and then imported a game.ts that was not
   * there and rebuilt it as a broken stub. Tested code in the project beats a
   * description of it.
   */
  /**
   * The engine guard used to know only an engine adopted in this build. A
   * continued build (Continue, self-heal, every restart) never adopted one, so
   * nothing stopped a pass rewriting it — one dropped GameEvent and broke the
   * app's imports. Every engine file from the project's head start is guarded
   * here too, and one an earlier pass rewrote gets back what it lost.
   */
  private async protectEngine(): Promise<void> {
    if (!this.config.workingDir) return;
    // Files an older builder let the model's prose overwrite come back first.
    const broken = CodeGuard.restoreUnparseable(this.workspace.root);
    if (broken.length > 0) {
      await this.workspace.writeFiles(Object.fromEntries(broken.map((item) => [item.file, item.text])), "Restored files that no longer parsed");
      this.think(
        1,
        "decision",
        `Restored ${broken.length} file(s) that did not parse`,
        broken.map((item) => `• ${item.file}: back to its version from ${item.commit}, the latest that was code.`).join("\n"),
        broken.map((item) => item.file)
      );
    }
    let names: string[];
    try {
      names = fs.readdirSync(path.join(this.workspace.root, "src", "engine")).filter((name) => /\.(t|j)sx?$/.test(name) && !/\.(test|spec)\./.test(name));
    } catch {
      return;
    }
    const restored: Record<string, string> = {};
    const notes: string[] = [];
    for (const name of names) {
      const file = `src/engine/${name}`;
      if (CodeGuard.headStart(this.workspace.root, file) === null) {
        // A project copied with a fresh history (imported, or carried on from
        // a copy) has no head-start commit; its engine is still ours when it
        // opens like one of the catalogue's. Recognised, it is guarded, but
        // there is no earlier version to restore from.
        if (AutonomousOrchestrator.catalogueEngine(path.join(this.workspace.root, file), path.resolve(process.env.TEMPLATES_DIR ?? "templates/sites"))) {
          if (!this.adoptedEngine.includes(file)) this.adoptedEngine.push(file);
        }
        continue;
      }
      if (!this.adoptedEngine.includes(file)) this.adoptedEngine.push(file);
      const fix = CodeGuard.restoreEngine(this.workspace.root, file);
      if (fix) {
        restored[file] = fix.text;
        notes.push(`${file} ${fix.problem}`);
      }
    }
    if (notes.length === 0) return;
    await this.workspace.writeFiles(restored, "Restored the engine this project started from");
    this.think(
      1,
      "decision",
      `Restored the engine in ${Object.keys(restored).join(", ")}`,
      `An earlier pass rewrote it: ${notes.join("; ")}. What it lost is back, and what it added is kept. Add to the engine; do not replace it.`,
      Object.keys(restored)
    );
  }

  /** Whether a project's engine file opens with the same header comment as a catalogue template's file of that name. */
  static catalogueEngine(file: string, sitesDir: string): boolean {
    const header = (text: string) => /^\s*\/\*\*[\s\S]*?\*\//.exec(text)?.[0].replace(/\s+/g, " ").trim() ?? "";
    let mine = "";
    try {
      mine = header(fs.readFileSync(file, "utf8"));
    } catch {
      return false;
    }
    if (mine.length < 60) return false;
    try {
      return fs.readdirSync(sitesDir).some((id) => {
        try {
          return header(fs.readFileSync(path.join(sitesDir, id, "src", path.basename(file)), "utf8")) === mine;
        } catch {
          return false;
        }
      });
    } catch {
      return false;
    }
  }

  private async adoptExemplarEngine(): Promise<void> {
    if (!this.config.workingDir || !this.isStarter() || !this.starterStillPlaceholder()) return;
    if (this.exemplar === undefined) this.chooseExemplar(1);
    if (!this.exemplar) return;
    const files = ExemplarMemory.engineFiles(this.exemplar, path.resolve(process.env.TEMPLATES_DIR ?? "templates/sites"));
    // In src/engine/, not beside the screens: the engine is game.ts and the
    // model names its screen Game.tsx, which on Windows is the same file name
    // ("./Game" finds game.ts) — a build went round in circles on it.
    const fresh = Object.fromEntries(
      Object.entries(files)
        .map(([file, text]) => [file.replace(/^src\//, "src/engine/"), text] as const)
        .filter(([file]) => !fs.existsSync(path.join(this.workspace.root, file)))
    );
    if (Object.keys(fresh).length === 0) return;
    await this.workspace.writeFiles(fresh, `Head start: the engine from ${this.exemplar.title}`);
    this.adoptedEngine = Object.keys(fresh);
    this.think(
      1,
      "decision",
      `Started from a tested engine: ${this.adoptedEngine.join(", ")}`,
      `From our "${this.exemplar.title}". The app is built on it, so the rules (levels, scoring, winning and losing) work from the first pass.`,
      this.adoptedEngine
    );
  }

  /**
   * A new app that passed every check is kept as a worked example for the
   * next similar brief, and the example this build followed gets the credit.
   */
  private rememberSuccess(iteration: BuildIteration): void {
    if (!iteration.verification?.passed || (this.config.workingDir && !this.isStarter())) return;
    try {
      if (this.exemplar) ExemplarMemory.recordOutcome(this.exemplar.id, true);
      const id = ExemplarMemory.recordSuccess(this.workspace.root, this.config.projectName, this.config.description, iteration.qualityScore);
      if (id !== null) {
        this.think(iteration.iteration, "lesson", "Remembered this app as a worked example", "The next build with a similar brief starts from how this one was done.");
      }
    } catch (error: any) {
      Logger.warn("Could not remember this build as a worked example", { error: error?.message });
    }
  }

  /**
   * A new app, planned and then written one file at a time.
   *
   * Asked for a whole app in one answer, a 7B model writes a little of
   * everything and gets the seams wrong: an import of a function it never
   * wrote, two different GameState types, props one screen passes and another
   * does not take. One focused file at a time is what a small model does best,
   * so: first a short plan (the files, what each is for, what each exports),
   * then each file in its own call, which sees the plan and the actual code
   * already written — so every import points at something real. Logic first,
   * then screens, then App.tsx, then tests. Null when there is no usable plan.
   */
  private async generatePlanned(iteration: number, preamble: string): Promise<{ files: Record<string, string>; artifacts: string[] } | null> {
    const brief = this.config.description.split(/\n(?:What our research confirmed|This is going to a real customer)/i)[0].trim();
    const engine = this.adoptedEngine.map((file) => {
      const text = fs.existsSync(path.join(this.workspace.root, file)) ? fs.readFileSync(path.join(this.workspace.root, file), "utf8") : "";
      return { file, text, exports: CodeGuard.exportSignatures(text) };
    });
    // A playable board (GameBoard: canvas, frame loop, touch and keys) means the
    // game itself is done: a plan that added an input handler and its own loop
    // around it fought the board for three passes.
    const boards = engine
      .filter((e) => e.file.endsWith(".tsx"))
      .flatMap((e) => Array.from(e.text.matchAll(/export\s+function\s+([A-Z]\w*)/g)).map((m) => ({ name: m[1], file: e.file })));
    const engineNote = engine.length
      ? `\nAlready in the project (a tested engine — use it, do not plan to rewrite it):\n${engine.map((e) => `- ${e.file}: ${e.exports.join("; ")}`).join("\n")}\n${
          boards.length
            ? `The game itself already plays: ${boards.map((b) => `${b.name} in ${b.file}`).join(", ")} draws it, runs the loop, handles touch, mouse and keys, and has its own in-game panels (battles, controls, the map, the score bar). Plan no files for input, controls, a game loop, drawing, physics, battles or the map: the game screen renders <${boards[0].name} settings={DEFAULT_SETTINGS} onScore={...} /> and the rest of the app (menus, saving, progression) goes around it.\n`
            : ""
        }`
      : "";
    const rules = this.environmentRules();

    // 1. The plan: small, structured, cheap to retry.
    const planPrompt = `${preamble}You are planning a new web app (React + TypeScript + Vite + Vitest, already set up).

What to build:
${brief}
${engineNote}${rules}
Plan the files. Logic (rules, state, saving) goes in plain .ts modules under src/lib/; each screen is a
component under src/components/; src/App.tsx shows the screens and switches between them; tests go in
src/lib/*.test.ts and test the logic. Every page and every must-have in the brief gets a real home.
Between 4 and 9 files. Do not plan src/main.tsx, src/lib/testing.tsx or anything already in the project.
Every component's exports give its props in full — App.tsx will pass exactly these and nothing else:
  "default Menu(props: { onPlay: () => void; onBack: () => void })". A screen with no props: "default Home()".

Answer with JSON only:
{"files":[{"path":"src/lib/example.ts","purpose":"what it does, in one sentence","exports":["name(arg: Type): Return", "interface Name { field: Type }"]},{"path":"src/components/Example.tsx","purpose":"a screen","exports":["default Example(props: { onDone: () => void })"]}]}`;
    let plan: Array<{ path: string; purpose: string; exports: string[] }> = [];
    let answer = "";
    for (let attempt = 0; attempt < 2 && plan.length === 0; attempt++) {
      answer = await ModelRouter.generate(planPrompt);
      plan = AutonomousOrchestrator.parsePlan(answer, new Set([...this.kitFiles(), ...this.adoptedEngine, "src/main.tsx"]));
    }
    // What the engine already exports is not planned again: a plan that
    // rewrote newGame/step in its own gameLogic.ts gave the app two GameState
    // types that never fit together. A file that would only duplicate the
    // engine is dropped; a duplicated export is struck from the rest.
    const engineNames = new Set(engine.flatMap((e) => e.exports.map((signature) => /(?:interface|type|const|class|default)?\s*([A-Za-z_$][\w$]*)/.exec(signature)?.[1] ?? "")));
    const exportName = (signature: string) => /(?:interface|type|const|class|default)?\s*([A-Za-z_$][\w$]*)/.exec(signature.trim())?.[1] ?? "";
    plan = plan
      .map((file) => {
        const dupes = file.exports.filter((signature) => engineNames.has(exportName(signature)));
        return { file, dupes, keep: file.exports.filter((signature) => !engineNames.has(exportName(signature))) };
      })
      .filter(({ file, dupes, keep }) => !(dupes.length > 0 && dupes.length >= keep.length && !/\.tsx$/.test(file.path)))
      .map(({ file, keep }) => ({ ...file, exports: keep }))
      // With a playable board, logic files for what it already does are dropped.
      .filter((file) => !(boards.length && AutonomousOrchestrator.duplicatesBoard(file)))
      // And with the engine's score table, a store of the model's own.
      .filter((file) => !(engine.some((e) => /\/scores\.ts$/.test(e.file)) && AutonomousOrchestrator.duplicatesScores(file)));
    // Tests for the logic, when the plan forgot them.
    const logic = plan.find((file) => /^src\/lib\/[^/]+\.ts$/.test(file.path) && !/\.test\./.test(file.path));
    if (logic && !plan.some((file) => /\.test\.tsx?$/.test(file.path))) {
      plan.push({ path: logic.path.replace(/\.ts$/, ".test.ts"), purpose: `tests for ${logic.path}: each exported function, with real expected values`, exports: [] });
    }
    if (plan.length > 0 && !plan.some((file) => file.path === "src/App.tsx")) {
      // The screen switcher is what turns modules into an app; plan it if the model did not.
      plan.push({ path: "src/App.tsx", purpose: "shows each screen and switches between them", exports: ["default App()"] });
    }
    if (plan.length < 2) {
      Logger.warn("Planned generation: no usable plan", { answer: answer.slice(0, 600) });
      return null;
    }

    // With a playable board, the game screen is the board and nothing else, so
    // the builder writes it: told and hinted, a 7B model still rebuilt every
    // move and battle around the board (setHero(move(state))) in three RPG
    // builds out of three. The plan gets one, with props the app can rely on.
    const gameScreen = boards.length ? AutonomousOrchestrator.builtInGameScreen(engine.map((e) => ({ file: e.file, text: e.text }))) : null;
    if (gameScreen) {
      const existing = plan.find((file) => /\.tsx$/.test(file.path) && /^(Game|Play|Main)(Screen|Page|View)?$/.test(path.basename(file.path, ".tsx")));
      const entry = existing ?? { path: "src/components/GameScreen.tsx", purpose: "", exports: [] as string[] };
      if (!existing) plan.push(entry);
      const name = path.basename(entry.path, ".tsx");
      entry.purpose = "the game itself: renders the tested board (already written by the builder — use it as it is)";
      entry.exports = [`default ${name}(props: { onScore?: (score: number) => void; onChange?: (state: GameState) => void; onBack?: () => void })`];
    }

    // Logic first, then screens, App.tsx, and tests last: each file is written
    // after the ones it is likely to import.
    const rank = (file: string) => (/\.test\.tsx?$/.test(file) ? 3 : file === "src/App.tsx" ? 2 : /\.tsx$/.test(file) ? 1 : 0);
    plan.sort((a, b) => rank(a.path) - rank(b.path));
    const planText = plan.map((file) => `- ${file.path}: ${file.purpose}${file.exports.length ? `\n    exports: ${file.exports.join("; ")}` : ""}`).join("\n");
    this.think(iteration, "plan", `Planned ${plan.length} files`, planText, plan.map((file) => file.path));

    // 2. Each file in its own call. What stays the same comes first (so the
    // model server's prompt cache holds); what changes per file comes last.
    const written: Record<string, string> = {};
    const fixed = `${preamble}You are writing one file of a new web app (React + TypeScript + Vite + Vitest, already set up).

What to build:
${brief}
${engineNote}${rules}
The plan for the whole app:
${planText}
`;
    for (const [index, file] of plan.entries()) {
      if (gameScreen && /^(Game|Play|Main)(Screen|Page|View)?$/.test(path.basename(file.path, ".tsx")) && file.path.endsWith(".tsx")) {
        written[file.path] = gameScreen(file.path);
        this.emit("iteration-status", { iteration, status: "writing", attempt: index + 1 });
        continue;
      }
      const others = Object.entries(written)
        .map(([name, text]) => (text.length > 6000 ? `FILE: ${name} (exports: ${CodeGuard.exportSignatures(text).join("; ")})` : `FILE: ${name}\n\`\`\`\n${text}\n\`\`\``))
        .join("\n\n");
      const engineCode = engine.map((e) => `FILE: ${e.file} (already written; exports: ${e.exports.join("; ")})`).join("\n");
      const prompt = `${fixed}
Already written — import from these exactly as they are (names, props, types):
${[engineCode, others].filter(Boolean).join("\n\n") || "(nothing yet)"}

Now write ${file.path} (${file.purpose}), complete and working: real logic and real screens, no
placeholders, no TODO comments, no buttons that do nothing. Import only from the files above, the
installed packages, and files listed in the plan.${
        file.exports.length
          ? `\nIt must export exactly what the plan says, with the same names and props: ${file.exports.join("; ")}.`
          : ""
      }${
        file.path === "src/App.tsx"
          ? "\nRender each screen with exactly the props its signature above takes — no more, no fewer."
          : ""
      } Answer with exactly one file:
FILE: ${file.path}
\`\`\`
…the whole file…
\`\`\``;
      let code: string | undefined;
      for (let attempt = 0; attempt < 2 && !code; attempt++) {
        const answer = await ModelRouter.generate(prompt);
        const files = this.parseGeneratedCode(answer);
        code = files[file.path] ?? (Object.keys(files).length === 1 ? Object.values(files)[0] : undefined);
        if (!code) {
          // One fenced block and no FILE: line is still this file.
          const blocks = Array.from(answer.matchAll(/```[\w-]*\n([\s\S]*?)```/g)).map((match) => match[1]);
          if (blocks.length === 1 && /\b(import|export)\b/.test(blocks[0])) code = blocks[0];
        }
      }
      if (code) {
        written[file.path] = code;
        this.emit("iteration-status", { iteration, status: "writing", attempt: index + 1 });
      } else {
        Logger.warn(`Planned generation: no usable answer for ${file.path}`);
      }
    }
    if (!written["src/App.tsx"]) return null;
    this.think(iteration, "decision", `Wrote ${Object.keys(written).length} of ${plan.length} planned files, one at a time`, Object.keys(written).map((file) => `• ${file}`).join("\n"), Object.keys(written));
    return { files: written, artifacts: Object.keys(written) };
  }

  /** The plan's files from the model's answer: JSON, under src/, nothing locked, no duplicates. */
  static parsePlan(answer: string, locked: Set<string>): Array<{ path: string; purpose: string; exports: string[] }> {
    const json = /\{[\s\S]*\}/.exec(answer)?.[0];
    if (!json) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return [];
    }
    const files = (parsed as { files?: unknown })?.files;
    if (!Array.isArray(files)) return [];
    const seen = new Set<string>();
    const out: Array<{ path: string; purpose: string; exports: string[] }> = [];
    for (const entry of files as Array<Record<string, unknown>>) {
      const file = typeof entry?.path === "string" ? entry.path.replace(/\\/g, "/").replace(/^\.\//, "").trim() : "";
      if (!/^src\/[\w./-]+\.(ts|tsx|css)$/.test(file) || file.includes("..") || locked.has(file) || seen.has(file.toLowerCase())) continue;
      seen.add(file.toLowerCase());
      out.push({
        path: file,
        purpose: typeof entry.purpose === "string" ? entry.purpose.slice(0, 200) : "",
        exports: Array.isArray(entry.exports) ? entry.exports.filter((item): item is string => typeof item === "string").map((item) => item.slice(0, 160)).slice(0, 10) : []
      });
    }
    return out.slice(0, 10);
  }

  /**
   * A test that has failed pass after pass, on an app that otherwise works, is
   * usually a test and an app the model wrote that disagree — and it cannot
   * tell which is wrong, so it changes neither enough. Say plainly that the test
   * is ours, not the customer's, and which way to settle it.
   */
  private stuckTestHint(failing: string): string {
    if (failing !== "test" || !this.config.workingDir || !(this.isStarter() || fs.existsSync(path.join(this.workspace.root, "template.json")))) return "";
    let streak = 0;
    for (let i = this.iterations.length - 1; i >= 0 && this.iterations[i].verification?.blockingCheck?.name === "test"; i--) streak++;
    if (streak < 2) return "";
    return `\nThis test has failed for ${streak} passes in a row. It was written by this build, not by the customer. If it
checks something the brief does not ask for, or checks it differently from how the app (correctly) does it, change
the test to check what the app really does — keep it a real test with real expected values. If the brief does ask
for it, make the app do it. Do one or the other completely; do not change both halfway.\n`;
  }

  /** Whether this build started from the web starter (templates/starters/web) rather than a real project or template. */
  private isStarter(): boolean {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(this.workspace.root, "template.json"), "utf8")) as { starter?: boolean };
      return meta.starter === true;
    } catch {
      return false;
    }
  }

  /**
   * A head start on tailoring a template, done without the model: the
   * customer's business name (orders from the site carry "Business: …") in
   * place of the template's invented one, everywhere it appears in the content
   * module, and the preview ribbon off. The model still has to rewrite the rest
   * of the wording for the tailoring check to pass.
   */
  private async prefillTailoring(): Promise<void> {
    if (!this.config.workingDir || !fs.existsSync(path.join(this.workspace.root, "template.json")) || this.isStarter()) return;
    const file = ["src/content.ts", "src/content.tsx", "src/content.js"].find((name) => fs.existsSync(path.join(this.workspace.root, name)));
    if (!file) return;
    const full = path.join(this.workspace.root, file);
    const before = fs.readFileSync(full, "utf8");
    const facts = readFacts(this.config.description);
    const { source, changed } = applyFacts(before.replace(/\bdemo\s*:\s*true\b/, "demo: false"), facts);
    if (source === before) return;
    await this.workspace.writeFiles({ [file]: source }, "Head start: the customer's name and contact details, preview ribbon off");
    const given = [
      changed.includes("name") && `the business name "${facts.business}"`,
      changed.includes("email") && `email ${facts.email}`,
      changed.includes("phone") && `phone ${facts.phone}`,
      changed.includes("whatsapp") && `WhatsApp ${facts.whatsapp ?? facts.phone}`
    ].filter(Boolean);
    this.think(
      1,
      "decision",
      "Put the customer's details in",
      given.length
        ? `Copied the customer's own details from the brief into ${file} (${given.join(", ")}) in place of the template's samples, and turned the template-preview ribbon off.`
        : `Turned the template-preview ribbon off in ${file}.`,
      [file]
    );
  }

  /** Why the last content edit was refused by the shape guard, for the tailoring check to pass on. */
  private lastShapeRefusal: string | null = null;

  /**
   * A template build is only done once it is the customer's: the template's
   * sample content passes every check (it is a working site), so without this a
   * build that changed nothing scored 100 and handed over "Salt & Ember". Null
   * when this is not a template build.
   */
  private async tailoringCheck(): Promise<CheckResult | null> {
    if (!this.config.workingDir || !fs.existsSync(path.join(this.workspace.root, "template.json")) || this.isStarter()) return null;
    const file = ["src/content.ts", "src/content.tsx", "src/content.js"].find((name) => fs.existsSync(path.join(this.workspace.root, name)));
    if (!file) return null;
    const started = Date.now();
    // Contact details the customer never gave go before anything is judged:
    // a made-up number on a live site rings a stranger.
    const written = fs.readFileSync(path.join(this.workspace.root, file), "utf8");
    const stripped = stripInventedContact(written, this.config.description);
    if (stripped.removed.length > 0) {
      await this.workspace.writeFiles({ [file]: stripped.source }, "Removed contact details the customer never gave");
      this.think(
        this.currentIteration,
        "decision",
        "Removed made-up contact details",
        `The brief does not give the business's ${stripped.removed.join(", ")}, so ${stripped.removed.length === 1 ? "it was" : "they were"} emptied in ${file} and the site leaves ${stripped.removed.length === 1 ? "it" : "them"} out. Ask the customer for ${stripped.removed.length === 1 ? "it" : "them"} before it goes live.`,
        [file]
      );
    }
    const now = stripped.source;
    const original = await this.templateOriginal(file);
    const reasons: string[] = [];
    // Text the visitor reads: string values of four characters or more.
    const strings = (source: string) =>
      new Set(Array.from(source.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n]){4,}?)\1/g)).map((m) => m[2]).filter((value) => /[A-Za-z]{3}/.test(value) && !/^(\.|\/|#|https?:|[a-z-]+\/)/.test(value)));
    const businessName = (source: string) => /business\s*:\s*\{[\s\S]*?\bname\s*:\s*(["'`])([^"'`]+)\1/.exec(source)?.[2] ?? null;
    if (original && original.trim() === now.trim()) {
      reasons.push(`${file} is exactly the template's sample content`);
    } else if (original) {
      const sample = strings(original);
      const current = strings(now);
      const replaced = sample.size ? [...sample].filter((value) => !current.has(value)).length / sample.size : 1;
      const sampleName = businessName(original);
      if (sampleName && businessName(now) === sampleName) reasons.push(`the business is still called "${sampleName}" (the template's sample)`);
      if (replaced < 0.3) reasons.push(`only ${Math.round(replaced * 100)}% of the sample wording has been replaced; the rest still describes the template's invented business`);
      reasons.push(...sampleFactsLeft(original, now, readFacts(this.config.description)));
    }
    if (/\bdemo\s*:\s*true\b/.test(now)) reasons.push(`${file} still has demo: true (the "template preview" ribbon)`);
    // Placeholders are worse than the sample: a customer could never be handed "Customer's Phone".
    const placeholders = [...strings(now)].filter((value) =>
      /^(the )?(customer|client)['’]?s?\b|^(your|my) .{0,40}\b(here|goes here)$|lorem ipsum|placeholder|\bTBD\b|\bTODO\b|^(insert|enter) |^\[[^\]]+\]$|^<[^>]+>$|@example\.(com|org)|example\.(com|org)/i.test(value)
    );
    const leftoverNotes = (now.match(/\/\/[^\n]*\b(replace with|fill in|change this|update this|todo)\b/gi) ?? []).length;
    if (leftoverNotes >= 2) reasons.push(`it still has ${leftoverNotes} "replace with …" notes in it; remove them once the values are filled in`);
    if (placeholders.length >= 2) {
      reasons.push(`it has placeholder text instead of real wording (${placeholders.slice(0, 4).map((value) => `"${value}"`).join(", ")})`);
    }
    const passed = reasons.length === 0;
    if (passed) this.lastShapeRefusal = null;
    return {
      name: "tailoring",
      applicable: true,
      passed,
      durationMs: Date.now() - started,
      output: passed
        ? `${file} is tailored for the customer.`
        : `Not tailored yet: ${reasons.join("; ")}.${this.lastShapeRefusal ? ` Note: ${this.lastShapeRefusal}.` : ""}
Fix: write ${file} out in full with the customer's business name, wording, prices and details in place of the sample
values, set demo: false, and keep every export and every key exactly as they are (change values, not the shape).
No placeholders: where the brief does not give a detail, write realistic wording that fits their business, but never
invent contact details: a phone, WhatsApp, email or street address the brief does not give stays "" (the site hides it).`
    };
  }

  /** How many times the reviewer has held a build back, and its verdict on the code it last read. */
  private reviewHolds = 0;
  private lastReview: { head: string; missing: string[] } | null = null;
  /** After this many holds the reviewer's word is advice, so a build cannot circle forever on its opinion. */
  private static readonly MAX_REVIEW_HOLDS = 3;

  /**
   * A new app (a prompt build on the starter, or one from scratch) is only done
   * once it does what the brief asked: every page and must-have in it, enough
   * code to be an app, and nothing the reviewer finds missing or faked. Null for
   * template orders (tailoring covers those) and for projects the user owns.
   */
  private async completenessCheck(iteration: number, report: VerificationReport): Promise<CheckResult | null> {
    // Only apps on the web starter: its layout (src/, App.tsx) is what this
    // measures. A CLI or API built from an empty folder has no src/ to count,
    // and would fail it forever.
    if (!this.config.workingDir || !this.isStarter()) return null;
    const started = Date.now();
    const brief = [this.config.description, ...this.guidance.map((note) => note.text)].join("\n");
    const source = appSource(this.workspace.root);
    const { missing, lines, minLines } = coverage(brief, source, undefined, this.adoptedEngine);
    const reasons: string[] = [];
    const todo: string[] = [];
    // What only looks finished, found without a model: the local reviewer
    // passed a game whose canvas loop said "// Render game logic here".
    const fakes = stubs(source);
    if (fakes.length > 0) {
      reasons.push(`parts of it are not real yet: ${fakes.join("; ")}`);
      todo.push(...fakes.map((fake) => `make this real: ${fake}`));
    }
    for (const engine of engineUse(source, this.adoptedEngine)) {
      // The score table is not driven like a game: what matters is that a finished game is saved to it.
      if (/\/scores\.ts$/.test(engine.file)) {
        if (!engine.used.includes("addScore") && /high.?scores?|leader.?boards?|hall of|best scores?|top scores?/i.test(brief)) {
          reasons.push(`no score is ever saved: nothing calls addScore from ${engine.file}`);
          todo.push(`save each finished game's score: when the game screen's onScore fires (the game is won or lost), call addScore({ name, score, detail }) from ${engine.file.replace(/^src\//, "./").replace(/\.ts$/, "")} and show the high-score table with loadScores()`);
        }
        continue;
      }
      if (engine.used.length < Math.ceil((engine.used.length + engine.unused.length) / 2)) {
        reasons.push(`the app barely uses the engine in ${engine.file}: it never calls ${engine.unused.join(", ")}`);
        todo.push(`drive the game with the engine in ${engine.file}: call ${engine.unused.join(", ")} from the app (the game loop, the controls, starting a level) so it really plays`);
      }
    }
    const unreachable = unreachableScreens(source);
    if (unreachable.length > 0) {
      const named = unreachable.map((u) => (u.handler ? `${u.screen} (nothing calls ${u.handler})` : `${u.screen} (nothing switches to it)`)).join(", ");
      reasons.push(`these screens can never be opened: ${named}`);
      todo.push(
        `make every screen reachable: ${unreachable
          .map((u) => (u.handler ? `a button that calls ${u.handler} (for the ${u.screen} screen)` : `a button that switches to the ${u.screen} screen`))
          .join(" and ")}, e.g. on the title or menu screen (pass the handlers to it as props and render a button for each), and give every screen a Back button to the title. Change only App.tsx and those screens: the game screen and board already exist, do not write new ones`
      );
    }
    for (const unshown of unshownComponents(source, this.adoptedEngine)) {
      const [component] = unshown.components;
      const defaults = /export\s+const\s+(DEFAULT_[A-Z_]+)/.exec(Object.values(source).join("\n"))?.[1] ?? "settings";
      reasons.push(`the playable game is never shown: no screen renders <${component} /> from ${unshown.file}`);
      todo.push(
        `show the real game: on the game screen render <${component} settings={${defaults}} onScore={(score) => ...} /> from ${unshown.file} (it is the whole game: canvas, frame loop, touch and keyboard), and remove any buttons that stand in for play`
      );
    }
    if (missing.length > 0) {
      reasons.push(`the brief asks for ${missing.map((item) => `"${item.label}"`).join(", ")}, and nothing in the app's code has ${missing.length === 1 ? "it" : "them"}`);
    }
    if (lines < minLines) {
      reasons.push(`there are only ${lines} lines of app code (tests aside); a finished app for this brief needs much more than a skeleton`);
    }

    // The reviewer reads the code only once everything else passes: there is
    // no point asking whether a game is fun while it does not compile.
    const othersPass = report.checks.every((check) => !check.applicable || check.passed || check.name === "completeness");
    if (reasons.length === 0 && othersPass && this.reviewHolds < AutonomousOrchestrator.MAX_REVIEW_HOLDS) {
      const head = (await this.workspace.getHead().catch(() => "")) ?? "";
      let gaps = this.lastReview && head && this.lastReview.head === head ? this.lastReview.missing : null;
      if (!gaps) {
        try {
          gaps = parseReview(await ModelRouter.generate(reviewPrompt(brief, source, undefined, this.adoptedEngine))) ?? [];
        } catch (error: any) {
          // Game mode switched on mid-pass: that is not a verdict. The pass
          // fails and is tried again once the build resumes.
          if (error instanceof GameModeOnError) throw error;
          Logger.warn("Completeness review failed; passing on the checks alone", { error: error?.message });
          gaps = [];
        }
        this.lastReview = { head, missing: gaps };
        if (gaps.length > 0) {
          this.reviewHolds += 1;
          this.think(iteration, "critique", "Reviewed against the brief: not finished yet", gaps.map((gap) => `• ${gap}`).join("\n"));
        } else {
          this.think(iteration, "check", "Reviewed against the brief: everything asked for is there", "");
        }
      }
      if (gaps.length > 0) reasons.push(`a review against the brief found these missing or only faked: ${gaps.join("; ")}`);
      todo.push(...gaps);
    }

    // A small model asked for everything at once writes a little of each; asked
    // for one thing, it builds that thing properly. So: one at a time.
    todo.unshift(...missing.map((item) => `"${item.label}" from the brief, as a real, working part of the app`));
    if (lines < minLines && todo.length === 0) {
      // With a playable board the game itself is done and tested: told to build
      // "real rules, levels, rewards", a model rewrote the engine's battles
      // beside it. What is thin is everything around the game.
      const board = this.adoptedEngine.some((file) => /\.tsx$/.test(file));
      todo.push(
        board
          ? "the screens around the game, done properly (the game itself is already built and tested: do not rewrite its rules, battles, moves or loop): show the real numbers from the game's onScore and onChange (the score, the hero or player and their stats, the level, wave or floor), a results screen when it is won or lost that saves the score with the engine's score table (addScore), a high-score table from loadScores(), and a how-to-play section on the title screen"
          : "the app's main feature, done properly: real rules, states and feedback (levels, rewards, winning and losing for a game; validation and saved records for a booking app), not a counter or a list"
      );
    }
    const passed = reasons.length === 0;
    return {
      name: "completeness",
      applicable: true,
      passed,
      durationMs: Date.now() - started,
      output: passed
        ? "The app has every page and feature the brief lists."
        : `Not finished: ${reasons.join("; ")}.
Next, build this ONE thing, completely, and keep everything else as it is: ${todo[0] ?? "what is missing"}.
Give it its own file (a component in src/<Name>.tsx, its logic in src/lib/<name>.ts), make it reachable from
src/App.tsx, and add a test for its logic. No placeholders, hard-coded values or buttons that do nothing.`
    };
  }

  /** What stopped the last pass, so the next one goes straight at it. */
  private lastBlocker(previous: BuildIteration): string {
    const blocker = previous.verification?.blockingCheck;
    if (!blocker || previous.verification?.passed) return "";
    const lines = Array.from(new Set(blocker.output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))).slice(0, 15);
    return ` It failed the ${blocker.name} check — fix this first:\n${lines.join("\n")}\n`;
  }

  /**
   * The rules that keep a starter or template build green, read from the
   * project itself: exactly which packages are installed, and how its tests
   * run. Most failed builds came from a small model reaching for things that
   * are not there (react-router, Jest globals, a UI kit, component tests with no
   * testing library), so it is told plainly what it has to work with.
   */
  private environmentRules(): string {
    if (!fs.existsSync(path.join(this.workspace.root, "template.json"))) return "";
    let pkg: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(this.workspace.root, "package.json"), "utf8"));
    } catch {
      return "";
    }
    const runtime = Object.keys(pkg.dependencies ?? {});
    const dev = Object.keys(pkg.devDependencies ?? {});
    const config = ["vite.config.ts", "vite.config.js", "vitest.config.ts"]
      .map((name) => {
        try {
          return fs.readFileSync(path.join(this.workspace.root, name), "utf8");
        } catch {
          return "";
        }
      })
      .join("\n");
    const globals = /globals\s*:\s*true/.test(config);
    const dom = dev.includes("jsdom") || dev.includes("happy-dom");
    const testingLibrary = dev.some((name) => name.startsWith("@testing-library/"));
    const tailoring = this.isStarter()
      ? ""
      : `
This is a finished, working template. Tailor it for the customer by changing the VALUES in src/content.ts:
names, wording, prices, menu items, hours, contact details, colours, images. Keep that file's exports and every
key exactly as they are (same names, same nesting, same types); add or remove list items freely. Only touch other
files for a feature the customer asked for that the template does not have, and keep src/lib/ as it is.
Set demo: false. Write src/content.ts out in full.
Never write placeholders ("Customer's Business Name", "Your phone here", "Lorem ipsum", "TBD"): the customer sees
every word. Use what the brief says; where it does not say, write realistic, specific wording that fits their
business and location, in the same style and length as the sample it replaces.
`;
    return `${tailoring}
Rules that keep this build passing its checks (install, typecheck, build, tests):
- Installed packages: ${runtime.join(", ") || "none"} (dev: ${dev.join(", ")}). Import ONLY these and relative files.
  Do not add react-router, axios, a UI or CSS library, or anything else: plain React, fetch and CSS do it.
  Several screens? Keep the current screen in React state (or the URL hash), not a router.
- TypeScript is strict: type every prop, state and function parameter; no implicit any; no unused imports.
- A file that contains JSX must end in .tsx. Never give two files the same name with different
  extensions (Game.ts and Game.tsx): put shared types in src/types.ts.
- Tests run with Vitest${globals ? " (describe/it/expect are global)" : `: import { describe, it, expect } from "vitest" in every test file`}.
  Never use jest.*; use vi.* from "vitest".${
      dom && testingLibrary
        ? ""
        : `\n  There is no ${dom ? "" : "browser environment or "}testing library installed: test the logic (plain .ts modules), not React components.`
    }
- Every import must point at a file you write or that already exists, with the exact exported name.
- Write every file complete. No placeholders, TODOs or "rest of the code here".
`;
  }

  /**
   * Keep a template's build setup out of the model's reach.
   *
   * A build that starts from one of our templates (it has template.json) has
   * a known-good setup: the Vite config that makes the site open by
   * double-clicking, the TypeScript config, the entry point, the shared kit.
   * Left alone, a 7B model rewrote them on most passes — once it replaced
   * package.json and the build could never work again. So here:
   *
   *   - those files keep what they had; the model's versions are dropped;
   *   - package.json may gain new dependencies, and nothing else changes;
   *   - a second test or bundler config (jest, babel, webpack) is refused.
   *
   * Everything the customer asked for still gets built: the pages, content and
   * components the template is made of. Projects that are not templates are
   * not restricted here.
   */
  private guardFiles(files: Record<string, string>): Record<string, string> {
    // Every build: the model's answer must be code, and must not break a file that worked.
    const checked = CodeGuard.guard(files, this.workspace.root);
    if (checked.cleaned.length > 0) {
      this.think(
        this.currentIteration,
        "decision",
        "Took the code out of the model's explanation",
        `The answer for ${checked.cleaned.join(", ")} came wrapped in prose or a markdown fence; only the code was kept.`,
        checked.cleaned
      );
    }
    if (checked.refused.length > 0) {
      this.think(
        this.currentIteration,
        "decision",
        "Kept the working version of some files",
        checked.refused.map((item) => `• ${item.file}: the new version would not even parse (${item.why}), so the last working one stays.`).join("\n"),
        checked.refused.map((item) => item.file)
      );
    }
    files = checked.files;

    // A working file is replaced by a whole new version, never by a fragment:
    // a repair answered with one import line, and four screens became that line.
    const fragments: string[] = [];
    for (const file of Object.keys(files)) {
      if (this.adoptedEngine.includes(file) || !/\.(t|j)sx?$/.test(file)) continue;
      let before = "";
      try {
        before = fs.readFileSync(path.join(this.workspace.root, file), "utf8");
      } catch {
        continue;
      }
      // A file the builder wrote itself (the game screen around a board) stays as it is.
      if (before.includes(AutonomousOrchestrator.BUILT_IN_MARK) && files[file] !== before) {
        files[file] = before;
        fragments.push(`• ${file}: written by the builder (it renders the tested board), so it stays as it is — change the screens around it instead.`);
        continue;
      }
      const problem = CodeGuard.fragmentProblem(this.workspace.root, file, before, files[file]);
      if (problem) {
        files[file] = before;
        fragments.push(`• ${file}: the new version ${problem}, so the working one stays.`);
      }
    }
    // A build config is the project's, at its root: one written inside src/
    // came out half-finished and held the typecheck for a whole pass.
    for (const file of Object.keys(files)) {
      if (/^src\/(?:(vite|vitest|postcss|tailwind|eslint)\.config\.(m?[jt]s|cjs)|tsconfig(\.\w+)?\.json|package(-lock)?\.json)$/.test(file)) {
        delete files[file];
        fragments.push(`• ${file}: a build config belongs at the project's root, where the working one already is, so this copy is not added.`);
      }
    }

    // With a playable board, a repair may not add a second one: asked to make
    // two screens reachable, a model wrote its own GameBoard.tsx and Game.tsx
    // calling the engine's actions, and the build stopped compiling. New files
    // that redo the board, or a second game screen beside the builder's, go.
    if (this.adoptedEngine.some((file) => /\.tsx$/.test(file))) {
      const builtIn = (() => {
        try {
          return fs
            .readdirSync(path.join(this.workspace.root, "src", "components"))
            .some((name) => fs.readFileSync(path.join(this.workspace.root, "src", "components", name), "utf8").includes(AutonomousOrchestrator.BUILT_IN_MARK));
        } catch {
          return false;
        }
      })();
      for (const file of Object.keys(files)) {
        if (fs.existsSync(path.join(this.workspace.root, file)) || this.adoptedEngine.includes(file)) continue;
        const name = path.basename(file).replace(/\.tsx?$/, "");
        const secondScreen = builtIn && /\.tsx$/.test(file) && /^(Game|Play|Main)(Screen|Page|View)?$/.test(name);
        if (secondScreen || AutonomousOrchestrator.duplicatesBoard({ path: file, purpose: "" })) {
          delete files[file];
          fragments.push(`• ${file}: the game is already built (the tested board in src/engine/, shown by the builder's game screen), so a new copy of it is not added — change the screens around it instead.`);
        }
      }
    }
    if (fragments.length > 0) {
      this.think(
        this.currentIteration,
        "decision",
        "Kept files the answer would have cut down",
        `${fragments.join("\n")}\nChange a file by sending all of it, with what it exports kept.`,
        fragments.map((line) => line.slice(2, line.indexOf(":")))
      );
    }

    // The engine this build started from may grow (a new export, a tweak to a
    // rule), but not be replaced: a 7B model "rewrote" game.ts as empty stubs.
    for (const file of this.adoptedEngine) {
      if (!(file in files)) continue;
      let before = "";
      try {
        before = fs.readFileSync(path.join(this.workspace.root, file), "utf8");
      } catch {
        continue;
      }
      const problem = CodeGuard.engineRewriteProblem(before, files[file]);
      if (problem) {
        // Keep what it was adding (the saveGame the app imports), not what it lost.
        const salvage = CodeGuard.mergeEngineAdditions(file, before, files[file]);
        files[file] = salvage?.merged ?? before;
        this.think(
          this.currentIteration,
          "decision",
          `Kept the engine in ${file}`,
          `The new version ${problem}.${salvage ? ` Its new ${salvage.added.join(", ")} ${salvage.added.length === 1 ? "was" : "were"} added to the engine as it was.` : ""} Add to the engine or adjust a rule; do not replace it.`,
          [file]
        );
      }
    }

    if (!this.config.workingDir || !fs.existsSync(path.join(this.workspace.root, "template.json"))) return files;

    // A template's content module must keep its shape: the pages read it by name.
    if (!this.isStarter()) {
      for (const file of Object.keys(files)) {
        if (!/^src\/content\.(t|j)sx?$/.test(file)) continue;
        let before = "";
        try {
          before = fs.readFileSync(path.join(this.workspace.root, file), "utf8");
        } catch {
          continue;
        }
        const problem = CodeGuard.templateShapeProblem(before, files[file]);
        if (problem) {
          files[file] = before;
          this.lastShapeRefusal = `your last ${file} was refused: ${problem}`;
          this.think(
            this.currentIteration,
            "decision",
            "Kept the template's content structure",
            `The new ${file} would break every page that reads it (${problem}). Tailoring means changing the values inside it, not its shape.`,
            [file]
          );
        }
      }
    }

    const locked = /^(package-lock\.json|tsconfig(\.[\w-]+)?\.json|vite\.config\.[cm]?[jt]s|index\.html|template\.json|src\/main\.tsx|src\/styles\/base\.css)$/;
    // The kit in src/lib is the template's; a new file there is the app's own
    // (src/lib/usePersistentState.ts). Refusing those left every import of them
    // broken, and no repair could ever fix it.
    const kitFiles = this.kitFiles();
    const kit = (file: string) => kitFiles.has(file);
    const foreign = /^(jest|vitest|babel|webpack|rollup)\.config\.[\w.]+$|^\.babelrc$/;
    const kept: Record<string, string> = {};
    const refused: string[] = [];

    for (const [rawPath, content] of Object.entries(files)) {
      const file = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
      if (file === "package.json") {
        const merged = this.mergePackageJson(content);
        if (merged) kept[file] = merged;
        else refused.push(file);
      } else if (locked.test(file) || kit(file) || foreign.test(file)) {
        refused.push(file);
      } else {
        kept[file] = content;
      }
    }

    if (refused.length) {
      this.think(this.currentIteration, "decision", "Kept the template's build setup", `Ignored changes to ${refused.join(", ")}: they would break how the template builds.`, refused);
    }
    return kept;
  }

  /**
   * The template's package.json with any new dependencies the model asked for
   * added — and nothing else changed. Null when there is nothing to add.
   */
  private mergePackageJson(proposed: string): string | null {
    const file = path.join(this.workspace.root, "package.json");
    let current: Record<string, any>;
    let wanted: Record<string, any>;
    try {
      current = JSON.parse(fs.readFileSync(file, "utf8"));
      wanted = JSON.parse(proposed);
    } catch {
      return null;
    }
    let added = 0;
    const refused: string[] = [];
    for (const field of ["dependencies", "devDependencies"] as const) {
      for (const [name, version] of Object.entries((wanted[field] ?? {}) as Record<string, string>)) {
        const present = current.dependencies?.[name] ?? current.devDependencies?.[name];
        if (present || typeof version !== "string") continue;
        // Compiled, server-side packages: they rarely install on Windows and a
        // browser app cannot use them anyway (the canvas element needs no package).
        if (NATIVE_PACKAGES.has(name)) {
          refused.push(name);
          continue;
        }
        current[field] = { ...(current[field] ?? {}), [name]: version };
        added += 1;
      }
    }
    if (refused.length) {
      this.think(this.currentIteration, "decision", `Left out ${refused.join(", ")}`, "Native server packages do not install on this PC and a browser app cannot use them; use the browser's own APIs instead.");
    }
    if (added === 0) return null;
    this.think(this.currentIteration, "decision", `Added ${added} dependenc${added === 1 ? "y" : "ies"} to the template's package.json`, "");
    return `${JSON.stringify(current, null, 2)}\n`;
  }

  // Research findings for this build, looked up once: the request does not
  // change between passes, and a new finding mid-build is not worth a moving prompt.
  private research: Array<{ claim: string; source: string | null }> | null = null;

  /**
   * What the research on this machine found that bears on this build, for the
   * front of the prompt. Only findings nobody rejected that are corroborated or
   * held with good confidence; never allowed to fail the build.
   */
  private researchPreamble(iteration: number): string {
    if (this.research === null) {
      try {
        const focus = [this.config.projectName, this.config.description, ...this.guidance.map((note) => note.text)].join(" ");
        // The search matches one shared word; a phone game was handed the limbic
        // system and XAI for cyber analysts. Keep only findings about this app.
        this.research = ResearchStore.relevantFindings(focus, 18)
          .filter((finding) => relatedTo(focus, finding.claim))
          .slice(0, 6)
          .map((finding) => ({
            claim: finding.claim,
            source: finding.sourceTitle ?? finding.sourceUrl
          }));
        if (this.research.length > 0) {
          this.think(
            iteration,
            "lesson",
            `Using ${this.research.length} finding(s) from research`,
            this.research.map((item) => `• ${item.claim}${item.source ? ` — ${item.source}` : ""}`).join("\n")
          );
        }
      } catch (error: any) {
        Logger.warn("Research lookup for the build failed; building without it", { error: error?.message });
        this.research = [];
      }
    }
    if (this.research.length === 0) return "";
    return `What research on this machine has found that bears on this (checked against its sources) — use it where it applies:\n${this.research
      .map((item) => `- ${item.claim}`)
      .join("\n")}\n\n`;
  }

  /** Tell whoever is watching what the build is thinking. Never allowed to fail the build. */
  private think(iteration: number, kind: BuildThought["kind"], title: string, text: string, files?: string[], score?: number): void {
    try {
      const thought: BuildThought = { iteration, kind, title, text: text.trim().slice(0, 2500), files: files?.slice(0, 40), score };
      this.emit("thought", thought);
    } catch {
      // A listener's problem is not the build's.
    }
  }

  /** Run the checks and say what they found, in a line and the end of the failing output. */
  private async verifyAndReport(iteration: number, when: string): Promise<VerificationReport> {
    // A project that already exists is checked as it is. Adding a test runner
    // rewrote its package.json and added a vitest config, and applying the
    // build then carried both into the project nobody asked to change. A copy
    // of one of our own builds or templates already has its runner.
    const fromOurTemplate = fs.existsSync(path.join(this.workspace.root, "template.json"));
    const verifyStarted = Date.now();
    let report = await Verifier.verify(this.workspace, { scaffoldTests: !this.config.workingDir, autofix: !this.config.workingDir || fromOurTemplate });
    // Our own apps (a template or the starter) are opened in a real browser:
    // the one check that says a person would see a working app.
    if (fromOurTemplate) {
      const runs = await Verifier.runsCheck(this.workspace.root, verifyStarted).catch(() => null);
      if (runs) report = Verifier.withCheck(report, runs);
    }
    const typeFixes = Verifier.typeFixes.get(this.workspace.root) ?? [];
    if (typeFixes.length > 0) {
      this.think(
        iteration,
        "decision",
        `Fixed ${typeFixes.length} type error${typeFixes.length === 1 ? "" : "s"} without the model`,
        typeFixes.map((fix) => `• ${fix}`).join("\n")
      );
    }
    const tailoring = await this.tailoringCheck();
    if (tailoring) report = Verifier.withCheck(report, tailoring);
    const completeness = await this.completenessCheck(iteration, report);
    if (completeness) report = Verifier.withCheck(report, completeness);
    const line = report.checks
      .filter((check) => check.applicable)
      .map((check) => `${check.name} ${check.passed ? "✓" : "✗"}`)
      .join(" · ");
    const blocker = report.blockingCheck;
    this.think(
      iteration,
      "check",
      `${when}: ${report.passed ? "every check passes" : `${blocker?.name ?? "a check"} fails`} (score ${report.score})`,
      [line, blocker ? blocker.output.replace(/\r\n/g, "\n").trim().slice(-900) : ""].filter(Boolean).join("\n\n"),
      undefined,
      report.score
    );
    return report;
  }

  /** Paths whose content differs between two versions of the files. */
  private changedFiles(before: Record<string, string>, after: Record<string, string>): string[] {
    return Object.keys(after).filter((file) => before[file] !== after[file]);
  }

  /** What the model said outside its FILE blocks: its plan, or why it made a fix. */
  private narrative(response: string): string {
    const text = response.replace(/\r\n/g, "\n");
    const first = text.search(/^[ \t>#*_-]*FILE:/im);
    let said = (first === -1 ? text : text.slice(0, first)).trim();
    if (!said && first !== -1) {
      // Nothing before the files: take whatever follows the last closing fence.
      const lastFence = text.lastIndexOf("```");
      said = lastFence > first ? text.slice(lastFence + 3).trim() : "";
    }
    return said
      .replace(/^(PLAN|CAUSE):\s*/gim, "")
      .replace(/```[\s\S]*?```/g, "")
      .trim()
      .slice(0, 1500);
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
      currentCode = this.guardFiles(currentCode);
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
