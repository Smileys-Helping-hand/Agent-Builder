/**
 * ContextPack — everything an agent needs to continue work on a project, in one
 * response.
 *
 * The point is continuity: when a session ends (or runs out of budget), the next
 * agent — Jarvis, another model, a future Claude session — should be able to ask
 * one question and know where things stand, without re-deriving it from the
 * repository.
 *
 * Returns both a JSON object and a markdown briefing; models do better with the
 * prose, tools do better with the fields.
 */
import fs from "fs";
import path from "path";

import { EcosystemStore, type EcosystemIssue, type EcosystemProject } from "./EcosystemStore.js";
import { GitHubClient, repoFromRemote, type GitHubRepoStatus } from "./GitHubClient.js";
import { ProjectScanner } from "./ProjectScanner.js";
import { LessonMemory, type Lesson } from "../learning/LessonMemory.js";
import { ResearchStore } from "../research/ResearchStore.js";

export interface ProjectContext {
  project: EcosystemProject;
  openIssues: EcosystemIssue[];
  github: GitHubRepoStatus | null;
  lessons: Lesson[];
  research: Array<{ title: string; snippet: string }>;
  recentActivity: Array<{ kind: string; message: string; createdAt: string }>;
  suggestedNextSteps: string[];
  markdown: string;
}

const listUncommitted = (projectPath: string): string[] => {
  try {
    const { execFileSync } = require("child_process") as typeof import("child_process");
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd: projectPath,
      encoding: "utf8",
      timeout: 10_000,
      windowsHide: true
    });
    return output.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 40);
  } catch {
    return [];
  }
};

const readProjectNotes = (projectPath: string): string | null => {
  for (const name of ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md"]) {
    const file = path.join(projectPath, name);
    if (fs.existsSync(file)) {
      try {
        return fs.readFileSync(file, "utf8").slice(0, 3000);
      } catch {
        return null;
      }
    }
  }
  return null;
};

/** Concrete things worth doing next, derived from state rather than guessed. */
const nextSteps = (project: EcosystemProject, issues: EcosystemIssue[], github: GitHubRepoStatus | null): string[] => {
  const steps: string[] = [];
  const errors = issues.filter((issue) => issue.severity === "error" && issue.status === "open");
  if (errors.length > 0) {
    steps.push(`Fix ${errors.length} open error(s): ${errors.slice(0, 3).map((issue) => issue.title).join("; ")}`);
  }
  if (project.gitDirty > 0) {
    steps.push(`Review ${project.gitDirty} uncommitted change(s) — decide whether to commit or discard before new work.`);
  }
  if (project.gitAhead > 0) {
    steps.push(`${project.gitAhead} commit(s) are unpushed on ${project.gitBranch ?? "this branch"}.`);
  }
  if (project.gitBehind > 0) {
    steps.push(`${project.gitBehind} commit(s) behind upstream — pull before editing.`);
  }
  if (github?.lastWorkflowConclusion && !["success", "none", null].includes(github.lastWorkflowConclusion)) {
    steps.push(`Latest CI run concluded "${github.lastWorkflowConclusion}" — check the workflow.`);
  }
  if (github && github.openPullRequests.length > 0) {
    steps.push(`${github.openPullRequests.length} open pull request(s) awaiting attention.`);
  }
  if (steps.length === 0) {
    steps.push("No outstanding signals. Verify the project still builds and tests clean before changing anything.");
  }
  return steps;
};

const buildMarkdown = (
  project: EcosystemProject,
  issues: EcosystemIssue[],
  github: GitHubRepoStatus | null,
  lessons: Lesson[],
  research: Array<{ title: string; snippet: string }>,
  uncommitted: string[],
  notes: string | null,
  steps: string[]
): string => {
  const lines: string[] = [];
  lines.push(`# ${project.name}`);
  lines.push("");
  lines.push(project.description ?? project.readmeExcerpt ?? "No description recorded.");
  lines.push("");
  lines.push("## Where it is");
  lines.push(`- Path: \`${project.path}\``);
  lines.push(`- Type: ${project.kind}${project.stack.length ? ` (${project.stack.join(", ")})` : ""}`);
  lines.push(`- Branch: ${project.gitBranch ?? "unknown"}${project.gitRemote ? ` → ${project.gitRemote}` : " (no remote)"}`);
  lines.push(
    `- Git: ${project.gitDirty} uncommitted file(s), ${project.gitAhead} ahead, ${project.gitBehind} behind`
  );
  if (project.lastCommitSubject) {
    lines.push(`- Last commit: ${project.lastCommitSubject} (${project.lastCommitAt ?? "unknown date"})`);
  }
  if (Object.keys(project.scripts).length > 0) {
    lines.push(`- Scripts: ${Object.keys(project.scripts).slice(0, 12).join(", ")}`);
  }

  if (uncommitted.length > 0) {
    lines.push("");
    lines.push("## Uncommitted work");
    for (const entry of uncommitted.slice(0, 20)) lines.push(`- \`${entry}\``);
  }

  if (issues.length > 0) {
    lines.push("");
    lines.push("## Known issues");
    for (const issue of issues.slice(0, 15)) {
      lines.push(`- [${issue.severity}] ${issue.title} (${issue.status}, from ${issue.source})`);
      if (issue.detail) lines.push(`  - ${issue.detail.split("\n")[0].slice(0, 200)}`);
    }
  }

  if (github) {
    lines.push("");
    lines.push(`## GitHub (${github.nameWithOwner})`);
    if (github.error) {
      lines.push(`- Could not read: ${github.error}`);
    } else {
      lines.push(`- Open issues: ${github.openIssues.length}, open PRs: ${github.openPullRequests.length}`);
      if (github.lastWorkflowConclusion) lines.push(`- Latest CI: ${github.lastWorkflowConclusion}`);
      for (const issue of github.openIssues.slice(0, 8)) lines.push(`  - #${issue.number} ${issue.title}`);
    }
  }

  if (lessons.length > 0) {
    lines.push("");
    lines.push("## What earlier builds learned");
    for (const lesson of lessons) lines.push(`- ${lesson.lesson}`);
  }

  if (research.length > 0) {
    lines.push("");
    lines.push("## Related research");
    for (const hit of research) lines.push(`- ${hit.title}: ${hit.snippet.replace(/\s+/g, " ").slice(0, 180)}`);
  }

  if (notes) {
    lines.push("");
    lines.push("## Project notes (CLAUDE.md / AGENTS.md)");
    lines.push(notes.slice(0, 1500));
  }

  lines.push("");
  lines.push("## Suggested next steps");
  for (const step of steps) lines.push(`- ${step}`);

  return lines.join("\n");
};

