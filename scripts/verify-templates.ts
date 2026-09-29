/**
 * Prove every template can be built for a customer.
 *
 * Each template goes through exactly what an order does: copyForBuild makes a
 * fresh copy under builds/ as its own git repository, and the Verifier scores
 * it with the orchestrator's own options — install, typecheck, build, test.
 * A template that does not score 100 here would start every customer's build
 * already failing, so this is the bar for adding or changing one.
 *
 *   npm run verify:templates            # every template
 *   npm run verify:templates -- blog    # just one
 *
 * The copies are deleted afterwards unless --keep is passed.
 */
import fs from "fs";
import path from "path";

import { copyForBuild } from "../src/ecosystem/ProjectBuilds.js";
import { Verifier } from "../src/orchestrator/Verifier.js";
import { Workspace } from "../src/orchestrator/Workspace.js";

const TEMPLATES_ROOT = path.resolve("templates/sites");
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const only = args.find((arg) => !arg.startsWith("--"));

const ids = fs
  .readdirSync(TEMPLATES_ROOT, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && entry.name !== "node_modules")
  .map((entry) => entry.name)
  .filter((id) => !only || id === only);

if (ids.length === 0) {
  console.error(only ? `No template called "${only}".` : "No templates found.");
  process.exit(1);
}

let failures = 0;
for (const id of ids) {
  const started = Date.now();
  const { workDir } = await copyForBuild(path.join(TEMPLATES_ROOT, id), `template ${id}`, "verify");
  try {
    const report = await Verifier.verify(new Workspace(workDir));
    const checks = report.checks
      .map((check) => `${check.name}:${!check.applicable ? "n/a" : check.passed ? "ok" : "FAIL"}`)
      .join("  ");
    const seconds = Math.round((Date.now() - started) / 1000);
    console.log(`${id.padEnd(11)} score ${String(report.score).padStart(3)}  ${checks}  (${seconds}s)`);
    if (report.score < 100) {
      failures += 1;
      const failed = report.checks.find((check) => check.applicable && !check.passed);
      if (failed) console.log(`  ${failed.name} output:\n${failed.output.split("\n").slice(-15).join("\n")}`);
    }
  } finally {
    if (!keep) fs.rmSync(workDir, { recursive: true, force: true });
  }
}

console.log(failures === 0 ? `\nAll ${ids.length} templates score 100.` : `\n${failures} template(s) below 100.`);
process.exit(failures === 0 ? 0 : 1);
