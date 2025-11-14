import type { Express, Request, Response } from "express";
import { CollaborationHub } from "../orchestrator/CollaborationHub.js";
import { CollaborationServer } from "../orchestrator/CollaborationServer.js";

const hub = CollaborationHub.getInstance();

export const registerCollaborationRoutes = (app: Express) => {
  CollaborationServer.getInstance().start();

  app.post("/api/collab/create", (req: Request, res: Response) => {
    const { room } = req.body as { room?: "default" | "sandbox" | "team" };
    const snapshot = hub.createSession(room);
    res.status(201).json({ snapshot });
  });

  app.post("/api/collab/join", (req: Request, res: Response) => {
    const { sessionId, participant } = req.body as {
      sessionId: string;
      participant: { id: string; name: string; role: "Builder" | "UX" | "QA" | "Ops" };
    };

    if (!sessionId || !participant?.id) {
      return res.status(400).json({ error: "sessionId and participant are required" });
    }

    const session = hub.joinSession(sessionId, { ...participant });
    res.json({ session });
  });

  app.get("/api/collab/snapshot", (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string | undefined;
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }

    const snapshot = hub.snapshot(sessionId);
    if (!snapshot) {
      return res.status(404).json({ error: "Session not found" });
    }

    res.json({ snapshot });
  });

  app.get("/api/collab/list", (_req: Request, res: Response) => {
    const sessions = hub.listSessions();
    res.json({ sessions });
  });

  app.post("/api/collab/context", (req: Request, res: Response) => {
    const { sessionId, context } = req.body as { sessionId?: string; context?: Record<string, unknown> };
    if (!sessionId) {
      return res.status(400).json({ error: "sessionId is required" });
    }
    const merged = hub.setSessionContext(sessionId, {
      summary: typeof context?.summary === "string" ? context.summary : undefined,
      repos: Array.isArray(context?.repos) ? (context?.repos as string[]) : undefined,
      activeAgents: Array.isArray(context?.activeAgents) ? (context?.activeAgents as string[]) : undefined,
      lastCommand: typeof context?.lastCommand === "string" ? context.lastCommand : undefined
    });
    res.json({ context: merged });
  });
};
