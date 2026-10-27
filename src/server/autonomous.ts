/**
 * Build control — start a build, watch it, steer it, stop it.
 *
 * Auth is `authenticateAgent` rather than `authenticate` + roles, so one
 * implementation serves three callers: the dashboard (a signed-in user), the
 * remote web app (an agent key over the tunnel or the tailnet), and Jarvis.
 * Starting, steering and stopping need the `execute` scope; watching needs
 * `read`.
 *
 * The bookkeeping itself lives in BuildService — these are only its routes.
 */
import { execFile, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import type { Express, Request, Response } from "express";

import { signLink, verifyLink } from "../utils/SignedLinks.js";

import { BuildService, buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { Packager } from "../orders/Packager.js";
import { HEAD_STARTS, type HeadStart } from "../orchestrator/AutonomousOrchestrator.js";
import { APP_PLATFORMS, AppBuilder, type AppPlatform } from "../orders/AppBuilder.js";
import { SelfHeal } from "../orchestrator/SelfHeal.js";
import { withStorageShim } from "./previews.js";
import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { JarvisClient } from "../integrations/JarvisClient.js";
import { Logger } from "../utils/Logger.js";
import { GameMode } from "../utils/GameMode.js";
import { BlenderStudio } from "../media/BlenderStudio.js";
import { SuperPrompter } from "../media/SuperPrompter.js";
import { AppDeconstructor } from "../orchestrator/AppDeconstructor.js";
import { GameEvolutionStudio } from "../orchestrator/GameEvolutionStudio.js";
import { UnityLevelStudio, type UnityTarget } from "../media/UnityLevelStudio.js";
import { DbKit, dangerousKey, isPlatform } from "../database/DbKit.js";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));
const run = promisify(execFile);

const PROFILES = new Set(["fast", "balanced", "deep"]);
const PLATFORMS = new Set(["web", "desktop", "mobile", "android", "windows", "cli", "api"]);
const MAX_FILE_BYTES = 400 * 1024;
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", ".next", "out", "coverage", ".turbo", ".cache"]);

const clampNumber = (value: unknown, min: number, max: number): number | undefined => {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : undefined;
};

/**
 * The build's own files: what git tracks there, or a bounded walk when git is
 * not available. Never anything outside its folder.
 */
const listBuildFiles = async (root: string): Promise<string[]> => {
  try {
    const { stdout } = await run("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true
    });
    return stdout.split("\n").map((line) => line.trim()).filter(Boolean).sort();
  } catch {
    const files: string[] = [];
    const walk = (dir: string, prefix: string) => {
      if (files.length > 2000) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (!SKIP_DIRECTORIES.has(entry.name)) walk(path.join(dir, entry.name), `${prefix}${entry.name}/`);
        } else {
          files.push(`${prefix}${entry.name}`);
        }
      }
    };
    walk(root, "");
    return files.sort();
  }
};

const insideBuild = (root: string, relative: string): string | null => {
  const resolved = path.resolve(root, relative);
  const withSep = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved.startsWith(withSep) ? resolved : null;
};

/**
 * Tell Jarvis when a build ends. Registered once, here, rather than per build:
 * BuildService emits for every build whatever started it, so an order-driven
 * build is reported exactly like one started from the phone.
 */
