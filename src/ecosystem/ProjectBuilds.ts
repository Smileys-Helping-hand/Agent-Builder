/**
 * ProjectBuilds — carrying on with a project that already exists.
 *
 * The orchestrator commits every pass and, when a pass scores worse, runs
 * `git reset --hard` and `git clean -fd` to go back. That is exactly right in a
 * build folder and exactly wrong in someone's project, where it would throw
 * away work that was never committed. So a build never runs in the project.
 *
 *   start   copy the project as it is right now (uncommitted work included,
 *           ignored files like node_modules left out) into builds/, commit that
 *           copy as the starting point, and build there.
 *   changes what the build changed, relative to that starting point.
 *   apply   write those changes back into the project, file by file, but only
 *           where the project file is still what the build started from. A file
 *           you edited in the meantime is left alone and reported, never
 *           overwritten. Nothing is committed in the project; the changes show
 *           up as ordinary edits you can look at, commit or undo.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import { BuildService, buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { Verifier } from "../orchestrator/Verifier.js";
import { Workspace } from "../orchestrator/Workspace.js";
import { Logger } from "../utils/Logger.js";
import type { EcosystemProject } from "./EcosystemStore.js";
import { gitError, type PushResult } from "./ProjectGit.js";

const run = promisify(execFile);

const RECORDS_PATH = path.resolve("./data/project-builds.json");
const BUILDS_ROOT = path.resolve("./builds");

/** Walked when the project is not a git repository. */
const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "target", "venv", ".venv", "__pycache__", ".turbo", ".cache", "coverage"
]);
const MAX_FILES = 20_000;
const MAX_BYTES = 300 * 1024 * 1024;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Agent Builder",
  GIT_AUTHOR_EMAIL: "agent-builder@local",
  GIT_COMMITTER_NAME: "Agent Builder",
  GIT_COMMITTER_EMAIL: "agent-builder@local"
};

export interface ProjectBuildRecord {
  buildId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  /** The copy the build works in. */
  workDir: string;
  /** The commit in workDir holding the project as it was when the build started. */
  startCommit: string;
  instruction: string;
  startedBy: string;
  createdAt: string;
  appliedAt: string | null;
  lastApply: ApplyResult | null;
  /** How the build ended, kept here because the build service forgets on restart. */
  finalState?: "completed" | "stopped" | "error";
  finalQuality?: number;
  /** The last time its checks were run on the copy, before applying. */
  lastTest?: TestResult | null;
  /** The commit made in the project from the files this build applied. */
  commit?: { hash: string; branch: string; message: string; files: string[]; at: string } | null;
  /** The last push of that commit, as GitHub confirmed it. */
  push?: PushResult | null;
}

export interface TestCheck {
  name: string;
  applicable: boolean;
  passed: boolean;
  /** The end of the check's output, enough to see why it failed. */
  output: string;
}

export interface TestResult {
  state: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  score: number | null;
  passed: boolean;
  checks: TestCheck[];
  error?: string;
}

export interface FileChange {
  path: string;
  change: "added" | "modified" | "deleted";
}

export interface ApplyResult {
  applied: string[];
  /** Already the same in the project, so nothing to do. */
  unchanged: string[];
  /** Edited in the project since the build started; left alone. */
  conflicts: string[];
}

const git = async (cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string> => {
  const { stdout } = await run("git", args, { cwd, env, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 120_000 });
  return stdout;
};

const isGitRepo = async (dir: string): Promise<boolean> => {
  try {
    return (await git(dir, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch {
    return false;
  }
};

const readRecords = (): ProjectBuildRecord[] => {
  try {
    return JSON.parse(fs.readFileSync(RECORDS_PATH, "utf8")) as ProjectBuildRecord[];
  } catch {
    return [];
  }
};

const writeRecords = (records: ProjectBuildRecord[]): void => {
  fs.mkdirSync(path.dirname(RECORDS_PATH), { recursive: true });
  fs.writeFileSync(RECORDS_PATH, JSON.stringify(records.slice(-300), null, 2));
};

const saveRecord = (record: ProjectBuildRecord): void => {
  const records = readRecords().filter((entry) => entry.buildId !== record.buildId);
  records.push(record);
  writeRecords(records);
};

/** Every file worth copying, relative to the project root, with forward slashes. */
const listProjectFiles = async (projectPath: string): Promise<string[]> => {
  if (await isGitRepo(projectPath)) {
    // Tracked plus untracked-but-not-ignored: the project as you see it, minus node_modules and friends.
    const out = await git(projectPath, ["ls-files", "-co", "--exclude-standard", "-z"]);
    return out.split("\0").filter((entry) => entry && fs.existsSync(path.join(projectPath, entry)));
  }
  const found: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (found.length > MAX_FILES) return;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) walk(path.join(dir, entry.name), relPath);
      } else if (entry.isFile()) {
        found.push(relPath);
      }
    }
  };
  walk(projectPath, "");
  return found;
};

