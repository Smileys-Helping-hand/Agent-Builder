/**
 * A customer's edits to their finished site land exactly in its content.ts,
 * and nowhere else.
 *
 *   npm run test:site-edits
 */
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";

import { applyContentEdits, setContentPath, setLayout } from "../src/orders/ContentEdits.js";

const content = fs.readFileSync(path.resolve("templates/sites/restaurant/src/content.ts"), "utf8");

// A plain field, a colour, and one the template never set (its font is set; take a field it lacks).
const edited = applyContentEdits(
  content,
  { "business.name": "Spice Route Kitchen", "hero.title": "Durban's best \"bunny\" chow", "brand.primary": "#b45309", "business.tagline": "Curry by the sea" },
  { order: ["menu", "book"], hidden: ["gallery"] }
);
assert.deepEqual(edited.skipped, []);
assert.ok(edited.source.includes('name: "Spice Route Kitchen"'));
assert.ok(edited.source.includes('title: "Durban\'s best \\"bunny\\" chow"'), "quotes are escaped");
assert.ok(edited.source.includes('primary: "#b45309"'));
assert.ok(edited.source.includes('layout: { order: ["menu","book"], hidden: ["gallery"] }'));
// Only the hero's title changed, not every "title" in the file (menu sections have titles too).
assert.ok(edited.source.includes('title: "To start"'), "a nested title elsewhere is left alone");
assert.equal((edited.source.match(/Salt & Ember/g) ?? []).length, (content.match(/Salt & Ember/g) ?? []).length - 1, "only business.name, not every mention");

// Again: the layout is replaced, not added twice; a missing property is added.
const again = setLayout(edited.source, { order: ["book"], hidden: [] })!;
assert.equal((again.match(/\blayout:/g) ?? []).length, 1);
const landing = fs.readFileSync(path.resolve("templates/sites/landing/src/content.ts"), "utf8");
const withFont = setContentPath(landing, "brand.font", "Georgia, serif")!;
assert.ok(/brand: \{\s*font: "Georgia, serif",/.test(withFont), "a property the template lacks is added to its object");

// Not editable from the dashboard, or not a string: skipped, file untouched for it.
const refused = applyContentEdits(content, { "menu.0": "x", "nav.label": "y" });
assert.deepEqual(refused.skipped.sort(), ["menu.0", "nav.label"]);
assert.equal(refused.source, content);

// Still valid TypeScript after edits.
const ts = await import("typescript");
const result = ts.default.transpileModule(edited.source, { reportDiagnostics: true });
assert.equal(result.diagnostics?.length ?? 0, 0);

// End to end on the builder: a delivered site, an edit waiting on a stand-in of the hub.
const os = await import("os");
const http = await import("http");
const { execFileSync } = await import("child_process");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-site-edits-"));
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");
const delivered = path.join(tmp, "delivered");
const restaurant = path.resolve("templates/sites/restaurant");
// The site's own dist and .git only: node_modules/vite/dist is needed to build.
fs.cpSync(restaurant, delivered, { recursive: true, filter: (src) => !["dist", ".git"].includes(path.relative(restaurant, src)) });
execFileSync("git", ["init", "-q"], { cwd: delivered });

const reports: Array<{ id: string; body: Record<string, unknown> }> = [];
let served = false;
const hub = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/api/builder/edits") {
      const edits = served
        ? []
        : [{ orderId: "job-1", editId: "edit-1", status: "pending", patch: { "business.name": "Spice Route Kitchen", "brand.primary": "#b45309" }, sections: { order: [], hidden: ["gallery"] }, note: null, at: Date.now() }];
      served = true;
      return res.end(JSON.stringify({ edits }));
    }
    const match = /^\/api\/builder\/edits\/([^/]+)$/.exec(req.url ?? "");
    if (req.method === "PATCH" && match) {
      reports.push({ id: decodeURIComponent(match[1]), body: JSON.parse(raw) });
      return res.end('{"success":true}');
    }
    res.writeHead(404).end("{}");
  });
});
await new Promise<void>((resolve) => hub.listen(0, "127.0.0.1", resolve));
process.env.SITE_URL = `http://127.0.0.1:${(hub.address() as { port: number }).port}`;
process.env.SITE_API_KEY = "test-key";

const { OrderStore } = await import("../src/orders/OrderStore.js");
const { SiteEdits } = await import("../src/orders/SiteEdits.js");
const { order } = OrderStore.create({ externalId: "job-1", source: "site", customerName: "Ayesha", productType: "restaurant", title: "Restaurant for Ayesha", brief: "A curry house" });
OrderStore.update(order.id, { status: "delivered", deliverablePath: delivered, deliverableUrl: "https://example.test/preview/build/x/t/" });

assert.equal(await SiteEdits.process(), 1);
const after = fs.readFileSync(path.join(delivered, "src/content.ts"), "utf8");
assert.ok(after.includes('name: "Spice Route Kitchen"') && after.includes('primary: "#b45309"') && after.includes('hidden: ["gallery"]'));
const page = fs.readFileSync(path.join(delivered, "dist/index.html"), "utf8");
assert.ok(page.includes("Spice Route Kitchen"), "the site was rebuilt with the change");
assert.deepEqual(reports.map((r) => [r.id, r.body.status]), [["job-1", "applying"], ["job-1", "done"]]);
assert.equal(reports[1].body.previewUrl, "https://example.test/preview/build/x/t/", "the same link, now showing the change");
assert.equal(await SiteEdits.process(), 0, "nothing waiting: nothing done");
hub.close();
// Best effort: on Windows the test database is still open until the process ends.
try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // Left in the temp folder.
}

console.log("site edits: all checks passed");
