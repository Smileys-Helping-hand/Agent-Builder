#!/usr/bin/env node
/**
 * Build every template into one folder of live previews, one per subfolder,
 * with an index page listing them:
 *
 *   _previews/dist/index.html
 *   _previews/dist/landing/…
 *   _previews/dist/ecommerce/…
 *
 * That folder is what templates.arpcloudsolutions.co.za serves; the shop on
 * the hub links each item's "See an example" to its subfolder. Templates build
 * with relative asset paths and hash routes, so a subfolder needs no config.
 *
 *   node templates/sites/build-previews.mjs
 *   npx vercel deploy templates/sites/_previews/dist --prod
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "_previews", "dist");

const ids = fs
  .readdirSync(here, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "node_modules")
  .map((entry) => entry.name)
  .filter((id) => fs.existsSync(path.join(here, id, "template.json")));

// Clear the last build but keep .vercel, the link to the arp-templates project,
// so publishing again is just `vercel deploy --prod` from the folder.
fs.mkdirSync(out, { recursive: true });
for (const entry of fs.readdirSync(out)) {
  if (entry !== ".vercel") fs.rmSync(path.join(out, entry), { recursive: true, force: true });
}

const cards = [];
for (const id of ids) {
  const dir = path.join(here, id);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "template.json"), "utf8"));
  if (!fs.existsSync(path.join(dir, "node_modules"))) {
    execSync("npm install --no-audit --no-fund", { cwd: dir, stdio: "inherit" });
  }
  execSync("npm run build", { cwd: dir, stdio: "inherit", env: { ...process.env, BASE_PATH: "./" } });
  fs.cpSync(path.join(dir, "dist"), path.join(out, id), { recursive: true });
  cards.push({ id, ...meta });
  console.log(`${id}: built`);
}

const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

fs.writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Templates · ARP Cloud Solutions</title>
<meta name="description" content="Live previews of every website and app template ARP Cloud Solutions builds." />
<style>
  :root { color-scheme: dark; }
  body { margin: 0; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; background: #020617; color: #e2e8f0; }
  main { width: min(1100px, 100% - 32px); margin: 0 auto; padding: 56px 0; }
  h1 { font-size: clamp(2rem, 5vw, 3rem); margin: 0 0 8px; }
  p.lead { color: #94a3b8; margin: 0 0 36px; max-width: 60ch; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }
  a.card { display: block; padding: 22px; border-radius: 16px; background: #0f172a; border: 1px solid #1e293b; color: inherit; text-decoration: none; transition: border-color .2s, transform .2s; }
  a.card:hover { border-color: #22d3ee; transform: translateY(-3px); }
  .icon { font-size: 2rem; }
  h2 { font-size: 1.15rem; margin: 10px 0 6px; }
  .card p { color: #94a3b8; font-size: .92rem; margin: 0; }
  .shop { display: inline-block; margin-top: 36px; color: #22d3ee; font-weight: 600; }
</style>
</head>
<body>
<main>
  <h1>Templates</h1>
  <p class="lead">Live, working previews of everything we build. Every one is tailored to your business before it goes live — these run on sample content.</p>
  <div class="grid">
${cards
  .map(
    (card) => `    <a class="card" href="./${card.id}/">
      <div class="icon">${card.icon}</div>
      <h2>${escape(card.name)}</h2>
      <p>${escape(card.description)}</p>
    </a>`
  )
  .join("\n")}
  </div>
  <a class="shop" href="https://arpcloudsolutions.co.za/shop">Order one in the shop &rarr;</a>
</main>
</body>
</html>
`
);

// Security headers for the static host, and no indexing of sample businesses.
fs.writeFileSync(
  path.join(out, "vercel.json"),
  JSON.stringify(
    {
      headers: [
        {
          source: "/(.*)",
          headers: [
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
            { key: "X-Robots-Tag", value: "noindex" }
          ]
        }
      ]
    },
    null,
    2
  )
);

// Never publish anything but the built pages. `vercel link` drops an .env.local
// and a .gitignore in the folder it links; neither belongs on a public site.
fs.writeFileSync(path.join(out, ".vercelignore"), ".env*\n.gitignore\n");

console.log(`\n${cards.length} previews in ${out}`);
