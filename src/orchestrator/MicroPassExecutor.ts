/**
 * MicroPassExecutor — Decomposed Micro-Pass Execution (Divide & Conquer).
 *
 * Eliminates monolithic generation sweeps and 7+ minute execution hangs
 * by decomposing build tasks into strict, sequential micro-passes:
 *   Pass A: Types & Interfaces (Must achieve 100% type safety before continuing)
 *   Pass B: Core Logic & State Management
 *   Pass C: UI Shell, Layouts & Styling Tokens
 */
import { ASTVerifier, type ASTVerificationResult } from "./ASTVerifier.js";
import { Logger } from "../utils/Logger.js";

export type MicroPassStage = "PASS_A_TYPES" | "PASS_B_LOGIC" | "PASS_C_UI";

export interface MicroPassConfig {
  workspaceDir: string;
  projectName: string;
  onPassComplete?: (stage: MicroPassStage, success: boolean, message: string) => void;
}

export class MicroPassExecutor {
  /**
   * Validates whether Pass A satisfies strict type safety before Pass B or C are unlocked.
   */
  static async executePassGate(
    stage: MicroPassStage,
    workspaceDir: string
  ): Promise<{ canProceed: boolean; verification: ASTVerificationResult }> {
    Logger.log(`[MicroPassExecutor] Executing gate check for stage: ${stage}`);
    const verification = await ASTVerifier.verifyWorkspace(workspaceDir);

    if (stage === "PASS_A_TYPES") {
      if (!verification.typeCheckPassed) {
        Logger.warn(`[MicroPassExecutor] Pass A failed type-check gate. UI/Logic generation locked until types are 100% sound.`);
        return { canProceed: false, verification };
      }
      return { canProceed: true, verification };
    }

    if (stage === "PASS_B_LOGIC") {
      if (!verification.typeCheckPassed) {
        Logger.warn(`[MicroPassExecutor] Pass B logic errors detected. Halting advance to Pass C (UI).`);
        return { canProceed: false, verification };
      }
      return { canProceed: true, verification };
    }

    // Pass C: Full verification
    return { canProceed: verification.passed, verification };
  }

  /**
   * Partitions requested files into their designated micro-pass bucket.
   */
  static partitionFiles(files: string[]): {
    passAFiles: string[];
    passBFiles: string[];
    passCFiles: string[];
  } {
    const passAFiles: string[] = [];
    const passBFiles: string[] = [];
    const passCFiles: string[] = [];

    for (const file of files) {
      const lower = file.toLowerCase();
      if (lower.includes("types") || lower.endsWith(".d.ts") || lower.includes("schema") || lower.includes("interface")) {
        passAFiles.push(file);
      } else if (
        lower.includes("logic") ||
        lower.includes("store") ||
        lower.includes("reducer") ||
        lower.includes("actions") ||
        lower.includes("engine") ||
        lower.includes("api") ||
        lower.includes("route") ||
        lower.includes("test")
      ) {
        passBFiles.push(file);
      } else {
        passCFiles.push(file);
      }
    }

    return { passAFiles, passBFiles, passCFiles };
  }
}
