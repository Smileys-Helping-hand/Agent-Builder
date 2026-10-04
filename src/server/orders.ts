/**
 * Order routes — the customer pipeline, over HTTP.
 *
 * Read routes need an agent key with `read`; anything that moves an order
 * along needs `execute`. The one exception is intake, which needs `write`:
 * accepting an order is not the same power as starting a build with it.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { BuildService, buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { ProjectBuilds } from "../ecosystem/ProjectBuilds.js";
import { Catalog } from "../orders/Catalog.js";
import { OrderPipeline } from "../orders/OrderPipeline.js";
import { OrderReceipts } from "../orders/OrderReceipts.js";
import { OrderStore, ORDER_STATUSES, type OrderStatus } from "../orders/OrderStore.js";
import { Packager } from "../orders/Packager.js";
import { SiteClient } from "../orders/SiteClient.js";
import { Logger } from "../utils/Logger.js";
import { GameMode } from "../utils/GameMode.js";
import { signLink, verifyLink } from "../utils/SignedLinks.js";
import { readPublicUrl } from "../utils/PublicUrl.js";
import { shareableBuildPreview } from "./previews.js";

/** The build as a list needs it, without its thought feed and logs. */
const summarise = (buildId: string) => {
  const view = BuildService.view(buildId);
  return view ? BuildService.summary(view) : null;
};

const execFileAsync = promisify(execFile);

/** The latest build working on each template's code, by template id. */
const templateBuilds = new Map<string, string>();

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** An order plus everything the UI wants beside it. */
const expand = (orderId: string) => {
  const order = OrderStore.get(orderId);
  if (!order) return null;
  return {
    order,
    notes: OrderStore.notes(orderId, 30),
    receipts: OrderReceipts.forOrder(orderId).map((receipt) => ({ ...receipt, verified: OrderReceipts.verify(receipt) })),
    build: order.buildId ? summarise(order.buildId) : null
  };
};

