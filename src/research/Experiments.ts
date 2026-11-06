/**
 * Experiments — computed experiments that really run.
 *
 * An experiment is a stated hypothesis plus a model written as code:
 *   function simulate(params) { return { metric: number, … }; }
 * The engine (not the model that wrote it) evaluates it over every combination
 * of the variables, ranks them by the stated objective, measures how much each
 * variable matters around the best (sensitivity), and repeats the best to prove
 * the result reproduces. The numbers in a report are what this computed.
 *
 * The code comes from a model that has read web pages, so it is treated as
 * untrusted: it runs in its own process under Node's permission model (no file
 * access beyond its own script, no child processes), with an empty environment,
 * in a VM context with no require or process, for at most a minute. Math.random is
 * seeded, so a run can be reproduced exactly.
 *
 * What it proves is what the model computes under its stated assumptions, not
 * what happens in the world: every result keeps those assumptions beside it, and
 * questions that need the real world are recorded as physical experiments to do.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type ExperimentKind = "simulation" | "analysis" | "physical";

export interface ExperimentResult {
  evaluated: number;
  objective: string;
  direction: "max" | "min";
  best: { params: Record<string, unknown>; metrics: Record<string, number> };
  top: Array<{ params: Record<string, unknown>; metrics: Record<string, number> }>;
  baseline: { params: Record<string, unknown>; metrics: Record<string, number> } | null;
  /** How much the objective moves when one variable changes and the others stay at the best: largest first. */
  sensitivity: Array<{ variable: string; low: number; high: number; range: number; share: number }>;
  /** The best was evaluated again from the same seed and came out the same. */
  repeatable: boolean;
  seed: number;
  durationMs: number;
}

export interface Experiment {
  id: string;
  title: string;
  hypothesis: string;
  question: string;
  kind: ExperimentKind;
  variables: Record<string, unknown[]>;
  baseline: Record<string, unknown>;
  objective: string;
  direction: "max" | "min";
  method: string;
  /** Stated assumptions the model rests on, and where its numbers come from. */
  assumptions: string[];
  expected: string;
  criteria: string;
  code: string | null;
  state: "planned" | "running" | "done" | "failed" | "needs-physical-test";
  result: ExperimentResult | null;
  error: string | null;
  supported: boolean | null;
  conclusion: string | null;
  /** Why it cannot be computed, and what a person must do, for a physical experiment. */
  physicalProtocol: string | null;
  runAt: string | null;
}

const LIMIT_MS = Number(process.env.EXPERIMENT_LIMIT_MS) || 60_000;
const MAX_COMBINATIONS = 5000;

