/**
 * ProjectDoctor — runs a project's own checks, and attempts a repair when they
 * fail.
 *
 * This is what makes "Jarvis found an error" actionable: diagnose reproduces the
 * failure with the same objective checks the build pipeline uses (install,
 * typecheck, build, test, lint), and repair asks the local model for a patch,
 * keeping it only if the verified score actually improves.
 *
 * Safety rules, because this edits real projects:
 *   - a project with uncommitted work is left alone unless explicitly forced —
 *     the user's in-progress changes are not ours to gamble with;
 *   - every attempt happens on a dedicated branch, never on the current one;
 *   - a patch that does not improve the score is rolled back;
 *   - nothing is ever pushed.
 */
import { execFile } from "child_process";
import { promisify } from "util";

import { EcosystemStore } from "./EcosystemStore.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { Logger } from "../utils/Logger.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Verifier, type VerificationReport } from "../orchestrator/Verifier.js";
import { Workspace } from "../orchestrator/Workspace.js";

const run = promisify(execFile);

const FILE_BLOCK = /FILE:\s*(.+?)\n```(\w+)?\n([\s\S]+?)```/g;
const MAX_PATCH_FILES = 6;

export interface RepairOutcome {
  projectId: string;
  attempted: boolean;
  reason?: string;
  branch?: string;
  startScore?: number;
  finalScore?: number;
  passed?: boolean;
  attempts: number;
  changedFiles: string[];
  failingCheck?: string;
}

const git = async (cwd: string, args: string[]): Promise<string> => {
  const { stdout } = await run("git", args, { cwd, timeout: 20_000, windowsHide: true });
  return stdout.trim();
};

const parsePatch = (response: string): Record<string, string> => {
  const files: Record<string, string> = {};
  let match: RegExpExecArray | null;
  FILE_BLOCK.lastIndex = 0;
  while ((match = FILE_BLOCK.exec(response)) !== null) {
    const [, rawPath, , body] = match;
    const filePath = rawPath.trim().replace(/^[./\\]+/, "");
    // Refuse anything that climbs out of the project or targets version control.
    if (!filePath || filePath.includes("..") || filePath.startsWith(".git/")) continue;
    files[filePath] = body;
    if (Object.keys(files).length >= MAX_PATCH_FILES) break;
  }
  return files;
};

/** File paths mentioned in a failing check's output, so the model sees the right code. */
const filesFromOutput = (output: string): string[] => {
  const paths = new Set<string>();
  const pattern = /(?:^|\s|\()([\w./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|json|css|py|rs))(?::\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(output)) !== null) {
    const candidate = match[1].replace(/^[./]+/, "");
    if (!candidate.includes("node_modules") && candidate.length < 200) paths.add(candidate);
    if (paths.size >= 5) break;
  }
  return [...paths];
};

