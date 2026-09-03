import http from "http";
import express, { Request, Response } from "express";
import cors from "cors";
import { Server } from "socket.io";
import { Orchestrator } from "../orchestrator/Orchestrator.js";
import { registerUpdateRoute } from "./update.js";
import { eventBus, emitServerEvent, type ServerEvent } from "./eventBus.js";
import { MemoryStore } from "../state/MemoryStore.js";
import { authenticate, authorizeRoles, registerAuthRoutes } from "./auth.js";
import { UserModel } from "../models/UserModel.js";
import { Hash } from "../utils/hash.js";
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
import { registerRobloxRoutes } from "./roblox.js";
// import { registerRobloxSyncRoutes } from "./robloxSync.js";
import { registerCollaborationRoutes } from "./collaboration.js";
// import { registerRobloxDebugRoutes } from "./robloxDebug.js";
import { registerStoryworldRoutes } from "./storyworld.js";
import { registerBuildRoutes } from "./build.js";
import { envRouter } from "./envManager.js";
import { buildStudioRouter, initializeBuildStudio } from "./buildStudioRoutes.js";
import { WorldMemory } from "../state/WorldMemory.js";
import { registerLicenseRoutes } from "./license.js";
import { registerAdminRoutes } from "./admin.js";
import { onboardingRouter } from "./onboarding.js";
import { ConfigVault } from "../utils/ConfigVault.js";
import { syncDynamicEnv } from "../utils/EnvLoader.js";
import { registerAutonomousRoutes } from "./autonomous.js";

const ADMIN_EMAIL = "mraaziqp";
const ADMIN_PASSWORD = "114477";

const ensureAdmin = () => {
  const config = ConfigVault.load();
  const targetEmail = config?.adminEmail ?? ADMIN_EMAIL;
  const targetRole = config?.adminRole ?? "owner";
  const passwordHash = Hash.make(ADMIN_PASSWORD);

  const existing = UserModel.findByEmail(targetEmail);
  if (!existing) {
    UserModel.create(targetEmail, passwordHash, targetRole);
    UserModel.create("mraaziqp@gmail.com", passwordHash, targetRole);
    console.log("Super Admin accounts created:", targetEmail, "and mraaziqp@gmail.com");
  } else {
    UserModel.updateCredentials(existing.id, { passwordHash, role: targetRole });
    const existingGmail = UserModel.findByEmail("mraaziqp@gmail.com");
    if (!existingGmail) {
      UserModel.create("mraaziqp@gmail.com", passwordHash, targetRole);
    } else {
      UserModel.updateCredentials(existingGmail.id, { passwordHash, role: targetRole });
    }
    console.log("Super Admin credentials updated for:", targetEmail);
  }
};

import { JarvisBridge } from "../integrations/JarvisBridge.js";

syncDynamicEnv();
await initializeTelemetry();
await PluginRegistry.initialize();
await VectorMemory.init();
await QueueService.getInstance();
await WorldMemory.getInstance().init();
initializeBuildStudio(process.cwd());
ensureAdmin();
JarvisBridge.getInstance().initialize().catch(() => {});

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
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

app.post("/api/agent/run", async (req: Request, res: Response) => {
  const { prompt } = req.body as { prompt?: string };
  const orchestrator = new Orchestrator();
  const result = await orchestrator.run(prompt ?? "");
  res.json(result);
});

app.get("/api/agent/tasks", (_req: Request, res: Response) => {
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
registerRobloxRoutes(app);
// registerRobloxSyncRoutes(app);
// registerRobloxDebugRoutes(app);
registerCollaborationRoutes(app);
registerBuildRoutes(app);
registerStoryworldRoutes(app);
registerLicenseRoutes(app);
registerAdminRoutes(app);
registerAutonomousRoutes(app);
app.use("/api/build-studio", buildStudioRouter);
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

const port = Number(process.env.PORT) || 4000;

server.listen(port, () => {
  console.log(`Agent Builder API running on port ${port}`);
});

const autoUpdater = new AutoUpdater();
autoUpdater.start();
