/**
 * Workspace - a real, git-backed directory for one build's generated files.
 *
 * Every prior build pipeline held generated code in memory and discarded it.
 * This is the fix: a directory on disk, initialized as a git repo, where
 * every write is committed so rollback is `git reset` and diffs are free.
 */
import fs from "fs/promises";
import path from "path";
import { Executor } from "./Executor.js";
import { Logger } from "../utils/Logger.js";

export type WriteFilesResult = {
  writtenPaths: string[];
  skippedPaths: string[];
  committed: boolean;
  commitHash?: string;
};

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Agent Builder",
  GIT_AUTHOR_EMAIL: "agent-builder@local",
  GIT_COMMITTER_NAME: "Agent Builder",
  GIT_COMMITTER_EMAIL: "agent-builder@local"
};

const exists = async (target: string): Promise<boolean> =>
  fs.access(target).then(() => true).catch(() => false);

export class Workspace {
  readonly root: string;
  private initialized = false;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /** Resolve a relative path and reject anything that would escape the workspace root. */
  private resolveSafe(relPath: string): string {
    if (path.isAbsolute(relPath)) {
      throw new Error(`Refusing absolute path outside workspace: ${relPath}`);
    }
    const resolved = path.resolve(this.root, relPath);
    const rootWithSep = this.root.endsWith(path.sep) ? this.root : this.root + path.sep;
    if (resolved !== this.root && !resolved.startsWith(rootWithSep)) {
      throw new Error(`Refusing path that escapes workspace: ${relPath}`);
    }
    return resolved;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.root, { recursive: true });

    const isRepo = await exists(path.join(this.root, ".git"));
    if (!isRepo) {
      const initResult = await Executor.run("git", ["init"], { cwd: this.root });
      if (initResult.exitCode !== 0) {
        throw new Error(`git init failed in ${this.root}: ${initResult.stderr || initResult.stdout}`);
      }

      const gitignorePath = path.join(this.root, ".gitignore");
      if (!(await exists(gitignorePath))) {
        await fs.writeFile(gitignorePath, "node_modules/\ndist/\n.env\n", "utf8");
      }

      await this.commitAll("Initialize workspace");
    }

    this.initialized = true;
  }

  /** Write a batch of relative-path -> content entries and commit them as one iteration. */
  async writeFiles(files: Record<string, string>, message: string): Promise<WriteFilesResult> {
    await this.init();

    const writtenPaths: string[] = [];
    const skippedPaths: string[] = [];

    for (const [relPath, content] of Object.entries(files)) {
      try {
        const absolute = this.resolveSafe(relPath);
        await fs.mkdir(path.dirname(absolute), { recursive: true });
        await fs.writeFile(absolute, content, "utf8");
        writtenPaths.push(relPath);
      } catch (error) {
        Logger.warn(`Workspace: refused to write ${relPath}`, error);
        skippedPaths.push(relPath);
      }
    }

    if (writtenPaths.length === 0) {
      return { writtenPaths, skippedPaths, committed: false };
    }

    const commitHash = await this.commitAll(message);
    return { writtenPaths, skippedPaths, committed: Boolean(commitHash), commitHash };
  }

  async readFile(relPath: string): Promise<string> {
    return fs.readFile(this.resolveSafe(relPath), "utf8");
  }

  /** Commit whatever is currently on disk (e.g. after out-of-band scaffolding writes). */
  async commitCurrentState(message: string): Promise<string | undefined> {
    await this.init();
    return this.commitAll(message);
  }

  async getHead(): Promise<string | undefined> {
    const result = await Executor.run("git", ["rev-parse", "HEAD"], { cwd: this.root });
    return result.exitCode === 0 ? result.stdout.trim() : undefined;
  }

  /** Hard-reset this workspace to a prior commit, discarding anything after it. Scoped to this
   * generated project's own throwaway directory — never the parent Agent-Builder repo. */
  async resetTo(commitHash: string): Promise<void> {
    await Executor.run("git", ["reset", "--hard", commitHash], { cwd: this.root });
    await Executor.run("git", ["clean", "-fd"], { cwd: this.root });
  }

  private async commitAll(message: string): Promise<string | undefined> {
    await Executor.run("git", ["add", "-A"], { cwd: this.root });

    const status = await Executor.run("git", ["status", "--porcelain"], { cwd: this.root });
    if (!status.stdout.trim()) {
      return undefined;
    }

    const commit = await Executor.run("git", ["commit", "-m", message], { cwd: this.root, env: GIT_ENV });
    if (commit.exitCode !== 0) {
      Logger.warn("Workspace: git commit failed", { stderr: commit.stderr });
      return undefined;
    }

    const hash = await Executor.run("git", ["rev-parse", "HEAD"], { cwd: this.root });
    return hash.stdout.trim() || undefined;
  }
}