/** Runs in the sandbox process: reads spec.json next to it and prints one JSON line. */
const RUNNER = String.raw`
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "spec.json"), "utf8"));

const seeded = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const context = vm.createContext({ console: { log() {}, error() {}, warn() {} } });
vm.runInContext("delete globalThis.WebAssembly; delete globalThis.SharedArrayBuffer;", context);
vm.runInContext(spec.code + "\n;globalThis.__simulate = simulate;", context, { timeout: 5000 });
const reseed = (seed) => {
  context.__random = seeded(seed);
  vm.runInContext("Math.random = globalThis.__random;", context);
};
const evaluate = (params) => {
  context.__params = JSON.stringify(params);
  const out = vm.runInContext("JSON.stringify(__simulate(JSON.parse(__params)))", context, { timeout: 5000 });
  const metrics = JSON.parse(out);
  if (!metrics || typeof metrics !== "object") throw new Error("simulate must return an object of numbers");
  const clean = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = Math.round(value * 1e6) / 1e6;
  }
  if (typeof clean[spec.objective] !== "number") throw new Error("simulate did not return a finite number for the objective: " + spec.objective);
  return clean;
};

const names = Object.keys(spec.variables);
const combos = [];
const walk = (i, params) => {
  if (combos.length >= spec.maxCombinations) return;
  if (i === names.length) { combos.push({ ...params }); return; }
  for (const value of spec.variables[names[i]]) walk(i + 1, { ...params, [names[i]]: value });
};
walk(0, {});
if (!combos.length) throw new Error("no combinations of the variables");

const better = (a, b) => (spec.direction === "min" ? a < b : a > b);
const results = [];
for (const params of combos) {
  reseed(spec.seed);
  results.push({ params, metrics: evaluate(params) });
}
results.sort((a, b) => (spec.direction === "min" ? a.metrics[spec.objective] - b.metrics[spec.objective] : b.metrics[spec.objective] - a.metrics[spec.objective]));
const best = results[0];

reseed(spec.seed);
const again = evaluate(best.params);
const repeatable = JSON.stringify(again) === JSON.stringify(best.metrics);

let baseline = null;
if (spec.baseline && Object.keys(spec.baseline).length) {
  reseed(spec.seed);
  baseline = { params: spec.baseline, metrics: evaluate({ ...best.params, ...spec.baseline }) };
}

const sensitivity = names.map((variable) => {
  const values = spec.variables[variable].map((value) => {
    reseed(spec.seed);
    return evaluate({ ...best.params, [variable]: value })[spec.objective];
  });
  const low = Math.min(...values);
  const high = Math.max(...values);
  return { variable, low, high, range: Math.round((high - low) * 1e6) / 1e6, share: 0 };
}).sort((a, b) => b.range - a.range);
const total = sensitivity.reduce((sum, s) => sum + s.range, 0);
for (const s of sensitivity) s.share = total ? Math.round((s.range / total) * 1000) / 1000 : 0;

process.stdout.write(JSON.stringify({ evaluated: results.length, best, top: results.slice(0, 15), baseline, sensitivity, repeatable, better: better(1, 0) }));
`;

export const Experiments = {
  /** Evaluate a simulation in the sandbox. Throws with the reason when its code does not work. */
  async run(input: { code: string; variables: Record<string, unknown[]>; baseline?: Record<string, unknown>; objective: string; direction?: "max" | "min"; seed?: number }): Promise<ExperimentResult> {
    if (!/function\s+simulate\s*\(|simulate\s*=/.test(input.code)) throw new Error("The code has no simulate(params) function.");
    const started = Date.now();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-"));
    const seed = input.seed ?? 20261106;
    const direction = input.direction === "min" ? "min" : "max";
    try {
      fs.writeFileSync(path.join(dir, "runner.cjs"), RUNNER);
      fs.writeFileSync(path.join(dir, "spec.json"), JSON.stringify({ code: input.code, variables: input.variables, baseline: input.baseline ?? {}, objective: input.objective, direction, seed, maxCombinations: MAX_COMBINATIONS }));
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(process.execPath, ["--permission", `--allow-fs-read=${dir}${path.sep}*`, path.join(dir, "runner.cjs")], { env: {}, cwd: dir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", (chunk: Buffer) => {
          out += chunk.toString("utf8");
          if (out.length > 4_000_000) child.kill();
        });
        child.stderr.on("data", (chunk: Buffer) => {
          err = (err + chunk.toString("utf8")).slice(-3000);
        });
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error(`It did not finish within ${Math.round(LIMIT_MS / 1000)} s.`));
        }, LIMIT_MS);
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(out);
          else reject(new Error((/Error: [^\n]*/.exec(err)?.[0] ?? err.split("\n").slice(-3).join(" ")).slice(0, 600) || `exit ${code}`));
        });
      });
      const parsed = JSON.parse(output) as Omit<ExperimentResult, "objective" | "direction" | "seed" | "durationMs">;
      return { evaluated: parsed.evaluated, objective: input.objective, direction, best: parsed.best, top: parsed.top, baseline: parsed.baseline, sensitivity: parsed.sensitivity, repeatable: parsed.repeatable, seed, durationMs: Date.now() - started };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
};
