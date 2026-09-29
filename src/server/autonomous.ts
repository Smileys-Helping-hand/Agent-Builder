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
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";

import { signLink, verifyLink } from "../utils/SignedLinks.js";

import { BuildService, buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { JarvisClient } from "../integrations/JarvisClient.js";
import { Logger } from "../utils/Logger.js";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const projectName = typeof body.projectName === "string" ? body.projectName.trim() : "";
      const description = typeof body.description === "string" ? body.description.trim() : "";

      if (!projectName || !description) {
        return res.status(400).json({ error: "Both projectName and description are required." });
      }

      const record = BuildService.start({
        ...body,
        projectName,
        description,
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
   * route. The note joins the prompt from the next pass onward and stays in it.
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
      appliesFrom: "the next pass",
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

  app.get("/api/autonomous/:buildId/iterations", authenticateAgent("read"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    res.json({ buildId: build.buildId, totalIterations: build.iterationDetail.length, iterations: build.iterationDetail });
  });

  app.get("/api/autonomous/active", authenticateAgent("read"), (_req: Request, res: Response) => {
    const builds = BuildService.active();
    res.json({ count: builds.length, builds });
  });

  /** Everything, newest first, including builds that have finished. */
  app.get("/api/autonomous/builds", authenticateAgent("read"), (_req: Request, res: Response) => {
    const builds = BuildService.list();
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
