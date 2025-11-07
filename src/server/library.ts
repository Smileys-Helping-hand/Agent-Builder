import express from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { TemplateLibrary } from "../orchestrator/TemplateLibrary.js";
import { createDiff } from "../orchestrator/DiffViewer.js";
import { RollbackManager } from "../orchestrator/RollbackManager.js";

export const registerLibraryRoutes = (app: express.Express) => {
  app.get("/api/templates", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (_req, res) => {
    const templates = await TemplateLibrary.list();
    res.json({ templates });
  });

  app.post(
    "/api/templates",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req, res) => {
      const record = await TemplateLibrary.create(req.body);
      res.status(201).json({ template: record });
    }
  );

  app.post("/api/diff", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), (req, res) => {
    const { original, updated } = req.body as { original?: string; updated?: string };
    if (typeof original !== "string" || typeof updated !== "string") {
      return res.status(400).json({ error: "original and updated are required" });
    }
    res.json({ diff: createDiff(original, updated) });
  });

  app.get("/api/rollbacks", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (req, res) => {
    const { taskId } = req.query;
    const records = await RollbackManager.list(typeof taskId === "string" ? taskId : undefined);
    res.json({ records });
  });

  app.post("/api/rollbacks/restore", authenticate, authorizeRoles(["editor", "admin", "owner"]), async (req, res) => {
    const { id } = req.body as { id?: string };
    if (!id) {
      return res.status(400).json({ error: "id is required" });
    }
    const restored = await RollbackManager.restore(id);
    res.json({ task: restored });
  });
};
