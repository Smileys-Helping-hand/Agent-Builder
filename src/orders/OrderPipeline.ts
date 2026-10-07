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
import { buildFraction, buildProgressLine } from "../orchestrator/buildProgress.js";
import { JarvisClient } from "../integrations/JarvisClient.js";
import { Logger } from "../utils/Logger.js";
import { copyForBuild } from "../ecosystem/ProjectBuilds.js";
import { Catalog } from "./Catalog.js";
import { OrderStore, type Order } from "./OrderStore.js";
import { OrderReceipts } from "./OrderReceipts.js";
import { SiteClient, type SiteOrder } from "./SiteClient.js";
import { readPublicUrl } from "../utils/PublicUrl.js";
import { shareableBuildPreview } from "../server/previews.js";
import { GameMode } from "../utils/GameMode.js";

const INTAKE_EVERY_MS = 5 * 60 * 1000;
/**
 * The site calls the PC offline after 15 minutes without a word, so check in
 * well inside that, on its own timer: a slow or failing order intake must
 * never be what makes the shop say the PC is off.
 */
const CHECK_IN_EVERY_MS = 2 * 60 * 1000;
const CHECK_IN_RETRY_MS = 20 * 1000;
/** At most one progress report a build to the site in this long, between passes. */
const STAGE_REPORT_EVERY_MS = 30 * 1000;
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
/** "launching-soon" until the business is ready: the site is told, and nothing builds by itself. */
export const ordersMode = (): "open" | "launching-soon" =>
  (process.env.ORDERS_MODE ?? "open").toLowerCase() === "launching-soon" ? "launching-soon" : "open";

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
let lastPublish: { at: string; ok: boolean; message: string; count: number; lastOkAt: string | null; failures: number } | null = null;
/** When the site last accepted a check-in, and how many have failed since. */
let lastPublishOk: string | null = null;
let publishFailures = 0;
/** While the PC's model is down, the queue waits instead of burning attempts. */
let holdUntil = 0;
let holdReason: string | null = null;
const HOLD_MS = 5 * 60 * 1000;

