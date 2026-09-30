/**
 * OrderReceipts — a permanent record of each hand-over.
 *
 * Delivering an order is the one step a person takes on purpose, so it gets a
 * receipt: who it went to, which build, how well it scored, where it lives,
 * who handed it over and when. The receipt carries a digest of those fields,
 * so a record edited afterwards no longer checks out.
 *
 * Kept beside the orders in data/knowledge.db. Receipts are never updated or
 * trimmed.
 */
import { createHash, randomBytes } from "node:crypto";

import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";
import type { Order } from "./OrderStore.js";

export interface OrderReceipt {
  id: string;
  number: string;
  kind: "delivery";
  orderId: string;
  title: string;
  customerName: string;
  customerEmail: string | null;
  buildId: string | null;
  qualityScore: number;
  attempts: number;
  deliverableUrl: string | null;
  by: string;
  createdAt: string;
  digest: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS order_receipts (
  id TEXT PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  order_id TEXT NOT NULL,
  title TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT,
  build_id TEXT,
  quality_score REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  deliverable_url TEXT,
  by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  digest TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_receipts_order ON order_receipts(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_receipts_created ON order_receipts(created_at DESC);
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

type Row = {
  id: string;
  number: string;
  kind: string;
  order_id: string;
  title: string;
  customer_name: string;
  customer_email: string | null;
  build_id: string | null;
  quality_score: number;
  attempts: number;
  deliverable_url: string | null;
  by: string;
  created_at: string;
  digest: string;
};

const fromRow = (row: Row): OrderReceipt => ({
  id: row.id,
  number: row.number,
  kind: "delivery",
  orderId: row.order_id,
  title: row.title,
  customerName: row.customer_name,
  customerEmail: row.customer_email,
  buildId: row.build_id,
  qualityScore: row.quality_score,
  attempts: row.attempts,
  deliverableUrl: row.deliverable_url,
  by: row.by,
  createdAt: row.created_at,
  digest: row.digest
});

/** Everything on the receipt except the digest, in a fixed order. */
const digestOf = (receipt: Omit<OrderReceipt, "digest">): string =>
  createHash("sha256")
    .update(
      JSON.stringify([
        receipt.id,
        receipt.number,
        receipt.kind,
        receipt.orderId,
        receipt.title,
        receipt.customerName,
        receipt.customerEmail,
        receipt.buildId,
        receipt.qualityScore,
        receipt.attempts,
        receipt.deliverableUrl,
        receipt.by,
        receipt.createdAt
      ])
    )
    .digest("hex");

export const OrderReceipts = {
  /** Record a hand-over. Called once per delivery. */
  issueDelivery(order: Order, by: string): OrderReceipt {
    const createdAt = nowIso();
    const base: Omit<OrderReceipt, "digest"> = {
      id: `rcpt_${randomBytes(8).toString("hex")}`,
      number: `AB-${createdAt.slice(0, 4)}-${randomBytes(3).toString("hex").toUpperCase()}`,
      kind: "delivery",
      orderId: order.id,
      title: order.title,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      buildId: order.buildId,
      qualityScore: Math.round(order.qualityScore * 10) / 10,
      attempts: order.attempts,
      deliverableUrl: order.deliverableUrl,
      by,
      createdAt
    };
    const receipt: OrderReceipt = { ...base, digest: digestOf(base) };
    db()
      .prepare(
        `INSERT INTO order_receipts (id, number, kind, order_id, title, customer_name, customer_email, build_id,
           quality_score, attempts, deliverable_url, by, created_at, digest)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        receipt.id,
        receipt.number,
        receipt.kind,
        receipt.orderId,
        receipt.title,
        receipt.customerName,
        receipt.customerEmail,
        receipt.buildId,
        receipt.qualityScore,
        receipt.attempts,
        receipt.deliverableUrl,
        receipt.by,
        receipt.createdAt,
        receipt.digest
      );
    return receipt;
  },

  list(limit = 100): OrderReceipt[] {
    const rows = db()
      .prepare("SELECT * FROM order_receipts ORDER BY created_at DESC LIMIT ?")
      .all(Math.min(Math.max(1, limit), 500)) as Row[];
    return rows.map(fromRow);
  },

  forOrder(orderId: string): OrderReceipt[] {
    const rows = db()
      .prepare("SELECT * FROM order_receipts WHERE order_id = ? ORDER BY created_at DESC")
      .all(orderId) as Row[];
    return rows.map(fromRow);
  },

  /** True when the stored fields still match the digest taken at issue. */
  verify(receipt: OrderReceipt): boolean {
    const { digest, ...rest } = receipt;
    return digestOf(rest) === digest;
  }
};
