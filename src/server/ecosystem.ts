/**
 * Ecosystem API — how Jarvis (or any agent) sees this machine and acts on it.
 *
 * Read routes hand out project state, source files and briefings; write routes
 * accept reported problems; execute routes run checks and attempt repairs.
 * Every route requires an agent key with the matching scope, or a signed-in
 * user with a role that allows it (see agentAuth.ts).
 *
 * The server binds 127.0.0.1 by default, and these routes expose source code,
 * so keep it that way unless you have a reason not to.
 */
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { ContextPack } from "../ecosystem/ContextPack.js";
import { EcosystemLoop } from "../ecosystem/EcosystemLoop.js";
import { EcosystemStore, type IssueSeverity, type IssueStatus } from "../ecosystem/EcosystemStore.js";
import { GitHubClient } from "../ecosystem/GitHubClient.js";
import { ProjectDoctor } from "../ecosystem/ProjectDoctor.js";
import { ProjectScanner, projectRoots } from "../ecosystem/ProjectScanner.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { Logger } from "../utils/Logger.js";

const MAX_FILE_BYTES = 400_000;
const HIDDEN_SEGMENTS = new Set([".git", "node_modules", ".next", "dist", "build", "target", ".venv"]);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * Resolve a path inside a project, refusing anything that escapes it.
 * Symlinks are resolved first, so a link pointing outside cannot be followed.
 */
const resolveInsideProject = (projectPath: string, relative: string): string | null => {
  const base = fs.realpathSync.native(projectPath).replace(/\\/g, "/");
  const target = path.resolve(projectPath, relative);
  let resolved: string;
  try {
    resolved = fs.realpathSync.native(target).replace(/\\/g, "/");
  } catch {
    resolved = target.replace(/\\/g, "/"); // Not yet existing is fine; containment still checked.
  }
  if (resolved !== base && !resolved.startsWith(`${base}/`)) return null;
  return resolved;
};