/** A build that died before its first pass because the machine could not run it, not because of the order. */
const isMachineProblem = (record: BuildRecord): boolean =>
  record.iterations === 0 &&
  /ollama is not running|could not be started|ECONNREFUSED|fetch failed|model .*not (found|available)|no model|lm studio/i.test(record.error ?? "");

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Turn whatever shape the site uses into the fields an order needs. */
const normalize = (raw: SiteOrder): Parameters<typeof OrderStore.create>[0] | null => {
  const brief = (raw.brief ?? raw.projectDescription ?? "").trim();
  const customerName = (raw.customerName ?? raw.name ?? "").trim();
  if (!brief || !customerName) return null;

  // A catalogue pick is recorded by its id, the same way a template started
  // from the phone is, so buildPrompt can find the template again.
  // Named, or (the site's quote form names none) the catalogue template the
  // customer's own words clearly ask for: tested code to tailor, not a blank page.
  const template = Catalog.get(raw.templateId) ?? Catalog.match(`${raw.serviceType ?? raw.productType ?? ""} ${brief}`);
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
    // Their email from the order is the business's unless their words give
    // another (the first address in the brief wins). Nothing else is made up.
    order.customerEmail ? `Contact email from their order: ${order.customerEmail}` : "",
    "Never invent contact details: a phone, WhatsApp number, email or street address the customer did not give is left out, not made up.",
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

/** The least a build must score to be shown to anyone: roughly install, typecheck and build all passing. */
const SHIPPABLE_SCORE = 60;

/** The business contact details a tailored site left empty because the customer never gave them. */
export const missingContact = (outputDir: string): string[] => {
  let source = "";
  try {
    source = fs.readFileSync(path.join(outputDir, "src", "content.ts"), "utf8");
  } catch {
    return [];
  }
  const block = /business\s*:\s*\{[\s\S]*?\n\s*\}/.exec(source)?.[0] ?? "";
  const names: Record<string, string> = { email: "email", phone: "phone number", whatsapp: "WhatsApp number", address: "address" };
  return Object.keys(names)
    .filter((key) => new RegExp(`\\b${key}\\s*:\\s*(["'\`])\\1`).test(block))
    .map((key) => names[key]);
};

/**
 * What a customer may be shown has to work, whatever it scored: it installs,
 * type-checks, builds and opens in a browser without errors. A score is a sum
 * of checks, and one could clear 60 with the page failing to open; the
 * customer was sent the link to it as "a first version, ready to look at".
 * Checked on the pass the workspace was left at (the best one).
 */
const CUSTOMER_CHECKS = ["install", "typecheck", "build", "runs"];
export const customerSafe = (record: Pick<BuildRecord, "iterationDetail" | "bestScore" | "qualityScore">): { ok: boolean; failing: string[] } => {
  const passes = record.iterationDetail ?? [];
  if (passes.length === 0) return { ok: false, failing: ["no finished pass"] };
  const best = passes.reduce((top, pass) => (pass.qualityScore > top.qualityScore ? pass : top), passes[0]);
  const failing = CUSTOMER_CHECKS.filter((name) => {
    const check = best.checks.find((c) => c.name === name);
    return check ? check.applicable && !check.passed : name !== "runs" && name !== "typecheck";
  });
  return { ok: failing.length === 0, failing };
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
      // One order the site sends in a shape we cannot take must not stop the
      // others, or every intake after it.
      try {
        created += this.takeIn(candidate) ? 1 : 0;
      } catch (error) {
        Logger.error("Order intake: could not take an order in", { externalId: candidate?.id, error: errorMessage(error) });
      }
    }
    lastIntakeAt = new Date().toISOString();
    lastIntakeCount = raw.length;
    return { found: raw.length, created };
  },

  /** One order from the site: record it, and act on its payment. True when it is new. */
  takeIn(candidate: SiteOrder): boolean {
    const normalized = normalize(candidate);
    if (!normalized) {
      Logger.log("Order skipped: not enough detail", { externalId: candidate.id });
      return false;
    }
    const { order, created: isNew } = this.record(normalized);
    if (!candidate.paid) return isNew;

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
    return isNew;
  },

  /**
   * Tell the site what we can build and how busy we are. Runs every two
   * minutes on its own, so the site's "PC online" light and its catalogue stay current.
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
      address: publicHttpsUrl(),
      ordersMode: ordersMode(),
      launchMessage: process.env.ORDERS_LAUNCH_MESSAGE?.trim() || null,
      // Every build on the PC right now and how far along it is — customer
      // orders and the owner's own builds alike.
      activeBuilds: BuildService.active().map((build) => ({
        buildId: build.buildId,
        projectName: build.projectName,
        orderRef: build.orderId ? OrderStore.get(build.orderId)?.externalId ?? null : null,
        state: build.state,
        stage: build.stage,
        progress: Math.round(buildFraction(build) * 100),
        line: buildProgressLine(build),
        qualityScore: Math.round(build.qualityScore),
        startedAt: build.startedAt
      }))
    });
    const at = new Date().toISOString();
    if (result.ok) {
      lastPublishOk = at;
      publishFailures = 0;
    } else {
      publishFailures += 1;
      Logger.warn("Check-in to the site failed", { detail: result.message, failuresInARow: publishFailures, lastOk: lastPublishOk });
    }
    lastPublish = { at, ok: result.ok, message: result.message, count: items.length, lastOkAt: lastPublishOk, failures: publishFailures };
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
    if (GameMode.isOn()) return null;
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
    const receipt = OrderReceipts.issueDelivery(updated ?? order, by);
    OrderStore.note(orderId, "receipt", `Delivery receipt ${receipt.number} issued.`);

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
    // Not open yet: orders that come in (tests, early customers) wait for you.
    if (!autoStart() || ordersMode() === "launching-soon") return { started: [] };

    if (Date.now() < holdUntil) return { started: [] };
    // Game mode: orders wait, and start when it is switched off.
    if (GameMode.isOn()) return { started: [] };

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
    if (!autoImprove() || ordersMode() === "launching-soon") return { started: [] };
    if (GameMode.isOn()) return { started: [] };

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
      ordersMode: ordersMode(),
      launchMessage: process.env.ORDERS_LAUNCH_MESSAGE?.trim() || null,
      lastIntakeAt,
      lastIntakeCount,
      catalog: lastPublish,
      hold: Date.now() < holdUntil ? { until: new Date(holdUntil).toISOString(), reason: holdReason } : null,
      counts: OrderStore.counts()
    };
  },

  /** Start the timers. Idempotent. */
  start(): void {
    if (started) return;
    started = true;

    // A restart ends every build that was in flight. An order still marked
    // "building" would otherwise wait for a build that no longer exists, and
    // never be picked up again: put it back in the queue.
    for (const order of OrderStore.list({ status: "building" })) {
      if (order.buildId && BuildService.isRunning(order.buildId)) continue;
      OrderStore.note(order.id, "building", "The builder restarted while this was building. It is back in the queue.");
      OrderStore.update(order.id, { status: "accepted", buildId: null });
    }

    // A customer's build tells the site where it is as it moves — each stage of
    // each pass, not only when a pass ends — so the Hub's bar and log keep up
    // with the app's rather than sitting on one flat "Building" for an hour.
    const reported = new Map<string, { at: number; percent: number; line: string }>();
    const trailing = new Map<string, NodeJS.Timeout>();
    const reportBuild = (record: BuildRecord, passDone: boolean) => {
      if (!record.orderId || record.state !== "running") return;
      const order = OrderStore.get(record.orderId);
      if (!order?.externalId) return;
      const last = reported.get(record.buildId);
      // Stages can be seconds apart; one report every 30s is plenty, but a finished pass always goes.
      // A stage held back is sent when the 30s are up, so a long stage that began inside them is not lost.
      if (!passDone && last && Date.now() - last.at < STAGE_REPORT_EVERY_MS) {
        if (!trailing.has(record.buildId)) {
          const timer = setTimeout(() => {
            trailing.delete(record.buildId);
            const now = BuildService.view(record.buildId);
            if (now) reportBuild(now, false);
          }, last.at + STAGE_REPORT_EVERY_MS - Date.now() + 50);
          timer.unref?.();
          trailing.set(record.buildId, timer);
        }
        return;
      }
      // The Hub keeps building reports between 16% and 89%, and never moves it backwards.
      const percent = Math.max(last?.percent ?? 16, Math.round(16 + buildFraction(record) * 73));
      const target = record.qualityThreshold || 90;
      const line = passDone
        ? `Pass ${record.iterations} of up to ${record.maxIterations} done: quality ${Math.round(record.qualityScore)} of a target ${target}`
        : buildProgressLine(record);
      if (!passDone && last?.line === line) return;
      reported.set(record.buildId, { at: Date.now(), percent, line });
      void SiteClient.reportProgress(order.externalId, {
        status: "building",
        message: line,
        qualityScore: record.iterations ? record.qualityScore : undefined,
        progress: Math.min(89, percent)
      });
    };
    buildEvents.on("stage", (record: BuildRecord) => reportBuild(record, false));
    buildEvents.on("iteration", (record: BuildRecord) => reportBuild(record, true));
    for (const done of ["completed", "failed", "stopped"]) {
      buildEvents.on(done, (record: BuildRecord) => {
        reported.delete(record.buildId);
        clearTimeout(trailing.get(record.buildId));
        trailing.delete(record.buildId);
      });
    }

    // A build finishing is what moves an order forward, so the pipeline
    // listens rather than polls for it.
    buildEvents.on("completed", (record: BuildRecord) => {
      if (!record.orderId) return;
      const order = OrderStore.get(record.orderId);
      if (!order) return;

      const wasMaintained = order.status === "maintained";

      // Finishing is not the same as being fit to show anyone. Below this the
      // site does not even build (install, typecheck and build together are
      // about 60 of the 100), so it cannot be opened, let alone handed over:
      // one such build reached "review" at 31 and downloaded as a blank page.
      const safe = customerSafe(record);
      if (!wasMaintained && (record.qualityScore < SHIPPABLE_SCORE || !safe.ok)) {
        const giveUp = order.attempts >= 3;
        OrderStore.update(order.id, {
          status: giveUp ? "failed" : "accepted",
          buildId: null,
          qualityScore: record.qualityScore,
          // Start the next try from the template's clean code, not from this attempt.
          deliverablePath: null
        });
        OrderStore.note(
          order.id,
          "failed",
          (record.qualityScore < SHIPPABLE_SCORE
            ? `Build finished at quality ${Math.round(record.qualityScore)}, below the ${SHIPPABLE_SCORE} it needs to be usable, so it was not offered for checking. `
            : `Build finished at quality ${Math.round(record.qualityScore)}, but ${safe.failing.join(", ")} did not pass, so it was not offered for checking. `) +
            (giveUp ? "Three tries have not got there; it needs a person." : "Trying again from the template's clean code.") +
            ` The attempt is kept at ${record.outputDir}.`
        );
        if (giveUp) {
          notifyJarvis(
            order,
            `Needs a person: ${order.title}`,
            `Three builds for ${order.customerName} finished below a usable standard (last: ${Math.round(record.qualityScore)}/100). The last attempt is at ${record.outputDir}.`
          );
        }
        return;
      }

      // The address the customer will open. The site cannot reach this PC, so
      // without one their dashboard shows a finished build and nothing to look
      // at; it is only null when the tunnel is down or the build produced
      // nothing servable.
      const previewUrl = shareableBuildPreview(record.buildId, readPublicUrl());
      const missing = missingContact(record.outputDir);

      OrderStore.update(order.id, {
        status: wasMaintained ? "maintained" : "review",
        qualityScore: record.qualityScore,
        deliverablePath: record.outputDir,
        ...(previewUrl ? { deliverableUrl: previewUrl } : {})
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
            previewUrl
              ? `The customer can open it at ${previewUrl}`
              : "There is no public address for it, so the customer has nothing to open: check the tunnel is up.",
            ...(missing.length ? [`They did not give their ${missing.join(", ")}, so the site leaves ${missing.length === 1 ? "it" : "them"} out: ask them before it goes live.`] : [])
          ].join("\n")
        );
        if (order.externalId) {
          void SiteClient.reportProgress(order.externalId, {
            status: "in-progress",
            message: previewUrl
              ? "A first version is finished and ready to look at."
              : "A first version is finished and being checked.",
            qualityScore: record.qualityScore,
            previewUrl
          });
        }
      }
    });

    buildEvents.on("failed", (record: BuildRecord) => {
      if (!record.orderId) return;
      const order = OrderStore.get(record.orderId);
      if (!order) return;
      // The machine could not run the build at all (the model is down): the
      // order is not at fault. Keep its attempts, hold the queue a few
      // minutes and say so, rather than failing a paid order in three.
      if (isMachineProblem(record)) {
        OrderStore.undoAttempt(order.id);
        OrderStore.update(order.id, { status: "accepted", buildId: null });
        OrderStore.note(order.id, "waiting", `Could not start: ${record.error}. It waits in the queue and starts again when the PC can build.`);
        const firstTime = Date.now() >= holdUntil;
        holdUntil = Date.now() + HOLD_MS;
        holdReason = record.error ?? "The PC could not start a build.";
        if (firstTime) {
          Logger.warn("Order queue on hold: the PC cannot build right now", { error: holdReason });
          notifyJarvis(order, "Builds are on hold", `The PC could not start a build for ${order.customerName}: ${holdReason}. Orders wait in the queue and start again on their own.`);
          if (order.externalId) {
            void SiteClient.reportProgress(order.externalId, {
              status: "received",
              message: "Waiting to start: the build machine is getting ready. The order is safe in the queue and starts on its own."
            });
          }
        }
        return;
      }

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
        // Without this the Hub shows it "building" for ever.
        if (order.externalId) {
          void SiteClient.reportProgress(order.externalId, {
            status: "failed",
            message: "The build hit a problem it could not get past. A person is looking at it."
          });
        }
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

    // The check-in is what keeps the shop's "PC online" light on. It runs on
    // its own timer, and one that fails is tried again shortly, so neither an
    // order intake that throws nor one slow answer from the site makes the PC
    // look offline.
    const checkIn = async () => {
      if (!SiteClient.isConfigured()) return;
      const result = await this.publish();
      if (!result.ok) {
        const retry = setTimeout(() => {
          this.publish().catch((error) => Logger.error("Check-in retry failed", { error: errorMessage(error) }));
        }, CHECK_IN_RETRY_MS);
        retry.unref?.();
      }
    };
    const intake = async () => {
      if (!SiteClient.isConfigured()) return;
      await this.intake();
    };
    run("check-in", checkIn, CHECK_IN_EVERY_MS);
    run("intake", intake, INTAKE_EVERY_MS);
    // Once shortly after start too, so a restart shows up on the site in
    // seconds rather than minutes.
    const first = setTimeout(() => {
      void (async () => {
        await checkIn().catch((error) => Logger.error("Order pipeline first check-in failed", { error: errorMessage(error) }));
        await intake().catch((error) => Logger.error("Order pipeline first intake failed", { error: errorMessage(error) }));
      })();
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
