// Must stay the first import. ESM evaluates imports in order, and modules
// below read process.env while they load — jwt.ts picks its signing secret
// at import time. Without this, .env was only loaded later (as a side effect
// of OpenAIClient) and JWT_SECRET from .env was silently ignored.
import "dotenv/config";
import fs from "fs";
import http from "http";
import path from "path";
import express, { Request, Response } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { registerUpdateRoute } from "./update.js";
import { eventBus, emitServerEvent, type ServerEvent } from "./eventBus.js";
import { MemoryStore } from "../state/MemoryStore.js";
import { authenticate, authorizeRoles, registerAuthRoutes } from "./auth.js";
import { UserModel } from "../models/UserModel.js";
import { JWT } from "../utils/jwt.js";
import { PluginRegistry } from "../agents/PluginRegistry.js";
import { VectorMemory } from "../state/VectorMemory.js";
import { FineTuner } from "../orchestrator/FineTuner.js";
import { AutoUpdater } from "../orchestrator/AutoUpdater.js";
import { registerMarketplaceRoutes } from "./marketplace.js";
import { registerAnalyticsRoutes } from "./analytics.js";
import { registerContainerRoutes } from "./containers.js";
import { initializeTelemetry } from "../observability/Telemetry.js";
import { HealthMonitor, registerHealthRoute } from "./health.js";
import { registerQueueRoutes } from "./queues.js";
import { registerLogRoutes } from "./logs.js";
import { registerSecurityRoutes } from "./security.js";
import { registerLibraryRoutes } from "./library.js";
import { QueueService } from "../queue/QueueService.js";
import { registerGovernanceRoutes } from "./governance.js";
import { registerControlRoutes } from "./controls.js";
import { registerChatRoutes } from "./chat.js";
import { registerTrainingRoutes } from "./train.js";
// registerRobloxRoutes and registerStoryworldRoutes are imported dynamically,
// gated on gameModeEnabled below — both modules construct singletons
// (StoryOrchestrator, WorldSimulator, WorldMemory, ...) at module top level,
// so a static import here would pay their init cost on every boot regardless
// of whether the routes are ever registered.
// import { registerRobloxSyncRoutes } from "./robloxSync.js";
import { registerCollaborationRoutes } from "./collaboration.js";
// import { registerRobloxDebugRoutes } from "./robloxDebug.js";
import { envRouter } from "./envManager.js";
import { registerLicenseRoutes } from "./license.js";
import { registerAdminRoutes } from "./admin.js";
import { onboardingRouter } from "./onboarding.js";
import { ConfigVault } from "../utils/ConfigVault.js";
import { syncDynamicEnv } from "../utils/EnvLoader.js";
import { registerAutonomousRoutes } from "./autonomous.js";
import { registerResearchRoutes } from "./research.js";
import { registerEcosystemRoutes } from "./ecosystem.js";
import { registerServiceRoutes } from "./services.js";
import { registerJarvisRoutes } from "./jarvis.js";
import { registerOrderRoutes } from "./orders.js";

const warnIfNoAccountsExist = () => {
  if (!ConfigVault.isConfigured() && UserModel.count() === 0) {
    console.warn(
      "[setup] No admin account exists yet. Visit the dashboard's onboarding screen " +
      "(POST /api/onboarding/complete) to create the first owner account."
    );
  }
};

import { JarvisBridge } from "../integrations/JarvisBridge.js";

// The storyworld/NPC/Roblox subsystem is a separate product bolted onto the
// app builder. It's off by default so a plain "build me an app" boot doesn't
// pay init cost (WorldMemory's DB, route registration) for a feature it
// isn't using. Set GAME_MODE_ENABLED=true (or the pre-existing
// STORYWORLD_ENABLED, honored for anyone who already had it on) to keep it.
const gameModeEnabled =
  (process.env.GAME_MODE_ENABLED ?? process.env.STORYWORLD_ENABLED ?? "false").toLowerCase() === "true";

