/**
 * SimulationLab — experiments you can run on their own, and every experiment in one place.
 *
 * Run a simulation directly (your code, or code the model writes from a description),
 * run it again with another seed, or let the optimiser search: each round looks closer
 * around the best so far, spending its effort on the variables that matter most, as
 * measured by the round before. That picks the next experiment from the results
 * instead of trying more at random. Numbers are what the code computes under its
 * stated assumptions, and each experiment keeps them. Investigations' experiments
 * are listed here too. Stored in data/agent/experiments.json.
 */
import fs from "fs";
import path from "path";

import { Evidence } from "../knowledge/Evidence.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Experiments, type ExperimentResult } from "./Experiments.js";
import { Investigations } from "./Investigation.js";

export interface LabExperiment {
  id: string;
  title: string;
  hypothesis: string;
  assumptions: string[];
  code: string;
  variables: Record<string, unknown[]>;
  baseline: Record<string, unknown>;
  objective: string;
  direction: "max" | "min";
  state: "running" | "done" | "failed";
  error: string | null;
  createdAt: string;
  runs: Array<{ at: string; label: string; seed: number; variables: Record<string, unknown[]>; result: ExperimentResult }>;
  /** The optimiser's rounds: how the best moved as it looked closer. */
  optimised: Array<{ round: number; best: number; params: Record<string, unknown>; focused: string[] }>;
  feedback: Array<{ at: string; by: string; text: string }>;
}

const FILE = () => path.resolve(process.env.SIMULATIONS_FILE ?? "data/agent/experiments.json");

const read = (): LabExperiment[] => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as LabExperiment[];
  } catch {
    return [];
  }
};
const save = (item: LabExperiment) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify([...read().filter((e) => e.id !== item.id), item].slice(-300), null, 2));
};

const newId = () => `sim_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const isNumbers = (values: unknown[]): values is number[] => values.length >= 2 && values.every((v) => typeof v === "number" && Number.isFinite(v));

/**
 * The next round's values: closer around the best for numeric variables, with more points for those that moved the
 * result most last round. Categorical variables are held at their best once they clearly do not matter.
 */
export const nextRound = (variables: Record<string, unknown[]>, result: ExperimentResult): { variables: Record<string, unknown[]>; focused: string[] } => {
  const next: Record<string, unknown[]> = {};
  const focused: string[] = [];
  const share = new Map(result.sensitivity.map((s) => [s.variable, s.share]));
  const top = result.sensitivity[0]?.variable;
  for (const [name, values] of Object.entries(variables)) {
    const best = result.best.params[name];
    const matters = (share.get(name) ?? 0) >= 0.1 || name === top;
    if (!isNumbers(values)) {
      next[name] = matters ? values : [best];
      continue;
    }
    if (!matters) {
      next[name] = [best];
      continue;
    }
    focused.push(name);
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const at = sorted.indexOf(best as number);
    const low = sorted[Math.max(0, at - 1)];
    const high = sorted[Math.min(sorted.length - 1, at + 1)];
    const points = name === top ? 7 : 5;
    next[name] = low === high ? [low] : Array.from({ length: points }, (_v, i) => Math.round((low + ((high - low) * i) / (points - 1)) * 1e6) / 1e6);
  }
  return { variables: next, focused };
};

export const SimulationLab = {
  /** Yours, and those inside investigations. */
  list() {
    const investigations = Investigations.list().flatMap((inv) => inv.experiments.map((e) => ({ investigation: inv.id, objective: inv.objective, id: e.id, title: e.title, hypothesis: e.hypothesis, kind: e.kind, state: e.state, conclusion: e.conclusion, physicalProtocol: e.physicalProtocol, assumptions: e.assumptions, error: e.error, best: e.result?.best ?? null, objectiveMetric: e.result?.objective ?? e.objective, sensitivity: e.result?.sensitivity ?? [], repeatable: e.result?.repeatable ?? null })));
    return { experiments: read().reverse(), fromInvestigations: investigations.reverse() };
  },

  get: (id: string) => read().find((e) => e.id === id) ?? null,

  /** A new experiment: from your code, or written by the model from a description. */
  async create(input: { title: string; description?: string; hypothesis?: string; code?: string; variables?: Record<string, unknown[]>; baseline?: Record<string, unknown>; objective?: string; direction?: "max" | "min"; assumptions?: string[] }): Promise<LabExperiment> {
    const title = String(input.title ?? "").trim().slice(0, 160);
    if (!title) throw new Error("Name the experiment.");
    let { code, variables, objective } = input;
    let hypothesis = input.hypothesis ?? "";
    let assumptions = input.assumptions ?? [];
    let baseline = input.baseline ?? {};
    let direction: "max" | "min" = input.direction === "min" ? "min" : "max";
    if (!code) {
      if (!input.description?.trim()) throw new Error("Give its code, or describe what to simulate.");
      const answer = await ModelRouter.generate(`Write a numerical simulation of: ${input.description}

