/**
 * Jarvis routes — check the connection, test it, and push a note by hand.
 *
 * The builder reports to Jarvis on its own (repairs, issues), so these exist for
 * the moments you want certainty: is it configured, did the last delivery work,
 * and what happens if I send one right now.
 */
import type { Express, Request, Response } from "express";

import { authenticateAgent } from "./agentAuth.js";
import { JarvisClient, type JarvisEventType } from "../integrations/JarvisClient.js";
import { ContextPack } from "../ecosystem/ContextPack.js";
import { Logger } from "../utils/Logger.js";

export const registerJarvisRoutes = (app: Express) => {
  app.get("/api/jarvis/status", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(JarvisClient.describe());
  });

  /** Send a test event and report exactly what came back. */
  app.post("/api/jarvis/test", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const result = await JarvisClient.send({
      type: "test",
      subject: "Agent Builder connection test",
      body:
        "This is a test from Agent Builder. If you are reading it in Jarvis, the two are connected and " +
        "the builder can report builds, repairs and issues here.",
      metadata: { source: "manual-test" }
    });

    // A successful test is a good moment to clear anything that piled up.
    const flushed = result.ok ? await JarvisClient.flush() : { delivered: 0, remaining: 0 };
    res.status(result.ok ? 200 : 502).json({ ...result, flushed, connection: JarvisClient.describe() });
  });

  /** Push an arbitrary note - useful from the app, or from a script. */
  app.post("/api/jarvis/notify", authenticateAgent("write"), async (req: Request, res: Response) => {
    const { subject, body, type, project } = (req.body ?? {}) as {
      subject?: string;
      body?: string;
      type?: JarvisEventType;
      project?: string;
    };
    if (!subject || !body) return res.status(400).json({ error: "Both subject and body are required." });

    const result = await JarvisClient.send({
      type: type ?? "status",
      subject: subject.slice(0, 200),
      body: body.slice(0, 8000),
      project: project ?? null
    });
    res.status(result.ok ? 200 : 502).json(result);
  });

  /** Send the whole-machine briefing, so Jarvis knows where everything stands. */
  app.post("/api/jarvis/handoff", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const handoff = ContextPack.handoff();
    const result = await JarvisClient.send({
      type: "status",
      subject: `Agent Builder handoff: ${handoff.projects} projects, ${handoff.openIssues} open issue(s)`,
      body: handoff.markdown.slice(0, 8000),
      metadata: { projects: handoff.projects, openIssues: handoff.openIssues, errors: handoff.errors }
    });
    res.status(result.ok ? 200 : 502).json(result);
  });

  app.post("/api/jarvis/flush", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    res.json(await JarvisClient.flush());
  });

  Logger.log("Jarvis routes registered", { configured: JarvisClient.isConfigured() });
};
