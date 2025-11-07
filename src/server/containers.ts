import fs from "fs";
import path from "path";
import express, { type Request, type Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { authenticate, authorizeRoles, type AuthenticatedRequest } from "./auth.js";
import { emitServerEvent } from "./eventBus.js";
import { SandboxManager } from "../security/SandboxManager.js";

const CONTAINERS_PATH = path.resolve("./data/containers.json");

type ContainerStatus = "pending" | "approved" | "running" | "completed" | "failed";

type ContainerRecord = {
  id: string;
  image: string;
  command?: string;
  status: ContainerStatus;
  requestedBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  error?: string;
};

const readContainers = async (): Promise<ContainerRecord[]> => {
  try {
    const raw = await fs.promises.readFile(CONTAINERS_PATH, "utf8");
    return JSON.parse(raw) as ContainerRecord[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeContainers = async (records: ContainerRecord[]) => {
  await fs.promises.mkdir(path.dirname(CONTAINERS_PATH), { recursive: true });
  await fs.promises.writeFile(CONTAINERS_PATH, JSON.stringify(records, null, 2));
};

const emitContainerEvent = (payload: Record<string, unknown>) => {
  emitServerEvent({ type: "container", payload: { ...payload, timestamp: new Date().toISOString() } });
};

const simulateRun = async (record: ContainerRecord) => {
  record.status = "running";
  record.startedAt = new Date().toISOString();
  record.logs = [
    `Launching ${record.image}...`,
    record.command ? `Executing command: ${record.command}` : "No command supplied."
  ];
  await new Promise((resolve) => setTimeout(resolve, 50));
  record.status = "completed";
  record.finishedAt = new Date().toISOString();
  record.logs?.push("Execution finished successfully.");
};

export const registerContainerRoutes = (app: express.Express) => {
  app.get("/api/containers", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (_req: Request, res: Response) => {
    const containers = await readContainers();
    res.json({ containers });
  });

  app.post(
    "/api/containers/run",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { image, command } = req.body as { image?: string; command?: string };
      if (!image) {
        return res.status(400).json({ error: "image is required" });
      }

      const record: ContainerRecord = {
        id: uuidv4(),
        image,
        command,
        status: "pending",
        requestedBy: (req as AuthenticatedRequest).user?.email ?? "unknown",
        createdAt: new Date().toISOString()
      };

      await SandboxManager.validate({ image, command });

      const containers = await readContainers();
      containers.push(record);
      await writeContainers(containers);
      emitContainerEvent({ action: "requested", containerId: record.id, image: record.image });

      res.status(202).json({ container: record });
    }
  );

  app.post(
    "/api/containers/:id/approve",
    authenticate,
    authorizeRoles(["admin", "owner"]),
    async (req: Request, res: Response) => {
      const { id } = req.params;
      const containers = await readContainers();
      const record = containers.find((item) => item.id === id);
      if (!record) {
        return res.status(404).json({ error: "Container request not found" });
      }

      if (record.status !== "pending") {
        return res.json({ container: record });
      }

      record.status = "approved";
      record.approvedAt = new Date().toISOString();
      record.approvedBy = (req as AuthenticatedRequest).user?.email;
      emitContainerEvent({ action: "approved", containerId: record.id });

      try {
        await SandboxManager.validate({ image: record.image, command: record.command });
        await simulateRun(record);
        emitContainerEvent({ action: "completed", containerId: record.id });
      } catch (error) {
        record.status = "failed";
        record.error = error instanceof Error ? error.message : String(error);
        record.finishedAt = new Date().toISOString();
        emitContainerEvent({ action: "failed", containerId: record.id, error: record.error });
      }

      await writeContainers(containers);
      res.json({ container: record });
    }
  );
};
