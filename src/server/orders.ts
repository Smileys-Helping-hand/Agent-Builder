/**
 * Order routes — the customer pipeline, over HTTP.
 *
 * Read routes need an agent key with `read`; anything that moves an order
 * along needs `execute`. The one exception is intake, which needs `write`:
 * accepting an order is not the same power as starting a build with it.
 */
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { OrderPipeline } from "../orders/OrderPipeline.js";
import { OrderStore, ORDER_STATUSES, type OrderStatus } from "../orders/OrderStore.js";
import { SiteClient } from "../orders/SiteClient.js";
import { Logger } from "../utils/Logger.js";

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** An order plus everything the UI wants beside it. */
const expand = (orderId: string) => {
  const order = OrderStore.get(orderId);
  if (!order) return null;
  return {
    order,
    notes: OrderStore.notes(orderId, 30),
    build: order.buildId ? BuildService.view(order.buildId) : null
  };
};

export const registerOrderRoutes = (app: Express) => {
  OrderPipeline.start();

  app.get("/api/orders/status", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(OrderPipeline.status());
  });

  app.get("/api/orders", authenticateAgent("read"), (req: Request, res: Response) => {
    const requested = typeof req.query.status === "string" ? req.query.status.split(",") : [];
    const statuses = requested.filter((status): status is OrderStatus =>
      ORDER_STATUSES.includes(status as OrderStatus)
    );
    const orders = OrderStore.list(statuses.length > 0 ? { status: statuses } : {});
    res.json({
      orders: orders.map((order) => ({
        ...order,
        build: order.buildId ? BuildService.view(order.buildId) : null
      })),
      counts: OrderStore.counts()
    });
  });

  app.get("/api/orders/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const detail = expand(req.params.id);
    if (!detail) return res.status(404).json({ error: "Unknown order." });
    res.json(detail);
  });

  /**
   * Take an order in. This is both the manual "add one by hand" route and the
   * inbound webhook the site can use if it would rather push than be polled.
   * POST /api/orders
   */
  app.post("/api/orders", authenticateAgent("write"), (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const str = (key: string): string => (typeof body[key] === "string" ? (body[key] as string).trim() : "");

    const customerName = str("customerName") || str("name");
    const brief = str("brief") || str("projectDescription") || str("description");
    if (!customerName || !brief) {
      return res.status(400).json({ error: "customerName and brief are required." });
    }
    if (brief.length < 20) {
      return res.status(400).json({ error: "The brief is too short to build from — give it a sentence or two." });
    }

    const productType = str("productType") || str("serviceType") || "website";
    try {
      const { order, created } = OrderPipeline.record({
        externalId: str("externalId") || str("id") || null,
        source: (["site", "manual", "jarvis", "api"] as const).includes(body.source as never)
          ? (body.source as "site" | "manual" | "jarvis" | "api")
          : "manual",
        customerName,
        customerEmail: str("customerEmail") || str("email") || null,
        productType,
        title: str("title") || `${productType} for ${customerName}`,
        brief,
        budget: str("budget") || null,
        timeline: str("timeline") || null,
        autoImprove: body.autoImprove !== false
      });
      res.status(created ? 201 : 200).json({ order, created });
    } catch (error) {
      Logger.error("Failed to record order", { error: errorMessage(error) });
      res.status(500).json({ error: "Could not record that order.", details: errorMessage(error) });
    }
  });

  /** Pull from the site now rather than waiting for the timer. */
  app.post("/api/orders/intake", authenticateAgent("write"), async (_req: Request, res: Response) => {
    if (!SiteClient.isConfigured()) {
      return res.status(400).json({
        error: "No ordering site is configured. Set SITE_URL and SITE_API_KEY."
      });
    }
    try {
      res.json(await OrderPipeline.intake());
    } catch (error) {
      res.status(502).json({ error: "Could not reach the site.", details: errorMessage(error) });
    }
  });

  app.post("/api/orders/:id/accept", authenticateAgent("execute"), (req: Request, res: Response) => {
    const order = OrderPipeline.accept(req.params.id, (req as AgentRequest).actor ?? "user");
    if (!order) return res.status(404).json({ error: "Unknown order." });
    res.json({ order });
  });

  app.post("/api/orders/:id/build", authenticateAgent("execute"), (req: Request, res: Response) => {
    const result = OrderPipeline.startBuild(req.params.id, (req as AgentRequest).actor ?? "user");
    if (!result) {
      return res.status(409).json({ error: "That order cannot be built right now — it may already be building." });
    }
    res.json(result);
  });

  /** Pass an instruction through to the build behind this order. */
  app.post("/api/orders/:id/instruct", authenticateAgent("execute"), (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "Provide the instruction as { text }." });
    const ok = OrderPipeline.addInstruction(req.params.id, text, (req as AgentRequest).actor ?? "user");
    if (!ok) return res.status(409).json({ error: "Nothing is building for that order." });
    res.json({ success: true, appliesFrom: "the next pass" });
  });

  /** Hand it over. Deliberately a person's decision, never the pipeline's. */
  app.post("/api/orders/:id/deliver", authenticateAgent("execute"), (req: Request, res: Response) => {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : null;
    const order = OrderPipeline.deliver(req.params.id, url || null, (req as AgentRequest).actor ?? "user");
    if (!order) return res.status(404).json({ error: "Unknown order." });
    res.json({ order });
  });

  app.post("/api/orders/:id/cancel", authenticateAgent("execute"), (req: Request, res: Response) => {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "No reason given.";
    const order = OrderPipeline.cancel(req.params.id, reason, (req as AgentRequest).actor ?? "user");
    if (!order) return res.status(404).json({ error: "Unknown order." });
    res.json({ order });
  });

  /** Turn continuous improvement on or off for one order. */
  app.patch("/api/orders/:id", authenticateAgent("execute"), (req: Request, res: Response) => {
    const patch: { autoImprove?: boolean; notes?: string } = {};
    if (typeof req.body?.autoImprove === "boolean") patch.autoImprove = req.body.autoImprove;
    if (typeof req.body?.notes === "string") patch.notes = req.body.notes.slice(0, 4000);
    const order = OrderStore.update(req.params.id, patch);
    if (!order) return res.status(404).json({ error: "Unknown order." });
    res.json({ order });
  });

  /** Run an improvement pass now instead of waiting for the timer. */
  app.post("/api/orders/improve", authenticateAgent("execute"), (_req: Request, res: Response) => {
    res.json(OrderPipeline.improve());
  });

  Logger.log("Order routes registered", SiteClient.describe());
};
