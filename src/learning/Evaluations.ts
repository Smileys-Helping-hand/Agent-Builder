/**
 * Evaluations — does the agent actually get better? Measured, not claimed.
 *
 * A benchmark is a set of fixed challenges with code-based graders: the model
 * writes a function and hidden tests run it in the sandbox; it diagnoses a real
 * error and must name the cause; it reads a passage and must find what is there
 * and not invent what is not; it follows a rule it was taught. Nothing is graded by
 * the model's opinion of itself. Add your own, including any defect once fixed
 * (POST /api/agent/evaluations/challenges), so it cannot quietly come back.
 *
 * A run scores every challenge (over repeated trials, because the model is not
 * deterministic), with what the builder has learned given to it (lessons and
 * research findings, as builds get them), or without, to measure what the learning
 * itself is worth on the same model. compare() shows two runs side by side: scores,
 * differences, regressions and how much trials varied. A change to the model's
 * weights is not what this measures: adding to memory does not change an LLM. It
 * measures what the whole system can do.
 *
 * Runs are kept in data/agent/evaluations.json and in the evidence ledger.
 */
import fs from "fs";
import path from "path";

import { Evidence } from "../knowledge/Evidence.js";
import { Experiments } from "../research/Experiments.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { LessonMemory } from "./LessonMemory.js";

export type GraderKind = "code" | "contains" | "plan";

export interface Challenge {
  id: string;
  category: "coding" | "diagnosis" | "reading" | "planning" | "procedure" | "regression";
  title: string;
  prompt: string;
  grader:
    | { kind: "code"; /** JavaScript that throws if it fails; the answer's function is in scope. */ tests: string; name: string }
    | { kind: "contains"; must: string[]; mustNot?: string[] }
    | { kind: "plan"; mustCover: string[] };
  /** Added by the owner, or from a defect that was fixed. */
  custom?: boolean;
}

const code = (id: string, title: string, name: string, spec: string, tests: string): Challenge => ({
  id,
  category: "coding",
  title,
  prompt: `Write a JavaScript function named ${name}. ${spec}\nAnswer with the code only, no imports.`,
  grader: { kind: "code", name, tests }
});

/** The standard challenges: fixed, so runs compare over time. */
export const STANDARD: Challenge[] = [
  code("code-dedupe", "Keep the order while removing duplicates", "dedupe", "dedupe(list) returns the list without repeated values, keeping each value's first position.", `eq(dedupe([3,1,3,2,1]),[3,1,2]); eq(dedupe([]),[]); eq(dedupe(["a","a"]),["a"]);`),
  code("code-intervals", "Merge overlapping intervals", "merge", "merge(ranges) takes [start,end] pairs in any order and returns them merged where they overlap or touch, sorted by start.", `eq(merge([[5,8],[1,3],[2,4]]),[[1,4],[5,8]]); eq(merge([[1,2],[2,3]]),[[1,3]]); eq(merge([]),[]); eq(merge([[1,10],[2,3]]),[[1,10]]);`),
  code("code-parse", "Parse a duration", "seconds", 'seconds(text) turns "1h 20m 5s" style text into seconds. Any of the parts may be missing; unknown text gives null.', `eq(seconds("1h 20m 5s"),4805); eq(seconds("45s"),45); eq(seconds("2h"),7200); eq(seconds("soon"),null);`),
  code("code-grid", "Shortest path on a grid", "shortest", 'shortest(rows) takes strings where "." is open, "#" is a wall, "S" the start and "E" the end; it returns the fewest 4-direction moves from S to E, or -1.', `eq(shortest(["S.E"]),2); eq(shortest(["S#E"]),-1); eq(shortest(["S..","##.","E.."]),6);`),
  code("code-state", "Immutable reducer", "reducer", 'reducer(state, action) for a cart: state is {items:[{id,qty}]}; "add" adds 1 to an id (new or existing), "remove" takes 1 off and drops it at 0. It must not change the state it was given.', `const start={items:[{id:"a",qty:1}]}; const frozen=JSON.stringify(start); const added=reducer(start,{type:"add",id:"a"}); eq(added.items,[{id:"a",qty:2}]); eq(JSON.stringify(start),frozen); eq(reducer(start,{type:"remove",id:"a"}).items,[]); eq(reducer({items:[]},{type:"add",id:"b"}).items,[{id:"b",qty:1}]);`),
  {
    id: "diag-module",
    category: "diagnosis",
    title: "An ES module error",
    prompt: `A Node project fails with:\nError [ERR_REQUIRE_ESM]: require() of ES Module /app/node_modules/chalk/source/index.js from /app/server.js not supported.\nIn one or two sentences: what is the cause and the fix?`,
    grader: { kind: "contains", must: ["esm|es module|import", "import\\b|\"type\"|dynamic import|chalk@4|version 4|downgrade"] }
  },
  {
    id: "diag-race",
    category: "diagnosis",
    title: "A stale closure",
    prompt: `In React: useEffect(() => { const id = setInterval(() => setCount(count + 1), 1000); return () => clearInterval(id); }, []); The counter goes to 1 and stops. In one or two sentences: why, and how to fix it?`,
    grader: { kind: "contains", must: ["stale|closure|captur|initial value", "setCount\\(\\s*\\(?\\w+\\)?\\s*=>|functional update|updater|dependency|dependencies"] }
  },
  {
    id: "read-grounded",
    category: "reading",
    title: "Answers from the passage, and only from it",
    prompt: `Passage: "The Lindqvist reactor reached 340 C during the 2019 trial and was shut down after 14 hours because of a coolant leak."\n1) What temperature did it reach? 2) Why was it shut down? 3) Who funded the trial? If the passage does not say, answer exactly "not stated".`,
    grader: { kind: "contains", must: ["340", "coolant", "not stated"], mustNot: ["funded by", "government funded"] }
  },
  {
    id: "plan-web",
    category: "planning",
    title: "Plans the whole of an app",
    prompt: `Plan the milestones to build a booking app for a hair salon: customers book a slot, the owner manages staff and sees the calendar, reminders go out by SMS. List the milestones, one a line.`,
    grader: { kind: "plan", mustCover: ["book|appointment|slot", "calendar|schedule", "staff|stylist", "sms|reminder|notif", "test|verify|check", "auth|login|account|owner"] }
  },
  {
    id: "proc-wsl",
    category: "procedure",
    title: "Knows how this PC works",
    prompt: `You are building on this Windows PC: QEMU runs inside WSL with no KVM. How do you boot an ISO at E:\\os\\x.iso in a VM from a Windows process, and how fast will it be? Two sentences.`,
    grader: { kind: "contains", must: ["wsl", "/mnt/e|mnt/e", "emulat|tcg|slow|no kvm|without kvm"] }
  }
];