JavaScript with function simulate(params) returning an object of numbers (no imports, no I/O; Math is available). State every constant and where it comes from in "assumptions". Give "variables" as {name: [values]} (at most 6 values each, 4 variables), a "baseline", the "objective" metric and "direction" (max or min).

Answer with JSON only: {"hypothesis":"...","assumptions":["..."],"variables":{},"baseline":{},"objective":"...","direction":"max","code":"..."}`);
      const clean = answer.replace(/<think>[\s\S]*?<\/think>/gi, "");
      const parsed = JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)) as Partial<LabExperiment>;
      code = String(parsed.code ?? "");
      variables = parsed.variables;
      objective = parsed.objective;
      hypothesis = hypothesis || String(parsed.hypothesis ?? "");
      assumptions = Array.isArray(parsed.assumptions) ? parsed.assumptions.map(String) : assumptions;
      baseline = parsed.baseline ?? baseline;
      direction = parsed.direction === "min" ? "min" : "max";
    }
    if (!variables || !Object.keys(variables).length || !objective || !code) throw new Error("It needs code, variables and an objective.");
    const item: LabExperiment = { id: newId(), title, hypothesis: hypothesis.slice(0, 500), assumptions: assumptions.slice(0, 20), code, variables, baseline, objective, direction, state: "running", error: null, createdAt: new Date().toISOString(), runs: [], optimised: [], feedback: [] };
    save(item);
    return SimulationLab.run(item.id);
  },

  async run(id: string, options: { seed?: number; label?: string } = {}): Promise<LabExperiment> {
    const item = SimulationLab.get(id);
    if (!item) throw new Error("Unknown experiment.");
    try {
      const result = await Experiments.run({ code: item.code, variables: item.variables, baseline: item.baseline, objective: item.objective, direction: item.direction, seed: options.seed });
      item.runs.push({ at: new Date().toISOString(), label: options.label ?? (item.runs.length ? "Run again" : "First run"), seed: result.seed, variables: item.variables, result });
      item.state = "done";
      item.error = null;
      Evidence.record({ kind: "experiment", ref: `experiment:${item.id}`, task: "simulation-lab", agent: "owner", title: item.title, outcome: result.repeatable ? "ran, repeatable" : "ran, not repeatable", data: { best: result.best, evaluated: result.evaluated, assumptions: item.assumptions } });
    } catch (error) {
      item.state = "failed";
      item.error = (error as Error).message;
    }
    save(item);
    return item;
  },

  /** Search: each round looks closer around the best so far, at the variables that matter most. */
  async optimise(id: string, rounds = 3): Promise<LabExperiment> {
    const item = SimulationLab.get(id);
    if (!item) throw new Error("Unknown experiment.");
    let variables = item.runs[item.runs.length - 1]?.variables ?? item.variables;
    let last = item.runs[item.runs.length - 1]?.result ?? null;
    item.optimised = [];
    for (let round = 1; round <= Math.min(6, Math.max(1, rounds)); round++) {
      let focused: string[] = Object.keys(variables);
      if (last) ({ variables, focused } = nextRound(variables, last));
      const result = await Experiments.run({ code: item.code, variables, baseline: item.baseline, objective: item.objective, direction: item.direction });
      item.runs.push({ at: new Date().toISOString(), label: `Optimiser round ${round}`, seed: result.seed, variables, result });
      item.optimised.push({ round, best: result.best.metrics[item.objective], params: result.best.params, focused });
      last = result;
    }
    item.state = "done";
    save(item);
    return item;
  },

  feedback(id: string, text: string, by = "owner"): LabExperiment {
    const item = SimulationLab.get(id);
    if (!item) throw new Error("Unknown experiment.");
    const clean = text.trim().slice(0, 2000);
    if (!clean) throw new Error("Write the feedback.");
    item.feedback.push({ at: new Date().toISOString(), by, text: clean });
    save(item);
    Evidence.record({ kind: "feedback", ref: `feedback:experiment:${id}:${item.feedback.length}`, task: "simulation-lab", agent: by, title: clean.slice(0, 120), outcome: "recorded", links: [{ to: `experiment:${id}`, relation: "feedback-on" }] });
    return item;
  }
};
