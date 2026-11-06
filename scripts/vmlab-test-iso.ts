/**
 * Boot an ISO in the Virtual Test Lab (the real one, data/vmlab) and test it, from
 * the command line. The VM and the run stay, and show on the app's Lab page.
 *
 *   npx tsx scripts/vmlab-test-iso.ts <iso> [--user nexus] [--password nexus] [--name "NexusOS"] [--memory 3072] [--cpus 4] [--profiles boot,login,...] [--keep-running] [--label "0.1.0"]
 */
import path from "path";

import { VmLab } from "../src/lab/VmLab.js";
import { VmTests, FULL } from "../src/lab/VmTests.js";

const option = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const main = async () => {
  const iso = process.argv[2];
  if (!iso || iso.startsWith("--")) throw new Error("Say which ISO.");
  const name = option("name", path.basename(iso))!;
  const vm =
    VmLab.list().find((v) => v.name === name && v.iso && path.resolve(v.iso) === path.resolve(iso)) ??
    (await VmLab.create({ name, purpose: `Testing ${path.basename(iso)}`, iso, cpus: Number(option("cpus", "4")), memoryMb: Number(option("memory", "3072")), diskGb: 8, network: "isolated" }));
  if (vm.state === "running" || vm.state === "paused") await VmLab.stop(vm.id, true);
  const run = await VmTests.runToEnd({
    vmId: vm.id,
    profiles: option("profiles")?.split(",") ?? FULL,
    agent: "command line",
    task: option("task") ?? `iso:${path.basename(iso)}`,
    label: option("label") ?? null,
    login: { user: option("user", "root"), password: option("password", "") },
    recordEverySec: Number(option("record", "0"))
  });
  for (const step of run.steps) console.log(`${step.result.padEnd(7)} [${step.profile}] ${step.what}: ${step.actual} (${Math.round(step.durationMs / 1000)} s)${step.screenshot ? ` <${step.screenshot}>` : ""}`);
  for (const step of run.steps.filter((s) => s.result === "failed" || s.result === "warned")) console.log(`\n--- ${step.result}: ${step.what}\nexpected ${step.expected}\n${step.output.slice(-1000)}`);
  console.log(`\nRUN ${run.id}: ${run.state}. ${run.counts.passed} passed, ${run.counts.failed} failed, ${run.counts.warned} warnings, ${run.counts.skipped} skipped.`);
  if (!process.argv.includes("--keep-running")) await VmLab.stop(vm.id, true);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed:", error?.message ?? error);
    process.exit(1);
  });
