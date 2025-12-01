import fs from "fs";
import path from "path";
import type { Application, Request, Response } from "express";
import { getSettings, isSettingsComplete, runDiagnostics } from "../settings/SettingsStore.js";
import { ProcessManager } from "./ProcessManager.js";

export const registerStatusRoutes = (app: Application) => {
  app.get("/api/system/status", async (_req: Request, res: Response) => {
    const settings = getSettings();
    const diagnostics = await runDiagnostics(settings);
    const envLoaded = fs.existsSync(path.resolve(process.cwd(), ".env"));
    const backend = ProcessManager.getInstance().status();
    res.json({
      openaiOnline: Boolean(diagnostics.openaiReachable),
      diskAccess: Boolean(diagnostics.diskAccess),
      backendRunning: backend.running,
      settingsComplete: isSettingsComplete(settings),
      envLoaded,
      diagnostics
    });
  });
};
