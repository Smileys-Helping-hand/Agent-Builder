/**
 * OrderPipeline — the thing that turns "a customer asked for a website" into
 * "here is the website", and then keeps working on it.
 *
 * It runs three loops on timers:
 *
 *   intake   — pull new orders from the ordering site.
 *   work     — start a build for the next accepted order, within a concurrency
 *              limit, because this machine has one GPU and builds are greedy.
 *   improve  — revisit delivered products and put them through another pass.
 *
 * Delivery is the middle of the story, not the end. An order that reaches
 * "delivered" with autoImprove on moves to "maintained", and the improve loop
 * keeps raising its quality afterwards. That is the whole premise: the customer
 * gets something that gets better after they receive it.
 *
 * Nothing here ever emails a customer or publishes anything. The pipeline
 * prepares the deliverable and moves the order to "review"; a person decides
 * when it actually goes out.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { BuildService, buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { JarvisClient } from "../integrations/JarvisClient.js";
import { Logger } from "../utils/Logger.js";
import { copyForBuild } from "../ecosystem/ProjectBuilds.js";
import { Catalog } from "./Catalog.js";
import { OrderStore, type Order } from "./OrderStore.js";
import { SiteClient, type SiteOrder } from "./SiteClient.js";
import { readPublicUrl } from "../utils/PublicUrl.js";

const INTAKE_EVERY_MS = 5 * 60 * 1000;
const WORK_EVERY_MS = 60 * 1000;
const IMPROVE_EVERY_MS = 6 * 60 * 60 * 1000;

/** Builds a delivered product must wait before being improved again. */
const IMPROVE_COOLDOWN_MS = 12 * 60 * 60 * 1000;

/** Quality below which an improvement pass is worth the electricity. */
const IMPROVE_BELOW = 97;

const numberEnv = (name: string, fallback: number): number => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
};

/** One GPU, so one build at a time by default. */
const maxConcurrent = (): number => numberEnv("ORDER_MAX_CONCURRENT_BUILDS", 1);

/** Orders are only started automatically if this is on. */
const autoStart = (): boolean => (process.env.ORDER_AUTO_START ?? "true").toLowerCase() !== "false";

/** Whether the improve loop runs at all. */
const autoImprove = (): boolean => (process.env.ORDER_AUTO_IMPROVE ?? "true").toLowerCase() !== "false";

/**
 * An order the customer has already paid for on the site skips "New" and goes
 * straight into the queue. Money changing hands is the acceptance.
 */
const autoAcceptPaid = (): boolean => (process.env.ORDER_AUTO_ACCEPT_PAID ?? "true").toLowerCase() !== "false";

/** Our version, for the site's admin to show beside "online". */
const appVersion = (() => {
  let cached: string | null = null;
  return (): string => {
    if (cached) return cached;
    try {
      const pkg = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { version?: string };
      cached = pkg.version ?? "unknown";
    } catch {
      cached = "unknown";
    }
    return cached;
  };
})();

const timers: NodeJS.Timeout[] = [];
let started = false;
let lastIntakeAt: string | null = null;
let lastIntakeCount = 0;
let lastPublish: { at: string; ok: boolean; message: string; count: number } | null = null;

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Turn whatever shape the site uses into the fields an order needs. */
const normalize = (raw: SiteOrder): Parameters<typeof OrderStore.create>[0] | null => {
  const brief = (raw.brief ?? raw.projectDescription ?? "").trim();
  const customerName = (raw.customerName ?? raw.name ?? "").trim();
  if (!brief || !customerName) return null;

  // A catalogue pick is recorded by its id, the same way a template started
  // from the phone is, so buildPrompt can find the template again.
  const template = Catalog.get(raw.templateId);
  const productType = template?.id ?? ((raw.productType ?? raw.serviceType ?? "website").trim() || "website");
  const features = (raw.features ?? []).filter((feature) => typeof feature === "string" && !brief.includes(feature));
  return {
    externalId: raw.id,
    source: "site",
    customerName,
    customerEmail: (raw.customerEmail ?? raw.email ?? "").trim() || null,
    productType,
    // The site rarely collects a title, so fall back to something a human can
    // scan in a list: what they want, for whom.
    title: (raw.title ?? "").trim() || `${template?.name ?? productType} for ${customerName}`,
    brief: features.length > 0 ? `${brief}\n\nFeatures they chose: ${features.join(", ")}.` : brief,
    budget: raw.budget ?? null,
    timeline: raw.timeline ?? null
  };
};

