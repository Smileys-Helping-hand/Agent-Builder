import type { Express, Request, Response } from "express";
import { RobloxBridge } from "../integrations/RobloxBridge.js";

export const registerRobloxDebugRoutes = (app: Express) => {
  const bridge = RobloxBridge.getInstance();

  app.post("/api/roblox/debug/log", async (req: Request, res: Response) => {
    const { message } = req.body as { message?: string };
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    await bridge.sendDebugLog(message);
    res.status(202).json({ forwarded: true });
  });

  app.post("/api/roblox/debug/eval", async (req: Request, res: Response) => {
    const { script } = req.body as { script?: string };
    if (!script) {
      return res.status(400).json({ error: "script is required" });
    }

    await bridge.evaluateScript(script);
    res.status(202).json({ forwarded: true });
  });
};