let reportingWired = false;
const wireJarvisReporting = (): void => {
  if (reportingWired) return;
  reportingWired = true;

  // Practice builds (the Template Academy) go on his record; yours and customers' are told to you.
  const practice = (record: BuildRecord) => (record.startedBy ?? "").startsWith("academy:");

  buildEvents.on("started", (record: BuildRecord) => {
    // An order's build is announced by the order pipeline already.
    if (record.orderId) return;
    void JarvisClient.send({
      type: "build",
      severity: practice(record) ? "info" : "notice",
      project: record.projectName,
      subject: `Build started: ${record.projectName}`,
      body: [`Agent Builder started building ${record.projectName}.`, `What it was asked for: ${record.description.slice(0, 400)}`, record.orderId ? `This is for order ${record.orderId}.` : ""]
        .filter(Boolean)
        .join("\n"),
      metadata: { buildId: record.buildId, orderId: record.orderId }
    });
  });

  buildEvents.on("completed", (record: BuildRecord) => {
    void JarvisClient.send({
      type: "build",
      severity: practice(record) ? "info" : "notice",
      project: record.projectName,
      subject: `Build finished: ${record.projectName} (quality ${Math.round(record.qualityScore)})`,
      body: [
        `Agent Builder finished building ${record.projectName}.`,
        `What it was asked for: ${record.description}`,
        `Final quality score: ${Math.round(record.qualityScore)}`,
        `Passes: ${record.iterations}`,
        `Output: ${record.outputDir}`,
        record.orderId ? `This was for order ${record.orderId}.` : ""
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { buildId: record.buildId, quality: record.qualityScore, orderId: record.orderId }
    });
  });

  buildEvents.on("failed", (record: BuildRecord) => {
    void JarvisClient.send({
      type: "build",
      severity: practice(record) ? "info" : "warn",
      project: record.projectName,
      subject: `Build failed: ${record.projectName}`,
      body: [
        `Agent Builder could not finish ${record.projectName}.`,
        `What went wrong: ${record.error ?? "no reason was recorded"}`,
        `It got to pass ${record.iterations}.`,
        record.orderId ? `This was for order ${record.orderId}.` : ""
      ]
        .filter(Boolean)
        .join("\n"),
      metadata: { buildId: record.buildId, orderId: record.orderId }
    });
  });
};

export const registerAutonomousRoutes = (app: Express) => {
  wireJarvisReporting();

  /**
   * Start a build.
   * POST /api/autonomous/start
   * Body: { projectName, description, targetPlatforms?, profile?, ... }
   */
  app.post("/api/autonomous/start", authenticateAgent("execute"), (req: Request, res: Response) => {
    if (GameMode.isOn()) return res.status(409).json({ error: "Game mode is on: the graphics card is free for you. Switch it off to build or research again." });
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";

      if (!projectName || !description) {
        return res.status(400).json({ error: "Both projectName and description are required." });
      }

      // Only the settings a person chooses. Never spread the body: workingDir
      // in particular points a build — which runs git reset --hard and
      // git clean in its folder — at a directory, and that is not something a
      // request gets to pick. Carrying on in a folder goes through /continue.
      const platforms = Array.isArray(body.targetPlatforms)
        ? body.targetPlatforms.filter((platform): platform is string => typeof platform === "string" && PLATFORMS.has(platform))
        : [];
      const record = BuildService.start({
        projectName: projectName.slice(0, 120),
        description: description.slice(0, 8000),
        targetPlatforms: platforms.length > 0 ? platforms : undefined,
        profile: typeof body.profile === "string" && PROFILES.has(body.profile) ? (body.profile as "fast" | "balanced" | "deep") : undefined,
        qualityThreshold: clampNumber(body.qualityThreshold, 40, 100),
        maxIterations: clampNumber(body.maxIterations, 1, 200),
        patience: clampNumber(body.patience, 1, 50),
        autoPackaging: body.autoPackaging === false ? false : undefined,
        starter: body.starter === "site" || body.starter === "web" || body.starter === "none" ? body.starter : "auto",
        // The local model this build writes with; unset: the builder's own (BuildService checks the name).
        model: typeof body.model === "string" ? body.model.trim() : undefined,
        // prompt / engine / template; anything else is the Settings choice.
        headStart: typeof body.headStart === "string" && (HEAD_STARTS as readonly string[]).includes(body.headStart) ? (body.headStart as HeadStart) : undefined,
        multiAgent: body.multiAgent === true,
        superPrompt: body.superPrompt === true,
        blender3d: body.blender3d === true,
        database: isPlatform(body.database) ? body.database : undefined,
        startedBy: (req as AgentRequest).actor ?? "unknown"
      });

      res.json({ success: true, buildId: record.buildId, message: "Build started.", build: record });
    } catch (error) {
      Logger.error("Failed to start build", { error: errorMessage(error) });
      res.status(500).json({ error: "Failed to start the build.", details: errorMessage(error) });
    }
  });

  /**
   * Super-Prompt Expansion:
   * Turns a single prompt into an exhaustive 10-point production blueprint.
   * POST /api/autonomous/super-prompt/expand  Body: { prompt, projectName? }
   */
  app.post("/api/autonomous/super-prompt/expand", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
      if (!prompt) return res.status(400).json({ error: "Provide a single prompt to expand." });
      const projectName = typeof req.body?.projectName === "string" ? req.body.projectName.trim() : undefined;
      const blueprint = await SuperPrompter.expand(prompt, projectName);
      res.json({ success: true, blueprint });
    } catch (error) {
      res.status(500).json({ error: "Failed to expand prompt.", details: errorMessage(error) });
    }
  });

  /**
   * Blender Environment Status:
   * Checks if Blender is installed locally and reports its executable path.
   * GET /api/autonomous/blender/status
   */
  app.get("/api/autonomous/blender/status", authenticateAgent("read"), (_req: Request, res: Response) => {
    const status = BlenderStudio.detectBlender();
    res.json({ success: true, ...status });
  });

  /**
   * Plan & Generate Blender 3D Scene:
   * Generates Blender Python script (bpy) and Three.js bridge for any project.
   * POST /api/autonomous/blender/generate  Body: { projectName, description }
   */
  app.post("/api/autonomous/blender/generate", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      const projectName = typeof req.body?.projectName === "string" ? req.body.projectName.trim() : "Project3D";
      const description = typeof req.body?.description === "string" ? req.body.description.trim() : "";
      if (!description) return res.status(400).json({ error: "Provide a project description for 3D asset generation." });
      const plan = await BlenderStudio.plan3DAssets(projectName, description);
      const pythonScript = BlenderStudio.generateBlenderPythonScript(plan);
      const threeBridge = BlenderStudio.generateThreeJsBridge(plan);
      res.json({ success: true, plan, pythonScript, threeBridge });
    } catch (error) {
      res.status(500).json({ error: "Failed to generate Blender assets.", details: errorMessage(error) });
    }
  });

  /**
   * Super-Build:
   * Starts a full multi-agent build from a single prompt with SuperPrompter,
   * Code Engine, Visual/Animation Agent, Blender 3D assets, and SoundCraft.
   * POST /api/autonomous/super-build  Body: { prompt, projectName? }
   */
  app.post("/api/autonomous/super-build", authenticateAgent("execute"), async (req: Request, res: Response) => {
    if (GameMode.isOn()) return res.status(409).json({ error: "Game mode is on. Switch it off to build." });
    try {
      const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
      if (!prompt) return res.status(400).json({ error: "Provide a prompt for the super-build." });
      // The blueprint is expanded inside the build (SuperModelSynthesizer), where
      // a local model can take the minutes it needs; expanding here held this
      // request open past the app's timeout.
      const named = typeof req.body?.projectName === "string" ? req.body.projectName.trim() : "";
      const projectName =
        named ||
        prompt.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 5).join("-") ||
        "super-build";
      const record = BuildService.start({
        projectName,
        description: prompt,
        profile: "balanced",
        qualityThreshold: 90,
        maxIterations: 25,
        starter: "web",
        multiAgent: true,
        superPrompt: true,
        blender3d: SuperPrompter.is3DRequested(prompt) || SuperPrompter.detectKind(prompt) === "game",
        startedBy: (req as AgentRequest).actor ?? "super-build"
      });
      res.json({
        success: true,
        buildId: record.buildId,
        message: `Super-build started for ${projectName}`,
        build: record
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to start super-build.", details: errorMessage(error) });
    }
  });

  /**
   * Codebase Deconstruction & Feature Dissection:
   * Tears down any existing codebase to understand architecture, state, and generate a rebuild blueprint.
   * POST /api/autonomous/deconstruct  Body: { projectPath }
   */
  app.post("/api/autonomous/deconstruct", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      const projectPath = typeof req.body?.projectPath === "string" ? req.body.projectPath.trim() : "";
      if (!projectPath) return res.status(400).json({ error: "Provide projectPath to deconstruct." });
      const report = await AppDeconstructor.deconstruct(projectPath);
      res.json({ success: true, report });
    } catch (error) {
      res.status(500).json({ error: "Failed to deconstruct codebase.", details: errorMessage(error) });
    }
  });

  /**
   * Codebase Rebuild & Modernization:
   * Deconstructs an app and rebuilds it with clean modern patterns, tests, and optional 3D/audio.
   * POST /api/autonomous/rebuild  Body: { projectPath, projectName?, elevate3D? }
   */
  app.post("/api/autonomous/rebuild", authenticateAgent("execute"), async (req: Request, res: Response) => {
    if (GameMode.isOn()) return res.status(409).json({ error: "Game mode is on. Switch it off to build." });
    try {
      const projectPath = typeof req.body?.projectPath === "string" ? req.body.projectPath.trim() : "";
      if (!projectPath) return res.status(400).json({ error: "Provide projectPath to rebuild." });
      const report = await AppDeconstructor.deconstruct(projectPath);
      const projectName = typeof req.body?.projectName === "string" && req.body.projectName.trim()
        ? req.body.projectName.trim()
        : `${report.projectName}-reborn`;
      const elevate3D = req.body?.elevate3D === true;

      const fullDescription = [
        `Elevated, modernized clean rebuild of ${report.projectName}.`,
        `Original architecture: ${report.framework}. Total files analyzed: ${report.totalFiles}.`,
        `Detected flaws to permanently fix: ${report.flawsDetected.slice(0, 5).join("; ") || "None"}.`,
        `Key feature requirements to deliver without stubs:`,
        ...report.features.map(f => `- ${f.name} (${f.category}): ${f.description}`),
        `Target Modern Stack: ${report.rebuildBlueprint.modernizedStack}.`,
        elevate3D ? "Include dynamic 3D spatial models and Three.js visualization scene." : ""
      ].filter(Boolean).join("\n\n");

      const record = BuildService.start({
        projectName,
        description: fullDescription,
        profile: "deep",
        qualityThreshold: 92,
        maxIterations: 30,
        starter: "web",
        multiAgent: true,
        superPrompt: true,
        blender3d: elevate3D,
        startedBy: (req as AgentRequest).actor ?? "app-rebuild"
      });

      res.json({
        success: true,
        buildId: record.buildId,
        message: `Rebuild started for ${projectName}`,
        report,
        build: record
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to initiate rebuild.", details: errorMessage(error) });
    }
  });

  /**
   * Gamemaker / KingdomForge External Status:
   * Checks connection and Unity bridge status for E:\Projects\Gamemaker.
   * GET /api/autonomous/gamemaker/status
   */
  app.get("/api/autonomous/gamemaker/status", authenticateAgent("read"), (_req: Request, res: Response) => {
    const status = GameEvolutionStudio.checkGamemakerStatus();
    res.json({ success: true, ...status });
  });

  /**
   * Game Studio: List all managed games, live versions, and background evolutions.
   * GET /api/autonomous/games
   */
  app.get("/api/autonomous/games", authenticateAgent("read"), (_req: Request, res: Response) => {
    const games = GameEvolutionStudio.listAllGames();
    res.json({ success: true, count: games.length, games });
  });

  /**
   * Game Studio Checkup:
   * Grades story/plot, mechanics variety, visual/audio polish, and suggests evolution plan.
   * POST /api/autonomous/games/checkup  Body: { gameDir, gameName? }
   */
  app.post("/api/autonomous/games/checkup", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      const gameDir = typeof req.body?.gameDir === "string" ? req.body.gameDir.trim() : "";
      if (!gameDir) return res.status(400).json({ error: "Provide gameDir to run checkup." });
      const gameName = typeof req.body?.gameName === "string" ? req.body.gameName.trim() : undefined;
      const scorecard = await GameEvolutionStudio.runGameCheckup(gameDir, gameName);
      // Only a judged scorecard becomes the game's rating; a counted one is shown, not kept.
      const gameId = typeof req.body?.gameId === "string" ? req.body.gameId.trim() : "";
      if (gameId && scorecard.assessedBy === "model") GameEvolutionStudio.recordCheckup(gameId, scorecard);
      res.json({ success: true, scorecard });
    } catch (error) {
      res.status(500).json({ error: "Failed to run game checkup.", details: errorMessage(error) });
    }
  });

  /**
   * Databases for built apps (DbKit): the platforms on offer.
   * GET /api/databases/platforms
   */
  app.get("/api/databases/platforms", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ platforms: DbKit.platforms() });
  });

  /**
   * A build's database: the platform it is set up for and which keys are in (never their values).
   * GET /api/autonomous/:buildId/database
   */
  app.get("/api/autonomous/:buildId/database", authenticateAgent("read"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    res.json({ state: DbKit.state(build.outputDir), platforms: DbKit.platforms() });
  });

  /**
   * Choose the platform and paste its keys: adds the data layer if the build has none, writes
   * .env.local on this PC, and rebuilds the site so the preview uses them. Empty boxes keep what is saved.
   * POST /api/autonomous/:buildId/database  Body: { platform, values?: { [field]: string }, rebuild?: boolean }
   */
  app.post("/api/autonomous/:buildId/database", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    const platform = req.body?.platform;
    if (!isPlatform(platform)) return res.status(400).json({ error: "Pick a platform: local, supabase, firebase, pocketbase, appwrite or rest." });
    if (BuildService.isRunning(build.buildId)) return res.status(409).json({ error: "The build is running; set the database when this pass is done." });
    const raw = req.body?.values && typeof req.body.values === "object" ? (req.body.values as Record<string, unknown>) : {};
    const values = Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
    try {
      const before = DbKit.state(build.outputDir);
      if (!before.installed || before.platform !== platform) DbKit.install(build.outputDir, platform);
      const state = DbKit.writeKeys(build.outputDir, platform, values, { keepExisting: true });
      const rebuilt = req.body?.rebuild === false ? null : await DbKit.rebuild(build.outputDir);
      res.json({
        state,
        rebuilt,
        note: before.installed
          ? undefined
          : "The data layer was added. Continue the build with \"keep all data in src/lib/db\" so the app uses it."
      });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  /**
   * Test keys against the platform from this PC: the boxes' values, or the saved ones when the boxes are empty.
   * POST /api/autonomous/:buildId/database/test  Body: { platform, values? }
   */
  app.post("/api/autonomous/:buildId/database/test", authenticateAgent("write"), async (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    const platform = req.body?.platform;
    if (!isPlatform(platform)) return res.status(400).json({ error: "Pick a platform." });
    const saved = DbKit.savedValues(build.outputDir, platform);
    const given = req.body?.values && typeof req.body.values === "object" ? (req.body.values as Record<string, string>) : {};
    const values = Object.fromEntries(Object.keys(saved).map((key) => [key, String(given[key] ?? "").trim() || saved[key]]));
    for (const [key, value] of Object.entries(values)) {
      const danger = value ? dangerousKey(platform, key, value) : null;
      if (danger) return res.json({ ok: false, detail: danger });
    }
    res.json(await DbKit.test(platform, values));
  });

  /**
   * Unity Level Studio: what is installed (Unity editor, Blender) and the level project.
   * GET /api/autonomous/unity/status
   */
  app.get("/api/autonomous/unity/status", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ success: true, ...UnityLevelStudio.status(), recipes: UnityLevelStudio.recipes() });
  });

  /**
   * Unity Level Studio: design and build a full playable Unity level from a prompt.
   * Runs in the background (minutes); poll the job.
   * POST /api/autonomous/unity/levels  Body: { prompt, target?: "none" | "windows" | "webgl" }
   */
  app.post("/api/autonomous/unity/levels", authenticateAgent("execute"), (req: Request, res: Response) => {
    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (!prompt) return res.status(400).json({ error: "Describe the level to build." });
    const target: UnityTarget = ["windows", "webgl"].includes(req.body?.target) ? req.body.target : "none";
    const job = UnityLevelStudio.start(prompt, {
      target,
      onDone: (done) => {
        if (done.status !== "done" || !done.plan) return;
        // The finished level joins the Game Studio list.
        GameEvolutionStudio.registerGame({
          gameId: `unity-${done.plan.name}`,
          name: done.plan.title,
          engine: "unity",
          liveVersion: "1.0.0",
          liveOutputDir: done.project,
          previewImage: done.previews.find((p) => p.endsWith("preview-player.png")) ?? done.previews[0]
        });
      }
    });
    res.json({ success: true, job });
  });

  /** GET /api/autonomous/unity/levels — recent level jobs. */
  app.get("/api/autonomous/unity/levels", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ success: true, jobs: UnityLevelStudio.listJobs() });
  });

  /** GET /api/autonomous/unity/levels/:id — one job, with its steps. */
  app.get("/api/autonomous/unity/levels/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const job = UnityLevelStudio.getJob(req.params.id);
    if (!job) return res.status(404).json({ error: "Unknown level job." });
    res.json({ success: true, job });
  });

  /** GET /api/autonomous/unity/levels/:id/preview/:index — a preview image the job rendered. */
  app.get("/api/autonomous/unity/levels/:id/preview/:index", authenticateAgent("read"), (req: Request, res: Response) => {
    const job = UnityLevelStudio.getJob(req.params.id);
    const file = job?.previews[Number(req.params.index)];
    if (!file || !file.endsWith(".png") || !fs.existsSync(file)) return res.status(404).json({ error: "No such preview." });
    res.sendFile(path.resolve(file));
  });

  /**
   * Game Studio: Promote staged evolution to live on SaveState.
   * POST /api/autonomous/games/promote  Body: { gameId }
   */
  app.post("/api/autonomous/games/promote", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      const gameId = typeof req.body?.gameId === "string" ? req.body.gameId.trim() : "";
      if (!gameId) return res.status(400).json({ error: "Provide gameId to promote." });
      const result = GameEvolutionStudio.promoteStagedToLive(gameId);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: "Failed to promote game.", details: errorMessage(error) });
    }
  });

  /**
   * Auto-Confirm All Findings & Dispatch Repair:
   * Acknowledges audit problems and runtime errors, and immediately dispatches a fix pass.
   * POST /api/autonomous/:buildId/findings/auto-confirm
   */
  app.post("/api/autonomous/:buildId/findings/auto-confirm", authenticateAgent("execute"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });

    const audit = build.audit;
    const findings = (audit?.findings ?? []).filter((f) => f.severity !== "info");
    const runtime = audit?.runtime ?? [];
    const lines: string[] = [];

    if (audit?.blocker) {
      lines.push(`Fix this blocker check: ${audit.blocker.name}\n${audit.blocker.output.slice(-800)}`);
    }
    if (runtime.length) {
      lines.push(`Fix these runtime errors detected in browser preview:\n${runtime.slice(0, 10).map((e) => `- ${e.message}${e.page ? ` (on ${e.page})` : ""}`).join("\n")}`);
    }
    if (findings.length) {
      lines.push(`Fix these site audit problems:\n${findings.slice(0, 15).map((f) => `- ${f.message}${f.file ? ` [${f.file}]` : ""}`).join("\n")}`);
    }

    const instruction = lines.join("\n\n") || "Perform comprehensive polish, eliminate all console warnings, and verify end-to-end functionality.";
    const actor = (req as AgentRequest).actor ?? "auto-confirm";

    if (BuildService.isRunning(build.buildId)) {
      const note = BuildService.guide(build.buildId, instruction, actor);
      return res.json({
        success: true,
        action: "guided",
        message: "Build is active: automatically confirmed all findings and applied repair guidance to next pass.",
        instruction,
        note
      });
    } else {
      try {
        const record = BuildService.continue(build.buildId, {
          instruction,
          profile: "balanced",
          startedBy: actor
        });
        return res.json({
          success: true,
          action: "continued",
          message: "Automatically confirmed all findings and dispatched repair pass.",
          instruction,
          buildId: record.buildId,
          build: record
        });
      } catch (err) {
        return res.status(400).json({ error: errorMessage(err) });
      }
    }
  });

  /**
   * Give a running build a further instruction — the "actually, also do X"
   * route. The note joins the next repair or pass and stays in every prompt after it.
   * POST /api/autonomous/:buildId/guidance  Body: { text }
   */
  app.post("/api/autonomous/:buildId/guidance", authenticateAgent("execute"), (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Provide the instruction as { text }." });
    if (text.length > 2000) return res.status(400).json({ error: "Keep an instruction under 2000 characters." });

    const note = BuildService.guide(req.params.buildId, text, (req as AgentRequest).actor ?? "user");
    if (!note) return res.status(404).json({ error: "That build is not running, so there is nothing to steer." });

    res.json({
      success: true,
      note,
      appliesFrom: "the next repair or pass",
      guidance: BuildService.guidance(req.params.buildId)
    });
  });

  const control = (action: "pause" | "resume" | "stop") => (req: Request, res: Response) => {
    if (!BuildService.control(req.params.buildId, action)) {
      return res.status(404).json({ error: "Build not found, or it already finished." });
    }
    res.json({ success: true, buildId: req.params.buildId, state: action });
  };

  app.post("/api/autonomous/:buildId/pause", authenticateAgent("execute"), control("pause"));
  app.post("/api/autonomous/:buildId/resume", authenticateAgent("execute"), control("resume"));
  app.post("/api/autonomous/:buildId/stop", authenticateAgent("execute"), control("stop"));

  app.get("/api/autonomous/:buildId/status", authenticateAgent("read"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    res.json(build);
  });

  /**
   * Download what a build has made, packaged like an order's (see Packager):
   * "Open the website.html" to double-click, the source, and how to open both.
   * The link is signed for this one build and an hour, so the key never goes
   * into a URL a browser tab, proxy or tunnel would log.
   */
  app.post("/api/autonomous/:buildId/download-link", authenticateAgent("read"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    const token = signLink("build-download", build.buildId, 60 * 60 * 1000);
    res.json({ path: `/api/autonomous/${encodeURIComponent(build.buildId)}/download?t=${encodeURIComponent(token)}`, expiresInMinutes: 60 });
  });

  app.get(
    "/api/autonomous/:buildId/download",
    (req: Request, res: Response, next) => {
      if (!verifyLink("build-download", req.params.buildId, req.query.t)) return authenticateAgent("read")(req, res, next);
      next();
    },
    async (req: Request, res: Response) => {
      const build = BuildService.view(req.params.buildId);
      if (!build) return res.status(404).json({ error: "Unknown build." });
      if (!build.outputDir || !fs.existsSync(build.outputDir)) return res.status(409).json({ error: "This build's folder is gone, so there is nothing to download." });
      try {
        const pkg = await Packager.packageBuild(path.resolve(build.outputDir), build.projectName, build.buildId);
        res.download(pkg.zipPath, pkg.fileName);
      } catch (error) {
        res.status(500).json({ error: `Could not package it: ${error instanceof Error ? error.message : String(error)}` });
      }
    }
  );

  /**
   * The build as an app: an Android APK or a Windows program, made from its
   * built site (see AppBuilder). Making one takes from seconds to a few
   * minutes, longer than a request through the tunnel may wait, so: start it,
   * poll its status, then fetch it through a signed link like the zip.
   */
  const appPlatform = (value: unknown): AppPlatform | null => (APP_PLATFORMS.includes(value as AppPlatform) ? (value as AppPlatform) : null);
  const appView = (job: ReturnType<typeof AppBuilder.status>) =>
    job ? { platform: job.platform, state: job.state, stage: job.stage, fileName: job.fileName, error: job.error, startedAt: job.startedAt, finishedAt: job.finishedAt } : { state: "none" };

  app.post("/api/autonomous/:buildId/app", authenticateAgent("execute"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    const platform = appPlatform(req.body?.platform);
    if (!platform) return res.status(400).json({ error: `Say which app: ${APP_PLATFORMS.join(" or ")}.` });
    if (!build.outputDir || !fs.existsSync(build.outputDir)) return res.status(409).json({ error: "This build's folder is gone, so there is nothing to make an app from." });
    res.json(appView(AppBuilder.start(build.buildId, platform, path.resolve(build.outputDir), build.projectName)));
  });

  app.get("/api/autonomous/:buildId/app/:platform", authenticateAgent("read"), (req: Request, res: Response) => {
    const platform = appPlatform(req.params.platform);
    if (!platform) return res.status(400).json({ error: `Unknown app type: ${APP_PLATFORMS.join(" or ")}.` });
    res.json(appView(AppBuilder.status(req.params.buildId, platform)));
  });

  app.post("/api/autonomous/:buildId/app/:platform/link", authenticateAgent("read"), (req: Request, res: Response) => {
    const platform = appPlatform(req.params.platform);
    const job = platform ? AppBuilder.status(req.params.buildId, platform) : null;
    if (!platform || !job || job.state !== "ready") return res.status(409).json({ error: "That app is not ready yet.", ...appView(job) });
    const token = signLink(`app-download-${platform}`, req.params.buildId, 60 * 60 * 1000);
    res.json({ path: `/api/autonomous/${encodeURIComponent(req.params.buildId)}/app/${platform}/download?t=${encodeURIComponent(token)}`, fileName: job.fileName, expiresInMinutes: 60 });
  });

  app.get(
    "/api/autonomous/:buildId/app/:platform/download",
    (req: Request, res: Response, next) => {
      if (!verifyLink(`app-download-${req.params.platform}`, req.params.buildId, req.query.t)) return authenticateAgent("read")(req, res, next);
      next();
    },
    (req: Request, res: Response) => {
      const platform = appPlatform(req.params.platform);
      const job = platform ? AppBuilder.status(req.params.buildId, platform) : null;
      if (!job || job.state !== "ready" || !job.file || !fs.existsSync(job.file)) return res.status(404).json({ error: "That app is not ready." });
      res.download(job.file, job.fileName ?? path.basename(job.file));
    }
  );

  app.get("/api/autonomous/:buildId/iterations", authenticateAgent("read"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    res.json({ buildId: build.buildId, totalIterations: build.iterationDetail.length, iterations: build.iterationDetail });
  });

  /**
   * Carry on from a finished, stopped or interrupted build: a new build in the
   * same folder, starting from the code it left.
   * POST /api/autonomous/:buildId/continue  Body: { instruction?, profile? }
   */
  app.post("/api/autonomous/:buildId/continue", authenticateAgent("execute"), (req: Request, res: Response) => {
    const instruction = typeof req.body?.instruction === "string" ? req.body.instruction.trim().slice(0, 4000) : "";
    const profile = typeof req.body?.profile === "string" && PROFILES.has(req.body.profile) ? req.body.profile : undefined;
    try {
      const record = BuildService.continue(req.params.buildId, {
        instruction,
        profile,
        startedBy: (req as AgentRequest).actor ?? "user"
      });
      res.json({ success: true, buildId: record.buildId, build: record, message: "Carrying on from where it got to." });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  /** Take a finished build off the list. Its folder is left alone. */
  app.delete("/api/autonomous/:buildId", authenticateAgent("execute"), (req: Request, res: Response) => {
    if (BuildService.isRunning(req.params.buildId)) {
      return res.status(409).json({ error: "Stop the build before removing it." });
    }
    if (!BuildService.forget(req.params.buildId)) return res.status(404).json({ error: "Unknown build." });
    res.json({ success: true });
  });

  /** The files the build has produced so far. */
  app.get("/api/autonomous/:buildId/files", authenticateAgent("read"), async (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    if (!build.outputDir || !fs.existsSync(build.outputDir)) {
      return res.json({ outputDir: build.outputDir, exists: false, files: [] });
    }
    const files = await listBuildFiles(build.outputDir);
    res.json({ outputDir: build.outputDir, exists: true, files: files.slice(0, 1500), total: files.length });
  });

  /** One file from the build, to read on the phone. */
  app.get("/api/autonomous/:buildId/file", authenticateAgent("read"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    const relative = typeof req.query.path === "string" ? req.query.path : "";
    const target = relative ? insideBuild(path.resolve(build.outputDir), relative) : null;
    if (!target || target.split(path.sep).includes(".git")) return res.status(400).json({ error: "That path is not in this build." });
    try {
      const stat = fs.statSync(target);
      if (!stat.isFile()) return res.status(400).json({ error: "Not a file." });
      if (stat.size > MAX_FILE_BYTES) {
        return res.json({ path: relative, size: stat.size, truncated: true, content: fs.readFileSync(target, "utf8").slice(0, MAX_FILE_BYTES) });
      }
      res.json({ path: relative, size: stat.size, truncated: false, content: fs.readFileSync(target, "utf8") });
    } catch {
      res.status(404).json({ error: "That file is not there." });
    }
  });

  /** Open the build's folder on the PC, in the editor or the file explorer. */
  app.post("/api/autonomous/:buildId/open", authenticateAgent("execute"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    if (!build.outputDir || !fs.existsSync(build.outputDir)) return res.status(404).json({ error: "Its folder is gone." });
    const target = req.body?.target === "folder" ? "folder" : "editor";
    try {
      if (process.platform === "win32") {
        if (target === "folder") spawn("explorer.exe", [build.outputDir], { detached: true, stdio: "ignore" }).unref();
        else spawn("cmd.exe", ["/c", "code", build.outputDir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
      } else {
        const opener = target === "folder" ? (process.platform === "darwin" ? "open" : "xdg-open") : "code";
        spawn(opener, [build.outputDir], { detached: true, stdio: "ignore" }).unref();
      }
      res.json({ success: true, message: `Opened ${build.projectName} ${target === "folder" ? "in the file explorer" : "in VS Code"} on the PC.` });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** Builds that ended short of working are carried on while the PC is idle: see SelfHeal. */
  SelfHeal.start();
  app.get("/api/autonomous/self-heal", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(SelfHeal.status());
  });
  app.post("/api/autonomous/self-heal/now", authenticateAgent("execute"), (_req: Request, res: Response) => {
    if (GameMode.isOn()) return res.status(409).json({ error: "Game mode is on." });
    const buildId = SelfHeal.tick();
    res.json({ started: buildId, message: buildId ? "Carrying on the latest build that ended below its bar." : "Nothing to retry right now (a build is running, or every project is working or already retried on this version)." });
  });

  app.get("/api/autonomous/active", authenticateAgent("read"), (_req: Request, res: Response) => {
    const builds = BuildService.active();
    res.json({ count: builds.length, builds });
  });

  /** Everything, newest first, including builds that have finished. */
  app.get("/api/autonomous/builds", authenticateAgent("read"), (_req: Request, res: Response) => {
    const builds = BuildService.list().map((build) => BuildService.summary(build));
    res.json({ count: builds.length, active: BuildService.active().length, builds });
  });

  /**
   * A link to look at what a build has made so far, for an <iframe>: the
   * latest successful build of it (dist/), refreshed every time a pass builds.
   * The link carries a signature for this one build instead of the key.
   */
  app.post("/api/autonomous/:buildId/preview-link", authenticateAgent("read"), (req: Request, res: Response) => {
    const view = BuildService.view(req.params.buildId);
    if (!view) return res.status(404).json({ error: "Unknown build." });
    const index = path.resolve(view.outputDir, "dist", "index.html");
    const available = fs.existsSync(index);
    const token = signLink("preview", view.buildId, 6 * 60 * 60 * 1000);
    res.json({
      available,
      builtAt: available ? fs.statSync(index).mtime.toISOString() : null,
      path: `/api/preview/${encodeURIComponent(token)}/${encodeURIComponent(view.buildId)}/`
    });
  });

  /**
   * Serve a build's dist/ for its preview. The token is in the path, not the
   * query, so the page's own relative links (./assets/…) carry it too.
   */
  app.get("/api/preview/:token/:buildId/*", (req: Request, res: Response) => {
    const { token, buildId } = req.params;
    if (!verifyLink("preview", buildId, token)) return res.status(403).send("This preview link has expired. Open the preview again from the app.");
    const view = BuildService.view(buildId);
    if (!view) return res.status(404).send("Unknown build.");

    const dist = path.resolve(view.outputDir, "dist");
    const wanted = (req.params as unknown as Record<string, string>)[0] || "index.html";
    let file = path.resolve(dist, wanted);
    if (file !== dist && !file.startsWith(dist + path.sep)) return res.status(400).send("Outside the build.");
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) {
      return res
        .status(404)
        .type("html")
        .send("<p style='font:15px system-ui;padding:24px;color:#555'>Nothing built yet. The preview appears after the first pass builds successfully.</p>");
    }

    // The generated site runs sandboxed: its own opaque origin, so it can
    // never call this API or read anything that belongs to it.
    res.setHeader("Content-Security-Policy", "sandbox allow-scripts allow-forms allow-popups allow-modals");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "no-store");
    // Sandboxed, localStorage throws on first touch, and apps that save
    // crash before drawing: pages get storage of their own first.
    if (/\.html?$/i.test(file)) return res.type("html").send(withStorageShim(fs.readFileSync(file, "utf8")));
    res.sendFile(file);
  });

  app.get("/api/autonomous/hardware", authenticateAgent("read"), async (_req: Request, res: Response) => {
    try {
      const { HardwareScaler } = await import("../utils/HardwareScaler.js");
      const scaler = new HardwareScaler();
      res.json({
        specs: scaler.specs,
        utilization: await scaler.getUtilization(),
        recommendations: {
          model: scaler.specs.recommendedModelSize,
          tokens: scaler.getOptimalTokens(),
          delay: scaler.getOptimalDelay(),
          batchSize: scaler.getOptimalBatchSize()
        }
      });
    } catch (error) {
      Logger.error("Failed to get hardware info", { error: errorMessage(error) });
      res.status(500).json({ error: "Failed to read hardware info.", details: errorMessage(error) });
    }
  });

  Logger.log("Build control routes registered");
};
