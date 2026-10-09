import os from "os";
import express from "express";
import { Telemetry } from "../observability/Telemetry.js";
import { VectorMemory } from "../state/VectorMemory.js";
import { QueueService } from "../queue/QueueService.js";
import { PolicyEngine } from "../security/PolicyEngine.js";
import { Logger } from "../utils/Logger.js";
import { StallWatch } from "../utils/StallWatch.js";
import { emitServerEvent } from "./eventBus.js";

export type ComponentStatus = "ok" | "degraded" | "down";

export type HealthSnapshot = {
  status: ComponentStatus;
  uptimeSeconds: number;
  timestamp: string;
  components: Record<string, { status: ComponentStatus; details?: Record<string, unknown> }>;
};

const deriveGlobalStatus = (components: HealthSnapshot["components"]): ComponentStatus => {
  if (Object.values(components).some((entry) => entry.status === "down")) {
    return "down";
  }
  if (Object.values(components).some((entry) => entry.status === "degraded")) {
    return "degraded";
  }
  return "ok";
};

export class HealthMonitor {
  private lastSnapshot: HealthSnapshot | null = null;

  async evaluate(): Promise<HealthSnapshot> {
    const timestamp = new Date().toISOString();
    const components: HealthSnapshot["components"] = {};

    components.runtime = {
      status: "ok",
      details: {
        loadAvg: os.loadavg(),
        memoryUsage: process.memoryUsage(),
        platform: `${os.type()} ${os.release()}`,
        // Times the whole builder was frozen (over 3 s) since it started.
        freezes: StallWatch.status()
      }
    };
    Telemetry.setHealth("runtime", "ok");

    try {
      const vectorStatus = VectorMemory.isEnabled() ? "ok" : "degraded";
      components.vectorMemory = {
        status: vectorStatus,
        details: {
          enabled: VectorMemory.isEnabled()
        }
      };
      Telemetry.setHealth("vectorMemory", vectorStatus);
    } catch (error) {
      components.vectorMemory = { status: "down", details: { error: (error as Error).message } };
      Telemetry.setHealth("vectorMemory", "down");
    }

    try {
      const queue = await QueueService.getInstance();
      const metrics = await queue.getMetrics();
      const queueStatus = metrics.connected ? "ok" : "degraded";
      components.queue = { status: queueStatus, details: metrics };
      Telemetry.setHealth("queue", queueStatus);
    } catch (error) {
      components.queue = { status: "down", details: { error: (error as Error).message } };
      Telemetry.setHealth("queue", "down");
    }

    try {
      const policy = await PolicyEngine.getInstance();
      components.policy = { status: "ok", details: { revision: policy.getRevision(), rules: policy.countRules() } };
      Telemetry.setHealth("policy", "ok");
    } catch (error) {
      components.policy = { status: "degraded", details: { error: (error as Error).message } };
      Telemetry.setHealth("policy", "degraded");
    }

    const snapshot: HealthSnapshot = {
      status: deriveGlobalStatus(components),
      uptimeSeconds: process.uptime(),
      timestamp,
      components
    };

    this.lastSnapshot = snapshot;
    emitServerEvent({ type: "health", payload: { snapshot, timestamp } });
    return snapshot;
  }

  getLastSnapshot(): HealthSnapshot | null {
    return this.lastSnapshot;
  }
}

export const registerHealthRoute = (app: express.Express, monitor: HealthMonitor) => {
  app.get("/api/health", async (_req, res) => {
    try {
      const snapshot = await monitor.evaluate();
      res.json(snapshot);
    } catch (error) {
      Logger.error("Health check failed", error);
      const previous = monitor.getLastSnapshot();
      if (previous) {
        res.status(503).json(previous);
      } else {
        res.status(503).json({ status: "down", error: (error as Error).message });
      }
    }
  });
};
