/**
 * OrderStore — customer orders, from "someone asked for a website" to
 * "here is the finished thing", and then onward.
 *
 * An order is deliberately not the same thing as a build. A build is one run of
 * the orchestrator and may be thrown away; an order is a promise to a person,
 * outlives any number of builds, and keeps going after delivery because the
 * product is supposed to keep improving. So the order carries its own state
 * machine and points at whichever build is currently serving it.
 *
 * Same database as everything else the app knows (data/knowledge.db).
 */
import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";

/**
 * The life of an order.
 *
 * received -> accepted -> building -> review -> delivered -> maintained
 *                                       |
 *                                    failed / cancelled
 *
 * "review" exists because nothing goes to a customer unseen: a build reaching
 * the quality threshold moves the order to review, and a person (or an explicit
 * auto-deliver setting) moves it to delivered. "maintained" is the point of the
 * whole thing — delivery is not the end, the product stays enrolled for
 * continuous improvement.
 */
export type OrderStatus =
  | "received"
  | "accepted"
  | "building"
  | "review"
  | "delivered"
  | "maintained"
  | "failed"
  | "cancelled";

export const ORDER_STATUSES: OrderStatus[] = [
  "received",
  "accepted",
  "building",
  "review",
  "delivered",
  "maintained",
  "failed",
  "cancelled"
];

/** Where the order came in from. */
export type OrderSource = "site" | "manual" | "jarvis" | "api";

export interface Order {
  id: string;
  /** The id this order has on the ordering site, when it came from one. */
  externalId: string | null;
  source: OrderSource;
  customerName: string;
  customerEmail: string | null;
  /** "website", "landing page", "template", whatever the site collected. */
  productType: string;
  title: string;
  brief: string;
  budget: string | null;
  timeline: string | null;
  status: OrderStatus;
  /** The build currently serving this order, if one is running. */
  buildId: string | null;
  /** Where the finished thing lives on disk. */
  deliverablePath: string | null;
  /** Where the customer can see it, once that exists. */
  deliverableUrl: string | null;
  qualityScore: number;
  /** How many builds this order has been through, including retries. */
  attempts: number;
  /** Keep improving it after delivery. */
  autoImprove: boolean;
  notes: string | null;
  receivedAt: string;
  deliveredAt: string | null;
  updatedAt: string;
}

export interface OrderNote {
  id: number;
  orderId: string;
  kind: string;
  message: string;
  createdAt: string;
}

