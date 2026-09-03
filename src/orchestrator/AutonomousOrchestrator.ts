import { EventEmitter } from "events";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { QualityAnalyzer } from "./QualityAnalyzer.js";
import { ImprovementEngine, type ImprovementPlan, type ImprovementSuggestion } from "./ImprovementEngine.js";
import { HardwareScaler } from "../utils/HardwareScaler.js";
import { PackagingAgent } from "../agents/PackagingAgent.js";
import { Workspace } from "./Workspace.js";

export interface BuildIteration {
  iteration: number;
  timestamp: Date;
  qualityScore: number;
  improvements: string[];
  artifacts: string[];
  status: "running" | "analyzing" | "improving" | "packaging" | "complete" | "error";
  metrics: {
    completeness: number;
    security: number;
    performance: number;
    usability: number;
    testCoverage: number;
  };
}

export interface AutonomousConfig {
  projectName: string;
  description: string;
  targetPlatforms: string[];
  qualityThreshold: number;
  maxIterations: number;
  enableContinuousLearning: boolean;
  hardwareOptimization: boolean;
  autoPackaging: boolean;
}

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

  constructor(private config: AutonomousConfig) {
    super();
    this.buildId = `build_${Date.now()}`;
    this.outputDir = `./builds/${this.buildId}`;

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
    this.currentIteration = 0;

    Logger.log("Starting autonomous orchestration", { 
      projectName: this.config.projectName,
      qualityThreshold: this.config.qualityThreshold 
    });

    this.emit("started", { buildId: this.buildId });

    try {
      // Optimize for current hardware
      if (this.config.hardwareOptimization) {
        await this.hardwareScaler.optimize();
        this.emit("hardware-optimized", await this.hardwareScaler.getSpecs());
      }

      // Main autonomous loop
      while (this.isRunning && this.currentIteration < this.config.maxIterations) {
        if (this.isPaused) {
          await this.sleep(1000);
          continue;
        }

        this.currentIteration++;
        const iteration = await this.runIteration(this.currentIteration);
        this.iterations.push(iteration);

        this.emit("iteration-complete", iteration);

        // Check if quality threshold is met
        if (iteration.qualityScore >= this.config.qualityThreshold) {
          Logger.log("Quality threshold met", { 
            score: iteration.qualityScore, 
            threshold: this.config.qualityThreshold 
          });
          
          if (this.config.autoPackaging) {
            await this.packageBuild(iteration);
          }
          
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

      if (this.currentIteration >= this.config.maxIterations) {
        Logger.warn("Max iterations reached", { iterations: this.currentIteration });
      }

      this.emit("completed", { 
        buildId: this.buildId, 
        iterations: this.currentIteration,
        finalQuality: this.iterations[this.iterations.length - 1]?.qualityScore 
      });

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

      const generateWrite = await this.workspace.writeFiles(
        currentFiles,
        `Iteration ${iterationNum}: generate (${this.config.projectName})`
      );
      Logger.log(`Iteration ${iterationNum}: wrote ${generateWrite.writtenPaths.length} file(s) to ${this.workspace.root}`, {
        skipped: generateWrite.skippedPaths,
        commit: generateWrite.commitHash
      });

      // Phase 2: Analyze Quality
      iteration.status = "analyzing";
      this.emit("iteration-status", { iteration: iterationNum, status: "analyzing" });

      const analysis = await this.qualityAnalyzer.analyze({
        code: currentFiles,
        iteration: iterationNum,
        previousAnalysis: this.getPreviousAnalysis()
      });

      iteration.metrics = analysis.metrics;
      iteration.qualityScore = analysis.overallScore;

      Logger.log(`Iteration ${iterationNum} quality score: ${iteration.qualityScore}`, {
        metrics: iteration.metrics
      });

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
   * Generate code based on current context and previous iterations
   */
  private async generateCode(context: any): Promise<any> {
    const systemPrompt = this.buildSystemPrompt(context);
    
    const response = await ModelRouter.generate(systemPrompt);

    // Parse and structure the generated code
    const files = this.parseGeneratedCode(response);
    
    return {
      files,
      artifacts: Object.keys(files)
    };
  }

  /**
   * Build context-aware prompt with learning from previous iterations
   */
  private buildSystemPrompt(context: any): string {
    const previousInsights = this.iterations.map(it => ({
      iteration: it.iteration,
      score: it.qualityScore,
      improvements: it.improvements
    }));

    return `You are building: ${this.config.projectName}
Description: ${this.config.description}
Target Platforms: ${this.config.targetPlatforms.join(", ")}

Iteration: ${context.iteration}
Previous Quality Score: ${context.previousScore || "N/A"}

Previous Insights:
${JSON.stringify(previousInsights, null, 2)}

Requirements:
- Create production-ready, polished code
- Include comprehensive error handling
- Add proper documentation
- Ensure security best practices
- Optimize for performance
- Include unit tests

${context.iteration > 1 ? `
Previous Issues to Address:
${context.previousIssues.join("\n")}
` : ""}

Generate a complete, working application. Return code in structured format:
FILE: path/to/file.ext
\`\`\`language
code content here
\`\`\`
`;
  }

  /**
   * Parse generated code into structured files
   */
  private parseGeneratedCode(response: string): Record<string, string> {
    const files: Record<string, string> = {};
    const filePattern = /FILE:\s*(.+?)\n```(\w+)?\n([\s\S]+?)```/g;
    
    let match;
    while ((match = filePattern.exec(response)) !== null) {
      const [, filepath, , content] = match;
      files[filepath.trim()] = content.trim();
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
      outputDir: this.outputDir
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
