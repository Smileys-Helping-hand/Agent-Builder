/**
 * The Template Academy's bookkeeping and its template contract, without
 * running a build (the practice loop itself is tried live).
 *
 *   npm run test:academy
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-academy-"));
process.env.ACADEMY_DIR = path.join(tmp, "academy");
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");

const { TemplateAcademy, contractProblems, practiceBrief } = await import("../src/academy/TemplateAcademy.js");

// Ideas: added once, refused twice, and refused when empty.
const dental = TemplateAcademy.add({ name: "Dental Practice", category: "Dentists", brief: "A site for a dental practice: treatments, team, booking.", mustHave: ["Treatments with prices", "Book a check-up"], icon: "🦷" });
assert.equal(dental.status, "idea");
assert.throws(() => TemplateAcademy.add({ name: "dental practice", brief: "Again, but lower case." }), /already/);
assert.throws(() => TemplateAcademy.add({ name: "X", brief: "" }), /needs a name/);
assert.equal(TemplateAcademy.status().counts.idea, 1);

// The brief carries the contract.
const brief = practiceBrief(dental);
assert.match(brief, /Dental Practice/);
assert.match(brief, /src\/content\.ts/);
assert.match(brief, /demo: true/);
assert.match(brief, /Book a check-up/);

// The contract: the solar landing template is not a dental template, but is a solar one.
const landing = path.resolve("templates/sites/landing");
assert.ok(contractProblems(landing, { name: "Dental Practice", category: "Dentists" }).some((p) => /solar/.test(p)), "the starting point is caught");
assert.deepEqual(contractProblems(landing, { name: "Solar Installer", category: "Solar" }), [], "a finished template passes");
const empty = fs.mkdtempSync(path.join(tmp, "empty-"));
assert.ok(contractProblems(empty, { name: "Gym", category: "Gyms" }).length >= 4, "nothing there: many problems");

// Off means off; nothing running means nothing to step aside.
process.env.ACADEMY = "off";
assert.equal(await TemplateAcademy.tick(), null);
delete process.env.ACADEMY;
assert.equal(TemplateAcademy.yieldToOrders(), 0);

// Publishing is only for graduates.
assert.throws(() => TemplateAcademy.publish(dental.id, 5000), /graduated/);
assert.equal(TemplateAcademy.remove(dental.id), true);
assert.equal(TemplateAcademy.list().length, 0);

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // The test database is still open on Windows; left in the temp folder.
}
console.log("template academy: all checks passed");
