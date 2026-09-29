/**
 * ProjectGit — getting a project's work onto GitHub, and knowing it got there.
 *
 * A plain `git push` answered "done" whether it pushed ten commits, pushed
 * nothing, or never reached GitHub at all. Here a push:
 *
 *   - says beforehand exactly which commits will go, and to which branch;
 *   - never waits on a password prompt (GIT_TERMINAL_PROMPT=0), which would
 *     otherwise hang the request with nobody at the PC to answer it;
 *   - sets the upstream on a branch GitHub has never seen;
 *   - and afterwards asks GitHub what its branch now points at, so "pushed"
 *     means GitHub has this exact commit, not that git exited with 0.
 *
 * checkAccess proves read and push permission with a dry run, changing nothing.
 */
import { execFile } from "child_process";
import { promisify } from "util";

import { JarvisClient } from "../integrations/JarvisClient.js";
import { Logger } from "../utils/Logger.js";
import { EcosystemStore } from "./EcosystemStore.js";

const run = promisify(execFile);

/** Never let git ask for a password: there is nobody at the PC to type it. */
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" };

const git = async (cwd: string, args: string[], timeout = 120_000): Promise<string> => {
  const { stdout } = await run("git", args, { cwd, env: GIT_ENV, windowsHide: true, timeout, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
};

/** git's own words when a command fails, rather than "Command failed: git …". */
export const gitError = (error: unknown): string => {
  const detail = (error as { stderr?: string }).stderr?.trim();
  const message = detail || (error instanceof Error ? error.message : String(error));
  if (/terminal prompts disabled|could not read Username|Authentication failed|403/i.test(message)) {
    return "GitHub refused the sign-in from this PC. Sign in to GitHub on the PC (for example: gh auth login), then try again.";
  }
  if (/non-fast-forward|fetch first|rejected/i.test(message)) {
    return "GitHub has commits this PC does not. Pull first, then push again.";
  }
  return message.split("\n").slice(-4).join(" ").slice(0, 400);
};

export interface PendingCommit {
  hash: string;
  subject: string;
}

export interface PushPlan {
  branch: string;
  remote: string | null;
  remoteUrl: string | null;
  /** Web address of the repository on GitHub, when it is on GitHub. */
  webUrl: string | null;
  /** False when the remote is a folder or another host, so a push would not reach GitHub. */
  isGitHub: boolean;
  hasUpstream: boolean;
  /** What a push would send. */
  commits: PendingCommit[];
  /** Local edits not committed yet; a push does not send these. */
  uncommitted: number;
}

export interface PushResult {
  pushed: boolean;
  /** GitHub now points the branch at the local commit. */
  confirmed: boolean;
  branch: string;
  commit: string | null;
  commits: PendingCommit[];
  commitUrl: string | null;
  message: string;
  at: string;
}

export interface AccessCheck {
  remote: string | null;
  remoteUrl: string | null;
  webUrl: string | null;
  /** False when "the remote" is really a folder or another host — a push would not reach GitHub. */
  isGitHub: boolean;
  branch: string | null;
  canRead: boolean;
  canPush: boolean;
  /** GitHub has commits this PC does not; a push would be refused until you pull. */
  behind: boolean;
  detail: string;
}

/** https://github.com/owner/repo for either remote style, or null if it is not GitHub. */
export const githubWebUrl = (remoteUrl: string | null): string | null => {
  if (!remoteUrl) return null;
  const match = /github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(remoteUrl.trim());
  return match ? `https://github.com/${match[1]}/${match[2]}` : null;
};

/** Credentials sometimes sit in a remote URL; never show or log them. */
const withoutCredentials = (url: string | null): string | null => (url ? url.replace(/\/\/[^@/]+@/, "//") : url);

const currentBranch = async (cwd: string): Promise<string> => {
  const branch = await git(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch === "HEAD") throw new Error("The project is not on a branch (a detached HEAD). Check out a branch first.");
  return branch;
};

const remoteOf = async (cwd: string): Promise<{ name: string | null; url: string | null }> => {
  const names = (await git(cwd, ["remote"])).split("\n").filter(Boolean);
  const name = names.includes("origin") ? "origin" : names[0] ?? null;
  if (!name) return { name: null, url: null };
  return { name, url: withoutCredentials(await git(cwd, ["remote", "get-url", name]).catch(() => "")) || null };
};

const parseCommits = (output: string): PendingCommit[] =>
  output
    .split("\n")
    .filter(Boolean)
    .map((line) => ({ hash: line.slice(0, 40), subject: line.slice(41) }));

export const ProjectGit = {
  /** What a push would do right now, without doing it. */
  async plan(projectPath: string): Promise<PushPlan> {
    const branch = await currentBranch(projectPath);
    const { name, url } = await remoteOf(projectPath);
    const hasUpstream = await git(projectPath, ["rev-parse", "--abbrev-ref", "@{upstream}"]).then(
      () => true,
      () => false
    );

    let commits: PendingCommit[] = [];
    if (hasUpstream) {
      commits = parseCommits(await git(projectPath, ["log", "@{upstream}..HEAD", "--format=%H %s"]));
    } else if (name) {
      // A branch GitHub has never seen: everything not already on any remote branch goes.
      commits = parseCommits(await git(projectPath, ["log", "HEAD", "--not", `--remotes=${name}`, "--format=%H %s", "-n", "50"]));
    }
    const uncommitted = (await git(projectPath, ["status", "--porcelain"])).split("\n").filter(Boolean).length;

    const webUrl = githubWebUrl(url);
    return { branch, remote: name, remoteUrl: url, webUrl, isGitHub: webUrl !== null, hasUpstream, commits, uncommitted };
  },

  /** Push the current branch and confirm GitHub has it. */
  async push(projectId: string, projectPath: string, projectName: string): Promise<PushResult> {
    const plan = await this.plan(projectPath);
    const at = new Date().toISOString();
    if (!plan.remote) throw new Error("This project has no GitHub remote to push to.");

    if (plan.hasUpstream && plan.commits.length === 0) {
      return {
        pushed: false,
        confirmed: true,
        branch: plan.branch,
        commit: await git(projectPath, ["rev-parse", "HEAD"]),
        commits: [],
        commitUrl: null,
        message: `Nothing to push: GitHub already has everything on ${plan.branch}.${
          plan.uncommitted ? ` (${plan.uncommitted} change(s) are not committed yet, so they are not included.)` : ""
        }`,
        at
      };
    }

    const args = plan.hasUpstream ? ["push", plan.remote, plan.branch] : ["push", "-u", plan.remote, plan.branch];
    try {
      await git(projectPath, args, 180_000);
    } catch (error) {
      throw new Error(gitError(error));
    }

    // Ask GitHub, not git's exit code, where the branch is now.
    const local = await git(projectPath, ["rev-parse", "HEAD"]);
    const remoteLine = await git(projectPath, ["ls-remote", plan.remote, `refs/heads/${plan.branch}`], 60_000).catch(() => "");
    const remoteSha = remoteLine.split(/\s+/)[0] ?? "";
    const confirmed = remoteSha === local;
    const commitUrl = plan.webUrl ? `${plan.webUrl}/commit/${local}` : null;

    const summary = `${plan.commits.length} commit(s) to ${plan.branch}`;
    // Only say "GitHub" when it is GitHub; a folder remote gets named as what it is.
    const destination = plan.isGitHub ? "GitHub" : plan.remoteUrl ?? plan.remote;
    const message = confirmed
      ? `Pushed ${summary}. ${destination} now has ${local.slice(0, 7)}.${plan.isGitHub ? "" : " (This remote is not GitHub.)"}`
      : `git reported the push finished, but ${destination}'s ${plan.branch} is at ${remoteSha.slice(0, 7) || "nothing"}, not ${local.slice(0, 7)}. Check the repository.`;

    EcosystemStore.recordEvent(projectId, "push", message);
    Logger.log("Project pushed", { project: projectName, branch: plan.branch, commits: plan.commits.length, confirmed });
    void JarvisClient.send({
      type: "build",
      project: projectName,
      subject: confirmed ? `Pushed ${projectName} to GitHub` : `Push of ${projectName} not confirmed`,
      body: [message, ...plan.commits.slice(0, 10).map((commit) => `- ${commit.hash.slice(0, 7)} ${commit.subject}`), commitUrl ?? ""]
        .filter(Boolean)
        .join("\n"),
      url: commitUrl,
      metadata: { branch: plan.branch, commit: local, confirmed }
    });

    return { pushed: true, confirmed, branch: plan.branch, commit: local, commits: plan.commits, commitUrl, message, at };
  },

  /** Can this PC read from and push to the project's GitHub repository? Changes nothing. */
  async checkAccess(projectPath: string): Promise<AccessCheck> {
    const { name, url } = await remoteOf(projectPath);
    const branch = await currentBranch(projectPath).catch(() => null);
    const webUrl = githubWebUrl(url);
    const base = { remote: name, remoteUrl: url, webUrl, isGitHub: webUrl !== null, branch, behind: false };
    if (!name) return { ...base, canRead: false, canPush: false, detail: "No remote is set up for this project, so there is nowhere to push." };

    // Said up front: a "remote" that is a folder on this PC means Push only
    // copies commits between your own folders and never reaches GitHub.
    const where = webUrl ?? url;
    const notGitHub = webUrl ? "" : ` Note: ${where} is not GitHub, so pushing does not put anything on GitHub.`;

    try {
      await git(projectPath, ["ls-remote", "--heads", name], 60_000);
    } catch (error) {
      return { ...base, canRead: false, canPush: false, detail: gitError(error) + notGitHub };
    }
    if (!branch) return { ...base, canRead: true, canPush: false, detail: `Can read, but the project is not on a branch to push.${notGitHub}` };

    try {
      // A dry run signs in for pushing exactly as a real push does, and sends nothing.
      await git(projectPath, ["push", "--dry-run", name, `HEAD:refs/heads/${branch}`], 90_000);
      return { ...base, canRead: true, canPush: true, detail: `This PC can push to ${where} (${branch}).${notGitHub}` };
    } catch (error) {
      const detail = (error as { stderr?: string }).stderr ?? String(error);
      // Refused for being behind means the sign-in was accepted: pushing works once you pull.
      if (/non-fast-forward|fetch first|\[rejected\]/i.test(detail)) {
        return {
          ...base,
          canRead: true,
          canPush: true,
          behind: true,
          detail: `This PC can push to ${where}, but it has commits this PC does not. Pull first, then push.${notGitHub}`
        };
      }
      return { ...base, canRead: true, canPush: false, detail: gitError(error) + notGitHub };
    }
  }
};
