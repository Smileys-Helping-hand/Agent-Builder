#!/usr/bin/env node
/**
 * Copy the shared kit (_kit/) into every template folder, filling in each
 * template's name from its template.json.
 *
 * Each template ends up self-contained on purpose: a customer's build starts
 * from a copy of one folder, and must not reach outside it. So the kit is
 * duplicated rather than shared, and this script keeps the copies in step.
 *
 * Kit files always win — they are plumbing. A template's own look goes in
 * src/styles/template.css and its content in src/content.ts, which the kit
 * never touches.
 *
 *   node templates/sites/scaffold.mjs            # every template
 *   node templates/sites/scaffold.mjs landing    # just one
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const kit = path.join(here, "_kit");

const walk = (dir, rel = "") =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.name === "node_modules" || entry.name === "dist") return [];
    return entry.isDirectory() ? walk(path.join(dir, entry.name), relPath) : [relPath];
  });

const kitFiles = walk(kit);
const only = process.argv[2];

const templates = fs
  .readdirSync(here, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "node_modules")
  .map((entry) => entry.name)
  .filter((name) => !only || name === only);

if (templates.length === 0) {
  console.error(only ? `No template called "${only}".` : "No templates found.");
  process.exit(1);
}

for (const id of templates) {
  const dir = path.join(here, id);
  const metaPath = path.join(dir, "template.json");
  if (!fs.existsSync(metaPath)) {
    console.error(`${id}: missing template.json, skipped.`);
    continue;
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  const fill = (text) =>
    text
      .replaceAll("__PACKAGE__", `arp-template-${id}`)
      .replaceAll("__NAME__", meta.name)
      .replaceAll("__DESCRIPTION__", meta.description.replaceAll('"', "&quot;"))
      .replaceAll("__THEME__", meta.theme)
      .replaceAll("__ICON__", meta.icon);

  for (const file of kitFiles) {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const source = fs.readFileSync(path.join(kit, file), "utf8");
    // package.json must stay valid JSON, so its description is escaped for JSON, not HTML.
    const filled =
      file === "package.json"
        ? source
            .replaceAll("__PACKAGE__", `arp-template-${id}`)
            .replaceAll("__DESCRIPTION__", meta.description.replaceAll("\\", "\\\\").replaceAll('"', '\\"'))
        : fill(source);
    fs.writeFileSync(target, filled);
  }

  const templateCss = path.join(dir, "src", "styles", "template.css");
  if (!fs.existsSync(templateCss)) fs.writeFileSync(templateCss, "/* Styles for this template only. */\n");

  console.log(`${id}: kit copied (${kitFiles.length} files)`);
}
