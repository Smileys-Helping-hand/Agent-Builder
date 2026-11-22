/**
 * Game mode routes, kept for the app's switch and Jarvis's "game-mode" action:
 * now a thin layer over the resource modes (system/ResourceModes.ts).
 *
 *   GET  /api/game-mode              — is it on, since when, what it paused, and a switch in progress
 *   POST /api/game-mode { on: true } — Gaming Mode with the chosen profile (gaming-balanced unless
 *                                      the game-detection settings say another, or { profile } is sent)
 *   POST /api/game-mode { on: false }— Resume All
 *
 * A switch can take longer than the tunnel's 100 s, so POST answers 202 and
 * the switch goes on in the background (GET shows `switching` until it is
 * done); ?wait=1 answers when it is done.
 *
 * This module also registers /api/system/* (server/system.ts), so the system
 * routes come up with game mode, wherever the server registers it.
 */
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { registerSystemRoutes } from "./system.js";
import { GameMode, type GameModeState } from "../utils/GameMode.js";
import { checkOllama } from "../utils/Ollama.js";
import { readSettings } from "../system/GameWatcher.js";
import { freed, resumeAll, startSwitch, switchState } from "../system/ResourceModes.js";

const outcome = (state: GameModeState, id: string) => state.report?.actions.find((a) => a.id === id);

/** Gaming Mode on, waiting for it; the old result shape (scripts/game-mode-smoketest.ts). */
export const enterGameMode = async (profile = readSettings().profile || "gaming-balanced"): Promise<GameModeState & { modelServerStopped: boolean }> => {
  const current = GameMode.read();
  if (current.on) return { ...current, modelServerStopped: (await checkOllama()).state === "down" };
  const state = (await startSwitch(profile, "game mode")) ?? GameMode.read();
  return { ...state, modelServerStopped: (await checkOllama()).state === "down" };
};

/** Resume All, waiting for it; the old result shape. */
export const exitGameMode = async (): Promise<GameModeState & { modelServerUp: boolean; resumedBuilds: string[]; resumedTopics: string[]; startedServices: string[] }> => {
  const before = GameMode.read();
  const state = await resumeAll("game mode");
  const steps = state.resume?.steps ?? [];
  const back = (id: string) => steps.some((s) => s.id === id && s.state === "done");
  const ids = (id: string) => ((outcome(before, id)?.undo?.ids as string[] | undefined) ?? []);
  return {
    ...state,
    modelServerUp: (await checkOllama()).state !== "down",
    resumedBuilds: back("builds") ? ids("builds") : [],
    resumedTopics: back("research") ? ids("research") : [],
    startedServices: steps.filter((s) => ["jarvis", "savestate"].includes(s.id) && s.state === "done").map((s) => s.id)
  };
};

export const registerGameModeRoutes = (app: Express) => {
  registerSystemRoutes(app);

  app.get("/api/game-mode", authenticateAgent("read"), async (_req: Request, res: Response) => {
    const state = GameMode.read();
    const { switching, error } = switchState();
    res.json({ ...state, freed: state.report ? freed(state.report) : "", modelServer: (await checkOllama()).state, switching: switching ? { to: switching.to === "normal" ? "off" : "on", since: switching.since } : null, error });
  });

  app.post("/api/game-mode", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { on?: unknown; profile?: unknown };
    if (typeof body.on !== "boolean") return res.status(400).json({ error: 'Send { "on": true } or { "on": false }.' });
    const request = req as AgentRequest;
    const by = request.actor ?? (request.agent ? `agent key "${request.agent.name}"` : "the app");
    const to = body.on ? (typeof body.profile === "string" ? body.profile : readSettings().profile || "gaming-balanced") : "normal";
    try {
      const done = startSwitch(to, by);
      if (req.query.wait === "1") return res.json(done ? await done : GameMode.read());
      done?.catch(() => undefined); // kept in the switch state for GET
      const { switching, error } = switchState();
      return res.status(202).json({ ...GameMode.read(), switching: switching ? { to: body.on ? "on" : "off", since: switching.since } : null, error });
    } catch (error) {
      return res.status((error as { status?: number }).status ?? 500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });
};
