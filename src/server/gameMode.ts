/**
 * Game mode routes: free the PC's graphics card for games, and give it back.
 *
 *   GET  /api/game-mode              — is it on, since when, what it paused
 *   POST /api/game-mode { on: true } — pause everything and shut the model server down
 *   POST /api/game-mode { on: false }— start the model server and resume what was paused
 *
 * Switching on waits (up to 90s) for a model answer already in progress, so a
 * build is not cut off mid-reply; then it unloads every model and stops the
 * Ollama that Agent Builder uses (only that one, found by its port).
 */
import { execFile } from "child_process";
import { promisify } from "util";
import type { Express, Request, Response } from "express";

import { authenticateAgent } from "./agentAuth.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { ResearchEngine } from "../research/ResearchEngine.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { GameMode, type GameModeState } from "../utils/GameMode.js";
import { gpuLock } from "../utils/GpuLock.js";
import { OLLAMA_URL, checkOllama, ensureOllama } from "../utils/Ollama.js";
import { Logger } from "../utils/Logger.js";

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ask Ollama to drop every loaded model out of VRAM right away. */
const unloadModels = async (): Promise<string[]> => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(4000) });
    const body = (await response.json()) as { models?: Array<{ name: string }> };
    const names = (body.models ?? []).map((model) => model.name);
    for (const name of names) {
      await fetch(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name, keep_alive: 0 }),
        signal: AbortSignal.timeout(10000)
      }).catch(() => undefined);
    }
    return names;
  } catch {
    return [];
  }
};

/** Stop the Ollama server Agent Builder uses: the process listening on its port. */
const stopOllama = async (): Promise<boolean> => {
  const port = new URL(OLLAMA_URL).port || "11434";
  try {
    if (process.platform === "win32") {
      const { stdout } = await run("netstat", ["-ano", "-p", "tcp"], { windowsHide: true });
      const pids = new Set(
        stdout
          .split(/\r?\n/)
          .filter((line) => /LISTENING/i.test(line) && new RegExp(`:${port}\\s`).test(line))
          .map((line) => line.trim().split(/\s+/).pop())
          .filter((pid): pid is string => Boolean(pid && /^\d+$/.test(pid) && pid !== "0"))
      );
      for (const pid of pids) {
        // /T takes its model runners (llama-server) down with it.
        await run("taskkill", ["/PID", pid, "/T", "/F"], { windowsHide: true }).catch(() => undefined);
      }
    } else {
      await run("pkill", ["-f", "ollama serve"]).catch(() => undefined);
    }
  } catch (error) {
    Logger.warn("Game mode: could not stop the model server", { error: error instanceof Error ? error.message : String(error) });
  }
  for (let waited = 0; waited < 10_000; waited += 500) {
    if ((await checkOllama()).state === "down") return true;
    await sleep(500);
  }
  return false;
};

export const enterGameMode = async (): Promise<GameModeState & { modelServerStopped: boolean }> => {
  const current = GameMode.read();
  if (current.on) return { ...current, modelServerStopped: (await checkOllama()).state === "down" };

  const engine = ResearchEngine.getInstance();
  const pausedBuilds = BuildService.active()
    .filter((build) => build.state === "running")
    .map((build) => build.buildId)
    .filter((buildId) => BuildService.control(buildId, "pause"));
  const pausedTopics = ResearchStore.listTopics()
    .filter((topic) => topic.status === "running")
    .map((topic) => topic.id)
    .filter((id) => Boolean(engine.pause(id)));

  // On first, so nothing new asks for the model while we wind down.
  const state = GameMode.write({ on: true, since: new Date().toISOString(), pausedBuilds, pausedTopics });

  // Let an answer already being generated finish instead of cutting it off.
  for (let waited = 0; gpuLock.busy && waited < 90_000; waited += 1000) await sleep(1000);

  const unloaded = await unloadModels();
  const modelServerStopped = await stopOllama();
  Logger.log("Game mode on", { pausedBuilds, pausedTopics, unloaded, modelServerStopped });
  return { ...state, modelServerStopped };
};

export const exitGameMode = async (): Promise<GameModeState & { modelServerUp: boolean; resumedBuilds: string[]; resumedTopics: string[] }> => {
  const previous = GameMode.read();
  const state = GameMode.off();
  const modelServerUp = await ensureOllama(45_000);

  const engine = ResearchEngine.getInstance();
  const resumedBuilds = previous.pausedBuilds.filter((buildId) => BuildService.control(buildId, "resume"));
  const resumedTopics = previous.pausedTopics.filter((id) => Boolean(engine.resume(id)));
  Logger.log("Game mode off", { modelServerUp, resumedBuilds, resumedTopics });
  return { ...state, modelServerUp, resumedBuilds, resumedTopics };
};

export const registerGameModeRoutes = (app: Express) => {
  app.get("/api/game-mode", authenticateAgent("read"), async (_req: Request, res: Response) => {
    const state = GameMode.read();
    res.json({ ...state, modelServer: (await checkOllama()).state });
  });

  app.post("/api/game-mode", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const on = (req.body as { on?: unknown } | undefined)?.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: 'Send { "on": true } or { "on": false }.' });
    try {
      return res.json(on ? await enterGameMode() : await exitGameMode());
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
};