export interface TrialResult {
  passed: boolean;
  detail: string;
  output: string;
  durationMs: number;
}

export interface ChallengeResult {
  id: string;
  category: Challenge["category"];
  title: string;
  trials: TrialResult[];
  passRate: number;
  knowledgeUsed: string[];
}

export interface EvaluationRun {
  id: string;
  label: string;
  /** Given what it has learned, or not. */
  withKnowledge: boolean;
  trials: number;
  model: string | null;
  state: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  finishedAt: string | null;
  results: ChallengeResult[];
  score: number | null;
  byCategory: Record<string, number>;
  error: string | null;
}

const FILE = () => path.resolve(process.env.EVALUATIONS_FILE ?? "data/agent/evaluations.json");
const CUSTOM_FILE = () => path.resolve(process.env.EVALUATION_CHALLENGES_FILE ?? "data/agent/evaluation-challenges.json");

const read = (): EvaluationRun[] => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as EvaluationRun[];
  } catch {
    return [];
  }
};
const write = (runs: EvaluationRun[]) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(runs.slice(-200), null, 2));
};
const save = (run: EvaluationRun) => write([...read().filter((r) => r.id !== run.id), run]);

const custom = (): Challenge[] => {
  try {
    return JSON.parse(fs.readFileSync(CUSTOM_FILE(), "utf8")) as Challenge[];
  } catch {
    return [];
  }
};

/** Runs the answer's code against the hidden tests, in the experiments' sandbox. */
const gradeCode = async (answer: string, grader: Extract<Challenge["grader"], { kind: "code" }>): Promise<{ passed: boolean; detail: string }> => {
  const source = answer
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*?```(?:javascript|js|ts|typescript)?\s*\n/i, "")
    .replace(/```[\s\S]*$/, "")
    .trim();
  const program = `${source}
function simulate() {
  const eq = (actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("got " + JSON.stringify(actual) + ", wanted " + JSON.stringify(expected));
  };
  try {
    ${grader.tests}
    return { score: 1 };
  } catch (error) {
    return { score: 0, failedAt: 0 };
  }
}`;
  try {
    const result = await Experiments.run({ code: program, variables: { run: [1] }, objective: "score" });
    return { passed: result.best.metrics.score === 1, detail: result.best.metrics.score === 1 ? "the hidden tests pass" : "a hidden test failed" };
  } catch (error) {
    return { passed: false, detail: `it did not run: ${(error as Error).message.slice(0, 200)}` };
  }
};

