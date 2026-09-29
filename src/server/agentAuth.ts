/**
 * Authentication for machine callers (Jarvis) alongside human ones.
 *
 * Ecosystem routes expose source code and can start builds, so every one of
 * them is guarded. A caller is accepted if it presents either:
 *   - an agent key with the required scope (header `x-agent-key`, or
 *     `Authorization: Bearer ab_...`), or
 *   - a normal user token for a role allowed to do that thing.
 *
 * Scopes are deliberately coarse and separate: `read` cannot start a build, and
 * a key issued for reporting errors need not be able to read every file.
 */
import type { NextFunction, Request, Response } from "express";

import { AgentKeyModel, type AgentKey, type AgentScope } from "../models/AgentKeyModel.js";
import { AgentActivity } from "../state/AgentActivity.js";
import { JWT } from "../utils/jwt.js";
import { UserModel } from "../models/UserModel.js";

export interface AgentRequest extends Request {
  agent?: AgentKey;
  actor?: string;
}

const HUMAN_ROLES_FOR_SCOPE: Record<AgentScope, string[]> = {
  read: ["viewer", "developer", "editor", "admin", "owner"],
  write: ["developer", "editor", "admin", "owner"],
  // "editor" is here because the build routes it already governed moved onto
  // this middleware; dropping it would have quietly demoted existing accounts.
  execute: ["developer", "editor", "admin", "owner"]
};

const presentedKey = (req: Request): string | null => {
  const header = req.headers["x-agent-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const authorization = req.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ab_")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return null;
};

/** Keys the app itself uses; they poll constantly, so only their actions are worth a log line. */
const isAppKey = (name: string): boolean => name === "phone" || name.startsWith("hub-admin-");

/**
 * Record what an agent key was used for, once the response is sent. Everything
 * another agent (Jarvis) does is logged; the app's own keys log only actions,
 * not the reads it makes every few seconds.
 */
const logAgentRequest = (req: Request, res: Response, agent: string): void => {
  if (isAppKey(agent) && req.method === "GET") return;
  const started = Date.now();
  res.on("finish", () => {
    AgentActivity.record({
      direction: "in",
      agent,
      method: req.method,
      path: req.originalUrl.split("?")[0],
      status: res.statusCode,
      ms: Date.now() - started
    });
  });
};

export const authenticateAgent = (scope: AgentScope) => (req: Request, res: Response, next: NextFunction) => {
  const request = req as AgentRequest;

  const secret = presentedKey(req);
  if (secret) {
    const key = AgentKeyModel.verify(secret);
    if (!key) {
      return res.status(401).json({ error: "Unknown or revoked agent key." });
    }
    if (!key.scopes.includes(scope)) {
      return res.status(403).json({ error: `This key lacks the "${scope}" scope.`, scopes: key.scopes });
    }
    request.agent = key;
    request.actor = `agent:${key.name}`;
    logAgentRequest(req, res, key.name);
    return next();
  }

  // Fall back to a signed-in human, so the dashboard can use the same routes.
  const authorization = req.headers.authorization;
  const token = typeof authorization === "string" && authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : null;
  const payload = token ? JWT.verify(token) : null;
  if (!payload) {
    return res.status(401).json({ error: "Provide an agent key (x-agent-key) or sign in." });
  }
  const user = UserModel.findById(payload.id);
  if (!user || user.status !== "active") {
    return res.status(401).json({ error: "Account is not active." });
  }
  if (!HUMAN_ROLES_FOR_SCOPE[scope].includes(user.role)) {
    return res.status(403).json({ error: `Role "${user.role}" cannot perform a "${scope}" action.` });
  }
  request.actor = `user:${user.email}`;
  return next();
};
