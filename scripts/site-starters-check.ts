/**
 * Which prompts start from a finished site template, which business name is
 * read from them, and that the copy is a complete template without its
 * installed packages. Run from an empty folder (it writes ./builds there):
 *
 *   TEMPLATES_DIR=<repo>/templates/sites npx tsx <repo>/scripts/site-starters-check.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { businessName, isWebsiteRequest, prepareSite, starterFor } from "../src/orchestrator/SiteStarters.js";

let passed = 0;
const check = (name: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
};

const site = (name: string, brief: string) => isWebsiteRequest(name, brief);
check("a bakery website", () => assert.ok(site("Sweet Crumbs", "Build me a website for my bakery Sweet Crumbs in Cape Town with our menu and an order form")));
check("a landing page", () => assert.ok(site("Solar", "a landing page for my solar installation business")));
check("a gym site with booking", () => assert.ok(site("Iron Gym", "website for my gym with class times and a booking form")));
check("a habit tracker is an app", () => assert.ok(!site("Habits", "Build a habit tracker app: add habits and see streaks")));
check("a snake game is not a site", () => assert.ok(!site("Snake", "a snake game for my website")));
check("a dashboard is not a site", () => assert.ok(!site("Sales", "a sales dashboard site showing charts")));
check("no website word: not routed", () => assert.ok(!site("Notes", "something to keep my notes")));

check("starter: bakery -> restaurant", () => assert.equal(starterFor({ name: "Sweet Crumbs", brief: "a website for my bakery" }), "restaurant"));
check("starter: salon -> booking", () => assert.equal(starterFor({ name: "Glow", brief: "website for my nail salon" }), "booking"));
check("starter: nothing matching -> landing", () => assert.equal(starterFor({ name: "Acme", brief: "a website for my plumbing company" }), "landing"));

check("name: my bakery Sweet Crumbs", () => assert.equal(businessName("Bakery site", "a website for my bakery Sweet Crumbs in Cape Town"), "Sweet Crumbs"));
check("name: called", () => assert.equal(businessName("x", "a site for a salon called Glow Studio"), "Glow Studio"));
check("name: quoted", () => assert.equal(businessName("x", 'a landing page for "Bright Solar"'), "Bright Solar"));
check("name: generic project name is not a business", () => assert.equal(businessName("My website", "a website for a plumber"), null));

check("the copy is the template, ready to tailor", () => {
  const made = prepareSite("Sweet Crumbs Bakery", "Build me a website for my bakery Sweet Crumbs in Cape Town with our menu and prices");
  assert.ok(made, "a site was prepared");
  assert.equal(made.starter, "restaurant");
  for (const file of ["template.json", "package.json", "src/content.ts", "src/lib/site.tsx", ".gitignore"]) assert.ok(fs.existsSync(path.join(made.dir, file)), `${file} is there`);
  assert.ok(!fs.existsSync(path.join(made.dir, "node_modules")), "no installed packages copied");
  assert.ok(!fs.existsSync(path.join(made.dir, "dist")), "no old build copied");
  assert.match(made.brief, /^The project is our "Restaurant \/ Hospitality" site template/);
  assert.match(made.brief, /Business: Sweet Crumbs/);
  assert.match(made.brief, /my bakery Sweet Crumbs in Cape Town with our menu and prices/);
  assert.match(made.brief, /Never invent contact details/);
  fs.rmSync(made.dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed`);