syncDynamicEnv();
await initializeTelemetry();
await PluginRegistry.initialize();
await VectorMemory.init();
await QueueService.getInstance();
if (gameModeEnabled) {
  const { WorldMemory } = await import("../state/WorldMemory.js");
  await WorldMemory.getInstance().init();
} else {
  console.log("[boot] Game mode (storyworld/NPC/Roblox) disabled — set GAME_MODE_ENABLED=true to enable.");
}
warnIfNoAccountsExist();
JarvisBridge.getInstance().initialize().catch(() => {});

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? process.env.DASHBOARD_URL ?? "http://localhost:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Browser callers that authenticate with an agent key (the remote app, wherever
// it is hosted) are allowed from any origin: the key is the credential, it is
// never a cookie, and a page without it cannot do anything. Cookie/session
// callers — the dashboard — stay restricted to the configured allowlist.
const usesAgentKey = (req: Request): boolean =>
  Boolean(req.headers["x-agent-key"]) ||
  String(req.headers["access-control-request-headers"] ?? "").toLowerCase().includes("x-agent-key");

app.use(
  cors((req, callback) => {
    if (usesAgentKey(req as Request)) {
      callback(null, { origin: true, credentials: false, allowedHeaders: ["Content-Type", "x-agent-key", "Authorization"] });
      return;
    }
    callback(null, { origin: allowedOrigins, credentials: true });
  })
);
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true
  }
});

io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  const payload = token ? JWT.verify(token) : null;
  if (!payload) {
    next(new Error("Unauthorized"));
    return;
  }
  next();
});

io.on("connection", (socket) => {
  console.log("Socket connected");

  const forwardEvent = (event: ServerEvent) => {
    socket.emit("event", event);
  };

  eventBus.on("event", forwardEvent);

  socket.on("disconnect", () => {
    eventBus.off("event", forwardEvent);
  });
});

/**
 * A request made in a browser on this PC, not one relayed by the tunnel or
 * arriving over Tailscale or the LAN. The tunnel connects from 127.0.0.1 too,
 * so the address alone proves nothing: it must also be addressed to localhost
 * and carry none of the headers a proxy adds.
 */
