import type { Application, Request, Response } from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { RobloxBridge } from "../integrations/RobloxBridge.js";
import { Logger } from "../utils/Logger.js";

const bridge = RobloxBridge.getInstance();

export const registerRobloxSyncRoutes = (app: Application) => {
  app.post(
    "/api/roblox/sync",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (_req: Request, res: Response) => {
      if (!bridge.isEnabled()) {
        return res.status(503).json({ error: "Roblox Studio sync is disabled." });
      }

      try {
        const connected = await bridge.syncProject();
        res.json({ ok: true, connected: Boolean(connected) });
      } catch (error) {
        Logger.error("Failed to sync Roblox project", error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    "/api/roblox/playtest",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (_req: Request, res: Response) => {
      if (!bridge.isEnabled()) {
        return res.status(503).json({ error: "Roblox Studio sync is disabled." });
      }

      try {
        const triggered = await bridge.triggerPlaytest();
        res.json({ ok: Boolean(triggered) });
      } catch (error) {
        Logger.error("Failed to trigger Roblox playtest", error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
      }
    }
  );
};
