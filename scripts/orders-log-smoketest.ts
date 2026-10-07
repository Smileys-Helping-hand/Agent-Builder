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

// A customer is only shown a build that installs, type-checks, builds and opens.
const { customerSafe } = await import("../src/orders/OrderPipeline.js");
const pass = (score: number, failing: string[] = []) => ({
  iteration: 1, at: "", qualityScore: score, objectiveScore: score, status: "", improvements: [], files: 1, passed: failing.length === 0,
  checks: ["install", "typecheck", "build", "test", "runs", "completeness"].map((name) => ({ name, applicable: true, passed: !failing.includes(name), durationMs: 1 })),
  blocker: null, metrics: {} as never
});
assert.deepEqual(customerSafe({ iterationDetail: [pass(81, ["completeness"])], bestScore: 81, qualityScore: 81 }), { ok: true, failing: [] }, "incomplete but working: a person can check it");
assert.deepEqual(customerSafe({ iterationDetail: [pass(72, ["runs"])], bestScore: 72, qualityScore: 72 }), { ok: false, failing: ["runs"] }, "does not open: never shown");
assert.deepEqual(customerSafe({ iterationDetail: [pass(90, []), pass(70, ["typecheck"])], bestScore: 90, qualityScore: 90 }).ok, true, "judged on the best pass, where the workspace is left");
assert.equal(customerSafe({ iterationDetail: [], bestScore: 0, qualityScore: 0 }).ok, false, "nothing finished: nothing to show");

// An order that names no template (the site's quote form never does) starts from
// the one its words clearly ask for; a custom app is still built from the brief.
const { Catalog } = await import("../src/orders/Catalog.js");
for (const [text, id] of [
  ["Website: I need a website for my restaurant with our menu and table reservations", "restaurant"],
  ["E-commerce: an online shop to sell my handmade candles", "ecommerce"],
  ["Web App: a booking system for my hair salon", "booking"],
  ["Website: a website for my plumbing business", "landing"],
  ["Game: a fantasy RPG adventure where a hero explores a dungeon", "rpg"],
  ["Game: a tower defense game for my board game cafe", "strategy"],
  ["Game: a fun game for my shop", "game"],
  ["Game: a space shooter for my arcade", "shooter"],
  ["Website: wedding invitation with RSVP", "event"],
  ["Website: a blog for my travel stories", "blog"],
  ["Web App: inventory tracking software for my warehouse", null],
  ["Mobile App: an app to track my running", null]
] as const) {
  assert.equal(Catalog.match(text)?.id ?? null, id, text);
}

// Contact details the customer never gave are emptied, and the review note asks for them.
const { stripInventedContact } = await import("../src/orchestrator/Tailoring.js");
const { missingContact } = await import("../src/orders/OrderPipeline.js");
const tailored = `export const site = {\n  business: {\n    name: "Comic Vault",\n    email: "quest@comicvault.co.za",\n    phone: "+27 21 555 0199",\n    whatsapp: "+27 71 123 4567",\n    address: "429 Kalk Street, Cape Town"\n  },\n  hero: { title: "Quest" }\n};\n`;
const orderBrief = "A fantasy RPG for my comic shop Comic Vault in Cape Town. WhatsApp us on 071 123 4567.\nContact email from their order: thabo@comicvault.co.za";
const stripped = stripInventedContact(tailored, orderBrief);
assert.deepEqual(stripped.removed, ["email", "phone", "address"], "made-up email, phone and street go");
assert.match(stripped.source, /whatsapp: "\+27 71 123 4567"/, "the WhatsApp number they gave stays (+27 and 0 forms match)");
assert.match(stripped.source, /email: "",\n    phone: "",/);
assert.deepEqual(stripInventedContact(stripped.source.replace('address: ""', 'address: "Cape Town"'), orderBrief).removed, [], "a town they named stays");
const contactDir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-contact-"));
fs.mkdirSync(path.join(contactDir, "src"));
fs.writeFileSync(path.join(contactDir, "src/content.ts"), stripped.source);
assert.deepEqual(missingContact(contactDir), ["email", "phone number", "address"]);

console.log("orders log: all checks passed");
