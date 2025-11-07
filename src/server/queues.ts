import express from "express";
import { QueueService } from "../queue/QueueService.js";
import { QueueCluster } from "../queue/QueueCluster.js";
import { emitServerEvent } from "./eventBus.js";
import { authenticate, authorizeRoles } from "./auth.js";
import { PolicyEngine } from "../security/PolicyEngine.js";

export const registerQueueRoutes = (app: express.Express) => {
  app.get("/api/queue/metrics", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), async (_req, res) => {
    const queue = await QueueService.getInstance();
    const metrics = await queue.getMetrics();
    const cluster = QueueCluster.getInstance();
    res.json({ metrics, cluster: { nodes: cluster.getNodes(), leader: cluster.getLeader() } });
  });

  app.post(
    "/api/queue/cluster/register",
    authenticate,
    authorizeRoles(["admin", "owner"]),
    (req, res) => {
      const cluster = QueueCluster.getInstance();
      const { id, host, role } = req.body as { id?: string; host?: string; role?: "leader" | "worker" };
      if (!id || !host || !role) {
        return res.status(400).json({ error: "id, host, and role are required" });
      }
      const node = cluster.register({ id, host, role });
      res.status(201).json({ node });
    }
  );

  app.post(
    "/api/queue/publish",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req, res) => {
      const { queue: queueName, message } = req.body as { queue?: string; message?: Record<string, unknown> };
      if (!queueName || !message) {
        return res.status(400).json({ error: "queue and message are required" });
      }
      const policy = await PolicyEngine.getInstance();
      const publishRules = policy
        .listRules()
        .filter((rule) => rule.action === "queue.publish" && Array.isArray(rule.conditions?.channels))
        .flatMap((rule) => (rule.conditions?.channels as unknown[]).map((value) => String(value)));
      if (publishRules.length > 0 && !publishRules.includes(queueName)) {
        return res.status(403).json({ error: `Queue ${queueName} is not permitted by policy` });
      }
      const queue = await QueueService.getInstance();
      await queue.publish(queueName, message);
      emitServerEvent({
        type: "queue",
        payload: { queue: queueName, action: "publish", timestamp: new Date().toISOString() }
      });
      res.status(202).json({ status: "queued" });
    }
  );
};
