/**
 * The Template Academy's API (see academy/TemplateAcademy.ts).
 *
 *   GET    /api/academy                 status and every idea with its attempts
 *   POST   /api/academy/ideas           { name, category?, brief, mustHave?, icon? } — practise this
 *   POST   /api/academy/propose         { count? } — the model suggests ideas the catalogue lacks
 *   POST   /api/academy/:id/practise    practise it now (within the daily limit's spirit: one at a time)
 *   POST   /api/academy/:id/publish     { price? } — a graduated template goes on sale
 *   DELETE /api/academy/:id
 *
 * Looking needs read; anything that starts work or changes the shop needs execute.
 */
import type { Express, Request, Response } from "express";

import { TemplateAcademy } from "../academy/TemplateAcademy.js";
import { authenticateAgent } from "./agentAuth.js";

const fail = (res: Response, error: unknown, status = 400) => res.status(status).json({ error: error instanceof Error ? error.message : String(error) });

export const registerAcademyRoutes = (app: Express) => {
  app.get("/api/academy", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ ...TemplateAcademy.status(), ideas: TemplateAcademy.list() });
  });

  app.post("/api/academy/ideas", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ idea: TemplateAcademy.add(req.body ?? {}) });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/academy/propose", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      const count = Math.min(5, Math.max(1, Number(req.body?.count) || 3));
      res.json({ ideas: await TemplateAcademy.propose(count) });
    } catch (error) {
      fail(res, error, 502);
    }
  });

  app.post("/api/academy/:id/practise", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      const build = await TemplateAcademy.practise(req.params.id);
      res.json({ buildId: build.buildId, message: "Practising now. It carries on and starts over until it scores 100." });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/academy/:id/publish", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ idea: TemplateAcademy.publish(req.params.id, Number(req.body?.price) || undefined) });
    } catch (error) {
      fail(res, error);
    }
  });

  app.delete("/api/academy/:id", authenticateAgent("execute"), (req: Request, res: Response) => {
    if (!TemplateAcademy.remove(req.params.id)) return res.status(404).json({ error: "No such idea." });
    res.json({ ok: true });
  });
};
