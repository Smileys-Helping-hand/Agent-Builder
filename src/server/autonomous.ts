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

  buildEvents.on("completed", (record: BuildRecord) => {
    void JarvisClient.send({
      type: "build",
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
        starter: body.starter === "web" || body.starter === "none" ? body.starter : "auto",
        // prompt / engine / template; anything else is the Settings choice.
        headStart: typeof body.headStart === "string" && (HEAD_STARTS as readonly string[]).includes(body.headStart) ? (body.headStart as HeadStart) : undefined,
        startedBy: (req as AgentRequest).actor ?? "unknown"
      });

      res.json({ success: true, buildId: record.buildId, message: "Build started.", build: record });
    } catch (error) {
      Logger.error("Failed to start build", { error: errorMessage(error) });
      res.status(500).json({ error: "Failed to start the build.", details: errorMessage(error) });
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
