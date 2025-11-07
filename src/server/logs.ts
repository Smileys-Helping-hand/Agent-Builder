import express from "express";
import { LogStore } from "../state/LogStore.js";
import { authenticate, authorizeRoles } from "./auth.js";

export const registerLogRoutes = (app: express.Express) => {
  app.get("/api/logs", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (_req, res) => {
    const entries = await LogStore.list(200);
    res.json({ entries });
  });
};
