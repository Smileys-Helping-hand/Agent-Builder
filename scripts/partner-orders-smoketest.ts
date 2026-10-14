/**
 * Smoke test for orders sold through a partner's app (VerifiedBizLink): the
 * partner is kept on the order, shown in its history, and a database made
 * before partners existed gains the column without losing anything.
 * Runs against a throwaway database, never data/knowledge.db.
 *
 *   npm run test:partner-orders
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-partner-orders-"));
const file = path.join(dir, "knowledge.db");
process.env.KNOWLEDGE_DB_PATH = file;

// An orders table as it was before partners: no "via" column, one order in it.
const { openSqlite } = await import("../src/utils/Sqlite.js");
const old = openSqlite(file);
old.exec(`CREATE TABLE orders (
  id TEXT PRIMARY KEY, external_id TEXT, source TEXT NOT NULL DEFAULT 'manual', customer_name TEXT NOT NULL,
  customer_email TEXT, product_type TEXT NOT NULL DEFAULT 'website', title TEXT NOT NULL, brief TEXT NOT NULL,
  budget TEXT, timeline TEXT, status TEXT NOT NULL DEFAULT 'received', build_id TEXT, deliverable_path TEXT,
  deliverable_url TEXT, quality_score REAL NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0,
  auto_improve INTEGER NOT NULL DEFAULT 1, notes TEXT, received_at TEXT NOT NULL, delivered_at TEXT, updated_at TEXT NOT NULL)`);
old.prepare("INSERT INTO orders (id, customer_name, title, brief, received_at, updated_at) VALUES ('ord_old', 'Old Customer', 'Old site', 'An order from before partners.', '2026-01-01', '2026-01-01')").run();
old.close();

const { OrderStore } = await import("../src/orders/OrderStore.js");

const before = OrderStore.get("ord_old");
assert.ok(before, "the old order survives the new column");
assert.equal(before.via, null, "and was not through a partner");

const { order } = OrderStore.create({
  externalId: "hub-order-1",
  source: "site",
  customerName: "Member Business",
  customerEmail: "member@example.com",
  productType: "event",
  title: "Event & Invitation for Member Business",
  brief: "A wedding invitation site with RSVP and a venue map.",
  via: "VerifiedBizLink"
});
assert.equal(order.via, "VerifiedBizLink", "the partner is kept on the order");
assert.match(OrderStore.notes(order.id)[0]?.message ?? "", /through VerifiedBizLink/, "and named in its history");

const again = OrderStore.create({ externalId: "hub-order-1", source: "site", customerName: "x", title: "x", brief: "x", via: "Other" });
assert.equal(again.created, false, "taking the same order in twice is still a no-op");
assert.equal(again.order.via, "VerifiedBizLink", "and does not change its partner");

const direct = OrderStore.create({ source: "site", externalId: "hub-order-2", customerName: "Direct", title: "Site", brief: "Bought on the site itself." });
assert.equal(direct.order.via, null, "an order from the site itself has none");

console.log("partner orders: all checks passed");