export const registerOrderRoutes = (app: Express) => {
  OrderPipeline.start();

  app.get("/api/orders/status", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(OrderPipeline.status());
  });

  /**
   * What this builder can make (src/orders/Catalog.ts plus data/catalog.json).
   * The same list is published to the ordering site; see OrderPipeline.publish.
   */
  app.get("/api/orders/templates", authenticateAgent("read"), (_req: Request, res: Response) => {
    const templates = Catalog.list().map(({ buildNotes: _buildNotes, ...item }) => item);
    // Everything, hidden ones and build notes included, for the template editor.
    const all = Catalog.all().map((item) => ({
      ...item,
      builtIn: Catalog.isBuiltIn(item.id),
      developing: templateBuilds.get(item.id) ?? null
    }));
    res.json({ templates, all, count: templates.length, publishedToSite: OrderPipeline.status().catalog });
  });

  /** A new template. It goes to the site on the next check-in, or now if the site is connected. */
  app.post("/api/orders/templates", authenticateAgent("write"), (req: Request, res: Response) => {
    try {
      const template = Catalog.create((req.body ?? {}) as Record<string, unknown>);
      void OrderPipeline.publish();
      res.status(201).json({ template });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  app.patch("/api/orders/templates/:id", authenticateAgent("write"), (req: Request, res: Response) => {
    try {
      const template = Catalog.update(req.params.id, (req.body ?? {}) as Record<string, unknown>);
      void OrderPipeline.publish();
      res.json({ template });
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  /** Remove a template you added; a built-in one is hidden instead. */
  app.delete("/api/orders/templates/:id", authenticateAgent("write"), (req: Request, res: Response) => {
    try {
      const result = Catalog.remove(req.params.id);
      void OrderPipeline.publish();
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: errorMessage(error) });
    }
  });

  /**
   * Work on a template's code. With a source folder, this is the same as
   * carrying on with a project: it builds on a copy, and you apply the result.
   * Without one, it builds the template from its description, and that build
   * becomes the template's source folder when it finishes.
   */
  app.post("/api/orders/templates/:id/develop", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const template = Catalog.all().find((item) => item.id === req.params.id);
    if (!template) return res.status(404).json({ error: "Unknown template." });
    const { instruction } = (req.body ?? {}) as { instruction?: string };
    const actor = (req as AgentRequest).actor ?? "user";

    try {
      if (template.sourcePath && fs.existsSync(template.sourcePath)) {
        if (!instruction || instruction.trim().length < 3) {
          return res.status(400).json({ error: "Say what to change in the template." });
        }
        const record = await ProjectBuilds.start(
          { id: `template:${template.id}`, name: template.name, path: template.sourcePath },
          instruction.trim(),
          { startedBy: actor }
        );
        templateBuilds.set(template.id, record.buildId);
        return res.json({
          buildId: record.buildId,
          mode: "edit",
          message: `Working on a copy of ${template.name}. Apply the result when you are happy with it.`
        });
      }

      const build = BuildService.start({
        projectName: template.name,
        description: [
          `Build "${template.name}" as a reusable, sellable template: a complete, working starting point that is quick to tailor for each customer.`,
          template.description,
          template.features.length > 0 ? `It must include: ${template.features.join("; ")}.` : "",
          template.techStack?.length ? `Build it with: ${template.techStack.join(", ")}.` : "",
          template.buildNotes ?? "",
          "Keep business names, text, colours and images in one clearly marked place (a config or content file) so each customer's version is a small change.",
          instruction?.trim() ? `Also: ${instruction.trim()}` : ""
        ]
          .filter(Boolean)
          .join("\n"),
        targetPlatforms: ["web"],
        profile: "deep",
        startedBy: actor
      });
      templateBuilds.set(template.id, build.buildId);
      const ended = ["completed", "failed", "stopped"] as const;
      const detach = () => ended.forEach((event) => buildEvents.off(event, onEnded));
      function onEnded(this: unknown, record: BuildRecord) {
        if (record.buildId !== build.buildId) return;
        detach();
        const current = Catalog.all().find((item) => item.id === template!.id);
        if (record.state === "completed" && current && !current.sourcePath) {
          Catalog.update(template!.id, { sourcePath: path.resolve(record.outputDir) });
        }
      }
      ended.forEach((event) => buildEvents.on(event, onEnded));
      res.json({
        buildId: build.buildId,
        mode: "create",
        message: `Building ${template.name}. When it finishes, it becomes this template's source.`
      });
    } catch (error) {
      res.status(500).json({ error: errorMessage(error) });
    }
  });

  /** Send the catalogue to the site now rather than waiting for the next check-in. */
  app.post("/api/orders/templates/publish", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const result = await OrderPipeline.publish();
    res.status(result.ok ? 200 : 502).json(result);
  });

  /** Start building a template directly. */
  app.post("/api/orders/templates/:id/build", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const template = Catalog.get(req.params.id);
    if (!template) return res.status(404).json({ error: "Unknown template." });

    const { customerName, customBrief, budget } = (req.body ?? {}) as {
      customerName?: string;
      customBrief?: string;
      budget?: string;
    };

    const name = customerName?.trim() || "Internal Prototype";
    const brief = customBrief?.trim() || `Build production template: ${template.name}. ${template.description}. Features: ${template.features.join(", ")}.`;

    const { order } = OrderPipeline.record({
      source: "manual",
      customerName: name,
      productType: template.id,
      title: `${template.name} for ${name}`,
      brief,
      budget: budget || `${template.currency} ${template.price}`,
      timeline: template.timeframe,
      autoImprove: true
    });

    const buildResult = await OrderPipeline.startBuild(order.id, (req as AgentRequest).actor ?? "user");
    res.status(201).json({ order, build: buildResult?.build, message: `Started building ${template.name}.` });
  });

  /** Consolidated Hub & PayFast integration status. */
  app.get("/api/orders/hub/status", authenticateAgent("read"), async (_req: Request, res: Response) => {
    const siteConfig = SiteClient.describe();
    const payfastConfigured = Boolean(process.env.PAYFAST_MERCHANT_ID && process.env.PAYFAST_MERCHANT_KEY);
    res.json({
      siteUrl: siteConfig.site ?? "https://arpcloudsolutions.co.za",
      configured: siteConfig.configured,
      payfast: {
        configured: payfastConfigured,
        merchantId: process.env.PAYFAST_MERCHANT_ID ?? "36249939",
        mode: process.env.PAYFAST_MODE ?? "live"
      },
      intake: {
        lastIntakeAt: OrderPipeline.status().lastIntakeAt,
        lastIntakeCount: OrderPipeline.status().lastIntakeCount
      },
      catalog: OrderPipeline.status().catalog,
      counts: OrderStore.counts()
    });
  });

  /** Ping / test signal to Consolidated Hub (arpcloudsolutions.co.za). */
  app.post("/api/orders/hub/test", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const testResult = await SiteClient.testConnection();
    res.json(testResult);
  });

  /** What happened to every order, newest first. GET /api/orders/activity?limit=&kind= */
  app.get("/api/orders/activity", authenticateAgent("read"), (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 100;
    const kind = typeof req.query.kind === "string" && /^[a-z_-]{1,40}$/.test(req.query.kind) ? req.query.kind : undefined;
    res.json({ activity: OrderStore.activity({ limit, kind }) });
  });

  /** Every hand-over on record, each checked against its digest. GET /api/orders/receipts */
  app.get("/api/orders/receipts", authenticateAgent("read"), (req: Request, res: Response) => {
    const receipts = OrderReceipts.list(Number(req.query.limit) || 100);
    res.json({ receipts: receipts.map((receipt) => ({ ...receipt, verified: OrderReceipts.verify(receipt) })) });
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
        build: order.buildId ? summarise(order.buildId) : null
      })),
      counts: OrderStore.counts()
    });
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
      const intake = await OrderPipeline.intake();
      // "Check now" also refreshes what the site shows and its "PC online" light.
      const catalog = await OrderPipeline.publish();
      res.json({ ...intake, catalog });
    } catch (error) {
      res.status(502).json({ error: "Could not reach the site.", details: errorMessage(error) });
    }
  });

  /** Run an improvement pass now instead of waiting for the timer. */
  app.post("/api/orders/improve", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    res.json(await OrderPipeline.improve());
  });

  /**
   * A link to download an order's package, for a browser tab: it carries a
   * signature for this one order instead of the agent key (a key in a URL ends
   * up in every proxy and tunnel log). Valid for an hour.
   */
  app.post("/api/orders/:id/download-link", authenticateAgent("read"), (req: Request, res: Response) => {
    const order = OrderStore.get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found." });
    const token = signLink("download", order.id, 60 * 60 * 1000);
    res.json({ path: `/api/orders/${encodeURIComponent(order.id)}/download?t=${encodeURIComponent(token)}`, expiresInMinutes: 60 });
  });

  /**
   * The order's package: the built site as one double-clickable file, the
   * source without node_modules, and how to open both (see Packager). Needs an
   * agent key or a signed link — an order's code is the customer's, not public.
   */
  app.get("/api/orders/:id/download", async (req: Request, res: Response, next) => {
    // A signed link stands in for the key; anything else goes through the usual check.
    if (!verifyLink("download", req.params.id, req.query.t)) {
      return authenticateAgent("read")(req, res, next);
    }
    next();
  }, async (req: Request, res: Response) => {
    const order = OrderStore.get(req.params.id);
    if (!order) return res.status(404).json({ error: "Order not found." });

    const sourceDir = order.deliverablePath ?? (order.buildId ? BuildService.view(order.buildId)?.outputDir ?? null : null);
    if (!sourceDir || !fs.existsSync(sourceDir)) {
      return res.status(409).json({ error: "Nothing has been built for this order yet, so there is nothing to download." });
    }
    try {
      const pkg = await Packager.packageBuild(path.resolve(sourceDir), order.title, order.id);
      res.download(pkg.zipPath, pkg.fileName);
    } catch (error) {
      res.status(500).json({ error: `Could not package it: ${error instanceof Error ? error.message : String(error)}` });
    }
  });

  app.get("/api/orders/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const detail = expand(req.params.id);
    if (!detail) return res.status(404).json({ error: "Unknown order." });
    res.json(detail);
  });

  app.post("/api/orders/:id/accept", authenticateAgent("execute"), (req: Request, res: Response) => {
    const order = OrderPipeline.accept(req.params.id, (req as AgentRequest).actor ?? "user");
    if (!order) return res.status(404).json({ error: "Unknown order." });
    res.json({ order });
  });

  app.post("/api/orders/:id/build", authenticateAgent("execute"), async (req: Request, res: Response) => {
    if (GameMode.isOn()) {
      return res.status(409).json({ error: "Game mode is on: switch it off to build. The order waits in the queue until then." });
    }
    const result = await OrderPipeline.startBuild(req.params.id, (req as AgentRequest).actor ?? "user");
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
  /**
   * Send the customer a link to click through the built site before handover.
   * Their dashboard on the site shows it and they are emailed that the first
   * version is ready to look at. POST /api/orders/:id/share-preview
   */
  app.post("/api/orders/:id/share-preview", authenticateAgent("execute"), (req: Request, res: Response) => {
    const order = OrderStore.get(req.params.id);
    if (!order) return res.status(404).json({ error: "Unknown order." });
    if (!order.buildId) return res.status(409).json({ error: "Nothing has been built for this order yet." });
    const previewUrl = shareableBuildPreview(order.buildId, readPublicUrl());
    if (!previewUrl) {
      return res.status(409).json({
        error: readPublicUrl()
          ? "The build has no site to show yet: it needs a passing build first."
          : "This PC has no public address right now (the tunnel is down), so the customer could not open it."
      });
    }
    if (order.externalId) {
      void SiteClient.reportProgress(order.externalId, {
        status: "in-progress",
        message: "Your first version is ready to look at. Click through it and tell us what to change.",
        qualityScore: order.qualityScore,
        previewUrl
      });
    }
    OrderStore.note(order.id, "shared", `Preview shared with ${order.customerName}: ${previewUrl}`);
    res.json({ previewUrl, sentToSite: Boolean(order.externalId) });
  });

  app.post("/api/orders/:id/deliver", authenticateAgent("execute"), (req: Request, res: Response) => {
    const given = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    // No address given: hand over the live preview, so the customer has something to open.
    const existing = OrderStore.get(req.params.id);
    const url = given || existing?.deliverableUrl || (existing?.buildId ? shareableBuildPreview(existing.buildId, readPublicUrl()) : null);
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

  Logger.log("Order routes registered", SiteClient.describe());
};