const sameContent = (a: Buffer | null, b: Buffer | null): boolean =>
  a === null || b === null ? a === b : a.equals(b);

const readOrNull = (file: string): Buffer | null => (fs.existsSync(file) ? fs.readFileSync(file) : null);

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "project";

/**
 * Copy a folder into builds/ as a git repo whose first commit is the folder as
 * it is right now. Used for carrying on with a project, and for starting a
 * customer's build from a template's source.
 */
export const copyForBuild = async (
  sourcePath: string,
  label: string,
  prefix: string
): Promise<{ workDir: string; startCommit: string; files: string[] }> => {
  const files = await listProjectFiles(sourcePath);
  if (files.length === 0) throw new Error(`${sourcePath} has no files to work on.`);
  if (files.length > MAX_FILES) throw new Error(`${label} has more than ${MAX_FILES} files; too big to copy for a build.`);

  let bytes = 0;
  for (const file of files) bytes += fs.statSync(path.join(sourcePath, file)).size;
  if (bytes > MAX_BYTES) {
    throw new Error(`${label} is ${Math.round(bytes / 1024 / 1024)} MB without its ignored files; too big to copy for a build.`);
  }

  const workDir = path.join(BUILDS_ROOT, `${prefix}_${slug(label)}_${Date.now()}`);
  for (const file of files) {
    const target = path.join(workDir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourcePath, file), target);
  }
  // Without this, installing dependencies during checks would commit node_modules.
  const ignore = path.join(workDir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "node_modules/\ndist/\n.env\n", "utf8");

  await git(workDir, ["init", "-q"]);
  // Store bytes exactly as they are, so "is the project file still what we
  // started from" is a plain byte comparison even with CRLF files on Windows.
  await git(workDir, ["config", "core.autocrlf", "false"]);
  await git(workDir, ["config", "core.safecrlf", "false"]);
  // …including over a .gitattributes in the project asking for normalisation.
  fs.mkdirSync(path.join(workDir, ".git", "info"), { recursive: true });
  fs.writeFileSync(path.join(workDir, ".git", "info", "attributes"), "* -text\n", "utf8");
  await git(workDir, ["add", "-A"]);
  await git(workDir, ["commit", "-q", "--no-verify", "-m", `Starting point: ${label} as it was`], GIT_ENV);
  const startCommit = (await git(workDir, ["rev-parse", "HEAD"])).trim();

  return { workDir, startCommit, files };
};