const grade = async (challenge: Challenge, answer: string): Promise<{ passed: boolean; detail: string }> => {
  const text = answer.replace(/<think>[\s\S]*?<\/think>/gi, "");
  if (challenge.grader.kind === "code") return gradeCode(text, challenge.grader);
  if (challenge.grader.kind === "contains") {
    const missing = challenge.grader.must.filter((pattern) => !new RegExp(pattern, "i").test(text));
    const wrong = (challenge.grader.mustNot ?? []).filter((pattern) => new RegExp(pattern, "i").test(text));
    return { passed: !missing.length && !wrong.length, detail: [missing.length ? `missing: ${missing.join("; ")}` : "", wrong.length ? `invented: ${wrong.join("; ")}` : ""].filter(Boolean).join(" · ") || "it says what it must" };
  }
  const missing = challenge.grader.mustCover.filter((pattern) => !new RegExp(pattern, "i").test(text));
  return { passed: !missing.length, detail: missing.length ? `the plan misses: ${missing.join("; ")}` : "the plan covers everything" };
};

/** What builds would be told about this challenge: relevant lessons and findings. */
const knowledgeFor = (challenge: Challenge): { text: string; used: string[] } => {
  const lessons = LessonMemory.relevant("build", `${challenge.title} ${challenge.prompt}`, 3);
  const findings = ResearchStore.relevantFindings(`${challenge.title} ${challenge.prompt}`, 3);
  const used = [...lessons.map((l) => `lesson:${l.id}`), ...findings.map((f) => `finding:${f.id}`)];
  const text = [...lessons.map((l) => `- ${l.lesson}`), ...findings.map((f) => `- ${f.claim}`)].join("\n");
  return { text: text ? `What was learned before (use it if relevant):\n${text}\n\n` : "", used };
};

const stopping = new Set<string>();
let running: string | null = null;

const execute = async (run: EvaluationRun, challenges: Challenge[]) => {
  try {
    for (const challenge of challenges) {
      if (stopping.has(run.id)) {
        run.state = "stopped";
        break;
      }
      const context = run.withKnowledge ? knowledgeFor(challenge) : { text: "", used: [] };
      const trials: TrialResult[] = [];
      for (let i = 0; i < run.trials; i++) {
        const started = Date.now();
        const answer = await ModelRouter.generate(`${context.text}${challenge.prompt}`);
        const graded = await grade(challenge, answer);
        trials.push({ passed: graded.passed, detail: graded.detail, output: answer.slice(0, 2000), durationMs: Date.now() - started });
      }
      run.results.push({ id: challenge.id, category: challenge.category, title: challenge.title, trials, passRate: trials.filter((t) => t.passed).length / trials.length, knowledgeUsed: context.used });
      save(run);
    }
    const categories = new Map<string, number[]>();
    for (const result of run.results) categories.set(result.category, [...(categories.get(result.category) ?? []), result.passRate]);
    const mean = (values: number[]) => Math.round((values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)) * 1000) / 1000;
    run.byCategory = Object.fromEntries([...categories].map(([category, rates]) => [category, mean(rates)]));
    run.score = run.results.length ? mean(run.results.map((r) => r.passRate)) : null;
    if (run.state === "running") run.state = "done";
  } catch (error) {
    run.state = "failed";
    run.error = (error as Error).message;
    Logger.warn("An evaluation run failed", { error: run.error });
  } finally {
    run.finishedAt = new Date().toISOString();
    save(run);
    stopping.delete(run.id);
    running = null;
    Evidence.record({ kind: "evaluation", ref: `evaluation:${run.id}`, task: "evaluations", agent: "evaluator", title: `${run.label}: ${run.score === null ? run.state : `${Math.round(run.score * 100)}%`}${run.withKnowledge ? " with knowledge" : " without knowledge"}`, outcome: run.state, data: { score: run.score, byCategory: run.byCategory, failed: run.results.filter((r) => r.passRate < 1).map((r) => r.id) } });
  }
};