export const registerEcosystemRoutes = (app: Express) => {
  EcosystemLoop.start();

  app.get("/api/ecosystem/status", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ ...EcosystemLoop.status(), roots: projectRoots() });
  });

  app.post("/api/ecosystem/scan", authenticateAgent("write"), async (_req: Request, res: Response) => {
    try {
      const result = await ProjectScanner.scanAll();
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  app.get("/api/ecosystem/projects", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ projects: EcosystemStore.listProjects() });
  });

  app.get("/api/ecosystem/projects/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const issues = EcosystemStore.listIssues({ projectId: project.id, limit: 50 });
    res.json({ project, issues, events: EcosystemStore.listEvents(20, project.id) });
  });

  /** The briefing: one call that tells an agent everything about a project. */
  app.get("/api/ecosystem/projects/:id/context", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      const context = await ContextPack.forProject(req.params.id, {
        refresh: req.query.refresh !== "0",
        includeGitHub: req.query.github !== "0"
      });
      if (!context) return res.status(404).json({ error: "Unknown project." });
      if (req.query.format === "markdown") {
        res.type("text/markdown").send(context.markdown);
        return;
      }
      res.json(context);
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** The whole-machine version: what is in flight everywhere. */
  app.get("/api/ecosystem/handoff", authenticateAgent("read"), (req: Request, res: Response) => {
    const handoff = ContextPack.handoff();
    if (req.query.format === "markdown") {
      res.type("text/markdown").send(handoff.markdown);
      return;
    }
    res.json(handoff);
  });

  app.get("/api/ecosystem/search", authenticateAgent("read"), (req: Request, res: Response) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!query) return res.status(400).json({ error: "Provide a search query with ?q=" });
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    res.json({ query, hits: ResearchStore.search(query, limit) });
  });

  /** Directory listing inside a project. */
  app.get("/api/ecosystem/projects/:id/tree", authenticateAgent("read"), (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const relative = typeof req.query.path === "string" ? req.query.path : ".";
    const resolved = resolveInsideProject(project.path, relative);
    if (!resolved) return res.status(400).json({ error: "Path is outside the project." });
    try {
      const entries = fs.readdirSync(resolved, { withFileTypes: true })
        .filter((entry) => !HIDDEN_SEGMENTS.has(entry.name))
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
          path: path.posix.join(relative === "." ? "" : relative, entry.name)
        }));
      res.json({ project: project.id, path: relative, entries });
    } catch (error) {
      res.status(404).json({ error: errorMessage(error) });
    }
  });

  /** Read one source file. This is the "see the code" capability. */
  app.get("/api/ecosystem/projects/:id/file", authenticateAgent("read"), (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const relative = typeof req.query.path === "string" ? req.query.path : "";
    if (!relative) return res.status(400).json({ error: "Provide ?path=relative/file.ts" });
    if (relative.split(/[\\/]/).some((segment) => HIDDEN_SEGMENTS.has(segment))) {
      return res.status(403).json({ error: "That directory is not served." });
    }
    const resolved = resolveInsideProject(project.path, relative);
    if (!resolved) return res.status(400).json({ error: "Path is outside the project." });
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile()) return res.status(400).json({ error: "Not a file." });
      if (stat.size > MAX_FILE_BYTES) {
        return res.status(413).json({ error: `File is ${stat.size} bytes; limit is ${MAX_FILE_BYTES}.` });
      }
      res.json({ project: project.id, path: relative, size: stat.size, content: fs.readFileSync(resolved, "utf8") });
    } catch (error) {
      res.status(404).json({ error: errorMessage(error) });
    }
  });

  app.get("/api/ecosystem/issues", authenticateAgent("read"), (req: Request, res: Response) => {
    const status = typeof req.query.status === "string" ? (req.query.status as IssueStatus) : undefined;
    const projectId = typeof req.query.project === "string" ? req.query.project : undefined;
    res.json({ issues: EcosystemStore.listIssues({ status, projectId, limit: Math.min(Number(req.query.limit) || 100, 200) }) });
  });

  /** Jarvis reports a problem it noticed. */
  app.post("/api/ecosystem/issues", authenticateAgent("write"), (req: Request, res: Response) => {
    const request = req as AgentRequest;
    const { project, title, detail, severity, signature } = (req.body ?? {}) as {
      project?: string;
      title?: string;
      detail?: string;
      severity?: IssueSeverity;
      signature?: string;
    };
    if (!title || title.trim().length < 3) {
      return res.status(400).json({ error: "An issue needs a title of at least 3 characters." });
    }
    const projectId = project && EcosystemStore.getProject(project) ? project : null;
    if (project && !projectId) return res.status(404).json({ error: `Unknown project "${project}".` });

    const issue = EcosystemStore.recordIssue({
      projectId,
      source: request.agent ? "jarvis" : "user",
      severity: severity && ["info", "warning", "error"].includes(severity) ? severity : "error",
      title: title.trim().slice(0, 300),
      detail: detail?.slice(0, 8000) ?? null,
      signature
    });
    EcosystemStore.recordEvent(projectId, "issue", `${request.actor ?? "someone"} reported: ${issue.title}`);
    Logger.log("Ecosystem issue reported", { actor: request.actor, project: projectId, title: issue.title });
    res.status(201).json({ issue });
  });

  app.patch("/api/ecosystem/issues/:id", authenticateAgent("write"), (req: Request, res: Response) => {
    const { status, resolution } = (req.body ?? {}) as { status?: IssueStatus; resolution?: string };
    if (status && !["open", "fixing", "resolved", "dismissed"].includes(status)) {
      return res.status(400).json({ error: "Invalid status." });
    }
    const issue = EcosystemStore.updateIssue(Number(req.params.id), { status, resolution });
    if (!issue) return res.status(404).json({ error: "Unknown issue." });
    res.json({ issue });
  });

  /** Run the project's own checks and record what fails. */
  app.post("/api/ecosystem/projects/:id/diagnose", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      const result = await ProjectDoctor.diagnose(req.params.id);
      if (!result) return res.status(404).json({ error: "Unknown project." });
      res.json({ score: result.report.score, passed: result.report.passed, issues: result.issues, checks: result.report.checks });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** Attempt a fix on a branch, keeping it only if the verified score improves. */
  app.post("/api/ecosystem/projects/:id/repair", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const { maxAttempts, force, issueId } = (req.body ?? {}) as { maxAttempts?: number; force?: boolean; issueId?: number };
    try {
      if (issueId) EcosystemStore.updateIssue(issueId, { status: "fixing" });
      const outcome = await ProjectDoctor.repair(req.params.id, { maxAttempts, force });
      if (issueId) {
        EcosystemStore.updateIssue(issueId, {
          status: outcome.passed ? "resolved" : "open",
          resolution: outcome.passed
            ? `Repaired on ${outcome.branch}; score ${outcome.startScore} → ${outcome.finalScore}.`
            : (outcome.reason ?? `Attempted ${outcome.attempts} time(s); score ${outcome.startScore} → ${outcome.finalScore}.`)
        });
      }
      res.json(outcome);
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  app.get("/api/ecosystem/github/repos", authenticateAgent("read"), async (_req: Request, res: Response) => {
    if (!(await GitHubClient.isAvailable())) {
      return res.status(503).json({ error: "GitHub is not reachable: install the gh CLI and sign in, or set GITHUB_TOKEN." });
    }
    res.json({ repositories: await GitHubClient.listRepositories() });
  });

  Logger.log("Ecosystem routes registered", { roots: projectRoots() });
};
