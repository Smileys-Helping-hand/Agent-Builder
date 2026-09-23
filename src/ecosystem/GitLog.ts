/**
 * GitLog — what was actually committed, and what is still uncommitted.
 *
 * The registry stores only the last commit because a scan touches 60 repos.
 * This reads deeper for a single project, on demand, so a briefing can say what
 * has been happening rather than just when it last happened.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

export interface Commit {
  hash: string;
  subject: string;
  author: string;
  at: string;
  relative: string;
}

export interface WorkingChange {
  status: string;
  path: string;
}

const UNIT = "\u001f";
const RECORD = "\u001e";

const git = async (cwd: string, args: string[]): Promise<string> => {
  try {
    const { stdout } = await run("git", args, { cwd, timeout: 15_000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
    return stdout;
  } catch {
    return "";
  }
};

/** Human-readable status letters, because "AM" means nothing on a phone. */
const describeStatus = (code: string): string => {
  const trimmed = code.trim();
  if (trimmed.startsWith("??")) return "new";
  if (trimmed.startsWith("A")) return "added";
  if (trimmed.startsWith("D")) return "deleted";
  if (trimmed.startsWith("R")) return "renamed";
  if (trimmed.includes("M")) return "modified";
  return trimmed || "changed";
};

export const GitLog = {
  async commits(projectPath: string, limit = 15): Promise<Commit[]> {
    const output = await git(projectPath, [
      "log",
      `-${Math.max(1, Math.min(limit, 100))}`,
      `--format=%h${UNIT}%s${UNIT}%an${UNIT}%cI${UNIT}%cr${RECORD}`
    ]);
    return output
      .split(RECORD)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash, subject, author, at, relative] = entry.split(UNIT);
        return { hash, subject, author, at, relative };
      })
      .filter((commit) => commit.hash && commit.subject);
  },

  async workingChanges(projectPath: string, limit = 40): Promise<WorkingChange[]> {
    const output = await git(projectPath, ["status", "--porcelain"]);
    return output
      .split("\n")
      .map((line) => line.trimEnd())
      .filter(Boolean)
      .slice(0, limit)
      .map((line) => ({ status: describeStatus(line.slice(0, 2)), path: line.slice(3).trim() }));
  },

  /** Commits that exist locally but not on the remote. */
  async unpushed(projectPath: string, limit = 20): Promise<Commit[]> {
    const output = await git(projectPath, [
      "log",
      "@{upstream}..HEAD",
      `-${limit}`,
      `--format=%h${UNIT}%s${UNIT}%an${UNIT}%cI${UNIT}%cr${RECORD}`
    ]);
    return output
      .split(RECORD)
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [hash, subject, author, at, relative] = entry.split(UNIT);
        return { hash, subject, author, at, relative };
      })
      .filter((commit) => commit.hash && commit.subject);
  }
};
