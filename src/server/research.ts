import type { Express, Request, Response } from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { authenticateAgent } from "./agentAuth.js";
import { ResearchEngine } from "../research/ResearchEngine.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { LessonMemory, type LessonScope } from "../learning/LessonMemory.js";
import { SecondBrainClient } from "../integrations/SecondBrainClient.js";
import { Logger } from "../utils/Logger.js";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const registerResearchRoutes = (app: Express) => {
  const engine = ResearchEngine.getInstance();

  const seeded = LessonMemory.seed();
  SecondBrainClient.startSyncLoop();
  const resumed = engine.resumeAll();

  app.get("/api/research/topics", authenticateAgent("read"), (_req: Request, res: Response) => {
    const topics = ResearchStore.listTopics().map((topic) => ({
      ...topic,
      cycleRunning: engine.isCycleRunning(topic.id),
      generatingDocuments: engine.isGeneratingDocuments(topic.id)
    }));
    res.json({ topics });
  });

  app.post(
    "/api/research/topics",
    authenticateAgent("write"),
    (req: Request, res: Response) => {
      const { title, question } = (req.body ?? {}) as { title?: unknown; question?: unknown };
      const cleanTitle = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
      const cleanQuestion =
        typeof question === "string" && question.trim() ? question.replace(/\s+/g, " ").trim() : cleanTitle;

      if (cleanTitle.length < 3 || cleanTitle.length > 160) {
        return res.status(400).json({ error: "Give the topic a title between 3 and 160 characters." });
      }
      if (cleanQuestion.length < 3 || cleanQuestion.length > 1000) {
        return res.status(400).json({ error: "The research question must be between 3 and 1000 characters." });
      }

      const topic = engine.start(cleanTitle, cleanQuestion);
      return res.status(201).json({ topic: ResearchStore.getTopicSummary(topic.id) });
    }
  );

  app.get("/api/research/topics/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const topic = ResearchStore.getTopicSummary(req.params.id);
    if (!topic) return res.status(404).json({ error: "Research topic not found." });
    return res.json({
      topic: { ...topic, cycleRunning: engine.isCycleRunning(topic.id), generatingDocuments: engine.isGeneratingDocuments(topic.id) },
      findings: ResearchStore.listFindings(topic.id, 100, "recent"),
      openQuestions: ResearchStore.listQuestions(topic.id, 40, "open"),
      exploredQuestions: ResearchStore.listQuestions(topic.id, 40, "explored"),
      sources: ResearchStore.listSources(topic.id, 60),
      documents: ResearchStore.latestDocuments(topic.id).map(({ markdown: _markdown, ...meta }) => meta),
      activity: ResearchStore.recentActivity(topic.id, 80)
    });
  });

  const actions: Array<["pause" | "resume" | "stop", (id: string) => unknown]> = [
    ["pause", (id) => engine.pause(id)],
    ["resume", (id) => engine.resume(id)],
    ["stop", (id) => engine.stop(id)]
  ];
  for (const [action, run] of actions) {
    app.post(
      `/api/research/topics/:id/${action}`,
      authenticateAgent("write"),
      (req: Request, res: Response) => {
        if (!run(req.params.id)) return res.status(404).json({ error: "Research topic not found." });
        return res.json({ topic: ResearchStore.getTopicSummary(req.params.id) });
      }
    );
  }

  app.delete(
    "/api/research/topics/:id",
    authenticate,
    authorizeRoles(["developer", "admin", "owner"]),
    (req: Request, res: Response) => {
      if (!engine.remove(req.params.id)) return res.status(404).json({ error: "Research topic not found." });
      return res.json({ ok: true });
    }
  );

  app.post(
    "/api/research/topics/:id/documents/regenerate",
    authenticate,
    authorizeRoles(["developer", "admin", "owner"]),
    async (req: Request, res: Response) => {
      try {
        const documents = await engine.regenerateDocuments(req.params.id);
        return res.json({ documents: documents.map(({ markdown: _markdown, ...meta }) => meta) });
      } catch (error) {
        const message = errorMessage(error);
        return res.status(message.includes("not found") ? 404 : 409).json({ error: message });
      }
    }
  );

  app.get("/api/research/topics/:id/documents/:documentId", authenticate, (req: Request, res: Response) => {
    const document = ResearchStore.getDocument(req.params.id, Number(req.params.documentId));
    if (!document) return res.status(404).json({ error: "Document not found." });
    return res.json({ document });
  });

  app.get("/api/research/search", authenticateAgent("read"), (req: Request, res: Response) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!query) return res.status(400).json({ error: "Provide a search query with ?q=" });
    return res.json({ results: ResearchStore.search(query, 30) });
  });

  app.get("/api/learning/lessons", authenticateAgent("read"), (req: Request, res: Response) => {
    const scope = req.query.scope === "build" || req.query.scope === "research" ? (req.query.scope as LessonScope) : undefined;
    res.json({ lessons: LessonMemory.list(scope, 200) });
  });

  app.delete(
    "/api/learning/lessons/:id",
    authenticate,
    authorizeRoles(["admin", "owner"]),
    (req: Request, res: Response) => {
      if (!LessonMemory.remove(Number(req.params.id))) return res.status(404).json({ error: "Lesson not found." });
      return res.json({ ok: true });
    }
  );

  app.get("/api/second-brain/status", authenticate, async (_req: Request, res: Response) => {
    res.json({ status: await SecondBrainClient.status(), queue: SecondBrainClient.listQueue(30) });
  });

  app.post(
    "/api/second-brain/sync",
    authenticate,
    authorizeRoles(["developer", "admin", "owner"]),
    async (_req: Request, res: Response) => {
      try {
        res.json(await SecondBrainClient.processQueue());
      } catch (error) {
        res.status(500).json({ error: errorMessage(error) });
      }
    }
  );

  Logger.log("Research & learning routes registered", { seededLessons: seeded, resumedTopics: resumed });
};
