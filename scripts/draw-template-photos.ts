/**
 * Draw the photographs of our website templates on this PC's image engine.
 *
 * Each template lists its pictures in art.json ({ style, pictures: [{ name,
 * subject, kind: "photo", size, file }] }); this draws each into its file
 * (src/images/<name>.webp), which the page imports and builds into itself.
 * Customer builds redraw the same list for their own business (the art pass);
 * this is for the templates themselves.
 *
 *   npx tsx scripts/draw-template-photos.ts                 # missing photos only
 *   npx tsx scripts/draw-template-photos.ts --only restaurant
 *   npx tsx scripts/draw-template-photos.ts --only restaurant --force   # redraw all of them
 *
 * Starts ComfyUI if needed; uses Flux schnell when installed (see photoCheckpoint).
 */
import fs from "fs";
import path from "path";

import { ArtStudio, photoCheckpoint, photoWorkflow, type ArtRequest } from "../src/media/ArtStudio.js";

const argv = process.argv.slice(2);
const only = argv.includes("--only") ? argv[argv.indexOf("--only") + 1] : null;
const force = argv.includes("--force");
const sites = path.resolve("templates/sites");

const templates = fs
  .readdirSync(sites, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && (!only || entry.name === only))
  .map((entry) => entry.name)
  .filter((name) => fs.existsSync(path.join(sites, name, "art.json")));

if (!(await ArtStudio.ensure())) {
  console.error("The image engine (ComfyUI) is not running and could not be started.");
  process.exit(1);
}
const checkpoint = await photoCheckpoint();
console.log(`Drawing with ${checkpoint}`);
await ArtStudio.clearCardForArt();

let drawn = 0;
let failed = 0;
try {
  for (const template of templates) {
    const list = JSON.parse(fs.readFileSync(path.join(sites, template, "art.json"), "utf8")) as { style?: string; pictures?: ArtRequest[] };
    const photos = (list.pictures ?? []).filter((picture) => picture.kind === "photo");
    for (const [index, picture] of photos.entries()) {
      const file = path.join(sites, template, picture.file ?? `src/images/${picture.name}.webp`);
      if (fs.existsSync(file) && !force) continue;
      const started = Date.now();
      try {
        const webp = await ArtStudio.render(photoWorkflow(picture, list.style ?? "", 101 + index, `arp-templates/${template}-${picture.name}`, checkpoint));
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, webp);
        drawn += 1;
        console.log(`drew ${template}/${picture.name} (${Math.round((Date.now() - started) / 1000)} s, ${Math.round(webp.length / 1024)} KB)`);
      } catch (error) {
        failed += 1;
        console.log(`could not draw ${template}/${picture.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
} finally {
  await ArtStudio.clearCardForCode();
}
console.log(`${drawn} drawn, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
