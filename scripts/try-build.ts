/**
 * Run one real build from the command line, the way the app would, and print
 * every pass: score, which checks pass, and what the builder decided. For
 * trying the engine on a template or the web starter without the app.
 *
 *   npx tsx scripts/try-build.ts --template restaurant --brief-file brief.txt
 *   npx tsx scripts/try-build.ts --starter --name "Salon bookings" --brief "..."
 *   npx tsx scripts/try-build.ts --from path/to/earlier/build --brief-file brief.txt   (a continued build)
 *   options: --profile fast|balanced|deep  --iterations N  --threshold N
 *
 * Point it at a model server with OLLAMA_BASE_URL / OLLAMA_MODEL as usual.
 * Builds land in ./builds; set KNOWLEDGE_DB_PATH to keep lessons separate.
 */
import fs from "node:fs";
import path from "node:path";

import { AutonomousOrchestrator, type BuildProfile } from "../src/orchestrator/AutonomousOrchestrator.js";
import { copyForBuild } from "../src/ecosystem/ProjectBuilds.js";
import type { CheckResult } from "../src/orchestrator/Verifier.js";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? undefined : argv[index + 1];
};
const has = (name: string) => argv.includes(`--${name}`);

const template = flag("template");
const brief = flag("brief") ?? (flag("brief-file") ? fs.readFileSync(flag("brief-file")!, "utf8") : "");
const name = flag("name") ?? (template ? `${template} order` : "try-build");
if (!brief) {
  console.error("Give a --brief or --brief-file.");
  process.exit(1);
}

const source = flag("from") ? path.resolve(flag("from")!) : template ? path.resolve("templates/sites", template) : has("starter") ? path.resolve("templates/starters/web") : null;
const workingDir = source ? (await copyForBuild(source, name, "try")).workDir : undefined;
const started = Date.now();

const orchestrator = new AutonomousOrchestrator({
  projectName: name,
  description: brief,
  targetPlatforms: ["web"],
  qualityThreshold: Number(flag("threshold") ?? 92),
  maxIterations: Number(flag("iterations") ?? 8),
  enableContinuousLearning: false,
  hardwareOptimization: false,
  autoPackaging: false,
  profile: (flag("profile") ?? "deep") as BuildProfile,
  workingDir
});

const minutes = () => ((Date.now() - started) / 60000).toFixed(1);
orchestrator.on("iteration-status", (info) => console.log(`  [${minutes()}m] pass ${info.iteration}: ${info.status}${info.attempt ? ` ${info.attempt}` : ""}`));
orchestrator.on("thought", (thought) => {
  const review = /^Reviewed/.test(thought?.title ?? "");
  if (thought?.kind === "decision" || thought?.kind === "repair" || review) {
    console.log(`  [${minutes()}m] ${thought.title}${review && thought.text ? `\n${thought.text}` : ""}`);
  }
});
orchestrator.on("iteration-complete", (iteration) => {
  const checks = (iteration.verification?.checks ?? [])
    .filter((check: CheckResult) => check.applicable)
    .map((check: CheckResult) => `${check.name}=${check.passed ? "pass" : "FAIL"}`)
    .join(" ");
  console.log(`PASS ${iteration.iteration} [${minutes()}m]: score ${iteration.qualityScore}  ${checks}`);
  const blocker = iteration.verification?.blockingCheck;
  if (blocker?.name === "completeness" || blocker?.name === "tailoring") console.log(`  why: ${blocker.output.split("\n").slice(0, 2).join(" ").slice(0, 400)}`);
});
orchestrator.on("completed", (info) => console.log(`DONE [${minutes()}m]: final ${info.finalQuality} — ${info.reason ?? "threshold met"}`));

try {
  await orchestrator.start();
} catch (error) {
  console.log(`FAILED [${minutes()}m]: ${error instanceof Error ? error.message : String(error)}`);
}
console.log(`Workspace: ${orchestrator.getStatus().outputDir}`);
process.exit(0);
