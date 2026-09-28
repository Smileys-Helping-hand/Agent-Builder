/**
 * POST /api/auth/hub-sso — sign in from the ordering site's admin.
 *
 * "Open Agent Builder" on the site opens the app with a single-use token. The
 * app hands it here; this asks the site whether it is genuine (the site checks
 * it once and forgets it) and, if so, issues the app an agent key. So an admin
 * signed in to the site is signed in here too, with nothing copied or pasted.
 *
 * The route needs no key of its own — the token is the credential — so any
 * origin may call it (see server.ts). It is rate-limited, and the site will
 * only ever accept a given token once, within two minutes of making it.
 */
import crypto from "crypto";
import type { Express, Request, Response } from "express";

import { AgentKeyModel } from "../models/AgentKeyModel.js";
import { SiteClient } from "../orders/SiteClient.js";
import { Logger } from "../utils/Logger.js";

const KEY_PREFIX = "hub-admin-";
/** Keys issued this way that stay valid; older ones are revoked. One per device, roughly. */
const KEEP_KEYS = 5;

// Everything through the Cloudflare tunnel arrives from 127.0.0.1, so in
// practice this is one limit for all callers — the stricter reading, and fine
// for something a person does a few times a day.
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, number[]>();

const tooMany = (ip: string): boolean => {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter((at) => now - at < WINDOW_MS);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > MAX_ATTEMPTS;
};

/** Revoke all but the newest KEEP_KEYS hub-issued keys. */
const pruneOldKeys = (): void => {
  const issued = AgentKeyModel.list()
    .filter((key) => key.name.startsWith(KEY_PREFIX) && !key.revokedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const key of issued.slice(KEEP_KEYS)) AgentKeyModel.revoke(key.name);
};

export const registerHubSsoRoutes = (app: Express) => {
  app.post("/api/auth/hub-sso", async (req: Request, res: Response) => {
    if (tooMany(req.ip ?? "unknown")) {
      return res.status(429).json({ error: "Too many sign-in attempts. Wait a minute and try again." });
    }

    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!/^sso_[a-f0-9]{64}$/.test(token)) {
      return res.status(400).json({ error: "That is not a sign-in link from the site." });
    }

    const verdict = await SiteClient.redeemSso(token);
    if (!verdict.ok) {
      Logger.log("Hub sign-in refused", { reason: verdict.reason });
      return res.status(403).json({ error: verdict.reason });
    }

    const name = `${KEY_PREFIX}${new Date().toISOString().slice(0, 10)}-${crypto.randomBytes(3).toString("hex")}`;
    const { secret } = AgentKeyModel.issue(name, ["read", "write", "execute"]);
    pruneOldKeys();
    Logger.log("Signed in from the site's admin", { admin: verdict.admin, key: name });

    res.json({ key: secret, name, admin: verdict.admin });
  });
};