/**
 * The brief a customer writes is not a build prompt. This adds what the
 * orchestrator needs to know and keeps the customer's words intact and first,
 * so nothing it asked for gets paraphrased away.
 */
/** Where a build starts: nothing, the template's code, or what was built last time. */
type StartingPoint = "scratch" | "template" | "previous";

const buildPrompt = (order: Order, from: StartingPoint = "scratch"): string => {
  const template = Catalog.get(order.productType);
  return [
    from === "previous"
      ? `This ${template?.name ?? order.productType} was built for a paying customer. Improve it: finish anything missing, fix what is broken, and polish it. Do not start again.`
      : from === "template"
        ? `The project is our "${template?.name}" template. Tailor it for a paying customer: their content, their business, what they asked for.`
        : `Build a ${template?.name ?? order.productType} for a paying customer.`,
    "",
    "What the customer asked for, in their words:",
    order.brief,
    "",
    ...(template
      ? [
          `They chose "${template.name}" from our catalogue: ${template.description}`,
          template.features.length > 0 ? `It comes with: ${template.features.join("; ")}.` : "",
          template.techStack?.length ? `Build it with: ${template.techStack.join(", ")}.` : "",
          template.buildNotes ?? "",
          "Where the customer's words and the template disagree, the customer wins.",
          ""
        ]
      : []),
    order.timeline ? `They expect it by: ${order.timeline}.` : "",
    "This is going to a real customer, so it has to be finished, not a sketch:",
    "- Every page and link in the brief must exist and work.",
    "- It must look right on a phone as well as a desktop.",
    "- Forms must validate their input and say what went wrong.",
    "- No placeholder text, no lorem ipsum, no TODO comments left in.",
    "- Include a short README saying how to run it and how to change the content."
  ]
    .filter(Boolean)
    .join("\n");
};

const notifyJarvis = (order: Order, subject: string, body: string): void => {
  void JarvisClient.send({
    type: "build",
    project: order.title,
    subject,
    body,
    metadata: { orderId: order.id, status: order.status, customer: order.customerName }
  });
};

const publicHttpsUrl = (): string | null => {
  const url = readPublicUrl();
  return url && url.startsWith("https://") ? url.replace(/\/+$/, "") : null;
};

