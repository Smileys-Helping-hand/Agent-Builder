/**
 * The finished site must open by double-clicking dist/index.html. Browsers
 * will not load a module script from a file on disk, so the build puts the
 * code inside the page (see vite.config.ts). This fails if a change to the
 * build ever brings back a separate script or stylesheet file.
 *
 * Runs after `npm run build`; before a build there is nothing to check.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const built = path.resolve("dist/index.html");

describe.skipIf(!fs.existsSync(built))("the built site", () => {
  const page = fs.existsSync(built) ? fs.readFileSync(built, "utf8") : "";

  it("carries its code inside the page, so it opens from a folder", () => {
    expect(page).toMatch(/<script type="module">/);
    expect(page).not.toMatch(/<script[^>]+src=/);
  });

  it("carries its styles inside the page too", () => {
    expect(page).not.toMatch(/<link[^>]+rel="stylesheet"/);
  });

  it("is a single file", () => {
    const files = fs.readdirSync(path.resolve("dist")).filter((name) => !name.startsWith("."));
    expect(files).toEqual(["index.html"]);
  });
});
