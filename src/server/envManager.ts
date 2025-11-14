import { Router, type Request, type Response } from "express";
import fs from "fs";
import path from "path";
import type { AuthenticatedRequest } from "./auth.js";
import { AuditLogModel } from "../models/AuditLogModel.js";

export const envRouter = Router();
const ENV_FILE = path.resolve(".env.dynamic");

const parseEnv = (raw: string) => {
  const entries = raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [key, ...rest] = line.split("=");
      return [key, rest.join("=")] as const;
    });
  return Object.fromEntries(entries) as Record<string, string>;
};

envRouter.get("/", (_req: Request, res: Response) => {
  if (!fs.existsSync(ENV_FILE)) {
    return res.json({ env: {} });
  }
  const raw = fs.readFileSync(ENV_FILE, "utf8");
  const env = parseEnv(raw);
  res.json({ env });
});

envRouter.post("/", (req: Request, res: Response) => {
  const env = req.body as Record<string, string>;
  const formatted = Object.entries(env)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  fs.writeFileSync(ENV_FILE, formatted);
  const actor = (req as AuthenticatedRequest).user;
  AuditLogModel.record({
    eventType: "env.updated",
    actorId: actor ? Number.parseInt(actor.id, 10) || null : null,
    actorEmail: actor?.email ?? null,
    metadata: { keys: Object.keys(env) }
  });
  res.json({ ok: true, env });
});
