/**
 * The invites studio, seen from the builder: whether it is working, a way to
 * ask for new templates, and the invites platform's own briefing — so Jarvis
 * can ask "how are the invitations going?" through the bridge he already uses.
 *
 *   GET  /api/invites/status              the studio worker
 *   GET  /api/invites/platform[?format=markdown]  the invites app's ops briefing
 *   POST /api/invites/templates           { brief, eventTypes[], culture?, variants? }
 */
import type { Express, Request, Response } from "express";

import { authenticateAgent } from "./agentAuth.js";
import { InviteStudio } from "../integrations/InviteStudio.js";

export function registerInvitesRoutes(app: Express) {
  app.get("/api/invites/status", authenticateAgent("read"), (_req: Request, res: Response) => res.json(InviteStudio.status()));

  app.get("/api/invites/platform", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json(await InviteStudio.platform(req.query.format === "markdown" ? "markdown" : "json"));
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/invites/templates", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const { brief, eventTypes, culture, variants } = req.body ?? {};
    if (typeof brief !== "string" || brief.trim().length < 10) return res.status(400).json({ error: "brief: describe the templates in a sentence or two" });
    const types = Array.isArray(eventTypes) && eventTypes.length ? eventTypes.map(String).slice(0, 4) : ["wedding"];
    try {
      res.json(await InviteStudio.generate({ brief: brief.trim(), eventTypes: types, culture: typeof culture === "string" ? culture : undefined, variants: Number(variants) || 3 }));
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
}
