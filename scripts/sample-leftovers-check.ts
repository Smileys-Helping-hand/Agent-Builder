/**
 * The template's sample items left on a tailored site are found by name; an
 * item the brief names itself is not. Optionally pass built content.ts files
 * to see what each still carries from the restaurant template:
 *
 *   npx tsx scripts/sample-leftovers-check.ts [path/to/content.ts ...]
 */
import assert from "node:assert/strict";
import fs from "node:fs";

import { sampleItemsLeft } from "../src/orchestrator/Tailoring.js";

const original = [
  "export const site = {",
  '  business: { name: "Salt & Ember" },',
  '  menu: [{ title: "To start", dishes: [{ name: "Calamari", price: 95 }, { name: "Line fish", price: 180 }] }],',
  '  team: [{ name: "Thandi Mokoena", role: "Head chef" }]',
  "};"
].join("\n");
const bakery = original.replace("Salt & Ember", "Sweet Crumbs").replace('"Line fish"', '"Red Velvet Cake"').replace('"Thandi Mokoena"', '"Aisha Davids"');
assert.deepEqual(sampleItemsLeft(original, bakery, "a website for my bakery Sweet Crumbs"), ["Calamari"]);
assert.deepEqual(sampleItemsLeft(original, bakery, "a seafood place; we serve calamari"), [], "named in the brief: it stays");
assert.deepEqual(sampleItemsLeft(original, original.replace("Salt & Ember", "X"), "x"), ["Calamari", "Line fish", "Thandi Mokoena"]);
console.log("ok  sample dishes and team members left on a tailored site are named; the brief's own are not");

const template = fs.readFileSync("templates/sites/restaurant/src/content.ts", "utf8");
for (const file of process.argv.slice(2)) {
  console.log(`  ${file}: ${JSON.stringify(sampleItemsLeft(template, fs.readFileSync(file, "utf8"), "a website for my bakery Sweet Crumbs in Cape Town"))}`);
}
