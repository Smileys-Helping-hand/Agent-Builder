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
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import type { Express, Request, Response } from "express";

const execFileAsync = promisify(execFile);

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { ContextPack } from "../ecosystem/ContextPack.js";
import { EcosystemLoop } from "../ecosystem/EcosystemLoop.js";
import { EcosystemStore, type IssueSeverity, type IssueStatus } from "../ecosystem/EcosystemStore.js";
import { AiSessions } from "../ecosystem/AiSessions.js";
import { JarvisClient } from "../integrations/JarvisClient.js";
import { GitHubClient } from "../ecosystem/GitHubClient.js";
import { GitLog } from "../ecosystem/GitLog.js";
import { ProjectBuilds } from "../ecosystem/ProjectBuilds.js";
import { ProjectDoctor } from "../ecosystem/ProjectDoctor.js";
import { ProjectGit } from "../ecosystem/ProjectGit.js";
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

  /** Update/edit a source file inside the project. */
  app.put("/api/ecosystem/projects/:id/file", authenticateAgent("write"), (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const { path: relative, content } = (req.body ?? {}) as { path?: string; content?: string };
    if (!relative || typeof content !== "string") {
      return res.status(400).json({ error: "Provide path and string content." });
    }
    if (relative.split(/[\\/]/).some((segment) => HIDDEN_SEGMENTS.has(segment))) {
      return res.status(403).json({ error: "That directory is restricted." });
    }
    const resolved = resolveInsideProject(project.path, relative);
    if (!resolved) return res.status(400).json({ error: "Path is outside the project." });

    try {
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      fs.writeFileSync(resolved, content, "utf8");
      EcosystemStore.recordEvent(project.id, "edit", `File ${relative} updated via agent dashboard`);
      res.json({ success: true, project: project.id, path: relative, size: Buffer.byteLength(content, "utf8") });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/ecosystem/projects/:id/git/commit", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const { message } = (req.body ?? {}) as { message?: string };
    if (!message || message.trim().length < 2) {
      return res.status(400).json({ error: "Commit message required." });
    }

    try {
      await execFileAsync("git", ["add", "-A"], { cwd: project.path, windowsHide: true });
      const { stdout } = await execFileAsync("git", ["commit", "-m", message.trim()], { cwd: project.path, windowsHide: true });
      EcosystemStore.recordEvent(project.id, "commit", `Committed: ${message.trim()}`);
      res.json({ success: true, message: stdout.trim() });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  app.post("/api/ecosystem/projects/:id/git/sync", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const { action } = (req.body ?? {}) as { action?: "push" | "pull" };

    // A push goes through ProjectGit, which confirms with GitHub that it landed.
    if (action === "push") {
      try {
        const result = await ProjectGit.push(project.id, project.path, project.name);
        void ProjectScanner.rescanProject(project.id);
        return res.json({ success: true, ...result });
      } catch (error) {
        return res.status(502).json({ error: errorMessage(error) });
      }
    }

    try {
      const { stdout } = await execFileAsync("git", ["pull"], {
        cwd: project.path,
        windowsHide: true,
        timeout: 180_000,
        // Never wait on a password prompt: nobody is at the PC to answer it.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" }
      });
      const summary = stdout.trim() || "Already up to date.";
      EcosystemStore.recordEvent(project.id, "pull", `Pulled from GitHub: ${summary.split("\n").slice(-1)[0]}`);
      res.json({ success: true, message: summary });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /**
   * Carry on with a project: build what the instruction asks for on a copy of
   * it (see ProjectBuilds), so nothing in the project changes until you apply.
   */
  app.post("/api/ecosystem/projects/:id/instruct", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const { instruction, profile } = (req.body ?? {}) as { instruction?: string; profile?: "fast" | "balanced" | "deep" };
    if (!instruction || instruction.trim().length < 3) {
      return res.status(400).json({ error: "Instruction required." });
    }

    try {
      const record = await ProjectBuilds.start(project, instruction.trim(), {
        startedBy: (req as AgentRequest).actor ?? "remote-user",
        profile
      });
      EcosystemStore.recordEvent(project.id, "build", `Carrying on: ${instruction.trim()}`);
      res.json({
        success: true,
        buildId: record.buildId,
        workDir: record.workDir,
        message: "Working on a copy of the project. Nothing in the project changes until you apply the result."
      });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** The carry-on builds for one project, newest first, with where each one is. */
  app.get("/api/ecosystem/projects/:id/builds", authenticateAgent("read"), async (req: Request, res: Response) => {
    const { BuildService } = await import("../orchestrator/BuildService.js");
    const builds = await Promise.all(
      ProjectBuilds.list(req.params.id)
        .slice(0, 20)
        .map(async (record) => {
          const view = BuildService.view(record.buildId);
          return {
            ...record,
            state: view?.state ?? record.finalState ?? "ended",
            qualityScore: view?.qualityScore ?? record.finalQuality ?? null,
            iterations: view?.iterations ?? null,
            changes: await ProjectBuilds.changes(record).catch(() => [])
          };
        })
    );
    res.json({ builds });
  });

  /** Exactly what a carry-on build changed, as a diff. */
  app.get("/api/ecosystem/project-builds/:buildId/diff", authenticateAgent("read"), async (req: Request, res: Response) => {
    const record = ProjectBuilds.get(req.params.buildId);
    if (!record) return res.status(404).json({ error: "Unknown build." });
    try {
      res.json({ changes: await ProjectBuilds.changes(record), diff: await ProjectBuilds.diff(record) });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** What a push would send right now — the commits and the branch — without sending it. */
  app.get("/api/ecosystem/projects/:id/git/plan", authenticateAgent("read"), async (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    try {
      res.json(await ProjectGit.plan(project.path));
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  /** Can this PC read from and push to the project's GitHub repository? A dry run; changes nothing. */
  app.post("/api/ecosystem/projects/:id/git/check", authenticateAgent("read"), async (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    try {
      res.json(await ProjectGit.checkAccess(project.path));
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  /** Run the project's checks on a build's copy, before applying it. Poll the builds list for the result. */
  app.post("/api/ecosystem/project-builds/:buildId/test", authenticateAgent("execute"), (req: Request, res: Response) => {
    const record = ProjectBuilds.get(req.params.buildId);
    if (!record) return res.status(404).json({ error: "Unknown build." });
    try {
      res.status(202).json({ test: ProjectBuilds.startTest(record) });
    } catch (error) {
      res.status(409).json({ error: errorMessage(error) });
    }
  });

  /**
   * Commit only the files a build applied, and push if asked. The push is
   * confirmed with GitHub before it is reported as done.
   */
  app.post("/api/ecosystem/project-builds/:buildId/commit", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const record = ProjectBuilds.get(req.params.buildId);
    if (!record) return res.status(404).json({ error: "Unknown build." });
    const { message, push } = (req.body ?? {}) as { message?: string; push?: boolean };
    try {
      const commit = await ProjectBuilds.commitApplied(record, message);
      EcosystemStore.recordEvent(record.projectId, "commit", `Committed ${commit.files.length} file(s) from a build: ${commit.message} (${commit.hash.slice(0, 7)})`);
      let pushed = null;
      if (push) {
        pushed = await ProjectGit.push(record.projectId, record.projectPath, record.projectName);
        ProjectBuilds.recordPush(record.buildId, pushed);
      }
      void ProjectScanner.rescanProject(record.projectId);
      res.json({ success: true, commit, push: pushed });
    } catch (error) {
      res.status(409).json({ error: errorMessage(error) });
    }
  });

  /** Push the project after committing a build's changes, and remember it on the build. */
  app.post("/api/ecosystem/project-builds/:buildId/push", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const record = ProjectBuilds.get(req.params.buildId);
    if (!record) return res.status(404).json({ error: "Unknown build." });
    try {
      const pushed = await ProjectGit.push(record.projectId, record.projectPath, record.projectName);
      ProjectBuilds.recordPush(record.buildId, pushed);
      void ProjectScanner.rescanProject(record.projectId);
      res.json({ success: true, ...pushed });
    } catch (error) {
      res.status(502).json({ error: errorMessage(error) });
    }
  });

  /** Write a finished carry-on build's changes into the project. */
  app.post("/api/ecosystem/project-builds/:buildId/apply", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const record = ProjectBuilds.get(req.params.buildId);
    if (!record) return res.status(404).json({ error: "Unknown build." });
    try {
      const result = await ProjectBuilds.apply(record);
      EcosystemStore.recordEvent(
        record.projectId,
        "build",
        `Applied build ${record.buildId}: ${result.applied.length} file(s) changed${result.conflicts.length ? `, ${result.conflicts.length} left alone because they were edited since` : ""}`
      );
      void ProjectScanner.rescanProject(record.projectId);
      res.json({ success: true, ...result });
    } catch (error) {
      res.status(409).json({ error: errorMessage(error) });
    }
  });

  /**
   * Clone a repository into the workspace, register it, and optionally start
   * carrying on with it straight away.
   */
  app.post("/api/ecosystem/projects/clone", authenticateAgent("write"), async (req: Request, res: Response) => {
    const { url, name, root, instruction } = (req.body ?? {}) as {
      url?: string;
      name?: string;
      root?: string;
      instruction?: string;
    };
    const repoUrl = (url ?? "").trim();
    // https or ssh remotes only: no local paths, no ext:: or file:// transports.
    if (!/^(https:\/\/[\w.-]+\/[\w./-]+?|git@[\w.-]+:[\w./-]+?)(\.git)?\/?$/.test(repoUrl)) {
      return res.status(400).json({ error: "Give a repository address like https://github.com/owner/repo." });
    }
    const derived = repoUrl.replace(/\/$/, "").split(/[/:]/).pop()!.replace(/\.git$/, "");
    const folder = (name?.trim() || derived).replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/^[.-]+/, "");
    if (!folder) return res.status(400).json({ error: "Could not work out a folder name; give one." });

    const roots = projectRoots();
    const targetRoot = root && roots.includes(root) ? root : roots.find((entry) => /projects/i.test(entry)) ?? roots[0];
    if (!targetRoot) return res.status(500).json({ error: "No project folder is configured (ECOSYSTEM_ROOTS)." });
    const targetDir = path.join(targetRoot, folder);
    if (fs.existsSync(targetDir)) {
      return res.status(409).json({ error: `${targetDir} already exists. Pick another name, or open that project.` });
    }

    try {
      await execFileAsync("git", ["clone", "--", repoUrl, targetDir], {
        windowsHide: true,
        timeout: 10 * 60 * 1000,
        // Never sit waiting for a password prompt nobody can see.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
      });
    } catch (error) {
      fs.rmSync(targetDir, { recursive: true, force: true });
      const detail = errorMessage(error);
      const hint = /Authentication|could not read Username|403|not found/i.test(detail)
        ? " If it is private, sign in to GitHub on this PC once (for example with `gh auth login`), then try again."
        : "";
      return res.status(502).json({ error: `Clone failed.${hint}`, details: detail.slice(-1500) });
    }

    try {
      const project = await ProjectScanner.addProject(targetDir, targetRoot);
      EcosystemStore.recordEvent(project.id, "clone", `Cloned ${repoUrl}`);
      let build: { buildId: string } | null = null;
      if (instruction && instruction.trim().length >= 3) {
        build = await ProjectBuilds.start(project, instruction.trim(), { startedBy: (req as AgentRequest).actor ?? "remote-user" });
        EcosystemStore.recordEvent(project.id, "build", `Carrying on: ${instruction.trim()}`);
      }
      res.status(201).json({
        success: true,
        project,
        buildId: build?.buildId ?? null,
        message: build ? `Cloned ${project.name} and started on it.` : `Cloned ${project.name} into ${targetDir}.`
      });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** Create a brand-new project in the workspace. */
  app.post("/api/ecosystem/projects/create", authenticateAgent("write"), async (req: Request, res: Response) => {
    const { name, description, root, template } = (req.body ?? {}) as {
      name?: string;
      description?: string;
      root?: string;
      template?: string;
    };
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Project name is required." });
    }
    const cleanName = name.trim().replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-");
    const targetRoot = root && fs.existsSync(root) ? root : "E:/Projects";
    const targetDir = path.join(targetRoot, cleanName);

    if (fs.existsSync(targetDir)) {
      return res.status(400).json({ error: `Directory ${targetDir} already exists.` });
    }

    try {
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(
        path.join(targetDir, "README.md"),
        `# ${cleanName}\n\n${description || "Created with Agent Builder."}\n`,
        "utf8"
      );
      if (template === "python") {
        fs.writeFileSync(path.join(targetDir, "main.py"), `print("Hello from ${cleanName}")\n`, "utf8");
        fs.writeFileSync(path.join(targetDir, "requirements.txt"), "", "utf8");
      } else {
        const pkg = {
          name: cleanName.toLowerCase(),
          version: "0.1.0",
          private: true,
          description: description || cleanName,
          scripts: { dev: "node index.js", start: "node index.js" }
        };
        fs.writeFileSync(path.join(targetDir, "package.json"), JSON.stringify(pkg, null, 2), "utf8");
        fs.writeFileSync(path.join(targetDir, "index.js"), `console.log("Welcome to ${cleanName}!");\n`, "utf8");
      }
      fs.writeFileSync(path.join(targetDir, ".gitignore"), "node_modules\n.env\ndist\n.DS_Store\n", "utf8");

      try {
        await execFileAsync("git", ["init"], { cwd: targetDir, windowsHide: true });
      } catch {}

      void EcosystemLoop.sweepNow();

      res.status(201).json({
        success: true,
        path: targetDir,
        name: cleanName,
        message: `Project ${cleanName} created at ${targetDir}`
      });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** Open project in code editor or explorer on the PC. */
  app.post("/api/ecosystem/projects/:id/open", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const { target } = (req.body ?? {}) as { target?: "editor" | "folder" };

    try {
      if (target === "folder") {
        spawn("explorer.exe", [project.path], { detached: true, stdio: "ignore" }).unref();
      } else {
        spawn("cmd.exe", ["/c", "code", project.path], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      }
      res.json({ success: true, message: `Opened ${project.name} on PC.` });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** Open workspace or folders directly on the PC. */
  app.post("/api/ecosystem/workspace/open", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const { target } = (req.body ?? {}) as { target?: string };
    try {
      if (target === "vscode") {
        spawn("cmd.exe", ["/c", "code", process.cwd()], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        return res.json({ success: true, message: "Opened Agent Builder in VS Code on PC." });
      } else if (target === "projects") {
        spawn("explorer.exe", ["E:\\Projects"], { detached: true, stdio: "ignore" }).unref();
        return res.json({ success: true, message: "Opened E:\\Projects folder on PC." });
      } else if (target === "ts") {
        spawn("explorer.exe", ["H:\\ts"], { detached: true, stdio: "ignore" }).unref();
        return res.json({ success: true, message: "Opened H:\\ts folder on PC." });
      } else if (target === "comfy") {
        const bin = "C:\\Program Files\\Comfy Desktop\\Comfy Desktop.exe";
        if (fs.existsSync(bin)) {
          spawn(bin, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
          return res.json({ success: true, message: "Launched Comfy Desktop on PC." });
        }
        return res.status(404).json({ error: "Comfy Desktop executable not found." });
      }
      return res.status(400).json({ error: "Unknown workspace target." });
    } catch (error) {
      return res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** What was committed here, and what is still uncommitted. */
  app.get("/api/ecosystem/projects/:id/commits", authenticateAgent("read"), async (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const limit = Math.min(Number(req.query.limit) || 15, 100);
    try {
      const [commits, changes, unpushed] = await Promise.all([
        GitLog.commits(project.path, limit),
        GitLog.workingChanges(project.path),
        GitLog.unpushed(project.path)
      ]);
      res.json({ project: project.id, commits, workingChanges: changes, unpushed });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** What Claude and Gemini have been doing - everywhere, or in one project. */
  app.get("/api/ecosystem/ai-sessions", authenticateAgent("read"), (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 30, 120);
    const projectId = typeof req.query.project === "string" ? req.query.project : null;
    const sessions = projectId ? AiSessions.forProject(projectId, limit) : AiSessions.recent(limit);
    res.json({ sessions, available: AiSessions.available() });
  });

  /**
   * One timeline of everything that has happened lately: commits, assistant
   * sessions and the builder's own activity, newest first. This is the "carry
   * on where I left off" view.
   */
  app.get("/api/ecosystem/continue", authenticateAgent("read"), async (_req: Request, res: Response) => {
    try {
      const projects = EcosystemStore.listProjects();
      const recentProjects = projects
        .filter((project) => project.lastCommitAt)
        .sort((a, b) => (a.lastCommitAt! < b.lastCommitAt! ? 1 : -1))
        .slice(0, 6);

      const commitGroups = await Promise.all(
        recentProjects.map(async (project) => ({
          project,
          commits: await GitLog.commits(project.path, 3)
        }))
      );

      const timeline = [
        ...commitGroups.flatMap((group) =>
          group.commits.map((commit) => ({
            kind: "commit" as const,
            at: commit.at,
            projectId: group.project.id,
            projectName: group.project.name,
            title: commit.subject,
            detail: `${commit.hash} · ${commit.author}`
          }))
        ),
        ...AiSessions.recent(12).map((session) => ({
          kind: session.source,
          at: session.updatedAt,
          projectId: session.projectId,
          projectName: session.projectId ? EcosystemStore.getProject(session.projectId)?.name ?? null : null,
          title: session.title,
          detail: session.summary
        })),
        // Routine sweeps ("Scanned 62 projects") happen every half hour and
        // would crowd out the things you actually did.
        ...EcosystemStore.listEvents(30)
          .filter((event) => event.kind !== "scan")
          .slice(0, 8)
          .map((event) => ({
            kind: "builder" as const,
            at: event.createdAt,
            projectId: event.projectId,
            projectName: event.projectId ? EcosystemStore.getProject(event.projectId)?.name ?? null : null,
            title: event.message,
            detail: event.kind
          }))
      ]
        .filter((entry) => entry.at)
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 40);

      res.json({ timeline, unfinished: projects.filter((p) => p.gitDirty > 0 || p.gitAhead > 0).slice(0, 10) });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
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
    // Skip issues Jarvis reported himself; he does not need them echoed back.
    if (request.agent?.name !== "jarvis") {
      void JarvisClient.send({
        type: "issue",
        project: projectId ?? null,
        subject: `[${issue.severity}] ${issue.title}`,
        body: issue.detail ?? "No detail was given.",
        metadata: { issueId: issue.id, source: issue.source }
      });
    }
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
