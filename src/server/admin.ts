import express from "express";
import os from "os";
import process from "process";
import { authenticate, authorizeRoles } from "./auth.js";
import type { AuthenticatedRequest } from "./auth.js";
import { QueueService } from "../queue/QueueService.js";
import { BuildEngine } from "../orchestrator/BuildEngine.js";
import { UserModel } from "../models/UserModel.js";
import { Hash } from "../utils/hash.js";
import { AuditLogModel } from "../models/AuditLogModel.js";

const serverStartedAt = new Date();

const getQueueHealth = async () => {
  try {
    const queue = await QueueService.getInstance();
    return await queue.getMetrics();
  } catch (error) {
    return {
      provider: "memory",
      connected: false,
      queueDepth: 0,
      details: { error: (error as Error).message }
    };
  }
};

export const registerAdminRoutes = (app: express.Express) => {
  const router = express.Router();

  router.use(authenticate, authorizeRoles(["admin", "owner"]));

  router.get("/system-status", async (_req, res) => {
    const memoryUsage = process.memoryUsage();
    const uptimeSeconds = process.uptime();
    const load = os.loadavg();
    const queue = await getQueueHealth();
    const builds = BuildEngine.getInstance().listBuilds().slice(0, 10);

    res.json({
      system: {
        cpuLoad: load[0],
        platform: os.platform(),
        release: os.release(),
        uptimeSeconds,
        totalMem: os.totalmem(),
        freeMem: os.freemem(),
        memoryUsage,
        queue,
        serverStartedAt: serverStartedAt.toISOString()
      },
      builds
    });
  });

  router.get("/users", (_req, res) => {
    const users = UserModel.getAll().map((user) => ({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status ?? "active",
      lastLoginAt: user.last_login_at,
      createdAt: user.created_at
    }));
    res.json({ users });
  });

  router.post("/users", (req, res) => {
    const { email, role } = (req.body ?? {}) as { email?: string; role?: string };
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalizedRole = role && ["owner", "admin", "developer", "viewer"].includes(role) ? role : "viewer";
    const existing = UserModel.findByEmail(email);
    const tempPassword = Math.random().toString(36).slice(2, 10);
    const hash = Hash.make(tempPassword);

    if (existing) {
      UserModel.updateCredentials(existing.id, { passwordHash: hash, role: normalizedRole });
    } else {
      UserModel.create(email, hash, normalizedRole);
    }

    const actor = (req as AuthenticatedRequest).user;
    const actorId = actor ? Number.parseInt(actor.id, 10) : NaN;
    AuditLogModel.record({
      eventType: existing ? "user.credentials_reset" : "user.invited",
      actorId: Number.isFinite(actorId) ? actorId : null,
      actorEmail: actor?.email ?? null,
      metadata: {
        email,
        role: normalizedRole,
        temporaryPasswordIssued: true
      }
    });

    res.json({ ok: true, temporaryPassword: tempPassword });
  });

  router.get("/audit-log", (req, res) => {
    const { limit, eventType } = req.query;
    const parsedLimit = typeof limit === "string" ? Number.parseInt(limit, 10) : undefined;
    const entries = AuditLogModel.list({
      limit: parsedLimit && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
      eventType: typeof eventType === "string" ? eventType : undefined
    }).map((entry) => ({
      id: entry.id,
      eventType: entry.eventType,
      actorId: entry.actorId,
      actorEmail: entry.actorEmail,
      message: entry.message,
      metadata: entry.metadata,
      createdAt: entry.createdAt
    }));
    res.json({ entries });
  });

  app.use("/api/admin", router);
};
