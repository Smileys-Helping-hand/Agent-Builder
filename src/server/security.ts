import express from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { PolicyEngine } from "../security/PolicyEngine.js";
import { SandboxManager } from "../security/SandboxManager.js";
import { emitServerEvent } from "./eventBus.js";

export const registerSecurityRoutes = (app: express.Express) => {
  app.get("/api/security/policies", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (_req, res) => {
    const engine = await PolicyEngine.getInstance();
    res.json({ revision: engine.getRevision(), rules: engine.listRules() });
  });

  app.post(
    "/api/security/validate",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req, res) => {
      try {
        await SandboxManager.validate(req.body);
        emitServerEvent({ type: "security", payload: { action: "validate", timestamp: new Date().toISOString() } });
        res.json({ allowed: true });
      } catch (error) {
        emitServerEvent({
          type: "security",
          payload: { action: "validate", status: "denied", error: (error as Error).message, timestamp: new Date().toISOString() }
        });
        res.status(403).json({ allowed: false, error: (error as Error).message });
      }
    }
  );
};
