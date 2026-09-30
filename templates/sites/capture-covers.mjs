#!/usr/bin/env node
/**
 * A cover picture for every built preview, so the shop's gallery can show a
 * light image and only load the live site when someone reaches for it.
 *
 *   node templates/sites/build-previews.mjs
 *   node templates/sites/capture-covers.mjs      # writes _previews/dist/<id>/cover.webp
 *
 * Uses a locally installed Chrome or Edge in headless mode (each preview is a
 * single file, so it opens straight from disk) and Python's Pillow to shrink
 * the screenshot to a 960x600 WebP.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "_previews", "dist");

const browser = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && fs.existsSync(candidate));
if (!browser) {
  console.error("No Chrome or Edge found. Set CHROME_PATH.");
  process.exit(1);
}

const ids = fs
  .readdirSync(dist, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dist, entry.name, "index.html")))
  .map((entry) => entry.name);

const shrink = `
import sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGB")
im = im.resize((960, 600), Image.LANCZOS)
im.save(dst, "WEBP", quality=80, method=6)
`;
const shrinkScript = path.join(os.tmpdir(), "arp-shrink-cover.py");
fs.writeFileSync(shrinkScript, shrink);

for (const id of ids) {
  const page = pathToFileURL(path.join(dist, id, "index.html")).href;
  const raw = path.join(os.tmpdir(), `arp-cover-${id}.png`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "arp-cover-profile-"));
  execFileSync(
    browser,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--no-first-run",
      "--force-device-scale-factor=1",
      `--user-data-dir=${profile}`,
      "--window-size=1280,800",
      // Let entrance animations finish before the picture is taken.
      "--virtual-time-budget=5000",
      `--screenshot=${raw}`,
      page,
    ],
    { stdio: "ignore", timeout: 60000 }
  );
  const cover = path.join(dist, id, "cover.webp");
  execFileSync(process.platform === "win32" ? "python" : "python3", [shrinkScript, raw, cover], { stdio: "inherit" });
  fs.rmSync(raw, { force: true });
  fs.rmSync(profile, { recursive: true, force: true });
  console.log(`${id}: cover.webp (${Math.round(fs.statSync(cover).size / 1024)} KB)`);
}
