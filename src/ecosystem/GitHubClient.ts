/**
 * GitHubClient — the remote half of the picture.
 *
 * Uses the `gh` CLI, which is already signed in on this machine, so no token
 * has to be stored in this app. Falls back to the REST API with GITHUB_TOKEN
 * when the CLI is unavailable (a packaged desktop install may not have it).
 *
 * Every call is read-only. Nothing here pushes, merges or closes anything.
 */
import { execFile } from "child_process";
import { promisify } from "util";

const run = promisify(execFile);

export interface GitHubIssue {
  number: number;
  title: string;
  state: string;
  isPullRequest: boolean;
  updatedAt: string;
  url: string;
  labels: string[];
}

export interface GitHubRepoStatus {
  nameWithOwner: string;
  openIssues: GitHubIssue[];
  openPullRequests: GitHubIssue[];
  lastWorkflowConclusion: string | null;
  error?: string;
}

/** owner/repo from a git remote URL, in either ssh or https form. */
export const repoFromRemote = (remote: string | null): string | null => {
  if (!remote) return null;
  const match = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?\/?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
};

const gh = async (args: string[]): Promise<string> => {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(token ? { GITHUB_TOKEN: token, GH_TOKEN: token } : {})
  };
  const { stdout } = await run("gh", args, { timeout: 20_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env });
  return stdout;
};

let cliAvailable: boolean | null = null;

export const GitHubClient = {
  async isAvailable(): Promise<boolean> {
    if (cliAvailable !== null) return cliAvailable;
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (token) {
      cliAvailable = true;
      return true;
    }
    try {
      await gh(["auth", "status"]);
      cliAvailable = true;
    } catch {
      cliAvailable = false;
    }
    return cliAvailable;
  },

  /** Open issues and pull requests for a repo, plus the latest CI conclusion. */
  async repoStatus(nameWithOwner: string): Promise<GitHubRepoStatus> {
    const empty: GitHubRepoStatus = {
      nameWithOwner,
      openIssues: [],
      openPullRequests: [],
      lastWorkflowConclusion: null
    };

    try {
      const raw = await gh([
        "api",
        `repos/${nameWithOwner}/issues?state=open&per_page=20`,
        "--jq",
        "[.[] | {number, title, state, updatedAt: .updated_at, url: .html_url, isPullRequest: (has(\"pull_request\")), labels: [.labels[].name]}]"
      ]);
      const items = JSON.parse(raw || "[]") as GitHubIssue[];
      empty.openIssues = items.filter((item) => !item.isPullRequest);
      empty.openPullRequests = items.filter((item) => item.isPullRequest);
    } catch (error) {
      empty.error = error instanceof Error ? error.message.split("\n")[0] : String(error);
      return empty;
    }

    try {
      const runs = await gh([
        "api",
        `repos/${nameWithOwner}/actions/runs?per_page=1`,
        "--jq",
        ".workflow_runs[0].conclusion // \"none\""
      ]);
      empty.lastWorkflowConclusion = runs.trim().replace(/^"|"$/g, "") || null;
    } catch {
      empty.lastWorkflowConclusion = null;
    }

    return empty;
  },

  /** Every repo the signed-in account can see, for spotting work that has no local clone. */
  async listRepositories(limit = 100): Promise<Array<{ nameWithOwner: string; updatedAt: string; visibility: string }>> {
    try {
      const raw = await gh([
        "repo",
        "list",
        "--limit",
        String(limit),
        "--json",
        "nameWithOwner,updatedAt,visibility"
      ]);
      return JSON.parse(raw || "[]") as Array<{ nameWithOwner: string; updatedAt: string; visibility: string }>;
    } catch {
      return [];
    }
  }
};
