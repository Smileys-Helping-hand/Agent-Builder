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
    authenticateAgent("execute"),
    (req: Request, res: Response) => {
      if (!engine.remove(req.params.id)) return res.status(404).json({ error: "Research topic not found." });
      return res.json({ ok: true });
    }
  );

  app.post(
    "/api/research/topics/:id/documents/regenerate",
    authenticateAgent("execute"),
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

  app.get("/api/research/topics/:id/documents/:documentId", authenticateAgent("read"), (req: Request, res: Response) => {
    const document = ResearchStore.getDocument(req.params.id, Number(req.params.documentId));
    if (!document) return res.status(404).json({ error: "Document not found." });
    return res.json({ document });
  });

  // --- editing a topic while it runs -------------------------------------

  /** PATCH { title?, question? } — rename it or sharpen the question it works from. */
  app.patch("/api/research/topics/:id", authenticateAgent("write"), (req: Request, res: Response) => {
    const { title, question } = (req.body ?? {}) as { title?: unknown; question?: unknown };
    const cleanTitle = typeof title === "string" ? title.trim() : undefined;
    const cleanQuestion = typeof question === "string" ? question.trim() : undefined;
    if (cleanTitle !== undefined && (cleanTitle.length < 3 || cleanTitle.length > 160)) {
      return res.status(400).json({ error: "Give the topic a title between 3 and 160 characters." });
    }
    if (cleanQuestion !== undefined && (cleanQuestion.length < 3 || cleanQuestion.length > 1000)) {
      return res.status(400).json({ error: "The research question must be between 3 and 1000 characters." });
    }
    const topic = ResearchStore.updateTopic(req.params.id, { title: cleanTitle, question: cleanQuestion });
    if (!topic) return res.status(404).json({ error: "Research topic not found." });
    ResearchStore.logActivity(topic.id, topic.cycles, "status", "Topic edited by you");
    return res.json({ topic: ResearchStore.getTopicSummary(topic.id) });
  });

  /** POST — run a cycle now rather than at the next scheduled time. */
  app.post("/api/research/topics/:id/run", authenticateAgent("write"), (req: Request, res: Response) => {
    if (!engine.runNow(req.params.id)) {
      return res.status(409).json({ error: "Only a running topic can start a cycle. Resume it first." });
    }
    return res.json({ ok: true });
  });

  /** POST { text } — steer it: a question of yours goes to the top of the frontier. */
  app.post("/api/research/topics/:id/questions", authenticateAgent("write"), (req: Request, res: Response) => {
    const topic = ResearchStore.getTopic(req.params.id);
    if (!topic) return res.status(404).json({ error: "Research topic not found." });
    const text = typeof req.body?.text === "string" ? req.body.text : "";
    if (!ResearchStore.addPriorityQuestion(topic.id, text, topic.cycles)) {
      return res.status(400).json({ error: "Ask something between 10 and 300 characters that it is not already asking." });
    }
    ResearchStore.logActivity(topic.id, topic.cycles, "question", `You asked: ${text.trim()}`);
    return res.status(201).json({ ok: true });
  });

  app.delete("/api/research/topics/:id/questions/:questionId", authenticateAgent("write"), (req: Request, res: Response) => {
    if (!ResearchStore.deleteQuestion(req.params.id, Number(req.params.questionId))) {
      return res.status(404).json({ error: "Question not found." });
    }
    return res.json({ ok: true });
  });

  app.post(
    "/api/research/topics/:id/questions/:questionId/prioritise",
    authenticateAgent("write"),
    (req: Request, res: Response) => {
      if (!ResearchStore.prioritiseQuestion(req.params.id, Number(req.params.questionId))) {
        return res.status(404).json({ error: "Question not found." });
      }
      return res.json({ ok: true });
    }
  );

  /** POST { verdict: "confirm" | "reject" } — your call on a finding. */
  app.post("/api/research/topics/:id/findings/:findingId", authenticateAgent("write"), (req: Request, res: Response) => {
    const verdict = req.body?.verdict;
    if (verdict !== "confirm" && verdict !== "reject") return res.status(400).json({ error: 'verdict must be "confirm" or "reject".' });
    if (!ResearchStore.judgeFinding(req.params.id, Number(req.params.findingId), verdict)) {
      return res.status(404).json({ error: "Finding not found." });
    }
    const topic = ResearchStore.getTopic(req.params.id);
    if (topic) ResearchStore.logActivity(topic.id, topic.cycles, "finding", `You ${verdict === "confirm" ? "confirmed" : "rejected"} a finding`);
    return res.json({ ok: true });
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

  // Retiring a lesson is a change to how builds behave: the app's key needs
  // "execute", a signed-in dashboard user is accepted as before.
  app.delete(
    "/api/learning/lessons/:id",
    authenticateAgent("execute"),
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
