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

const relay = async (res: Response, path: string, init: RequestInit = {}) => {
  if (!HOST_KEY()) {
    res.status(503).json({ error: "The Host Manager has not started on this PC yet (it makes HOST_MANAGER_KEY on first start). Restart Agent Builder once." });
    return;
  }
  try {
    const upstream = await fetch(`${HOST_URL()}${path}`, {
      ...init,
      headers: { "x-host-key": HOST_KEY(), "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(120_000)
    });
    const body = await upstream.json().catch(() => ({ error: `The Host Manager answered ${upstream.status}.` }));
    res.status(upstream.status).json(body);
  } catch {
    res.status(502).json({ error: "The Host Manager is not answering on this PC. Restart Agent Builder (it starts the Host Manager), or run scripts/host-manager/host-manager.mjs." });
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