export const OrderPipeline = {
  /**
   * Record an order and announce it. Every route in matters equally — an order
   * added by hand deserves the same announcement as one pulled off the site —
   * so both go through here rather than straight to the store.
   */
  record(input: Parameters<typeof OrderStore.create>[0]): { order: Order; created: boolean } {
    const result = OrderStore.create(input);
    if (!result.created) return result;

    const { order } = result;
    Logger.log("Order received", { orderId: order.id, source: order.source, customer: order.customerName });
    notifyJarvis(
      order,
      `New order: ${order.title}`,
      [
        `${order.customerName} ordered a ${order.productType}.`,
        order.customerEmail ? `Contact: ${order.customerEmail}` : "",
        order.budget ? `Budget: ${order.budget}` : "",
        order.timeline ? `Timeline: ${order.timeline}` : "",
        "",
        order.brief
      ]
        .filter(Boolean)
        .join("\n")
    );
    if (order.externalId) {
      void SiteClient.reportProgress(order.externalId, {
        status: "received",
        message: "Agent Builder has the order and will start on it."
      });
    }
    return result;
  },

  /** Pull new orders from the site. Safe to call at any time. */
  async intake(): Promise<{ found: number; created: number }> {
    if (!SiteClient.isConfigured()) return { found: 0, created: 0 };

    const raw = await SiteClient.pendingOrders();
    let created = 0;
    for (const candidate of raw) {
      const normalized = normalize(candidate);
      if (!normalized) {
        Logger.log("Order skipped: not enough detail", { externalId: candidate.id });
        continue;
      }
      const { order, created: isNew } = this.record(normalized);
      if (isNew) created += 1;
      if (!candidate.paid) continue;

      // Paid for on the site. Often we already had it — the quote was accepted
      // before the customer paid — and the site sends it again to say so.
      if (order.status === "received" && autoAcceptPaid()) {
        this.accept(order.id, `payment on the site${candidate.orderRef ? ` (${candidate.orderRef})` : ""}`);
      }
      // Tell the site we know, or it keeps sending it. (A new order's own
      // "received" report, from record(), already said so.)
      if (!isNew && order.externalId && (order.status === "received" || order.status === "accepted")) {
        OrderStore.note(order.id, "paid", "Paid for on the site.");
        const queued = OrderStore.get(order.id)?.status === "accepted";
        void SiteClient.reportProgress(order.externalId, {
          status: "received",
          message: queued ? "Payment seen; it is in the build queue." : "Payment seen; waiting to be accepted on the PC."
        });
      }
    }

    lastIntakeAt = new Date().toISOString();
    lastIntakeCount = raw.length;
    return { found: raw.length, created };
  },

  /**
   * Tell the site what we can build and how busy we are. Runs with every
   * intake, so the site's "PC online" light and its catalogue stay current.
   */
  async publish(): Promise<{ ok: boolean; message: string; count: number }> {
    const items = Catalog.forSite();
    const counts = OrderStore.counts();
    const result = await SiteClient.checkIn({
      items,
      version: appVersion(),
      machine: os.hostname(),
      queueLength: counts.received + counts.accepted,
      building: counts.building,
      // Only an https address is any use to the site: its admin opens the app
      // from an https page, and a browser will not call plain http from there.
      address: publicHttpsUrl()
    });
    lastPublish = { at: new Date().toISOString(), ok: result.ok, message: result.message, count: items.length };
    if (!result.ok) Logger.log("Catalogue not published to the site", { detail: result.message });
    return { ok: result.ok, message: result.message, count: items.length };
  },

  /** Move an order to accepted, so the work loop will pick it up. */
  accept(orderId: string, by = "user"): Order | null {
    const order = OrderStore.get(orderId);
    if (!order) return null;
    if (order.status !== "received") return order;
    OrderStore.note(orderId, "accepted", `Accepted by ${by}.`);
    return OrderStore.update(orderId, { status: "accepted" });
  },

  cancel(orderId: string, reason: string, by = "user"): Order | null {
    const order = OrderStore.get(orderId);
    if (!order) return null;
    if (order.buildId && BuildService.isRunning(order.buildId)) {
      BuildService.control(order.buildId, "stop");
    }
    OrderStore.note(orderId, "cancelled", `Cancelled by ${by}: ${reason}`);
    const updated = OrderStore.update(orderId, { status: "cancelled", buildId: null });
    if (order.externalId) {
      void SiteClient.reportProgress(order.externalId, { status: "cancelled", message: reason });
    }
    return updated;
  },

  /**
   * Start building an order now, regardless of the work loop. Returns null if
   * the order cannot be built (unknown, already building, or cancelled).
   */
  async startBuild(orderId: string, by = "pipeline"): Promise<{ order: Order; build: BuildRecord } | null> {
    const order = OrderStore.get(orderId);
    if (!order) return null;
    if (order.buildId && BuildService.isRunning(order.buildId)) return null;
    if (order.status === "cancelled" || order.status === "delivered") return null;

    // Carry on from what was built last time (an improvement pass, or a rebuild
    // after review); failing that, from the template's own code; failing that,
    // from nothing.
    const template = Catalog.get(order.productType);
    const previous = order.deliverablePath && fs.existsSync(order.deliverablePath) ? order.deliverablePath : null;
    const source = previous ?? (template?.sourcePath && fs.existsSync(template.sourcePath) ? template.sourcePath : null);
    const from: StartingPoint = previous ? "previous" : source ? "template" : "scratch";

    let workingDir: string | undefined;
    if (source) {
      try {
        ({ workDir: workingDir } = await copyForBuild(source, order.title, "order"));
      } catch (error) {
        OrderStore.note(orderId, "building", `Could not copy ${source} (${errorMessage(error)}); building from scratch instead.`);
      }
    }

    const attempts = OrderStore.recordAttempt(orderId);
    const build = BuildService.start({
      projectName: order.title,
      description: buildPrompt(order, workingDir ? from : "scratch"),
      targetPlatforms: ["web"],
      // A customer deliverable is worth the slow profile; this is exactly the
      // "trade time for quality" case the whole app exists for.
      profile: "deep",
      qualityThreshold: 92,
      // Working on code that exists is a bounded job, not an open-ended one.
      maxIterations: workingDir ? 8 : undefined,
      workingDir,
      startedBy: `order:${order.id} (${by})`,
      orderId: order.id
    });

    OrderStore.note(
      orderId,
      "building",
      `Build ${build.buildId} started (attempt ${attempts})${workingDir ? `, from ${from === "previous" ? "the last build" : "the template's code"}` : ""}.`
    );
    const updated = OrderStore.update(orderId, { status: "building", buildId: build.buildId });
    if (order.externalId) {
      void SiteClient.reportProgress(order.externalId, {
        status: "building",
        message: "Work has started on your order."
      });
    }
    return { order: updated ?? order, build };
  },

  /**
   * Give the build behind an order a further instruction. This is how a change
   * the customer asks for mid-job reaches the model.
   */
  addInstruction(orderId: string, text: string, by = "user"): boolean {
    const order = OrderStore.get(orderId);
    if (!order?.buildId) return false;
    const note = BuildService.guide(order.buildId, text, by);
    if (!note) return false;
    OrderStore.note(orderId, "instruction", text);
    return true;
  },

  /**
   * Hand the finished product to the customer. This is the deliberate,
   * person-made step: the pipeline never does it on its own.
   */
  deliver(orderId: string, deliverableUrl: string | null, by = "user"): Order | null {
    const order = OrderStore.get(orderId);
    if (!order) return null;
    if (order.status !== "review" && order.status !== "maintained") {
      OrderStore.note(orderId, "delivered", `Delivered by ${by} from status "${order.status}".`);
    } else {
      OrderStore.note(orderId, "delivered", `Delivered by ${by}.`);
    }

    const updated = OrderStore.update(orderId, {
      status: order.autoImprove ? "maintained" : "delivered",
      deliverableUrl: deliverableUrl ?? order.deliverableUrl
    });

    if (order.externalId) {
      void SiteClient.reportProgress(order.externalId, {
        status: "delivered",
        message: "Your order is ready.",
        qualityScore: order.qualityScore,
        previewUrl: deliverableUrl ?? order.deliverableUrl
      });
    }
    notifyJarvis(
      updated ?? order,
      `Delivered: ${order.title}`,
      [
        `${order.title} has been handed to ${order.customerName}.`,
        `Quality score: ${Math.round(order.qualityScore)}`,
        deliverableUrl ?? order.deliverableUrl ? `Where: ${deliverableUrl ?? order.deliverableUrl}` : "",
        order.autoImprove
          ? "It stays enrolled for continuous improvement, so it will keep getting better."
          : "Continuous improvement is off for this order."
      ]
        .filter(Boolean)
        .join("\n")
    );
    return updated;
  },

  /**
   * Start work on whatever is next in the queue, up to the concurrency limit.
   * Oldest accepted order first — a queue people can predict.
   */
  async work(): Promise<{ started: string[] }> {
    if (!autoStart()) return { started: [] };

    const busy = BuildService.active().filter((build) => build.orderId !== null).length;
    const room = Math.max(0, maxConcurrent() - busy);
    if (room === 0) return { started: [] };

    const queue = OrderStore.list({ status: "accepted" })
      .slice()
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .slice(0, room);

    const started: string[] = [];
    for (const order of queue) {
      const result = await this.startBuild(order.id, "queue");
      if (result) started.push(order.id);
    }
    return { started };
  },

  /**
   * Put a delivered product through another pass. This is the "it must not end
   * there" half: what was shipped keeps being worked on.
   */
  async improve(): Promise<{ started: string[] }> {
    if (!autoImprove()) return { started: [] };

    const busy = BuildService.active().length;
    if (busy >= maxConcurrent()) return { started: [] };

    const now = Date.now();
    const candidates = OrderStore.list({ status: "maintained" }).filter((order) => {
      if (!order.autoImprove) return false;
      if (order.buildId && BuildService.isRunning(order.buildId)) return false;
      if (order.qualityScore >= IMPROVE_BELOW) return false;
      return now - new Date(order.updatedAt).getTime() > IMPROVE_COOLDOWN_MS;
    });

    // Lowest quality first: the product that most needs the attention gets it.
    const target = candidates.sort((a, b) => a.qualityScore - b.qualityScore)[0];
    if (!target) return { started: [] };

    const result = await this.startBuild(target.id, "improvement");
    if (!result) return { started: [] };
    OrderStore.note(target.id, "improving", `Improvement pass started at quality ${Math.round(target.qualityScore)}.`);
    return { started: [target.id] };
  },

  status() {
    return {
      running: started,
      site: SiteClient.describe(),
      autoStart: autoStart(),
      autoImprove: autoImprove(),
      maxConcurrent: maxConcurrent(),
      autoAcceptPaid: autoAcceptPaid(),
      lastIntakeAt,
      lastIntakeCount,
      catalog: lastPublish,
      counts: OrderStore.counts()
    };
  },

  /** Start the timers. Idempotent. */
  start(): void {
    if (started) return;
    started = true;

    // A build finishing is what moves an order forward, so the pipeline
    // listens rather than polls for it.
    buildEvents.on("completed", (record: BuildRecord) => {
      if (!record.orderId) return;
      const order = OrderStore.get(record.orderId);
      if (!order) return;

      const wasMaintained = order.status === "maintained";
      OrderStore.update(order.id, {
        status: wasMaintained ? "maintained" : "review",
        qualityScore: record.qualityScore,
        deliverablePath: record.outputDir
      });
      OrderStore.note(
        order.id,
        wasMaintained ? "improved" : "ready",
        wasMaintained
          ? `Improvement pass finished at quality ${Math.round(record.qualityScore)}.`
          : `Build finished at quality ${Math.round(record.qualityScore)}. Waiting for you to check it before it goes out.`
      );

      if (!wasMaintained) {
        notifyJarvis(
          order,
          `Ready to check: ${order.title}`,
          [
            `The build for ${order.customerName} finished at quality ${Math.round(record.qualityScore)}.`,
            `It is in ${record.outputDir}.`,
            "Nothing has been sent to the customer — it is waiting for someone to look at it."
          ].join("\n")
        );
        if (order.externalId) {
          void SiteClient.reportProgress(order.externalId, {
            status: "in-progress",
            message: "A first version is finished and being checked.",
            qualityScore: record.qualityScore
          });
        }
      }
    });

    buildEvents.on("failed", (record: BuildRecord) => {
      if (!record.orderId) return;
      const order = OrderStore.get(record.orderId);
      if (!order) return;
      OrderStore.note(order.id, "failed", record.error ?? "The build failed without saying why.");
      // Back to accepted so the queue retries it, unless it keeps failing.
      const giveUp = order.attempts >= 3;
      OrderStore.update(order.id, { status: giveUp ? "failed" : "accepted", buildId: null });
      if (giveUp) {
        notifyJarvis(
          order,
          `Needs a person: ${order.title}`,
          `Three builds for ${order.customerName} have failed. The last said: ${record.error ?? "nothing"}.`
        );
      }
    });

    const run = (label: string, task: () => unknown | Promise<unknown>, everyMs: number) => {
      const timer = setInterval(() => {
        void (async () => {
          try {
            await task();
          } catch (error) {
            Logger.error(`Order pipeline ${label} failed`, { error: errorMessage(error) });
          }
        })();
      }, everyMs);
      timer.unref?.();
      timers.push(timer);
    };

    const intakeAndCheckIn = async () => {
      if (!SiteClient.isConfigured()) return;
      await this.intake();
      await this.publish();
    };
    run("intake", intakeAndCheckIn, INTAKE_EVERY_MS);
    // Once shortly after start too, so a restart shows up on the site in
    // seconds rather than five minutes.
    const first = setTimeout(() => {
      intakeAndCheckIn().catch((error) => Logger.error("Order pipeline first check-in failed", { error: errorMessage(error) }));
    }, 10_000);
    first.unref?.();
    timers.push(first);
    run("work", () => this.work(), WORK_EVERY_MS);
    run("improve", () => this.improve(), IMPROVE_EVERY_MS);

    Logger.log("Order pipeline started", {
      site: SiteClient.describe().site,
      autoStart: autoStart(),
      autoImprove: autoImprove(),
      maxConcurrent: maxConcurrent()
    });
  },

  stop(): void {
    for (const timer of timers) clearInterval(timer);
    timers.length = 0;
    started = false;
  }
};