export const Evaluations = {
  challenges: (): Challenge[] => [...STANDARD, ...custom()],

  list: (): EvaluationRun[] => read().reverse(),

  get: (id: string): EvaluationRun | null => read().find((r) => r.id === id) ?? null,

  isRunning: () => running,

  /** Start a run in the background. One at a time. */
  start(options: { label?: string; withKnowledge?: boolean; trials?: number; only?: string[]; await?: boolean } = {}): EvaluationRun & { done?: Promise<void> } {
    if (running) throw new Error("An evaluation is already running.");
    const all = Evaluations.challenges();
    const chosen = options.only?.length ? all.filter((c) => options.only!.includes(c.id)) : all;
    if (!chosen.length) throw new Error("No such challenges.");
    const run: EvaluationRun = {
      id: `eval_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      label: (options.label ?? "Manual run").slice(0, 80),
      withKnowledge: options.withKnowledge !== false,
      trials: Math.min(5, Math.max(1, Math.round(options.trials ?? 1))),
      model: process.env.LMSTUDIO_MODEL ?? process.env.MODEL_NAME ?? null,
      state: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      results: [],
      score: null,
      byCategory: {},
      error: null
    };
    save(run);
    running = run.id;
    const done = execute(run, chosen);
    return { ...run, done };
  },

  stop(id: string): void {
    stopping.add(id);
  },

  /** Two runs side by side: only what was measured. */
  compare(aId: string, bId: string) {
    const a = Evaluations.get(aId);
    const b = Evaluations.get(bId);
    if (!a || !b) throw new Error("No such run.");
    const ids = [...new Set([...a.results.map((r) => r.id), ...b.results.map((r) => r.id)])];
    const rows = ids.map((id) => {
      const left = a.results.find((r) => r.id === id) ?? null;
      const right = b.results.find((r) => r.id === id) ?? null;
      return {
        id,
        title: left?.title ?? right?.title ?? id,
        category: left?.category ?? right?.category ?? "",
        a: left?.passRate ?? null,
        b: right?.passRate ?? null,
        difference: left && right ? Math.round((right.passRate - left.passRate) * 1000) / 1000 : null,
        knowledgeUsed: right?.knowledgeUsed ?? []
      };
    });
    const shared = rows.filter((r) => r.difference !== null);
    const meanOf = (key: "a" | "b") => (shared.length ? Math.round((shared.reduce((sum, r) => sum + (r[key] ?? 0), 0) / shared.length) * 1000) / 1000 : null);
    return {
      a: { id: a.id, label: a.label, at: a.startedAt, withKnowledge: a.withKnowledge, trials: a.trials, score: meanOf("a") },
      b: { id: b.id, label: b.label, at: b.startedAt, withKnowledge: b.withKnowledge, trials: b.trials, score: meanOf("b") },
      difference: shared.length ? Math.round(((meanOf("b") ?? 0) - (meanOf("a") ?? 0)) * 1000) / 1000 : null,
      coverage: `${shared.length} challenges in both of ${ids.length}`,
      rows,
      improved: shared.filter((r) => (r.difference ?? 0) > 0).map((r) => r.id),
      regressions: shared.filter((r) => (r.difference ?? 0) < 0).map((r) => r.id),
      /** With one trial a single different answer moves a score: read small differences with care. */
      note: Math.min(a.trials, b.trials) < 3 ? "Fewer than 3 trials per challenge: the model varies, so a small difference may be chance." : null
    };
  },

  /** A challenge of your own, or a defect once fixed: it stays in every later run. */
  addChallenge(input: { id?: string; title: string; prompt: string; category?: Challenge["category"]; must?: string[]; mustNot?: string[]; tests?: string; name?: string }): Challenge {
    const title = String(input.title ?? "").trim().slice(0, 120);
    const prompt = String(input.prompt ?? "").trim().slice(0, 4000);
    if (!title || !prompt) throw new Error("Give the challenge a title and a prompt.");
    if (!input.tests && !input.must?.length) throw new Error("Say how it is graded: tests (code), or what the answer must say.");
    const id = (input.id ?? title).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
    if (STANDARD.some((c) => c.id === id)) throw new Error("That name is taken by a standard challenge.");
    const challenge: Challenge = {
      id,
      title,
      prompt,
      category: input.category ?? "regression",
      custom: true,
      grader: input.tests ? { kind: "code", name: String(input.name ?? "solution"), tests: input.tests.slice(0, 4000) } : { kind: "contains", must: input.must!.slice(0, 10), mustNot: input.mustNot?.slice(0, 10) }
    };
    fs.mkdirSync(path.dirname(CUSTOM_FILE()), { recursive: true });
    fs.writeFileSync(CUSTOM_FILE(), JSON.stringify([...custom().filter((c) => c.id !== id), challenge], null, 2));
    return challenge;
  },

  testHooks: { grade, knowledgeFor }
};
