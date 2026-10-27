/**
 * Game mode routes: pause everything on the PC for games, and start it again.
 *
 *   GET  /api/game-mode              — is it on, since when, what it paused, and a switch in progress
 *   POST /api/game-mode { on: true } — pause everything: builds, research, the model server and the PC's other services
 *   POST /api/game-mode { on: false }— start what was stopped and resume what was paused
 *
 * Switching on waits (up to 90s) for a model answer already in progress, so a
 * build is not cut off mid-reply; then it unloads every model and stops the
 * Ollama that Agent Builder uses (only that one, found by its port), and asks
 * the Host Manager to stop Jarvis's copy on this PC, the image engine and
 * SaveState hosting. Agent Builder itself stays up, idle, so the app can
 * switch it back. Continuous improvement and the training ground wait while
 * it is on.
 *
 * A switch can take longer than the tunnel's 100 s, so POST answers 202 and
 * the switch goes on in the background (GET shows `switching` until it is
 * done); ?wait=1 answers when it is done.
 */
import { execFile } from "child_process";
import { promisify } from "util";
import type { Express, Request, Response } from "express";

import { authenticateAgent } from "./agentAuth.js";
import { callHost } from "./host.js";
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

/** The PC's other services the pause stops, in order (Host Manager ids). */
const PAUSED_SERVICES = ["jarvis", "image-engine", "savestate"];

/** Stop the services that are running; the ids that were stopped. Without the Host Manager, none. */
const stopServices = async (): Promise<string[]> => {
  let running: string[];
  try {
    const { body } = await callHost("/api/status?fresh=1");
    const services = Array.isArray(body.services) ? (body.services as Array<{ id: string; state: string }>) : [];
    running = PAUSED_SERVICES.filter((id) => services.some((s) => s.id === id && (s.state === "up" || s.state === "starting")));
  } catch (error) {
    Logger.warn("Game mode: the Host Manager did not answer; only Agent Builder's own work is paused", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
  const stopped: string[] = [];
  for (const id of running) {
    const result = await callHost(`/api/services/${id}/stop`, { method: "POST", body: JSON.stringify({ by: "game mode (pause everything)" }) }).catch(() => null);
    if (result && result.status < 400) stopped.push(id);
    else Logger.warn(`Game mode: could not stop ${id}`, { error: result?.body?.error });
  }
  return stopped;
};

/** Start again what the pause stopped. The image engine is left off: it starts by itself when a picture is drawn. */
const startServices = async (ids: string[]): Promise<string[]> => {
  const started: string[] = [];
  for (const id of ids.filter((id) => id !== "image-engine")) {
    const result = await callHost(`/api/services/${id}/start`, { method: "POST", body: JSON.stringify({ by: "game mode (back to work)" }) }).catch(() => null);
    if (result && result.status < 400) started.push(id);
    else Logger.warn(`Game mode: could not start ${id} again`, { error: result?.body?.error });
  }
  return started;
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
  const state = GameMode.write({ on: true, since: new Date().toISOString(), pausedBuilds, pausedTopics, stoppedServices: [] });

  // Let an answer already being generated finish instead of cutting it off.
  for (let waited = 0; gpuLock.busy && waited < 90_000; waited += 1000) await sleep(1000);

  const unloaded = await unloadModels();
  const modelServerStopped = await stopOllama();
  const stoppedServices = await stopServices();
  const final = GameMode.write({ ...state, stoppedServices });
  Logger.log("Game mode on", { pausedBuilds, pausedTopics, unloaded, modelServerStopped, stoppedServices });
  return { ...final, modelServerStopped };
};

export const exitGameMode = async (): Promise<GameModeState & { modelServerUp: boolean; resumedBuilds: string[]; resumedTopics: string[]; startedServices: string[] }> => {
  const previous = GameMode.read();
  const state = GameMode.off();
  const modelServerUp = await ensureOllama(45_000);
  const startedServices = await startServices(previous.stoppedServices ?? []);

  const engine = ResearchEngine.getInstance();
  const resumedBuilds = previous.pausedBuilds.filter((buildId) => BuildService.control(buildId, "resume"));
  const resumedTopics = previous.pausedTopics.filter((id) => Boolean(engine.resume(id)));
  Logger.log("Game mode off", { modelServerUp, resumedBuilds, resumedTopics, startedServices });
  return { ...state, modelServerUp, resumedBuilds, resumedTopics, startedServices };
};

/** A switch in progress (one at a time), and how the last one ended. */
let switching: { to: "on" | "off"; since: string } | null = null;
let lastError: string | null = null;

const switchGameMode = (on: boolean) => {
  if (switching) {
    if (switching.to === (on ? "on" : "off")) return null;
    throw Object.assign(new Error(`Still switching ${switching.to}; try again in a moment.`), { status: 409 });
  }
  switching = { to: on ? "on" : "off", since: new Date().toISOString() };
  lastError = null;
  return (on ? enterGameMode() : exitGameMode())
    .catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
      Logger.warn(`Game mode: switching ${on ? "on" : "off"} failed`, { error: lastError });
      throw error;
    })
    .finally(() => {
      switching = null;
    });
};

export const registerGameModeRoutes = (app: Express) => {
  app.get("/api/game-mode", authenticateAgent("read"), async (_req: Request, res: Response) => {
    const state = GameMode.read();
    res.json({ ...state, modelServer: (await checkOllama()).state, switching, error: lastError });
  });

  app.post("/api/game-mode", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const on = (req.body as { on?: unknown } | undefined)?.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: 'Send { "on": true } or { "on": false }.' });
    try {
      const done = switchGameMode(on);
      if (req.query.wait === "1") return res.json(done ? await done : GameMode.read());
      done?.catch(() => undefined); // kept in lastError for GET
      return res.status(202).json({ ...GameMode.read(), switching, error: null });
    } catch (error) {
      return res.status((error as { status?: number }).status ?? 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
};
