import express, { Request, Response } from "express";
import { AgentUpdater } from "../orchestrator/AgentUpdater.js";

export const registerUpdateRoute = (app: express.Express) => {
  const updater = new AgentUpdater();

  app.post("/api/agent/update", async (req: Request, res: Response) => {
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