export const ProjectDoctor = {
  /** Run the project's checks and record what failed. */
  async diagnose(projectId: string): Promise<{ report: VerificationReport; issues: number } | null> {
    const project = EcosystemStore.getProject(projectId);
    if (!project) return null;

    const workspace = new Workspace(project.path);
    const report = await Verifier.verify(workspace, { scaffoldTests: false });

    let issues = 0;
    for (const check of report.checks) {
      if (!check.applicable) continue;
      const signature = LessonMemory.errorSignature(check.name, check.output);
      if (check.passed) {
        // Anything previously recorded for this check now passes: close it.
        for (const issue of EcosystemStore.listIssues({ projectId, limit: 100 })) {
          if (issue.title.startsWith(`${check.name} fails`) && issue.status !== "resolved") {
            EcosystemStore.updateIssue(issue.id, { status: "resolved", resolution: "Check passes again." });
          }
        }
        continue;
      }
      EcosystemStore.recordIssue({
        projectId,
        source: "maintenance",
        severity: "error",
        title: `${check.name} fails`,
        detail: check.output.slice(0, 4000),
        // One failing check is one issue: keying on the error signature made a
        // second row whenever the output varied slightly between runs.
        signature: `check:${check.name}`
      });
      issues += 1;
    }

    EcosystemStore.recordEvent(
      projectId,
      "diagnose",
      `Checks scored ${report.score}/100 (${report.checks.filter((c) => c.applicable && !c.passed).length} failing)`
    );
    return { report, issues };
  },

  /**
   * Attempt to fix the first failing check. Returns what happened rather than
   * throwing, so a caller (Jarvis, the dashboard) can report it verbatim.
   */
  async repair(
    projectId: string,
    options: { maxAttempts?: number; force?: boolean } = {}
  ): Promise<RepairOutcome> {
    const outcome: RepairOutcome = { projectId, attempted: false, attempts: 0, changedFiles: [] };
    const project = EcosystemStore.getProject(projectId);
    if (!project) {
      outcome.reason = "Unknown project.";
      return outcome;
    }
    if (project.gitDirty > 0 && !options.force) {
      outcome.reason = `Project has ${project.gitDirty} uncommitted change(s); refusing to edit. Commit or stash first, or repair with force.`;
      return outcome;
    }

    const workspace = new Workspace(project.path);
    let report = await Verifier.verify(workspace, { scaffoldTests: false });
    outcome.startScore = report.score;
    if (report.passed) {
      outcome.reason = "All checks already pass.";
      outcome.finalScore = report.score;
      outcome.passed = true;
      return outcome;
    }

    const branch = `agent-builder/fix-${Date.now()}`;
    const originalBranch = project.gitBranch ?? (await git(project.path, ["rev-parse", "--abbrev-ref", "HEAD"]));
    try {
      await git(project.path, ["checkout", "-b", branch]);
    } catch (error) {
      outcome.reason = `Could not create a working branch: ${error instanceof Error ? error.message : String(error)}`;
      return outcome;
    }

    outcome.attempted = true;
    outcome.branch = branch;
    const maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5));

    for (let attempt = 1; attempt <= maxAttempts && !report.passed; attempt += 1) {
      outcome.attempts = attempt;
      const failing = report.blockingCheck ?? report.checks.find((check) => check.applicable && !check.passed);
      if (!failing) break;
      outcome.failingCheck = failing.name;

      const signature = LessonMemory.errorSignature(failing.name, failing.output);
      const lessons = LessonMemory.relevant("build", `${failing.name} ${signature}`, 4);
      const lessonIds = lessons.map((lesson) => lesson.id);
      if (lessonIds.length > 0) LessonMemory.markApplied(lessonIds);

      const contextFiles: string[] = [];
      for (const relativePath of filesFromOutput(failing.output)) {
        try {
          const content = await workspace.readFile(relativePath);
          contextFiles.push(`FILE: ${relativePath}\n\`\`\`\n${content.slice(0, 4000)}\n\`\`\``);
        } catch {
          // The path came out of compiler output; not every match is a real file.
        }
      }

      const prompt = [
        `The project "${project.name}" (${project.stack.join(", ") || project.kind}) fails its ${failing.name} check.`,
        "",
        "Check output:",
        "```",
        failing.output.slice(0, 3000),
        "```",
        contextFiles.length > 0 ? `\nCurrent contents of the files involved:\n\n${contextFiles.join("\n\n")}` : "",
        lessons.length > 0 ? `\nWhat earlier fixes taught us:\n${LessonMemory.formatForPrompt(lessons)}` : "",
        "",
        "Fix the problem. Change as little as possible, and do not reformat unrelated code.",
        "Return ONLY the corrected file(s) as FILE: blocks:",
        "",
        "FILE: path/to/file.ext",
        "```",
        "<the complete corrected file>",
        "```"
      ].join("\n");

      const response = await ModelRouter.generate(prompt);
      const patch = parsePatch(response);
      if (Object.keys(patch).length === 0) {
        Logger.log("Repair produced no parseable files", { projectId, attempt });
        continue;
      }

      const head = await workspace.getHead();
      await workspace.writeFiles(patch, `agent-builder: repair ${failing.name} (attempt ${attempt})`);
      const next = await Verifier.verify(workspace, { scaffoldTests: false });

      if (next.score > report.score) {
        report = next;
        outcome.changedFiles = [...new Set([...outcome.changedFiles, ...Object.keys(patch)])];
        if (next.passed && lessonIds.length > 0) LessonMemory.recordOutcome(lessonIds, true);
        if (next.passed) {
          LessonMemory.recordFix(
            "build",
            `${failing.name}:${signature}`,
            `In ${project.name}, ${failing.name} failed and was fixed by editing ${Object.keys(patch).join(", ")}.`,
            failing.output.slice(0, 500)
          );
        }
      } else {
        // No improvement: put the branch back where it was and try again.
        if (lessonIds.length > 0) LessonMemory.recordOutcome(lessonIds, false);
        if (head) await workspace.resetTo(head);
      }
    }

    outcome.finalScore = report.score;
    outcome.passed = report.passed;

    if (!outcome.passed && outcome.changedFiles.length === 0) {
      // Nothing useful happened — do not leave a stray branch behind.
      try {
        await git(project.path, ["checkout", originalBranch]);
        await git(project.path, ["branch", "-D", branch]);
        outcome.branch = undefined;
      } catch {
        // Leaving the branch is not fatal; the caller is told what happened.
      }
    }

    EcosystemStore.recordEvent(
      projectId,
      "repair",
      `${outcome.passed ? "Fixed" : "Attempted"} ${outcome.failingCheck ?? "checks"}: ${outcome.startScore} → ${outcome.finalScore}` +
        (outcome.branch ? ` on ${outcome.branch}` : "")
    );
    return outcome;
  }
};
