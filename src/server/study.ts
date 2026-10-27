/**
 * Learning from research: courses, lessons, quizzes, flashcards and study packs
 * (StudyCourse). Writing is slow and runs in the background; a lesson that is
 * not written yet comes back with its status ("queued", "writing") and the app
 * or Jarvis asks again.
 *
 *   GET    /api/learn                              every course and its progress
 *   GET    /api/learn/cards/due                    flashcards due across courses
 *   POST   /api/learn/cards/:cardId/review         { knew: boolean }
 *   GET    /api/learn/:topicId                     the course: syllabus, lessons, progress
 *   POST   /api/learn/:topicId/plan                { level? } plan (or re-plan) it
 *   GET    /api/learn/:topicId/next                the next lesson to study (starts writing it)
 *   GET    /api/learn/:topicId/lessons/:index      one lesson (starts writing it when needed)
 *   POST   /api/learn/:topicId/lessons/:index/quiz { answers: number[] } → marked
 *   POST   /api/learn/:topicId/lessons/:index/done mark it studied
 *   GET    /api/learn/:topicId/cards/due           this course's due flashcards
 *   GET    /api/learn/:topicId/pack                the study pack (Markdown; ?download=1 as a file)
 *   POST   /api/learn/:topicId/jarvis              send the course to Jarvis
 */
import type { Express, Request, Response } from "express";

import { StudyCourse, type Level } from "../research/StudyCourse.js";
import { GameMode } from "../utils/GameMode.js";
import { authenticateAgent } from "./agentAuth.js";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A lesson as Jarvis or the app gets it: the quiz without its answers. */
const forLearner = (lesson: ReturnType<typeof StudyCourse.open>) => ({
  ...lesson,
  quiz: lesson.quiz.map(({ question, options }) => ({ question, options }))
});

export const registerStudyRoutes = (app: Express) => {
  app.get("/api/learn", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ courses: StudyCourse.list(), due: StudyCourse.dueCards(undefined, 100).length });
  });

  app.get("/api/learn/cards/due", authenticateAgent("read"), (req: Request, res: Response) => {
    res.json({ cards: StudyCourse.dueCards(undefined, Math.min(Number(req.query.limit) || 20, 100)) });
  });

  app.post("/api/learn/cards/:cardId/review", authenticateAgent("write"), (req: Request, res: Response) => {
    try {
      res.json({ card: StudyCourse.review(Number(req.params.cardId), req.body?.knew === true || req.body?.knew === "true") });
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });

  app.get("/api/learn/:topicId", authenticateAgent("read"), (req: Request, res: Response) => {
    const overview = StudyCourse.overview(req.params.topicId);
    if (!overview) return res.status(404).json({ error: "No course for this topic yet. Plan one first." });
    res.json(overview);
  });

  app.post("/api/learn/:topicId/plan", authenticateAgent("write"), (req: Request, res: Response) => {
    if (GameMode.isOn()) return res.status(409).json({ error: "Game mode is on: switch it off to plan a course." });
    const level: Level = ["beginner", "intermediate", "advanced"].includes(req.body?.level) ? req.body.level : "beginner";
    try {
      res.status(202).json({ course: StudyCourse.plan(req.params.topicId, level) });
    } catch (error) {
      res.status(/not found/i.test(message(error)) ? 404 : 400).json({ error: message(error) });
    }
  });

  app.get("/api/learn/:topicId/next", authenticateAgent("write"), (req: Request, res: Response) => {
    const lesson = StudyCourse.next(req.params.topicId);
    if (!lesson) {
      const course = StudyCourse.get(req.params.topicId);
      return res.json({
        lesson: null,
        say: !course ? "There is no course for this topic yet." : course.status !== "ready" ? `The course is ${course.status}.` : "Every lesson is done — review the flashcards to keep it."
      });
    }
    res.json({ lesson: forLearner(lesson) });
  });

  app.get("/api/learn/:topicId/lessons/:index", authenticateAgent("write"), (req: Request, res: Response) => {
    try {
      res.json({ lesson: forLearner(StudyCourse.open(req.params.topicId, Number(req.params.index))) });
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });

  /** answers: option numbers from 0, or letters ("b", "a"…) or one string "b, a, d, c". :index may be "current". */
  app.post("/api/learn/:topicId/lessons/:index/quiz", authenticateAgent("write"), (req: Request, res: Response) => {
    const raw: unknown[] = Array.isArray(req.body?.answers)
      ? req.body.answers
      : typeof req.body?.answers === "string"
        ? (req.body.answers as string).split(/[\s,;]+/).filter(Boolean)
        : [];
    const answers = raw.map((a) => {
      if (typeof a === "number") return a;
      const text = String(a ?? "").trim().toLowerCase().replace(/[).]/g, "");
      if (/^[a-f]$/.test(text)) return text.charCodeAt(0) - 97;
      return /^\d+$/.test(text) ? Number(text) : -1;
    });
    if (!answers.length) return res.status(400).json({ error: "Send answers as option letters (a-d) or numbers from 0, one per question." });
    const index = req.params.index === "current" ? StudyCourse.currentLesson(req.params.topicId) : Number(req.params.index);
    if (index === null || !Number.isInteger(index)) return res.status(404).json({ error: "No lesson is open in this course." });
    try {
      res.json({ lesson: index, ...StudyCourse.grade(req.params.topicId, index, answers) });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });

  /** { good } — 👍/👎 on a lesson: a reward for how it taught, beside the quiz score. */
  app.post("/api/learn/:topicId/lessons/:index/feedback", authenticateAgent("write"), (req: Request, res: Response) => {
    try {
      const good = req.body?.good === true || req.body?.good === "true";
      res.json(StudyCourse.feedback(req.params.topicId, Number(req.params.index), good, typeof req.body?.source === "string" ? req.body.source.slice(0, 40) : "app"));
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });

  app.post("/api/learn/:topicId/lessons/:index/done", authenticateAgent("write"), (req: Request, res: Response) => {
    StudyCourse.complete(req.params.topicId, Number(req.params.index));
    res.json({ ok: true });
  });

  app.get("/api/learn/:topicId/cards/due", authenticateAgent("read"), (req: Request, res: Response) => {
    res.json({ cards: StudyCourse.dueCards(req.params.topicId, Math.min(Number(req.query.limit) || 20, 100)) });
  });

  app.get("/api/learn/:topicId/pack", authenticateAgent("read"), (req: Request, res: Response) => {
    try {
      const markdown = StudyCourse.pack(req.params.topicId);
      if (req.query.download === "1") {
        const name = (StudyCourse.get(req.params.topicId)?.title ?? "study-pack").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60);
        res.setHeader("Content-Type", "text/markdown; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${name}-study-pack.md"`);
        return res.send(markdown);
      }
      res.json({ markdown });
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });

  app.post("/api/learn/:topicId/jarvis", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      res.json(await StudyCourse.sendToJarvis(req.params.topicId));
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });
};