/** A note with the order it belongs to, for the log across every order. */
export interface OrderActivity extends OrderNote {
  title: string;
  customerName: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  external_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  product_type TEXT NOT NULL DEFAULT 'website',
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  budget TEXT,
  timeline TEXT,
  status TEXT NOT NULL DEFAULT 'received',
  build_id TEXT,
  deliverable_path TEXT,
  deliverable_url TEXT,
  quality_score REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  auto_improve INTEGER NOT NULL DEFAULT 1,
  notes TEXT,
  received_at TEXT NOT NULL,
  delivered_at TEXT,
  updated_at TEXT NOT NULL
);
-- An order that arrived from the site must never be taken in twice, however
-- many times the intake poll runs.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_external ON orders(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS order_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_notes ON order_notes(order_id, id DESC);
`;

let ready = false;
const db = () => {
  const database = getKnowledgeDb();
  if (!ready) {
    database.exec(SCHEMA);
    ready = true;
  }
  return database;
};

type OrderRow = {
  id: string;
  external_id: string | null;
  source: OrderSource;
  customer_name: string;
  customer_email: string | null;
  product_type: string;
  title: string;
  brief: string;
  budget: string | null;
  timeline: string | null;
  status: OrderStatus;
  build_id: string | null;
  deliverable_path: string | null;
  deliverable_url: string | null;
  quality_score: number;
  attempts: number;
  auto_improve: number;
  notes: string | null;
  received_at: string;
  delivered_at: string | null;
  updated_at: string;
};

const mapOrder = (row: OrderRow): Order => ({
  id: row.id,
  externalId: row.external_id,
  source: row.source,
  customerName: row.customer_name,
  customerEmail: row.customer_email,
  productType: row.product_type,
  title: row.title,
  brief: row.brief,
  budget: row.budget,
  timeline: row.timeline,
  status: row.status,
  buildId: row.build_id,
  deliverablePath: row.deliverable_path,
  deliverableUrl: row.deliverable_url,
  qualityScore: row.quality_score,
  attempts: row.attempts,
  autoImprove: row.auto_improve === 1,
  notes: row.notes,
  receivedAt: row.received_at,
  deliveredAt: row.delivered_at,
  updatedAt: row.updated_at
});

/** A stable, readable id. Collisions are made impossible by the random tail. */
const newId = (): string =>
  `ord_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export interface NewOrder {
  externalId?: string | null;
  source?: OrderSource;
  customerName: string;
  customerEmail?: string | null;
  productType?: string;
  title: string;
  brief: string;
  budget?: string | null;
  timeline?: string | null;
  autoImprove?: boolean;
}

export const OrderStore = {
  /**
   * Record an order. If one with the same external id already exists, that one
   * is returned untouched — intake runs on a timer and must be safe to repeat.
   */
  create(input: NewOrder): { order: Order; created: boolean } {
    const source = input.source ?? "manual";
    if (input.externalId) {
      const existing = this.findByExternalId(source, input.externalId);
      if (existing) return { order: existing, created: false };
    }

    const now = nowIso();
    const id = newId();
    db()
      .prepare(
        `INSERT INTO orders (id, external_id, source, customer_name, customer_email, product_type, title, brief,
                             budget, timeline, status, auto_improve, received_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)`
      )
      .run(
        id,
        input.externalId ?? null,
        source,
        input.customerName,
        input.customerEmail ?? null,
        input.productType ?? "website",
        input.title,
        input.brief,
        input.budget ?? null,
        input.timeline ?? null,
        input.autoImprove === false ? 0 : 1,
        now,
        now
      );

    const order = this.get(id);
    if (!order) throw new Error("Order was written but could not be read back.");
    this.note(id, "received", `Order received from ${source}.`);
    return { order, created: true };
  },

  get(id: string): Order | null {
    const row = db().prepare("SELECT * FROM orders WHERE id = ?").get(id) as OrderRow | undefined;
    return row ? mapOrder(row) : null;
  },

  findByExternalId(source: OrderSource, externalId: string): Order | null {
    const row = db()
      .prepare("SELECT * FROM orders WHERE source = ? AND external_id = ?")
      .get(source, externalId) as OrderRow | undefined;
    return row ? mapOrder(row) : null;
  },

  findByBuildId(buildId: string): Order | null {
    const row = db().prepare("SELECT * FROM orders WHERE build_id = ?").get(buildId) as OrderRow | undefined;
    return row ? mapOrder(row) : null;
  },

  list(options: { status?: OrderStatus | OrderStatus[]; limit?: number } = {}): Order[] {
    const limit = Math.min(options.limit ?? 200, 500);
    const statuses = options.status
      ? Array.isArray(options.status)
        ? options.status
        : [options.status]
      : null;

    if (!statuses || statuses.length === 0) {
      return (db().prepare("SELECT * FROM orders ORDER BY updated_at DESC LIMIT ?").all(limit) as OrderRow[]).map(mapOrder);
    }
    const placeholders = statuses.map(() => "?").join(", ");
    return (
      db()
        .prepare(`SELECT * FROM orders WHERE status IN (${placeholders}) ORDER BY updated_at DESC LIMIT ?`)
        .all(...statuses, limit) as OrderRow[]
    ).map(mapOrder);
  },

  /** Partial update. Only the fields passed are touched. */
  update(
    id: string,
    patch: Partial<
      Pick<
        Order,
        "status" | "buildId" | "deliverablePath" | "deliverableUrl" | "qualityScore" | "notes" | "autoImprove" | "attempts"
      >
    >
  ): Order | null {
    const columns: Record<string, string> = {
      status: "status",
      buildId: "build_id",
      deliverablePath: "deliverable_path",
      deliverableUrl: "deliverable_url",
      qualityScore: "quality_score",
      notes: "notes",
      attempts: "attempts"
    };

    const sets: string[] = [];
    const values: Array<string | number | null> = [];
    for (const [key, column] of Object.entries(columns)) {
      const value = (patch as Record<string, unknown>)[key];
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      values.push(value as string | number | null);
    }
    if (patch.autoImprove !== undefined) {
      sets.push("auto_improve = ?");
      values.push(patch.autoImprove ? 1 : 0);
    }
    // Delivery time is derived, not passed in, so it can never disagree with status.
    if (patch.status === "delivered") {
      sets.push("delivered_at = COALESCE(delivered_at, ?)");
      values.push(nowIso());
    }
    if (sets.length === 0) return this.get(id);

    sets.push("updated_at = ?");
    values.push(nowIso(), id);
    db().prepare(`UPDATE orders SET ${sets.join(", ")} WHERE id = ?`).run(...values);
    return this.get(id);
  },

  /** Bump the attempt counter and return the new value. */
  recordAttempt(id: string): number {
    db().prepare("UPDATE orders SET attempts = attempts + 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
    return this.get(id)?.attempts ?? 0;
  },

  note(orderId: string, kind: string, message: string): void {
    db()
      .prepare("INSERT INTO order_notes (order_id, kind, message, created_at) VALUES (?, ?, ?, ?)")
      .run(orderId, kind, message, nowIso());
  },

  notes(orderId: string, limit = 50): OrderNote[] {
    const rows = db()
      .prepare("SELECT * FROM order_notes WHERE order_id = ? ORDER BY id DESC LIMIT ?")
      .all(orderId, Math.min(limit, 200)) as Array<{
      id: number;
      order_id: string;
      kind: string;
      message: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      kind: row.kind,
      message: row.message,
      createdAt: row.created_at
    }));
  },

  /** Every order's notes, newest first: the log of what happened to all of them. */
  activity(options: { limit?: number; kind?: string } = {}): OrderActivity[] {
    const limit = Math.min(Math.max(1, options.limit ?? 100), 500);
    const where = options.kind ? "WHERE n.kind = ?" : "";
    const params: unknown[] = options.kind ? [options.kind, limit] : [limit];
    const rows = db()
      .prepare(
        `SELECT n.id, n.order_id, n.kind, n.message, n.created_at, o.title, o.customer_name
           FROM order_notes n JOIN orders o ON o.id = n.order_id
           ${where}
           ORDER BY n.id DESC LIMIT ?`
      )
      .all(...params) as Array<{
      id: number;
      order_id: string;
      kind: string;
      message: string;
      created_at: string;
      title: string;
      customer_name: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      kind: row.kind,
      message: row.message,
      createdAt: row.created_at,
      title: row.title,
      customerName: row.customer_name
    }));
  },

  /** Counts per status, for the dashboard's header line. */
  counts(): Record<OrderStatus, number> {
    const rows = db().prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all() as Array<{
      status: OrderStatus;
      n: number;
    }>;
    const counts = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<OrderStatus, number>;
    for (const row of rows) counts[row.status] = row.n;
    return counts;
  }
};
