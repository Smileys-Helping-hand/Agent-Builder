/**
 * What the builder taught itself (repair/FixPlaybook.ts), for the app and Jarvis.
 *
 *   GET    /api/playbook        the fixes it learned: the error, why it happens, what it does, its record
 *   DELETE /api/playbook/:id    forget one (a fix that turned out wrong)
 */
import type { Express, Request, Response } from "express";

import { FixPlaybook, describeAction } from "../repair/FixPlaybook.js";
import { authenticateAgent } from "./agentAuth.js";

export const registerPlaybookRoutes = (app: Express) => {
  app.get("/api/playbook", authenticateAgent("read"), (_req: Request, res: Response) => {
    const entries = FixPlaybook.list()
      .slice()
      .sort((a, b) => (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt))
      .map((entry) => ({ ...entry, steps: entry.actions.map(describeAction) }));
    res.json({ entries });
  });

  app.delete("/api/playbook/:id", authenticateAgent("write"), (req: Request, res: Response) => {
    if (!/^fix_[a-z0-9]+$/.test(req.params.id)) {
      res.status(400).json({ error: "Not a fix id." });
      return;
    }
    res.json({ removed: FixPlaybook.remove(req.params.id) });
  });
};
