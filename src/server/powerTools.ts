/**
 * Power tools for the Control screen:
 *
 *   GET  /api/power/log?lines=200&level=error   the builder's own log, newest last
 *   POST /api/power/warm-model                   load the coding model into the GPU now
 *   POST /api/power/restart                      restart the builder (needs the launcher)
 *
 * Restart only goes ahead when the launcher is running: it is the launcher's
 * watchdog that starts the builder again. Without it, a restart would be a
 * shutdown nobody asked for.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { Logger } from "../utils/Logger.js";
import { OLLAMA_URL, ensureOllama } from "../utils/Ollama.js";

const run = promisify(execFile);
const API_LOG = path.resolve("data/api.log");
const TAIL_BYTES = 512 * 1024;

interface LogLine {
  at: string | null;
  level: string;
  message: string;
}

/** The last part of the log, as lines: JSON ones are read, anything else is kept as text. */
function readLog(limit: number, level?: string): LogLine[] {
  if (!fs.existsSync(API_LOG)) return [];
  const size = fs.statSync(API_LOG).size;
  const start = Math.max(0, size - TAIL_BYTES);
  const fd = fs.openSync(API_LOG, "r");
  const buffer = Buffer.alloc(size - start);
  try {
    fs.readSync(fd, buffer, 0, buffer.length, start);
  } finally {
    fs.closeSync(fd);
  }
  const lines = buffer.toString("utf8").split(/\r?\n/).slice(start > 0 ? 1 : 0);
  const parsed: LogLine[] = [];
  for (const raw of lines) {
    const text = raw.trim();
    if (!text) continue;
    try {
      const entry = JSON.parse(text) as { level?: string; message?: string; timestamp?: string };
      parsed.push({
        at: entry.timestamp ?? null,
        level: entry.level ?? "info",
        // The first line is the headline; the JSON context after it is noise here.
        message: String(entry.message ?? "").split("\n")[0].slice(0, 400)
      });
    } catch {
      parsed.push({ at: null, level: /error|fail|exception/i.test(text) ? "error" : "info", message: text.slice(0, 400) });
    }
  }
  const wanted = level === "error" ? parsed.filter((line) => line.level === "error") : level === "warn" ? parsed.filter((line) => line.level === "error" || line.level === "warn") : parsed;
  return wanted.slice(-limit);
}

/** Whether the launcher (scripts/launcher/start.ps1) is running, and so will bring the builder back. */
async function launcherRunning(): Promise<boolean> {
  if (process.platform !== "win32") return false;
  try {
    const { stdout } = await run(
      "powershell.exe",
      ["-NoProfile", "-Command", "@(Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*launcher*start.ps1*' }).Count"],
      { windowsHide: true, timeout: 15_000 }
    );
    return Number(stdout.trim()) > 0;
  } catch {
    return false;
  }
}

export const registerPowerToolRoutes = (app: Express) => {
  app.get("/api/power/log", authenticateAgent("read"), (req: Request, res: Response) => {
    const lines = Math.min(Math.max(Number(req.query.lines) || 200, 20), 1000);
    const level = typeof req.query.level === "string" ? req.query.level : undefined;
    res.json({ lines: readLog(lines, level), file: API_LOG });
  });

  app.post("/api/power/warm-model", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const model = process.env.OLLAMA_MODEL ?? process.env.MODEL ?? "qwen2.5-coder:7b";
    const started = Date.now();
    if (!(await ensureOllama())) return res.status(503).json({ error: "The model server (Ollama) is not running and could not be started." });
    try {
      // An empty prompt loads the model and returns straight away; keep_alive holds it in memory.
      const response = await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, prompt: "", keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "30m" }),
        signal: AbortSignal.timeout(180_000)
      });
      if (!response.ok) return res.status(502).json({ error: `Ollama answered ${response.status}: ${(await response.text()).slice(0, 200)}` });
      res.json({ success: true, model, seconds: Math.round((Date.now() - started) / 100) / 10, message: `${model} is loaded and ready.` });
    } catch (error) {
      res.status(502).json({ error: `Could not load ${model}: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  app.post("/api/power/restart", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const building = BuildService.active().filter((build) => build.state === "running");
    if (building.length && req.body?.force !== true) {
      return res.status(409).json({
        error: `${building.length} build(s) running: ${building.map((build) => build.projectName).join(", ")}. A restart stops them; they can be continued afterwards. Restart anyway?`,
        building: building.length
      });
    }
    if (!(await launcherRunning())) {
      return res.status(409).json({
        error: "The launcher is not running, so nothing would start the builder again. Restart it at the PC with Start Agent Builder."
      });
    }
    Logger.log("Builder restarting at the app's request", { by: (req as AgentRequest).actor ?? "app" });
    res.json({ success: true, message: "Restarting. The launcher brings it back in about 30 seconds." });
    // After the reply has gone. The launcher's watchdog notices and starts a fresh one.
    setTimeout(() => process.exit(0), 800).unref?.();
  });
};
