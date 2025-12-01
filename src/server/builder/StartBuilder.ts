import type { Application, Request, Response } from "express";
import { Orchestrator } from "../../orchestrator/Orchestrator.js";
import { emitServerEvent } from "../eventBus.js";
import { getSettings, applySettingsToEnv, validateSettingsLive, isSettingsComplete } from "../settings/SettingsStore.js";
import { Logger } from "../../utils/Logger.js";

export const registerBuilderRoutes = (app: Application) => {
  app.post("/api/builder/start", async (req: Request, res: Response) => {
    const { prompt, template } = req.body as { prompt?: string; template?: string };
    const settings = getSettings();
    applySettingsToEnv(settings);

    if (!isSettingsComplete(settings)) {
      return res.status(400).json({ error: "Missing API key or model selection. Open settings to continue." });
    }

    const validation = await validateSettingsLive(settings);
    if (!validation.ok) {
      return res.status(400).json({ error: validation.errors.join(" ") });
    }

    const runPrompt = prompt?.trim() || template?.trim() || "Generate a production-ready agent builder app.";

    emitServerEvent({
      type: "builder",
      payload: {
        level: "info",
        message: `Starting Agent Builder for: ${runPrompt}`,
        timestamp: new Date().toISOString()
      }
    });

    try {
      const orchestrator = new Orchestrator();
      const result = await orchestrator.run(runPrompt);
      emitServerEvent({
        type: "builder",
        payload: {
          level: "info",
          message: "Builder run completed",
          timestamp: new Date().toISOString(),
          details: { tasks: result.length }
        }
      });
      res.json({ success: true, tasks: result });
    } catch (error) {
      Logger.error("Builder start failed", error as Error);
      emitServerEvent({
        type: "builder",
        payload: {
          level: "error",
          message: "Builder run failed",
          timestamp: new Date().toISOString(),
          details: { error: (error as Error).message }
        }
      });
      res.status(500).json({ error: "Failed to start Agent Builder" });
    }
  });

  app.get("/api/builder/output", (_req: Request, res: Response) => {
    res.json({ ok: true, path: "./projects", message: "Outputs are saved to ./projects" });
  });
};