const isFromThisPc = (req: Request): boolean => {
  const ip = req.socket.remoteAddress ?? "";
  const loopback = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const relayed = ["x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded", "cf-connecting-ip", "cf-ray"].some(
    (header) => req.headers[header] !== undefined
  );
  const hostname = (req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  return loopback && !relayed && (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]");
};

// The app (remote/, built to remote/out) is served from here too, so the PC
// needs nothing but this server: open http://127.0.0.1:4000 and it is there.
const REMOTE_APP = path.resolve(process.cwd(), "remote", "out");
const HOSTED_APP = "https://agent-builder-remote.vercel.app";

/**
 * Opening the builder's address in a browser opens the app. On this PC it also
 * connects the app, by handing it the phone key once in the URL (the app saves
 * it and strips it from the address bar). Anywhere else, the key is never
 * sent: whoever opens the public address has to already have it.
 */
app.get("/", (req: Request, res: Response) => {
  const hasLocalApp = fs.existsSync(path.join(REMOTE_APP, "index.html"));
  const proto = req.headers["x-forwarded-proto"] || (req.secure ? "https" : "http");
  const address = `${proto}://${req.headers.host ?? "127.0.0.1:4000"}`;

  if (isFromThisPc(req) && !req.query.address) {
    let key = "";
    try {
      key = fs.readFileSync(path.resolve(process.cwd(), "data", "phone-key.txt"), "utf8").trim();
    } catch {
      // No phone key yet; the app will ask for one.
    }
    if (key) {
      const target = hasLocalApp ? "" : HOSTED_APP;
      return res.redirect(`${target}/?address=${encodeURIComponent(address)}&key=${encodeURIComponent(key)}`);
    }
  }

  if (hasLocalApp) return res.sendFile(path.join(REMOTE_APP, "index.html"));
  res.redirect(`${HOSTED_APP}/?address=${encodeURIComponent(address)}`);
});

// Historical task records written by the removed 4-phase Orchestrator.
// Kept read-only so existing data stays viewable; nothing writes here now —
// builds go through /api/autonomous/*.
app.get("/api/agent/tasks", authenticate, (_req: Request, res: Response) => {
  const memory = MemoryStore.load();
  const tasks = Object.values(memory ?? {});
  res.json(tasks);
});

registerUpdateRoute(app);
registerAuthRoutes(app);
app.use("/api/onboarding", onboardingRouter);
registerMarketplaceRoutes(app);
registerAnalyticsRoutes(app);
registerContainerRoutes(app);
registerQueueRoutes(app);
registerLogRoutes(app);
registerSecurityRoutes(app);
registerLibraryRoutes(app);
registerGovernanceRoutes(app);
registerControlRoutes(app);
registerChatRoutes(app);
registerTrainingRoutes(app);
if (gameModeEnabled) {
  const { registerRobloxRoutes } = await import("./roblox.js");
  const { registerStoryworldRoutes } = await import("./storyworld.js");
  registerRobloxRoutes(app);
  // const { registerRobloxSyncRoutes } = await import("./robloxSync.js");
  // registerRobloxSyncRoutes(app);
  // const { registerRobloxDebugRoutes } = await import("./robloxDebug.js");
  // registerRobloxDebugRoutes(app);
  registerStoryworldRoutes(app);
}
app.use("/api/collab", authenticate);
registerCollaborationRoutes(app);
registerLicenseRoutes(app);
registerAdminRoutes(app);
registerAutonomousRoutes(app);
registerResearchRoutes(app);
registerEcosystemRoutes(app);
registerServiceRoutes(app);
registerJarvisRoutes(app);
registerOrderRoutes(app);
app.use("/api/env", authenticate, authorizeRoles(["admin", "owner"]), envRouter);
const healthMonitor = new HealthMonitor();
registerHealthRoute(app, healthMonitor);

app.get("/api/plugins", (_req: Request, res: Response) => {
  res.json({ plugins: PluginRegistry.getMetadata() });
});

app.get("/api/memory/recent", async (_req: Request, res: Response) => {
  const records = await VectorMemory.listRecent(25);
  res.json({ records });
});

app.post("/api/memory/search", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (req: Request, res: Response) => {
  if (!VectorMemory.isEnabled()) {
    return res.status(503).json({ error: "Vector memory is not configured." });
  }

  const { query, limit } = req.body as { query?: string; limit?: number };
  if (!query) {
    return res.status(400).json({ error: "Query text is required" });
  }

  const records = await VectorMemory.searchByText(query, limit ?? 10);
  res.json({ records });
});

app.post("/api/feedback", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (req: Request, res: Response) => {
  const entry = await FineTuner.recordFeedback(req.body);
  emitServerEvent({
    type: "feedback",
    payload: {
      summary: { count: 1, ids: [entry.id] },
      timestamp: entry.createdAt
    }
  });
  res.status(201).json({ entry });
});

app.get("/api/feedback", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (req: Request, res: Response) => {
  const { processed } = req.query;
  const options = (() => {
    if (processed === undefined) {
      return {};
    }
    if (typeof processed === "string") {
      return { processed: processed.toLowerCase() === "true" };
    }
    if (Array.isArray(processed)) {
      return { processed: processed.some((value) => String(value).toLowerCase() === "true") };
    }
    return { processed: Boolean(processed) };
  })();
  const entries = await FineTuner.listFeedback(options);
  res.json({ entries });
});

// The app's pages and assets. Registered after every API route, and it only
// ever answers with files that exist in remote/out, so it cannot shadow one.
if (fs.existsSync(REMOTE_APP)) {
  app.use(express.static(REMOTE_APP, { extensions: ["html"], index: "index.html" }));
}

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "127.0.0.1";

server.listen(port, host, () => {
  console.log(`Agent Builder API running on http://${host}:${port}`);
});

// Running as the desktop app's sidecar: exit as soon as the app is gone. The app
// stops the sidecar on a normal exit, but a crash or force-quit gives it no chance
// to, and the API then lingered in the background holding ports 4000/9464/35000.
// The app keeps this process's stdin open for its whole lifetime, so end-of-input
// on stdin means the parent has exited, however it exited.
if (process.env.AGENT_BUILDER_SIDECAR === "1") {
  const exitWithParent = () => process.exit(0);
  process.stdin.on("end", exitWithParent);
  process.stdin.on("close", exitWithParent);
  process.stdin.on("error", exitWithParent);
  process.stdin.resume();
}

const autoUpdater = new AutoUpdater();
autoUpdater.start();
