/**
 * The acceptance suite: the specification's scenarios, each run from the checks
 * that prove it, with a line per scenario at the end.
 *
 *   npx tsx scripts/acceptance.ts            everything but real VMs (a few minutes)
 *   npx tsx scripts/acceptance.ts --vm       with the real boots (add about 15 minutes)
 *
 * A scenario marked "with a stand-in model" proves the machinery. What the local model
 * manages with it is measured separately, on the live builder, by the Evaluations tab.
 */
import { spawnSync } from "child_process";

interface Scenario {
  name: string;
  proof: string;
  scripts: string[];
  vm?: boolean;
}

const SCENARIOS: Scenario[] = [
  { name: "1. Linux OS development", proof: "real boots: a kernel to a login prompt, profiles over the serial console, snapshots, reset, a real defect found", scripts: ["scripts/vmlab-smoketest.ts"], vm: true },
  { name: "1b. OS as a build check", proof: "a failing check is fed back to the step that fixes it; the whole life of a session (stand-in model)", scripts: ["scripts/continuous-smoketest.ts"] },
  { name: "2. Iteration inspection", proof: "real commits: files, functions, diffs, lessons, checks, running and finished, compared", scripts: ["scripts/iterations-smoketest.ts"] },
  { name: "3. Deep research", proof: "plan, specialists, real sandboxed experiments, contradictions, citations (stand-in model and search)", scripts: ["scripts/investigation-smoketest.ts", "scripts/research-smoketest.ts"] },
  { name: "4. Shared learning", proof: "one agent's discovery reaches another's task; who used what (stand-in model)", scripts: ["scripts/learning-smoketest.ts", "scripts/platform-smoketest.ts"] },
  { name: "5. Measurable improvement", proof: "hidden-test graders; with and without knowledge compared; regressions named (stand-in model)", scripts: ["scripts/learning-smoketest.ts"] },
  { name: "6. User feedback", proof: "on an iteration: reaches the session; on a VM run and an investigation: linked and followed up", scripts: ["scripts/iterations-smoketest.ts", "scripts/investigation-smoketest.ts"] },
  { name: "7. Recovery and security", proof: "VM stop and delete, snapshot restore, no way out of the experiment sandbox, reconnecting (the VM parts with --vm)", scripts: ["scripts/investigation-smoketest.ts", "scripts/vmlab-smoketest.ts"], vm: true },
  { name: "Games and multiplayer", proof: "asset rules, engines, releases, downloads; rooms, host hand-over, reconnection", scripts: ["scripts/game-director-smoketest.ts", "scripts/net-kit-smoketest.ts"] },
  { name: "Self-improvement and rebuilding", proof: "findings from the record; rebuilding from a blueprint and learning from what it missed", scripts: ["scripts/self-improve-smoketest.ts", "scripts/reconstruct-smoketest.ts", "scripts/rl-smoketest.ts"] }
];

const withVm = process.argv.includes("--vm");
const results = new Map<string, boolean>();
const run = (script: string): boolean => {
  const known = results.get(script);
  if (known !== undefined) return known;
  console.log(`  running ${script}…`);
  const out = spawnSync("npx", ["tsx", script], { shell: true, encoding: "utf8", timeout: 40 * 60_000, windowsHide: true });
  const ok = out.status === 0;
  if (!ok) console.log((out.stdout + out.stderr).split("\n").filter((l) => !l.startsWith('{"source"')).slice(-8).join("\n"));
  results.set(script, ok);
  return ok;
};

const lines: string[] = [];
let failed = 0;
for (const scenario of SCENARIOS) {
  const scripts = scenario.scripts.filter((s) => withVm || s !== "scripts/vmlab-smoketest.ts");
  if (!scripts.length) {
    lines.push(`SKIPPED  ${scenario.name}: needs --vm`);
    continue;
  }
  console.log(scenario.name);
  const ok = scripts.map(run).every(Boolean);
  if (!ok) failed += 1;
  lines.push(`${ok ? "PASSED " : "FAILED "}  ${scenario.name}: ${scenario.proof}`);
}
console.log(`\n${lines.join("\n")}\n`);
console.log(failed ? `${failed} scenario(s) failed.` : "No scenario failed.");
process.exit(failed ? 1 : 0);
