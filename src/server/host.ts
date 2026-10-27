/**
 * This PC, from the app: what is running and the switches for it.
 *
 *   GET  /api/host                          the Host Manager's status (services, the PC, recent events)
 *   POST /api/host/services/:id/:action     start | stop | restart one of them
 *
 * The Host Manager (scripts/host-manager) is a separate small service on this
 * PC, so it keeps answering while the builder is down; this only relays to it
 * with its key (HOST_MANAGER_KEY in .env), for anyone signed in to the app
 * with a write key: the owner's phone, and Jarvis ("turn SaveState off",
 * "restart the model server"). Who asked is passed on, for its history.
 */
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";

const HOST_URL = () => (process.env.HOST_MANAGER_URL?.trim() || `http://127.0.0.1:${process.env.HOST_MANAGER_PORT || 4100}`).replace(/\/+$/, "");
const HOST_KEY = () => process.env.HOST_MANAGER_KEY?.trim() ?? "";

/** One request to the Host Manager. Throws when it has no key yet or does not answer. */
export const callHost = async (path: string, init: RequestInit = {}): Promise<{ status: number; body: Record<string, unknown> }> => {
  if (!HOST_KEY()) throw Object.assign(new Error("The Host Manager has not started on this PC yet (it makes HOST_MANAGER_KEY on first start). Restart Agent Builder once."), { status: 503 });
  let upstream: globalThis.Response;
  try {
    upstream = await fetch(`${HOST_URL()}${path}`, {
      ...init,
      headers: { "x-host-key": HOST_KEY(), "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(120_000)
    });
  } catch {
    throw Object.assign(new Error("The Host Manager is not answering on this PC. Restart Agent Builder (it starts the Host Manager), or run scripts/host-manager/host-manager.mjs."), { status: 502 });
  }
  const body = (await upstream.json().catch(() => ({ error: `The Host Manager answered ${upstream.status}.` }))) as Record<string, unknown>;
  return { status: upstream.status, body };
};

const relay = async (res: Response, path: string, init: RequestInit = {}) => {
  try {
    const { status, body } = await callHost(path, init);
    res.status(status).json(body);
  } catch (error) {
    res.status((error as { status?: number }).status ?? 502).json({ error: (error as Error).message });
  }
};

export const registerHostRoutes = (app: Express) => {
  app.get("/api/host", authenticateAgent("write"), (req: Request, res: Response) => {
    void relay(res, `/api/status${req.query.fresh === "1" ? "?fresh=1" : ""}`);
  });

  app.post("/api/host/services/:id/:action", authenticateAgent("write"), (req: Request, res: Response) => {
    const { id, action } = req.params;
    if (!/^[a-z-]{2,30}$/.test(id) || !["start", "stop", "restart"].includes(action)) {
      res.status(400).json({ error: "Name a service and start, stop or restart." });
      return;
    }
    const who = (req as AgentRequest).agent?.name ?? "the app";
    void relay(res, `/api/services/${id}/${action}`, { method: "POST", body: JSON.stringify({ by: /^jarvis/i.test(who) ? "Jarvis" : `the Agent Builder app (${who})` }) });
  });
};
