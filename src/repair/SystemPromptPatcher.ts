/**
 * SystemPromptPatcher — Recursive Prompt Self-Mutation (The Meta-Loop).
 *
 * When an application's integrity score fails to increase across 3 consecutive runs,
 * the agent is authorized to rewrite and mutate its own operational instructions for
 * that specific project repo, saving the optimized prompt to disk for future builds.
 */
import fs from "fs";
import path from "path";
import { EpisodicMemory } from "../learning/EpisodicMemory.js";
import { Logger } from "../utils/Logger.js";

export class SystemPromptPatcher {
  private static getProjectPromptDir(): string {
    const dir = path.resolve("agents", "projects");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  static getProjectPromptPath(projectName: string): string {
    const sanitized = projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    return path.join(this.getProjectPromptDir(), `${sanitized}.prompt.xml`);
  }

  /**
   * Checks if an application has hit the stagnation threshold (3 runs with ΔScore <= 0).
   */
  static shouldMutate(projectName: string): boolean {
    const ledger = EpisodicMemory.getLedger(projectName);
    return ledger.consecutiveStagnantRuns >= 3;
  }

  /**
   * Synthesizes and persists a mutated prompt tailored to overcome the project's stagnation vector.
   */
  static mutatePrompt(
    projectName: string,
    diagnostics: string,
    currentScore: number
  ): string {
    const ledger = EpisodicMemory.getLedger(projectName);
    const banned = EpisodicMemory.getBannedApproaches(projectName);
    const rules = ledger.heuristicRules;

    const mutatedPrompt = `<!-- Mutated Autonomous Directive for ${projectName} (Generated after ${ledger.consecutiveStagnantRuns} stagnant runs) -->
<system_meta_architecture>
You are the Specialized Production Architect for ${projectName}.
CRITICAL OVERRIDE: Prior conventional strategies stagnated at score ${currentScore}/100.
You must discard previous failed assumptions and execute strict anti-stagnation rules.
</system_meta_architecture>

<strict_anti_patterns>
${banned.map(b => `- FORBIDDEN: ${b}`).join("\n")}
</strict_anti_patterns>

<learned_heuristics>
${rules.map(r => `- RULE: ${r}`).join("\n")}
</learned_heuristics>

<execution_directives>
1. SURGICAL ATOMIC FIXES ONLY: Do not touch working modules.
2. COMPILE FIRST: No UI changes until types and interfaces achieve 100% AST check pass.
3. EXPLICIT ERROR BOUNDS: Catch and format async/promise parameters (e.g. Next.js 15 async route contexts).
</execution_directives>
`;

    const promptPath = this.getProjectPromptPath(projectName);
    fs.writeFileSync(promptPath, mutatedPrompt, "utf8");
    Logger.log(`[SystemPromptPatcher] Mutated prompt saved for ${projectName} at ${promptPath}`);

    return mutatedPrompt;
  }

  static loadActivePrompt(projectName: string, defaultPrompt: string): string {
    const promptPath = this.getProjectPromptPath(projectName);
    if (fs.existsSync(promptPath)) {
      try {
        return fs.readFileSync(promptPath, "utf8");
      } catch (err: any) {
        Logger.warn(`[SystemPromptPatcher] Failed to load mutated prompt for ${projectName}`, { error: err?.message });
      }
    }
    return defaultPrompt;
  }
}
