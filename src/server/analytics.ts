import express, { type Request, type Response } from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { MemoryStore } from "../state/MemoryStore.js";
import { VectorMemory } from "../state/VectorMemory.js";
import { RLTrainer } from "../orchestrator/RLTrainer.js";
import { emitServerEvent } from "./eventBus.js";

const toArray = <T>(value: Record<string, T>) => Object.values(value ?? {});

export const registerAnalyticsRoutes = (app: express.Express) => {
  app.get("/api/analytics/usage", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (_req: Request, res: Response) => {
    const memory = MemoryStore.load();
    const tasks = toArray(memory);

    const byStatus = tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.status] = (acc[task.status] ?? 0) + 1;
      return acc;
    }, {});

    const byAgent = tasks.reduce<Record<string, number>>((acc, task) => {
      acc[task.agentType] = (acc[task.agentType] ?? 0) + 1;
      return acc;
    }, {});

    const durations = tasks
      .map((task) => task.durationMs ?? (task.startedAt && task.completedAt
        ? new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()
        : null))
      .filter((value): value is number => value !== null && Number.isFinite(value));

    const averageDuration =
      durations.length > 0 ? Math.round(durations.reduce((total, value) => total + value, 0) / durations.length) : null;

    const longestDuration = durations.length > 0 ? Math.max(...durations) : null;
    const shortestDuration = durations.length > 0 ? Math.min(...durations) : null;

    const vectorEnabled = VectorMemory.isEnabled();
    const vectorCount = vectorEnabled ? await VectorMemory.count() : 0;

    const rlInsights = await RLTrainer.analyzeFeedback();

    const payload = {
      tasks: {
        total: tasks.length,
        byStatus,
        byAgent,
        averageDuration,
        longestDuration,
        shortestDuration
      },
      memory: {
        vectorEnabled,
        vectorCount
      },
      feedback: rlInsights
    };

    emitServerEvent({ type: "analytics", payload: { summary: payload, timestamp: new Date().toISOString() } });

    res.json(payload);
  });
};
