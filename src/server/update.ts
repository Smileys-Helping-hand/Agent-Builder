import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { AgentUpdater } from "../orchestrator/AgentUpdater.js";
import { authenticate } from "./auth.js";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve("package.json"), "utf8")
) as { version?: string };

const parseVersion = (value: string | undefined) => value?.trim() ?? "0.0.0";

const isUpdateAvailable = (current: string, latest: string) => {
  const currentParts = current.split(".").map((part) => Number(part));
  const latestParts = latest.split(".").map((part) => Number(part));
  for (let index = 0; index < Math.max(currentParts.length, latestParts.length); index += 1) {
    const currentValue = currentParts[index] ?? 0;
    const latestValue = latestParts[index] ?? 0;
    if (latestValue > currentValue) {
      return true;
    }
    if (latestValue < currentValue) {
      return false;
    }
  }
  return false;
};

export const registerUpdateRoute = (app: express.Express) => {
  const updater = new AgentUpdater();

  app.get("/api/update/check", (_req: Request, res: Response) => {
    const currentVersion = parseVersion(packageJson.version);
    const advertisedVersion = parseVersion(process.env.AGENT_BUILDER_LATEST ?? packageJson.version);
    res.json({
      currentVersion,
      latestVersion: advertisedVersion,
      updateAvailable: isUpdateAvailable(currentVersion, advertisedVersion)
    });
  });

  app.post("/api/agent/update", authenticate, async (req: Request, res: Response) => {
    const { taskId, instruction } = (req.body ?? {}) as {
      taskId?: string;
      instruction?: string;
    };

    if (!taskId) {
      return res.status(400).json({ error: "taskId is required" });
    }

    try {
      const result = await updater.apply(taskId, instruction);
      return res.json({ updated: true, result });
    } catch (error: any) {
      return res.status(400).json({ error: error?.message ?? "Unable to update task" });
    }
  });
};
