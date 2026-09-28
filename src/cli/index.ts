#!/usr/bin/env node
import { AutonomousOrchestrator, type BuildProfile } from "../orchestrator/AutonomousOrchestrator.js";
import type { CheckResult } from "../orchestrator/Verifier.js";
import { PluginRegistry } from "../agents/PluginRegistry.js";
import { VectorMemory } from "../state/VectorMemory.js";

/**
 * Usage:
 *   npm run cli -- "build a CLI that reverses a string"
 *   npm run cli -- --profile deep --iterations 5 "build a todo API"
 */
const argv = process.argv.slice(2);

const readFlag = (name: string): string | undefined => {
  const index = argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = argv[index + 1];
  argv.splice(index, value === undefined ? 1 : 2);
  return value;
};

const profile = (readFlag("profile") ?? "balanced") as BuildProfile;
const iterations = Number(readFlag("iterations") ?? 3);
const name = readFlag("name") ?? "cli-build";
const description = argv.join(" ").trim();

if (!description) {
  console.error(
    'Usage: npm run cli -- [--profile fast|balanced|deep] [--iterations N] [--name NAME] "<what to build>"'
  );
  process.exit(1);
}

(async () => {
  await PluginRegistry.initialize();
  await VectorMemory.init();

  const orchestrator = new AutonomousOrchestrator({
    projectName: name,
    description,
    targetPlatforms: [process.platform === "win32" ? "windows" : process.platform === "darwin" ? "macos" : "linux"],
    qualityThreshold: 100,
    maxIterations: Number.isFinite(iterations) ? iterations : 3,
    enableContinuousLearning: false,
    hardwareOptimization: true,
    autoPackaging: false,
    profile
  });

  orchestrator.on("iteration-status", (info) => {
    console.log(`  [iteration ${info.iteration}] ${info.status}${info.attempt ? ` (attempt ${info.attempt})` : ""}`);
  });

  orchestrator.on("iteration-complete", (iteration) => {
    const checks = iteration.verification?.checks
      .filter((check: CheckResult) => check.applicable)
      .map((check: CheckResult) => `${check.name}=${check.passed ? "pass" : "FAIL"}`)
      .join(" ");
    console.log(`Iteration ${iteration.iteration}: score ${iteration.objectiveScore}  ${checks ?? ""}`);
  });

  await orchestrator.start();

  const status = orchestrator.getStatus();
  console.log(`\nDone. Workspace: ${status.outputDir}`);
})();