export const ContextPack = {
  /**
   * Build the briefing for one project. `refresh` rescans it first, so a caller
   * acting on the result is not working from a stale snapshot.
   */
  async forProject(id: string, options: { refresh?: boolean; includeGitHub?: boolean } = {}): Promise<ProjectContext | null> {
    const project = options.refresh ? await ProjectScanner.rescanProject(id) : EcosystemStore.getProject(id);
    if (!project) return null;

    const openIssues = EcosystemStore.listIssues({ projectId: id, limit: 50 }).filter(
      (issue) => issue.status === "open" || issue.status === "fixing"
    );

    let github: GitHubRepoStatus | null = null;
    const nameWithOwner = repoFromRemote(project.gitRemote);
    if (nameWithOwner && options.includeGitHub !== false && (await GitHubClient.isAvailable())) {
      github = await GitHubClient.repoStatus(nameWithOwner);
    }

    const query = [project.name, project.kind, project.stack.join(" ")].join(" ");
    const lessons = LessonMemory.relevant("build", query, 5);
    const research = ResearchStore.search(query, 4).map((hit) => ({ title: hit.title, snippet: hit.snippet }));
    const uncommitted = listUncommitted(project.path);
    const notes = readProjectNotes(project.path);
    const recentActivity = EcosystemStore.listEvents(10, id).map((event) => ({
      kind: event.kind,
      message: event.message,
      createdAt: event.createdAt
    }));
    const suggestedNextSteps = nextSteps(project, openIssues, github);

    return {
      project,
      openIssues,
      github,
      lessons,
      research,
      recentActivity,
      suggestedNextSteps,
      markdown: buildMarkdown(project, openIssues, github, lessons, research, uncommitted, notes, suggestedNextSteps)
    };
  },

  /**
   * A briefing across the whole ecosystem: what exists, what is broken, what was
   * happening most recently. This is the "pick up where we left off" view.
   */
  handoff(): { markdown: string; projects: number; openIssues: number; errors: number } {
    const counts = EcosystemStore.counts();
    const projects = EcosystemStore.listProjects();
    const issues = EcosystemStore.listIssues({ limit: 40 }).filter(
      (issue) => issue.status === "open" || issue.status === "fixing"
    );
    const events = EcosystemStore.listEvents(25);

    const lines: string[] = [];
    lines.push("# Ecosystem handoff");
    lines.push("");
    lines.push(
      `${counts.projects} project(s) registered, ${counts.openIssues} open issue(s) of which ${counts.errors} are errors.`
    );

    const active = projects
      .filter((project) => project.lastCommitAt)
      .slice(0, 12);
    if (active.length > 0) {
      lines.push("");
      lines.push("## Most recently worked on");
      for (const project of active) {
        const dirty = project.gitDirty > 0 ? `, ${project.gitDirty} uncommitted` : "";
        lines.push(
          `- **${project.name}** (${project.kind}) — ${project.gitBranch ?? "?"}${dirty}. Last commit ${project.lastCommitAt}: ${project.lastCommitSubject ?? "n/a"}`
        );
      }
    }

    const dirtyProjects = projects.filter((project) => project.gitDirty > 0);
    if (dirtyProjects.length > 0) {
      lines.push("");
      lines.push("## Projects with uncommitted work");
      for (const project of dirtyProjects.slice(0, 15)) {
        lines.push(`- ${project.name}: ${project.gitDirty} file(s) on ${project.gitBranch ?? "?"}`);
      }
    }

    const unpushed = projects.filter((project) => project.gitAhead > 0);
    if (unpushed.length > 0) {
      lines.push("");
      lines.push("## Unpushed commits");
      for (const project of unpushed.slice(0, 15)) {
        lines.push(`- ${project.name}: ${project.gitAhead} commit(s) ahead of ${project.gitRemote ?? "origin"}`);
      }
    }

    if (issues.length > 0) {
      lines.push("");
      lines.push("## Open issues");
      for (const issue of issues.slice(0, 20)) {
        const project = issue.projectId ? EcosystemStore.getProject(issue.projectId) : null;
        lines.push(`- [${issue.severity}] ${project?.name ?? "ecosystem"}: ${issue.title} (${issue.status})`);
      }
    }

    if (events.length > 0) {
      lines.push("");
      lines.push("## Recent activity");
      for (const event of events.slice(0, 15)) lines.push(`- ${event.createdAt} ${event.kind}: ${event.message}`);
    }

    return { markdown: lines.join("\n"), ...counts };
  }
};