export const ProjectBuilds = {
  /**
   * Copy the project and start a build on the copy. Throws with a readable
   * message when the project cannot be copied (too big, unreadable).
   */
  async start(
    project: Pick<EcosystemProject, "id" | "name" | "path">,
    instruction: string,
    options: { startedBy?: string; profile?: "fast" | "balanced" | "deep" } = {}
  ): Promise<ProjectBuildRecord> {
    const { workDir, startCommit, files } = await copyForBuild(project.path, project.name, "project");

    const build = BuildService.start({
      projectName: project.name,
      description: instruction,
      workingDir: workDir,
      profile: options.profile ?? "balanced",
      // A change to an existing project is one job, not an open-ended quest
      // for a quality score: a few passes to get it right, then stop.
      maxIterations: 3,
      qualityThreshold: 85,
      // Packages would land in the copy and then look like changes to apply.
      autoPackaging: false,
      startedBy: options.startedBy ?? "user"
    });

    const record: ProjectBuildRecord = {
      buildId: build.buildId,
      projectId: project.id,
      projectName: project.name,
      projectPath: project.path,
      workDir,
      startCommit,
      instruction,
      startedBy: options.startedBy ?? "user",
      createdAt: new Date().toISOString(),
      appliedAt: null,
      lastApply: null
    };
    saveRecord(record);

    // Remember how it ended; the build service only keeps that in memory.
    const endings = { completed: "completed", failed: "error", stopped: "stopped" } as const;
    const listeners = Object.entries(endings).map(([event, state]) => {
      const listener = (ended: BuildRecord) => {
        if (ended.buildId !== build.buildId) return;
        listeners.forEach(([name, fn]) => buildEvents.off(name, fn));
        const current = this.get(build.buildId);
        if (current) saveRecord({ ...current, finalState: state, finalQuality: ended.qualityScore });
      };
      buildEvents.on(event, listener);
      return [event, listener] as const;
    });

    Logger.log("Project build started", { buildId: build.buildId, project: project.name, workDir, files: files.length });
    return record;
  },

  get(buildId: string): ProjectBuildRecord | null {
    return readRecords().find((record) => record.buildId === buildId) ?? null;
  },

  list(projectId?: string): ProjectBuildRecord[] {
    return readRecords()
      .filter((record) => !projectId || record.projectId === projectId)
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },

  /** What the build has changed so far, relative to where it started. */
  async changes(record: ProjectBuildRecord): Promise<FileChange[]> {
    if (!fs.existsSync(record.workDir)) return [];
    const out = await git(record.workDir, ["diff", "--no-renames", "--name-status", "-z", record.startCommit, "HEAD"]);
    const parts = out.split("\0").filter(Boolean);
    const changes: FileChange[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const status = parts[i];
      const file = parts[i + 1];
      changes.push({ path: file, change: status === "A" ? "added" : status === "D" ? "deleted" : "modified" });
    }
    return changes;
  },

  /** The diff of one build, for reading on a phone. */
  async diff(record: ProjectBuildRecord, maxChars = 60_000): Promise<string> {
    if (!fs.existsSync(record.workDir)) return "";
    const out = await git(record.workDir, ["diff", "--no-renames", record.startCommit, "HEAD"]);
    return out.length > maxChars ? `${out.slice(0, maxChars)}\n… (diff truncated)` : out;
  },

  /**
   * Write the build's changes into the project. A file is only written if the
   * project's copy is still exactly what the build started from; anything you
   * changed since is reported as a conflict and left as you left it.
   */
  async apply(record: ProjectBuildRecord): Promise<ApplyResult> {
    if (BuildService.isRunning(record.buildId)) throw new Error("The build is still running. Stop it or wait for it to finish first.");
    if (!fs.existsSync(record.projectPath)) throw new Error(`${record.projectPath} no longer exists.`);

    const result: ApplyResult = { applied: [], unchanged: [], conflicts: [] };
    for (const change of await this.changes(record)) {
      const inProject = path.join(record.projectPath, change.path);
      const resolved = path.resolve(inProject);
      if (!resolved.startsWith(path.resolve(record.projectPath) + path.sep)) {
        result.conflicts.push(change.path);
        continue;
      }

      const base = change.change === "added" ? null : await this.fileAt(record, record.startCommit, change.path);
      const next = change.change === "deleted" ? null : readOrNull(path.join(record.workDir, change.path));
      const current = readOrNull(inProject);

      if (sameContent(current, next)) {
        result.unchanged.push(change.path);
      } else if (sameContent(current, base)) {
        if (next === null) {
          fs.rmSync(inProject, { force: true });
        } else {
          fs.mkdirSync(path.dirname(inProject), { recursive: true });
          fs.writeFileSync(inProject, next);
        }
        result.applied.push(change.path);
      } else {
        result.conflicts.push(change.path);
      }
    }

    const updated = { ...record, appliedAt: new Date().toISOString(), lastApply: result };
    saveRecord(updated);
    Logger.log("Project build applied", { buildId: record.buildId, project: record.projectName, ...result });
    return result;
  },

  /**
   * Run the project's checks — install, typecheck, build, tests, lint — on the
   * build's copy, so you know whether the change works before it goes anywhere
   * near the project. Runs in the background; the result lands on the record.
   *
   * Nothing the checks write (node_modules, a refreshed lockfile, build output)
   * can leak into Apply: Apply takes only what the build committed.
   */
  startTest(record: ProjectBuildRecord): TestResult {
    if (BuildService.isRunning(record.buildId)) throw new Error("The build is still running. Test it once it has finished.");
    if (!fs.existsSync(record.workDir)) throw new Error("The build's copy has been cleaned up, so there is nothing to test.");
    if (record.lastTest?.state === "running") return record.lastTest;

    const running: TestResult = { state: "running", startedAt: new Date().toISOString(), finishedAt: null, score: null, passed: false, checks: [] };
    saveRecord({ ...record, lastTest: running });

    void (async () => {
      let result: TestResult;
      try {
        // The project's own tests only: never scaffold a test runner into someone's project.
        const report = await Verifier.verify(new Workspace(record.workDir), { scaffoldTests: false });
        result = {
          state: "done",
          startedAt: running.startedAt,
          finishedAt: new Date().toISOString(),
          score: report.score,
          passed: report.checks.every((check) => !check.applicable || check.passed),
          checks: report.checks.map((check) => ({
            name: check.name,
            applicable: check.applicable,
            passed: check.passed,
            output: check.output.split("\n").slice(-25).join("\n").slice(-4000)
          }))
        };
      } catch (error) {
        result = {
          ...running,
          state: "error",
          finishedAt: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        };
      }
      const latest = this.get(record.buildId);
      if (latest) saveRecord({ ...latest, lastTest: result });
      Logger.log("Project build tested", { buildId: record.buildId, project: record.projectName, score: result.score, passed: result.passed });
    })();

    return running;
  },

  /**
   * Commit the files this build wrote into the project — and only those. Your
   * other edits in the project, staged or not, stay exactly as they were.
   */
  async commitApplied(record: ProjectBuildRecord, message?: string): Promise<NonNullable<ProjectBuildRecord["commit"]>> {
    const files = record.lastApply?.applied ?? [];
    if (files.length === 0) throw new Error("This build has not written anything into the project yet. Apply it first.");
    if (!(await isGitRepo(record.projectPath))) throw new Error(`${record.projectName} is not a git repository, so there is nothing to commit to.`);

    // Only paths that still differ from the last commit; an applied file you
    // have since changed back, or already committed, is simply not included.
    // --no-renames: a rename entry carries a second path, which would parse as a bogus file.
    const pending = (await git(record.projectPath, ["status", "--porcelain", "-z", "--no-renames", "--untracked-files=all", "--", ...files]))
      .split("\0")
      .filter(Boolean)
      .map((entry) => entry.slice(3));
    if (pending.length === 0) throw new Error("Those files are already committed, or match the last commit; there is nothing new to commit.");

    const subject = (message?.trim() || record.instruction).replace(/\s+/g, " ").slice(0, 72);
    const body = `${subject}\n\nMade with Agent Builder (build ${record.buildId}).`;
    try {
      await git(record.projectPath, ["add", "-A", "--", ...pending]);
      // With paths given, git commits only those paths, whatever else is staged.
      await git(record.projectPath, ["commit", "-m", body, "--", ...pending]);
    } catch (error) {
      const detail = gitError(error);
      if (/Please tell me who you are|user\.email|empty ident/i.test(detail)) {
        // No git identity on this PC; commit as Agent Builder rather than fail.
        await git(record.projectPath, ["commit", "-m", body, "--", ...pending], GIT_ENV);
      } else {
        throw new Error(detail);
      }
    }

    const commit = {
      hash: (await git(record.projectPath, ["rev-parse", "HEAD"])).trim(),
      branch: (await git(record.projectPath, ["rev-parse", "--abbrev-ref", "HEAD"])).trim(),
      message: subject,
      files: pending,
      at: new Date().toISOString()
    };
    const latest = this.get(record.buildId) ?? record;
    saveRecord({ ...latest, commit });
    Logger.log("Project build committed", { buildId: record.buildId, project: record.projectName, commit: commit.hash, files: pending.length });
    return commit;
  },

  /** Remember a push against the build it came from, so its card can show it. */
  recordPush(buildId: string, push: PushResult): void {
    const latest = this.get(buildId);
    if (latest) saveRecord({ ...latest, push });
  },

  async fileAt(record: ProjectBuildRecord, commit: string, file: string): Promise<Buffer | null> {
    try {
      const { stdout } = await run("git", ["show", `${commit}:${file}`], {
        cwd: record.workDir,
        windowsHide: true,
        encoding: "buffer",
        maxBuffer: 64 * 1024 * 1024
      });
      return stdout as unknown as Buffer;
    } catch {
      return null;
    }
  }
};
