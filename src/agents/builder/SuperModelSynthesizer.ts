/**
 * SuperModelSynthesizer — The Ultimate Multi-Agent Super-Model Orchestrator.
 *
 * Combines specialized models & agents into a unified building pipeline:
 *   - Prompter Model: Expands raw single prompts into 10-part master blueprints
 *   - Coding Model (Claude / Qwen / GPT): Writes rock-solid logic, state & unit tests
 *   - Visual & Animation Model (Gemini / GPT): Crafts high-end UI, canvas 60fps loops & VFX
 *   - 3D & Blender Specialist: Builds executable Blender python scripts & WebGL bridges
 *   - Audio Specialist: Synthesizes zero-dependency procedural Web Audio SFX
 *   - QA Critic: Harmonizes modules, verifies imports, and drives continuous learning
 */
import fs from "fs";
import path from "path";

import { SuperPrompter, type SuperPromptBlueprint } from "../../media/SuperPrompter.js";
import { SystemArchitectAgent } from "./SystemArchitectAgent.js";
import { CodeEngineAgent } from "./CodeEngineAgent.js";
import { VisualAnimationAgent } from "./VisualAnimationAgent.js";
import { Blender3DAgent } from "./Blender3DAgent.js";
import { SoundFxAgent } from "./SoundFxAgent.js";
import { QACriticAgent, type QAReport } from "./QACriticAgent.js";
import { LessonMemory } from "../../learning/LessonMemory.js";
import { Logger } from "../../utils/Logger.js";

export interface SuperModelBuildResult {
  blueprint: SuperPromptBlueprint;
  files: Record<string, string>;
  blender3D: {
    plan: any;
    compiled: boolean;
    filesCreated: string[];
  };
  qaReport: QAReport;
  durationMs: number;
}

export class SuperModelSynthesizer {
  /**
   * Synthesizes a full application or game from a single user prompt.
   */
  static async synthesizeFromSinglePrompt(
    workspaceDir: string,
    rawPrompt: string,
    projectNameHint?: string,
    onThought?: (kind: string, title: string, text: string) => void,
    /**
     * A build passes true: when the code or visual model does not answer
     * usably this throws, and the build carries on with its own prompt-driven
     * planner instead of shipping the canned template modules as "the game".
     */
    strict = false
  ): Promise<SuperModelBuildResult> {
    const started = Date.now();
    Logger.log(`[SuperModelSynthesizer] Synthesizing project from prompt: "${rawPrompt.slice(0, 100)}..."`);

    // Step 1: Deep Single-Prompt Architectural Expansion
    onThought?.("plan", "SuperPrompter: Blueprint Expansion", "Deconstructing single prompt into 10-part production blueprint...");
    const blueprint = await SuperPrompter.expand(rawPrompt, projectNameHint);

    onThought?.(
      "decision",
      `Architectural Blueprint: ${blueprint.title}`,
      `Category: ${blueprint.kind.toUpperCase()} | 3D: ${blueprint.is3D ? "Enabled" : "2D Canvas"} | Theme: ${blueprint.theme.style}`
    );

    // Step 2: System Architect Partitioning
    const partition = SystemArchitectAgent.planPartitions(blueprint);

    // Step 3: Procedural Audio Engine Generation
    onThought?.("plan", "SoundCraft: Procedural Audio", "Synthesizing zero-dependency Web Audio API sound engine...");
    const soundFiles = SoundFxAgent.generateAudioModule(blueprint);

    // Step 4: 3D Scene & Blender Asset Generation
    onThought?.("plan", "BlenderStudio: 3D Scene Pipeline", "Generating Blender Python (bpy) automation script and Three.js bridge...");
    const blenderResult = await Blender3DAgent.setup3DScene(workspaceDir, blueprint);

    // Step 5: Code Engine Logic & State Modules (Best Coding Model)
    onThought?.("plan", "CodeEngine: Core Architecture", "Writing deterministic state machine, calculations, and unit tests...");
    const codeFiles = await CodeEngineAgent.generateCoreModules(blueprint, partition.codeEngineTasks.files, strict);

    // Step 6: Visual & Animation Agent (Best Visual Model)
    onThought?.("plan", "VisualAnimationAgent: UI & Motion", "Crafting responsive React UI, Canvas rendering loop, and CSS styling tokens...");
    const visualFiles = await VisualAnimationAgent.generateVisualModules(blueprint, codeFiles, strict);

    // Step 7: Combine all generated code modules
    const rawFiles: Record<string, string> = {
      ...soundFiles,
      ...codeFiles,
      ...visualFiles
    };

    // Step 8: QA & Critic Review / Harmonization
    onThought?.("review", "QACritic: Cross-Agent Harmonization", "Validating module exports, styles, audio hooks, and test assertions...");
    const { harmonizedFiles, report } = QACriticAgent.reviewAndHarmonize(blueprint, rawFiles);

    // Step 9: Write all harmonized files into the workspace
    for (const [relPath, content] of Object.entries(harmonizedFiles)) {
      const fullPath = path.join(workspaceDir, relPath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content, "utf8");
    }

    // Step 10: Record lessons learned and synergy metrics for continuous learning
    const durationMs = Date.now() - started;
    SuperModelSynthesizer.recordContinuousLearning(blueprint, report, durationMs);

    onThought?.(
      "decision",
      "Super-Model Synthesis Complete",
      `Built complete working ${blueprint.kind} with ${Object.keys(harmonizedFiles).length + blenderResult.filesCreated.length} files. QA Score: ${report.score}/100.`
    );

    return {
      blueprint,
      files: harmonizedFiles,
      blender3D: blenderResult,
      qaReport: report,
      durationMs
    };
  }

  /**
   * Persists synergy data and lessons learned so subsequent builds continuously improve.
   */
  private static recordContinuousLearning(
    blueprint: SuperPromptBlueprint,
    qaReport: QAReport,
    durationMs: number
  ) {
    try {
      const dataDir = path.resolve("data", "super-model");
      fs.mkdirSync(dataDir, { recursive: true });
      const record = {
        timestamp: new Date().toISOString(),
        title: blueprint.title,
        kind: blueprint.kind,
        is3D: blueprint.is3D,
        qaScore: qaReport.score,
        durationMs,
        fixesCount: qaReport.fixesApplied.length
      };
      fs.appendFileSync(path.join(dataDir, "synergy.jsonl"), JSON.stringify(record) + "\n", "utf8");

      // Record a reusable lesson for prompt engineering
      if (qaReport.score >= 90) {
        LessonMemory.recordFix(
          "build",
          `super-prompt-${blueprint.kind}`,
          `Single-prompt ${blueprint.kind} synthesis succeeds reliably when separating deterministic engine logic from visual canvas loops and procedural audio.`,
          blueprint.expandedBriefText.slice(0, 1000)
        );
      }
    } catch (err: any) {
      Logger.warn("Failed to record super-model synergy data", { error: err?.message });
    }
  }
}
