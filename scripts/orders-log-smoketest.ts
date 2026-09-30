/**
 * Smoke test for the orders log: the activity across orders and the delivery
 * receipts. Runs against a throwaway database, never data/knowledge.db.
 *
 *   npm run test:orders-log
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-orders-log-"));
process.env.KNOWLEDGE_DB_PATH = path.join(dir, "knowledge.db");

const { OrderStore } = await import("../src/orders/OrderStore.js");
const { OrderReceipts } = await import("../src/orders/OrderReceipts.js");

const { order } = OrderStore.create({
  source: "manual",
  customerName: "Test Customer",
  customerEmail: "test@example.com",
  productType: "website",
  title: "Plumbing site",
  brief: "A small site for a plumbing business with a booking form."
});
OrderStore.note(order.id, "accepted", "Accepted.");
OrderStore.note(order.id, "delivered", "Delivered by test.");

const activity = OrderStore.activity({ limit: 10 });
assert.ok(activity.length >= 2, "activity lists the notes");
assert.equal(activity[0].title, order.title, "each entry names its order");
assert.equal(OrderStore.activity({ kind: "accepted" }).length, 1, "activity filters by kind");

const receipt = OrderReceipts.issueDelivery(order, "test");
assert.match(receipt.number, /^AB-\d{4}-[0-9A-F]{6}$/, "receipt number");
assert.equal(OrderReceipts.verify(receipt), true, "a fresh receipt checks out");
assert.equal(OrderReceipts.forOrder(order.id).length, 1, "receipt is filed under its order");
assert.equal(OrderReceipts.list()[0].id, receipt.id, "and in the full list");
assert.equal(OrderReceipts.verify({ ...receipt, customerName: "Someone Else" }), false, "an edited receipt does not");

console.log("orders log: all checks passed");
