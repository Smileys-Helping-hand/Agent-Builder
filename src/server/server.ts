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
import { registerBuildRoutes } from "./build.js";
import { registerBuildDownloadRoutes } from "./buildDownload.js";
import { envRouter } from "./envManager.js";
import { registerLicenseRoutes } from "./license.js";
import { registerAdminRoutes } from "./admin.js";
import { onboardingRouter } from "./onboarding.js";
import { ConfigVault } from "../utils/ConfigVault.js";
import { syncDynamicEnv } from "../utils/EnvLoader.js";
import { registerBuilderRoutes } from "./builder/StartBuilder.js";
import { BuilderStream } from "./builder/BuilderStream.js";
import {
  applySettingsToEnv,
  getSettings,
  runDiagnostics,
  saveSettings,
  validateSettingsLive
} from "./settings/SettingsStore.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { registerProcessRoutes } from "./system/ProcessManager.js";
import { registerStatusRoutes } from "./system/statusRoutes.js";
import { checkForUpdates } from "./updater/CheckForUpdates.js";
import { applyUpdates } from "./updater/ApplyUpdates.js";

const ADMIN_EMAIL = "mraaziqp@gmail.com";
const ADMIN_PASSWORD = "admin123";

const ensureAdmin = () => {
  const config = ConfigVault.load();
  const targetEmail = config?.adminEmail ?? ADMIN_EMAIL;
  const targetRole = config?.adminRole ?? "admin";
  const passwordHash = config?.passwordHash ?? Hash.make(ADMIN_PASSWORD);

  const existing = UserModel.findByEmail(targetEmail);
  if (!existing) {
    UserModel.create(targetEmail, passwordHash, targetRole);
    console.log("Admin account created:", targetEmail);
  } else if (config?.passwordHash && existing.password_hash !== config.passwordHash) {
    UserModel.updateCredentials(existing.id, { passwordHash: config.passwordHash, role: targetRole });
    console.log("Admin credentials refreshed from onboarding config for", targetEmail);
  }
};

syncDynamicEnv();
await initializeTelemetry();
await PluginRegistry.initialize();
await VectorMemory.init();
await QueueService.getInstance();
ensureAdmin();

const app = express();
app.use(
  cors({
    origin: "*",
    exposedHeaders: ["Content-Disposition", "Content-Length", "Last-Modified"]
  })
);
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

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
registerBuildRoutes(app);
registerBuildDownloadRoutes(app);
registerLicenseRoutes(app);
registerAdminRoutes(app);
app.use("/api/env", authenticate, authorizeRoles(["admin", "owner"]), envRouter);
registerBuilderRoutes(app);
registerProcessRoutes(app);
registerStatusRoutes(app);

app.get("/api/settings", (_req: Request, res: Response) => {
  res.json(getSettings());
});

app.post("/api/settings", (req: Request, res: Response) => {
  try {
    const updated = saveSettings(req.body ?? {});
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: (error as Error).message });
  }
});

app.post("/api/settings/validate", async (req: Request, res: Response) => {
  const settings = { ...getSettings(), ...(req.body ?? {}) };
  const validation = await validateSettingsLive(settings);
  res.json(validation);
});

app.post("/api/settings/diagnostics", async (_req: Request, res: Response) => {
  const settings = getSettings();
  const diagnostics = await runDiagnostics(settings);
  res.json({ ok: true, diagnostics });
});

app.get("/api/system/check-updates", (_req: Request, res: Response) => {
  res.json(checkForUpdates());
});

app.post("/api/system/apply-update", (_req: Request, res: Response) => {
  res.json(applyUpdates());
});

applySettingsToEnv(getSettings());
BuilderStream.getInstance();
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

app.use(errorHandler);

server.listen(port, () => {
  console.log(`Agent Builder API running on port ${port}`);
});

const autoUpdater = new AutoUpdater();
autoUpdater.start();
