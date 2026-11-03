/**
 * ASTVerifier — Sandboxed AST Verification & Linter Feedback Loop.
 *
 * Replaces hallucination-prone model self-scoring with headless, deterministic
 * AST compiler verification (tsc --noEmit, Biome/ESLint).
 * Injects raw stdout error streams directly into failure context for targeted patch passes.
 */
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import { Logger } from "../utils/Logger.js";

const execAsync = promisify(exec);

export interface ASTDiagnostic {
  file: string;
  line: number;
  column: number;
  code: string;
  message: string;
  severity: "error" | "warning";
}

export interface ASTVerificationResult {
  passed: boolean;
  typeCheckPassed: boolean;
  lintPassed: boolean;
  diagnostics: ASTDiagnostic[];
  rawStdout: string;
  durationMs: number;
}

export class ASTVerifier {
  static async verifyWorkspace(workspaceDir: string): Promise<ASTVerificationResult> {
    const start = Date.now();
    const diagnostics: ASTDiagnostic[] = [];
    let rawStdout = "";
    let typeCheckPassed = true;
    let lintPassed = true;

    // Phase 1: Sandboxed Headless TypeScript AST Type Check
    const tsconfigPath = path.join(workspaceDir, "tsconfig.json");
    if (fs.existsSync(tsconfigPath)) {
      try {
        const { stdout, stderr } = await execAsync("npx tsc --noEmit", {
          cwd: workspaceDir,
          timeout: 120_000,
          windowsHide: true
        });
        rawStdout += `## TSC Output:\n${stdout}\n${stderr}\n`;
      } catch (err: any) {
        typeCheckPassed = false;
        const errOutput = `${err?.stdout ?? ""}\n${err?.stderr ?? ""}\n${err?.message ?? ""}`;
        rawStdout += `## TSC Compiler Errors:\n${errOutput}\n`;
        this.parseTscDiagnostics(errOutput, diagnostics);
      }
    }

    // Phase 2: Linter Verification (ESLint / Biome)
    const pkgJsonPath = path.join(workspaceDir, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
        if (pkg.scripts?.lint) {
          try {
            const { stdout, stderr } = await execAsync("npm run lint", {
              cwd: workspaceDir,
              timeout: 90_000,
              windowsHide: true
            });
            rawStdout += `## Linter Output:\n${stdout}\n${stderr}\n`;
          } catch (lintErr: any) {
            lintPassed = false;
            const lintOutput = `${lintErr?.stdout ?? ""}\n${lintErr?.stderr ?? ""}`;
            rawStdout += `## Linter Violations:\n${lintOutput}\n`;
            diagnostics.push({
              file: "linter",
              line: 1,
              column: 1,
              code: "LINT_FAIL",
              message: lintOutput.slice(0, 1000),
              severity: "error"
            });
          }
        }
      } catch {
        // pkg parse error handled elsewhere
      }
    }

    const durationMs = Date.now() - start;
    const passed = typeCheckPassed && lintPassed;

    return {
      passed,
      typeCheckPassed,
      lintPassed,
      diagnostics,
      rawStdout,
      durationMs
    };
  }

  private static parseTscDiagnostics(output: string, out: ASTDiagnostic[]): void {
    const lines = output.split(/\r?\n/);
    const regex = /^([^(]+)\((\d+),(\d+)\):\s+error\s+(TS\d+):\s+(.*)$/;
    for (const line of lines) {
      const match = regex.exec(line.trim());
      if (match) {
        out.push({
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          code: match[4],
          message: match[5],
          severity: "error"
        });
      }
    }
  }
}
