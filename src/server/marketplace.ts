import fs from "fs";
import path from "path";
import express, { type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { PluginRegistry, type PluginDefinition } from "../agents/PluginRegistry.js";
import { authenticate, authorizeRoles, type AuthenticatedRequest } from "./auth.js";
import { emitServerEvent } from "./eventBus.js";

const INSTALLS_PATH = path.resolve("./data/marketplace-installs.json");

type MarketplacePlugin = {
  id: string;
  name: string;
  agentType: string;
  description: string;
  version: string;
  author: string;
  homepage?: string;
  path: string;
  requiresApproval?: boolean;
};

type InstallRequest = {
  id: string;
  pluginId: string;
  status: "pending" | "installed" | "failed";
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  error?: string;
};

const MARKETPLACE_CATALOG: MarketplacePlugin[] = [
  {
    id: "docs-agent",
    name: "DocsAgent",
    agentType: "DocsAgent",
    description: "Generates product documentation and knowledge base articles.",
    version: "1.1.0",
    author: "AgentX Labs",
    path: "plugins/docs-agent/index.js"
  },
  {
    id: "data-agent",
    name: "DataAgent",
    agentType: "DataAgent",
    description: "Runs analytics pipelines and prepares dashboards.",
    version: "0.5.0",
    author: "AgentX Labs",
    path: "plugins/data-agent/index.js",
    requiresApproval: true
  }
];

const readInstalls = async (): Promise<InstallRequest[]> => {
  try {
    const raw = await fs.promises.readFile(INSTALLS_PATH, "utf8");
    return JSON.parse(raw) as InstallRequest[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeInstalls = async (requests: InstallRequest[]): Promise<void> => {
  await fs.promises.mkdir(path.dirname(INSTALLS_PATH), { recursive: true });
  await fs.promises.writeFile(INSTALLS_PATH, JSON.stringify(requests, null, 2));
};

const findPlugin = (pluginId: string) => MARKETPLACE_CATALOG.find((plugin) => plugin.id === pluginId);

const emitMarketplaceEvent = (payload: Record<string, unknown>) => {
  emitServerEvent({ type: "marketplace", payload: { ...payload, timestamp: new Date().toISOString() } });
};

const installDefinitionFor = (plugin: MarketplacePlugin): PluginDefinition => ({
  path: plugin.path,
  metadata: {
    name: plugin.name,
    agentType: plugin.agentType,
    description: plugin.description,
    version: plugin.version,
    author: plugin.author,
    homepage: plugin.homepage
  }
});

export const registerMarketplaceRoutes = (app: express.Express) => {
  app.get("/api/marketplace/catalog", authenticate, async (_req: Request, res: Response) => {
    res.json({ catalog: MARKETPLACE_CATALOG });
  });

  app.get("/api/marketplace/requests", authenticate, authorizeRoles(["editor", "admin", "owner"]), async (_req: Request, res: Response) => {
    const requests = await readInstalls();
    res.json({ requests });
  });

  app.post(
    "/api/marketplace/install",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { pluginId } = req.body as { pluginId?: string };
      if (!pluginId) {
        return res.status(400).json({ error: "pluginId is required" });
      }

      const plugin = findPlugin(pluginId);
      if (!plugin) {
        return res.status(404).json({ error: "Plugin not found" });
      }

      const requests = await readInstalls();
      const existing = requests.find((request) => request.pluginId === pluginId && request.status === "installed");
      if (existing) {
        return res.status(409).json({ error: "Plugin already installed" });
      }

      const actor = (req as AuthenticatedRequest).user;
      const requestRecord: InstallRequest = {
        id: uuidv4(),
        pluginId,
        status: plugin.requiresApproval ? "pending" : "installed",
        requestedBy: actor?.email ?? "unknown",
        requestedAt: new Date().toISOString()
      };

      if (plugin.requiresApproval) {
        requests.push(requestRecord);
        await writeInstalls(requests);
        emitMarketplaceEvent({ action: "requested", pluginId, requestId: requestRecord.id });
        return res.status(202).json({ request: requestRecord, requiresApproval: true });
      }

      try {
        const metadata = await PluginRegistry.installPlugin(installDefinitionFor(plugin));
        if (!metadata) {
          throw new Error("Plugin failed to register");
        }
        requests.push(requestRecord);
        await writeInstalls(requests);
        emitMarketplaceEvent({ action: "installed", pluginId, requestId: requestRecord.id });
        res.status(201).json({ request: requestRecord, requiresApproval: false });
      } catch (error) {
        requestRecord.status = "failed";
        requestRecord.error = error instanceof Error ? error.message : String(error);
        requests.push(requestRecord);
        await writeInstalls(requests);
        emitMarketplaceEvent({ action: "failed", pluginId, requestId: requestRecord.id, error: requestRecord.error });
        res.status(500).json({ error: requestRecord.error });
      }
    }
  );

  app.post(
    "/api/marketplace/approve",
    authenticate,
    authorizeRoles(["admin", "owner"]),
    async (req: Request, res: Response) => {
      const { requestId } = req.body as { requestId?: string };
      if (!requestId) {
        return res.status(400).json({ error: "requestId is required" });
      }

      const requests = await readInstalls();
      const request = requests.find((candidate) => candidate.id === requestId);
      if (!request) {
        return res.status(404).json({ error: "Request not found" });
      }

      if (request.status === "installed") {
        return res.status(200).json({ request });
      }

      const plugin = findPlugin(request.pluginId);
      if (!plugin) {
        request.status = "failed";
        request.error = "Plugin no longer available";
        await writeInstalls(requests);
        emitMarketplaceEvent({ action: "failed", requestId, error: request.error });
        return res.status(404).json({ error: request.error });
      }

      const actor = (req as AuthenticatedRequest).user;

      try {
        const metadata = await PluginRegistry.installPlugin(installDefinitionFor(plugin));
        if (!metadata) {
          throw new Error("Plugin failed to register");
        }
        request.status = "installed";
        request.approvedAt = new Date().toISOString();
        request.approvedBy = actor?.email;
        await writeInstalls(requests);
        emitMarketplaceEvent({ action: "installed", pluginId: plugin.id, requestId });
        res.json({ request });
      } catch (error) {
        request.status = "failed";
        request.error = error instanceof Error ? error.message : String(error);
        request.approvedAt = new Date().toISOString();
        request.approvedBy = actor?.email;
        await writeInstalls(requests);
        emitMarketplaceEvent({ action: "failed", pluginId: plugin.id, requestId, error: request.error });
        res.status(500).json({ error: request.error });
      }
    }
  );
};
