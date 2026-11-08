/**
 * Investigation — research that takes an objective all the way to findings.
 *
 * "Research how to make the best-tasting coffee" becomes:
 *   plan        the domain, the scope, what success means, the knowledge areas
 *               (each a specialist with its own objective, questions and evidence
 *               needs), the measurable variables and the hypotheses. It is written
 *               for this subject, not from a template.
 *   research    each specialist is a topic in the research engine: it searches
 *               reachable sources, reads them, keeps findings checked against the
 *               source text and ranked by source credibility. They run side by side
 *               and survive restarts.
 *   experiment  what can be computed is computed: a model written as code, evaluated
 *               by Experiments over every combination, with sensitivity and a
 *               reproducibility check. What cannot (taste, for one) is recorded as a
 *               physical experiment for a person to do, with its protocol.
 *   contradict  findings that disagree are named and kept apart, never averaged.
 *   synthesise  recommendations that cite findings by number; a citation of nothing
 *               is removed and flagged. Material open questions go back to the
 *               specialists for another round.
 *   answer      every research question and hypothesis gets an answer that cites
 *               findings; how strongly it is supported is counted from what those
 *               findings are (peer-reviewed counts most), not asked of the model.
 *               What is not answered goes back to the specialists, up to three rounds.
 *   learn       well-supported conclusions become knowledge (lessons, candidates until
 *               they prove useful), and everything is in the evidence ledger.
 *
 * With too little evidence it does not write conclusions: a specialist that finds
 * little re-plans its searches first, and if the evidence is still thin the report
 * says so and lists what could not be found. Experiments whose numbers cite no
 * finding are refused, because their numbers would be invented.
 *
 * The report's factual parts (sources, evidence matrix, experiment numbers) are
 * generated from the records, not written by a model. Nothing here has tasted
 * anything or touched the world: the report says what was only computed or read.
 * State is in data/research/investigations.json; a tick moves each one along.
 */
import fs from "fs";
import path from "path";

import { Evidence } from "../knowledge/Evidence.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";
import { Experiments, type Experiment } from "./Experiments.js";
import { ResearchEngine } from "./ResearchEngine.js";
import { ResearchStore, type ResearchFinding, type ResearchSource } from "./ResearchStore.js";
import { keywordQuery } from "./SourceProviders.js";
import { TIER_LABEL, classifySource } from "./SourceCredibility.js";

export type InvestigationState = "planning" | "researching" | "experimenting" | "synthesising" | "done" | "failed" | "stopped";

export interface Specialist {
  id: string;
  name: string;
  objective: string;
  questions: string[];
  evidenceNeeded: string;
  dependsOn: string[];
  topicId: string | null;
  status: "waiting" | "researching" | "done";
  doneWhy: string | null;
  /** How often its searches were re-planned because they found too little. */
  replans?: number;
  /** When it last started or re-planned: its time limit counts from here. */
  since?: string;
}

/** A research question or hypothesis, answered from the evidence. */
export interface Answer {
  question: string;
  kind: "question" | "hypothesis";
  answer: string;
  supporting: number[];
  refuting: number[];
  /** Counted from the cited findings' kinds, never the model's say. */
  verdict: "answered" | "supported" | "refuted" | "contested" | "not answered";
  confidence: "high" | "medium" | "low" | "none";
  strength: { supporting: number; refuting: number; peerReviewed: number };
}

export interface Contradiction {
  about: string;
  sideA: { claim: string; findings: number[] };
  sideB: { claim: string; findings: number[] };
  assessment: string;
}

export interface Recommendation {
  title: string;
  detail: string;
  confidence: "high" | "medium" | "low";
  findings: number[];
  experiments: string[];
  /** Citations of findings that do not exist were removed. */
  uncited: boolean;
}

export interface InvestigationReport {
  executiveSummary: string;
  scope: string;
  methodology: string;
  recommendations: Recommendation[];
  procedure: string[];
  confidenceNotes: string;
  limitations: string[];
  unresolved: string[];
  physicalTestsNeeded: string[];
  writtenAt: string;
}

export interface Investigation {
  id: string;
  objective: string;
  state: InvestigationState;
  phase: string;
  round: number;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  startedBy: string;
  error: string | null;
  plan: {
    domain: string;
    scope: string;
    success: string;
    variables: Array<{ name: string; unit: string; range: string; why: string }>;
    hypotheses: string[];
  } | null;
  specialists: Specialist[];
  experiments: Experiment[];
  contradictions: Contradiction[];
  report: InvestigationReport | null;
  answers?: Answer[];
  /** Set when the evidence was too thin to conclude anything. */
  insufficient?: boolean;
  knowledge: number[];
  feedback: Array<{ at: string; by: string; text: string; kind: string; followUp: string | null }>;
}

const FILE = () => path.resolve(process.env.INVESTIGATIONS_FILE ?? "data/research/investigations.json");
const MIN_FINDINGS = Number(process.env.INVESTIGATION_MIN_FINDINGS) || 12;
const MAX_AREA_MS = Number(process.env.INVESTIGATION_MAX_AREA_MS) || 8 * 3_600_000;
const MAX_ROUNDS = Number(process.env.INVESTIGATION_ROUNDS) || 3;
/** A specialist with fewer findings than this re-plans its searches before it gives up. */
const MIN_EVIDENCE = Number(process.env.INVESTIGATION_MIN_EVIDENCE) || 3;
const MAX_REPLANS = 2;
/** Fewer findings than this in all, and nothing is concluded. */
const MIN_TOTAL_EVIDENCE = Number(process.env.INVESTIGATION_MIN_TOTAL) || 6;
/** Experiments need at least this much evidence to ground their numbers in. */
const MIN_EXPERIMENT_EVIDENCE = Number(process.env.INVESTIGATION_MIN_EXPERIMENT_EVIDENCE) || 10;
const MAX_SPECIALISTS = 10;
const TICK_MS = Number(process.env.INVESTIGATION_TICK_MS) || 60_000;

const read = (): Investigation[] => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as Investigation[];
  } catch {
    return [];
  }
};
const write = (all: Investigation[]) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  const temp = `${FILE()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(all, null, 2));
  fs.renameSync(temp, FILE());
};
const get = (id: string) => read().find((i) => i.id === id) ?? null;
const patch = (id: string, changes: Partial<Investigation>) => {
  const all = read();
  const item = all.find((i) => i.id === id);
  if (!item) return null;
  Object.assign(item, changes, { updatedAt: new Date().toISOString() });
  write(all);
  return item;
};

const extractJson = (text: string): Record<string, unknown> | null => {
  const clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
};
const list = (value: unknown): string[] => (Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : []);
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ─── the stages ─── */

const makePlan = async (item: Investigation) => {
  patch(item.id, { phase: "Understanding the objective and planning the investigation" });
  const answer = await ModelRouter.generate(`You lead a research investigation. The objective, in the owner's words:
${item.objective}

Plan it for THIS subject (a culinary question, an engineering question and a medical question need different specialists):
identify the domain, the scope, what a successful investigation must establish, and split it into 4-${MAX_SPECIALISTS} specialist knowledge areas
that together cover every aspect, each with its own objective, 3-6 specific research questions, and the evidence it needs
(primary sources, datasets, standards, papers, experts). List the measurable variables that decide the outcome and the
hypotheses worth testing. Do not answer the objective here; only plan how to find out.

Answer with JSON only:
{"domain":"...","scope":"...","success":"...",
 "specialists":[{"id":"short-id","name":"...","objective":"...","questions":["..."],"evidenceNeeded":"...","dependsOn":["other-id"]}],
 "variables":[{"name":"...","unit":"...","range":"...","why":"..."}],
 "hypotheses":["..."]}`);
  const parsed = extractJson(answer);
  const specialists = (Array.isArray(parsed?.specialists) ? parsed!.specialists : [])
    .map((s) => (s && typeof s === "object" ? (s as Record<string, unknown>) : {}))
    .map((s, i): Specialist => ({
      id: String(s.id ?? `area-${i + 1}`).replace(/[^\w-]+/g, "-").slice(0, 40) || `area-${i + 1}`,
      name: String(s.name ?? "").trim().slice(0, 100),
      objective: String(s.objective ?? "").trim().slice(0, 600),
      questions: list(s.questions).slice(0, 8),
      evidenceNeeded: String(s.evidenceNeeded ?? "").slice(0, 400),
      dependsOn: list(s.dependsOn).slice(0, 5),
      topicId: null,
      status: "waiting",
      doneWhy: null
    }))
    .filter((s) => s.name && s.questions.length)
    .slice(0, MAX_SPECIALISTS);
  if (specialists.length < 2) throw new Error("The model did not write a usable plan of the investigation.");
  const variables = (Array.isArray(parsed!.variables) ? parsed!.variables : [])
    .map((v) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {}))
    .map((v) => ({ name: String(v.name ?? "").slice(0, 80), unit: String(v.unit ?? "").slice(0, 30), range: String(v.range ?? "").slice(0, 80), why: String(v.why ?? "").slice(0, 300) }))
    .filter((v) => v.name)
    .slice(0, 20);
  patch(item.id, {
    state: "researching",
    phase: `Researching: ${specialists.length} specialists`,
    plan: {
      domain: String(parsed!.domain ?? "").slice(0, 100),
      scope: String(parsed!.scope ?? "").slice(0, 800),
      success: String(parsed!.success ?? "").slice(0, 800),
      variables,
      hypotheses: list(parsed!.hypotheses).slice(0, 12)
    },
    specialists
  });
  Evidence.record({ kind: "research", ref: `investigation:${item.id}`, task: `investigation:${item.id}`, agent: "research-lead", title: `Planned: ${item.objective.slice(0, 120)}`, outcome: "planned", data: { specialists: specialists.map((s) => s.name) } });
};

const startSpecialists = (item: Investigation) => {
  const engine = ResearchEngine.getInstance();
  const specialists = item.specialists.map((s) => ({ ...s }));
  let changed = false;
  for (const specialist of specialists) {
    if (specialist.status !== "waiting") continue;
    // Dependencies first: what it builds on is researched before it.
    const waiting = specialist.dependsOn.some((id) => specialists.find((o) => o.id === id && o.status !== "done"));
    if (waiting && specialists.some((o) => o.status === "researching")) continue;
    // The title is what pages are checked against: the subject's words, not "Specialist" or "Research how to".
    const subject = specialist.name.replace(/\b(specialists?|experts?|analysts?|research(ers?)?|investigat\w*)\b/gi, "").replace(/\s+/g, " ").trim() || specialist.name;
    const topic = engine.start(`${subject}: ${keywordQuery(item.objective) || item.objective.slice(0, 60)}`.slice(0, 120), specialist.objective);
    for (const question of specialist.questions) ResearchStore.addPriorityQuestion(topic.id, question, 0);
    specialist.topicId = topic.id;
    specialist.status = "researching";
    specialist.since = new Date().toISOString();
    changed = true;
    Evidence.link(`investigation:${item.id}`, `topic:${topic.id}`, "delegated-to");
  }
  if (changed) patch(item.id, { specialists });
  return specialists;
};

const checkSpecialists = (item: Investigation) => {
  const engine = ResearchEngine.getInstance();
  const specialists = startSpecialists(item);
  // Specialists at work go first in the research queue; done ones go back to the normal pace.
  for (const s of specialists) if (s.topicId) engine.prioritise(s.topicId, s.status === "researching");
  let changed = false;
  for (const specialist of specialists) {
    if (specialist.status !== "researching" || !specialist.topicId) continue;
    const summary = ResearchStore.getTopicSummary(specialist.topicId);
    if (!summary) continue;
    const target = MIN_FINDINGS * item.round;
    const elapsed = Date.now() - Date.parse(specialist.since ?? summary.createdAt);
    const why =
      summary.findingCount >= target
        ? `${summary.findingCount} findings from ${summary.sourceCount} sources`
        : summary.consecutiveEmptyCycles >= 3 && summary.cycles >= 3
          ? `stopped yielding: ${summary.findingCount} findings from ${summary.sourceCount} sources`
          : elapsed > MAX_AREA_MS * item.round
            ? `reached its time limit with ${summary.findingCount} findings`
            : null;
    if (why && summary.findingCount < MIN_EVIDENCE && (specialist.replans ?? 0) < MAX_REPLANS) {
      // Too little to go on: search differently before giving up.
      replanning.add(`${item.id}:${specialist.id}`);
      specialist.replans = (specialist.replans ?? 0) + 1;
      specialist.since = new Date().toISOString();
      changed = true;
      void replan(item, specialist).finally(() => replanning.delete(`${item.id}:${specialist.id}`));
      continue;
    }
    if (why) {
      specialist.status = "done";
      specialist.doneWhy = summary.findingCount < MIN_EVIDENCE ? `${why}; searched ${1 + (specialist.replans ?? 0)} ways` : why;
      engine.pause(specialist.topicId);
      changed = true;
    }
  }
  if (changed) patch(item.id, { specialists });
  const done = specialists.filter((s) => s.status === "done").length;
  patch(item.id, { phase: `Researching: ${done} of ${specialists.length} specialists done` });
  if (done === specialists.length) patch(item.id, { state: "experimenting", phase: "Designing experiments" });
};

const replanning = new Set<string>();

/** New ways to search for what a specialist could not find: other words, the terms papers use, narrower questions. */
const replan = async (item: Investigation, specialist: Specialist) => {
  if (!specialist.topicId) return;
  const tried = ResearchStore.listQuestions(specialist.topicId, 30).map((q) => q.text);
  const answer = await ModelRouter.generate(`A researcher looking into "${specialist.objective}" (part of: ${item.objective}) has found almost nothing with these searches:
${tried.map((q) => `- ${q}`).join("\n")}

Write 6 different searches likely to find real evidence: use the terms scientists and specialists actually use in papers and reference works, name the specific things involved, and ask narrower questions. Each one short, like a search query.

Answer with JSON only: {"searches": ["..."]}`).catch(() => "");
  const searches = list(extractJson(answer)?.searches).slice(0, 8);
  for (const search of searches) ResearchStore.addPriorityQuestion(specialist.topicId, search, 0);
  ResearchEngine.getInstance().resume(specialist.topicId);
  ResearchEngine.getInstance().runNow(specialist.topicId);
  Evidence.record({ kind: "research", ref: `topic:${specialist.topicId}`, task: `investigation:${item.id}`, agent: "research-lead", title: `${specialist.name}: found too little, searching ${searches.length} new ways`, outcome: "re-planned", data: { searches } });
};

const findingsOf = (item: Investigation, limitEach = 30): Array<ResearchFinding & { area: string }> =>
  item.specialists.flatMap((s) => (s.topicId ? ResearchStore.listFindings(s.topicId, limitEach, "strongest").map((f) => ({ ...f, area: s.name })) : []));

const evidenceText = (item: Investigation, chars = 16_000) =>
  findingsOf(item)
    .map((f) => `[F${f.id}] (${f.area}; confidence ${Math.round(f.confidence * 100)}%, ${classifySource(f.sourceUrl, f.sourceTitle).tier}) ${f.claim}`)
    .join("\n")
    .slice(0, chars);

const runExperiment = async (item: Investigation, experiment: Experiment): Promise<Experiment> => {
  if (experiment.kind === "physical" || !experiment.code) return { ...experiment, state: "needs-physical-test" };
  let code = experiment.code;
  let lastError: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await Experiments.run({ code, variables: experiment.variables, baseline: experiment.baseline, objective: experiment.objective, direction: experiment.direction });
      Evidence.record({
        kind: "experiment",
        ref: `experiment:${experiment.id}`,
        task: `investigation:${item.id}`,
        agent: "research-lead",
        title: experiment.title,
        outcome: result.repeatable ? "ran, repeatable" : "ran, not repeatable",
        data: { hypothesis: experiment.hypothesis, best: result.best, evaluated: result.evaluated, sensitivity: result.sensitivity.slice(0, 5), assumptions: experiment.assumptions },
        links: [{ to: `investigation:${item.id}`, relation: "part-of" }]
      });
      return { ...experiment, code, state: "done", result, error: null, runAt: new Date().toISOString() };
    } catch (error) {
      lastError = (error as Error).message;
      if (attempt === 2) break;
      // Let the model fix what the run says is wrong.
      const fixed = await ModelRouter.generate(`This simulation failed when run: ${lastError}

Fix it. It must define function simulate(params) returning an object of finite numbers including "${experiment.objective}". params has: ${Object.keys(experiment.variables).join(", ")}. No imports or I/O. Answer with the JavaScript only.

${code}`);
      code = fixed.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?```(?:js|javascript)?\s*\n/, "").replace(/```[\s\S]*$/, "").trim() || code;
    }
  }
  return { ...experiment, code, state: "failed", error: lastError };
};

const designExperiments = async (item: Investigation) => {
  // Numbers need evidence to come from; without it a simulation only dresses up a guess.
  if (findingsOf(item).length < MIN_EXPERIMENT_EVIDENCE) {
    patch(item.id, { phase: "Too little evidence to ground experiments in: skipping them" });
    return;
  }
  const answer = await ModelRouter.generate(`The investigation: ${item.objective}
Hypotheses: ${(item.plan?.hypotheses ?? []).join("; ")}
Measurable variables: ${(item.plan?.variables ?? []).map((v) => `${v.name} (${v.unit}, ${v.range})`).join("; ")}

What the specialists found (cite as [F123]):
${evidenceText(item)}

Design 2-5 experiments. For each decide honestly:
- "simulation" or "analysis": it can be computed from a model grounded in the findings. Write JavaScript with function simulate(params) returning an object of numbers (no imports, no I/O; Math is available). Use constants from the findings and name where each comes from in "assumptions". Give "variables" as {name: [values to try]} (at most 6 values each, 4 variables), a "baseline" (the usual way), the "objective" metric and "direction" (max or min).
- "physical": it needs the real world (taste, a human judge, a lab measurement). Give no code; give "physicalProtocol": exactly what a person should do and record.

Never claim a simulation measures what only the real world can (a simulation of extraction is not a taste test).

Answer with JSON only:
{"experiments":[{"title":"...","hypothesis":"...","question":"...","kind":"simulation|analysis|physical","method":"...","assumptions":["..."],"expected":"...","criteria":"how the result is judged","variables":{},"baseline":{},"objective":"...","direction":"max","code":"...","physicalProtocol":"..."}]}`);
  const parsed = extractJson(answer);
  const experiments = (Array.isArray(parsed?.experiments) ? parsed!.experiments : [])
    .map((e) => (e && typeof e === "object" ? (e as Record<string, unknown>) : {}))
    .map((e): Experiment => {
      const kind = e.kind === "physical" ? "physical" : e.kind === "analysis" ? "analysis" : "simulation";
      const variables = e.variables && typeof e.variables === "object" ? (e.variables as Record<string, unknown[]>) : {};
      return {
        id: newId("exp"),
        title: String(e.title ?? "").slice(0, 160),
        hypothesis: String(e.hypothesis ?? "").slice(0, 500),
        question: String(e.question ?? "").slice(0, 500),
        kind,
        variables: Object.fromEntries(Object.entries(variables).filter(([, v]) => Array.isArray(v) && v.length).slice(0, 5).map(([k, v]) => [k, v.slice(0, 8)])),
        baseline: e.baseline && typeof e.baseline === "object" ? (e.baseline as Record<string, unknown>) : {},
        objective: String(e.objective ?? "score").slice(0, 60),
        direction: e.direction === "min" ? "min" : "max",
        method: String(e.method ?? "").slice(0, 800),
        assumptions: list(e.assumptions).slice(0, 15),
        expected: String(e.expected ?? "").slice(0, 500),
        criteria: String(e.criteria ?? "").slice(0, 500),
        code: kind === "physical" ? null : String(e.code ?? "") || null,
        state: "planned",
        result: null,
        error: null,
        supported: null,
        conclusion: null,
        physicalProtocol: e.physicalProtocol ? String(e.physicalProtocol).slice(0, 1500) : null,
        runAt: null
      };
    })
    .filter((e) => e.title)
    // A computed experiment must take its numbers from findings: one that cites none is refused, not run.
    .map((e) => {
      if (e.kind === "physical") return e;
      const known = new Set(findingsOf(item).map((f) => f.id));
      const cites = [...e.assumptions.join(" ").matchAll(/F(\d+)/g)].map((m) => Number(m[1])).filter((n) => known.has(n));
      return cites.length ? e : { ...e, state: "failed" as const, error: "Not run: none of its assumptions cites a finding, so its numbers would be invented." };
    })
    .slice(0, 6);
  patch(item.id, { experiments: [...item.experiments, ...experiments], phase: `Running ${experiments.filter((e) => e.kind !== "physical").length} experiments` });
};

const conclude = async (item: Investigation, experiment: Experiment): Promise<Experiment> => {
  if (!experiment.result) return experiment;
  const r = experiment.result;
  const answer = await ModelRouter.generate(`An experiment ran. Judge only from these numbers; they come from a computed model, not the real world.
Hypothesis: ${experiment.hypothesis}
Judged by: ${experiment.criteria}
Evaluated ${r.evaluated} combinations, objective ${r.objective} (${r.direction}).
Best: ${JSON.stringify(r.best)}
Baseline: ${JSON.stringify(r.baseline)}
Sensitivity: ${JSON.stringify(r.sensitivity.slice(0, 5))}
Repeatable: ${r.repeatable}
Assumptions: ${experiment.assumptions.join("; ")}

Answer with JSON only: {"supported": true|false, "conclusion": "2-3 sentences, saying it is what the model computes under those assumptions"}`).catch(() => "");
  const parsed = extractJson(answer);
  return { ...experiment, supported: typeof parsed?.supported === "boolean" ? parsed.supported : null, conclusion: parsed?.conclusion ? String(parsed.conclusion).slice(0, 800) : null };
};

const findContradictions = async (item: Investigation): Promise<Contradiction[]> => {
  const known = new Set(findingsOf(item).map((f) => f.id));
  const answer = await ModelRouter.generate(`These findings come from different sources. Find the real contradictions: where two say incompatible things about the same point. Do not average them or pick a side silently; say which evidence is stronger and why, or that it is unsettled.

${evidenceText(item)}

Answer with JSON only: {"contradictions":[{"about":"...","sideA":{"claim":"...","findings":[123]},"sideB":{"claim":"...","findings":[456]},"assessment":"..."}]}`).catch(() => "");
  const parsed = extractJson(answer);
  const ids = (value: unknown): number[] => (Array.isArray(value) ? value.map(Number).filter((n) => known.has(n)) : []);
  return (Array.isArray(parsed?.contradictions) ? parsed!.contradictions : [])
    .map((c) => (c && typeof c === "object" ? (c as Record<string, Record<string, unknown>>) : {}))
    .map((c) => ({
      about: String(c.about ?? "").slice(0, 300),
      sideA: { claim: String(c.sideA?.claim ?? "").slice(0, 500), findings: ids(c.sideA?.findings) },
      sideB: { claim: String(c.sideB?.claim ?? "").slice(0, 500), findings: ids(c.sideB?.findings) },
      assessment: String(c.assessment ?? "").slice(0, 600)
    }))
    // A contradiction must point at real findings on both sides.
    .filter((c) => c.about && c.sideA.findings.length && c.sideB.findings.length)
    .slice(0, 15);
};

/** How much a finding counts, by what kind of source it comes from. */
const weightOf = (finding: ResearchFinding) => {
  const tier = classifySource(finding.sourceUrl, finding.sourceTitle).tier;
  return tier === "academic" ? 3 : tier === "reference" ? 2 : tier === "news" || tier === "community" ? 1 : 0;
};

/** Each research question and hypothesis, answered from the findings, with a verdict counted from what is cited. */
const answerQuestions = async (item: Investigation): Promise<Answer[]> => {
  const findings = findingsOf(item, 60);
  const byId = new Map(findings.map((f) => [f.id, f]));
  const asked = [
    ...item.specialists.flatMap((s) => s.questions.map((q) => ({ question: q, kind: "question" as const }))),
    ...(item.plan?.hypotheses ?? []).map((h) => ({ question: h, kind: "hypothesis" as const }))
  ].slice(0, 40);
  const answers: Answer[] = [];
  for (let start = 0; start < asked.length; start += 8) {
    const batch = asked.slice(start, start + 8);
    const reply = await ModelRouter.generate(`Answer each question, and judge each hypothesis, from these findings ONLY. Cite the finding numbers that support it and any that contradict it. If the findings do not answer it, say so and cite nothing: never answer from memory.

${evidenceText(item)}

${batch.map((q, i) => `${i + 1}. [${q.kind}] ${q.question}`).join("\n")}

Answer with JSON only: {"answers":[{"n":1,"answer":"2-4 sentences, or 'The findings do not answer this.'","supporting":[123],"refuting":[456]}]}`).catch(() => "");
    const parsed = extractJson(reply);
    const rows = Array.isArray(parsed?.answers) ? parsed!.answers : [];
    batch.forEach((asked, i) => {
      const row = (rows.find((r) => r && typeof r === "object" && Number((r as Record<string, unknown>).n) === i + 1) ?? {}) as Record<string, unknown>;
      const ids = (value: unknown) => (Array.isArray(value) ? [...new Set(value.map(Number))].filter((n) => byId.has(n)) : []);
      const supporting = ids(row.supporting);
      const refuting = ids(row.refuting).filter((n) => !supporting.includes(n));
      const sum = (list: number[]) => list.reduce((total, n) => total + weightOf(byId.get(n)!), 0);
      const strength = { supporting: sum(supporting), refuting: sum(refuting), peerReviewed: supporting.filter((n) => classifySource(byId.get(n)!.sourceUrl, byId.get(n)!.sourceTitle).tier === "academic").length };
      const verdict: Answer["verdict"] = !supporting.length
        ? refuting.length && asked.kind === "hypothesis" ? "refuted" : "not answered"
        : strength.refuting > strength.supporting
          ? asked.kind === "hypothesis" ? "refuted" : "contested"
          : strength.refuting > 0
            ? "contested"
            : asked.kind === "hypothesis" ? "supported" : "answered";
      const confidence: Answer["confidence"] = verdict === "not answered" ? "none" : strength.supporting >= 6 && strength.peerReviewed >= 2 && !refuting.length ? "high" : strength.supporting >= 3 ? "medium" : "low";
      answers.push({ question: asked.question, kind: asked.kind, answer: String(row.answer ?? "The findings do not answer this.").slice(0, 1500), supporting, refuting, verdict, confidence, strength });
    });
  }
  return answers;
};

/** With too little evidence, the report says so and nothing is concluded or learned. */
const reportThinEvidence = (item: Investigation) => {
  const sources = item.specialists.reduce((n, s) => n + (s.topicId ? ResearchStore.getTopicSummary(s.topicId)?.sourceCount ?? 0 : 0), 0);
  const found = findingsOf(item).length;
  const report: InvestigationReport = {
    executiveSummary: `Not enough evidence was found to answer this: ${found} finding${found === 1 ? "" : "s"} from ${sources} sources read, after searching each part of it in several ways. Nothing is concluded from that little, and nothing was added to what the builder knows.`,
    scope: item.plan?.scope ?? "",
    methodology: `${item.specialists.length} specialists searched the reachable sources (the scholarly literature, reference works and the web) in up to ${MAX_ROUNDS} rounds, re-planning their searches when they found too little.`,
    recommendations: [],
    procedure: [],
    confidenceNotes: "No conclusions: the evidence threshold was not reached.",
    limitations: ["The sources reachable from here may not cover this subject.", "Try rewording the objective, or narrowing it to one part."],
    unresolved: item.specialists.flatMap((s) => s.questions).slice(0, 20),
    physicalTestsNeeded: [],
    writtenAt: new Date().toISOString()
  };
  patch(item.id, { report, insufficient: true, state: "done", phase: "Finished: not enough evidence to conclude anything", finishedAt: new Date().toISOString() });
  Evidence.record({ kind: "research", ref: `investigation:${item.id}`, task: `investigation:${item.id}`, agent: "research-lead", title: `Not enough evidence: ${item.objective.slice(0, 120)}`, outcome: "insufficient", data: { findings: found, sources } });
};

const synthesise = async (id: string) => {
  let item = get(id)!;
  if (findingsOf(item).length < MIN_TOTAL_EVIDENCE) {
    // One more round when there is one to have; otherwise say plainly that it could not be answered.
    if (item.round < MAX_ROUNDS) {
      const specialists = item.specialists.map((s) => ({ ...s, status: "researching" as const, doneWhy: null, replans: 0, since: new Date().toISOString() }));
      for (const s of specialists) if (s.topicId) ResearchEngine.getInstance().resume(s.topicId);
      patch(id, { specialists, round: item.round + 1, state: "researching", phase: `Round ${item.round + 1}: too little evidence so far, searching again` });
      return;
    }
    reportThinEvidence(item);
    return;
  }
  patch(id, { phase: "Answering each question from the evidence" });
  const answers = await answerQuestions(item);
  patch(id, { answers });
  item = get(id)!;
  patch(id, { phase: "Looking for contradictions" });
  const contradictions = await findContradictions(item);
  patch(id, { contradictions, phase: "Writing the findings" });
  item = get(id)!;
  const known = new Set(findingsOf(item).map((f) => f.id));
  const experimentLines = item.experiments
    .map((e) => (e.result ? `- ${e.title} [${e.id}]: best ${JSON.stringify(e.result.best.params)} → ${r3(e.result.best.metrics[e.result.objective])} ${e.result.objective}; most sensitive to ${e.result.sensitivity[0]?.variable}; ${e.conclusion ?? ""}` : `- ${e.title} [${e.id}]: ${e.state}${e.physicalProtocol ? ` — needs a person: ${e.physicalProtocol}` : ""}`))
    .join("\n");
  const answer = await ModelRouter.generate(`Write the conclusions of this investigation from the evidence below ONLY. Do not add facts from memory. Cite findings as numbers in "findings" and experiments by id in "experiments". Distinguish fact, interpretation and assumption in your wording. Never claim anything was tasted, built or physically tested: experiments here were computed.

Objective: ${item.objective}
Success means: ${item.plan?.success}

What the evidence answers (each answer cites its findings; build on these):
${(item.answers ?? []).filter((a) => a.verdict !== "not answered").map((a) => `- [${a.verdict}, ${a.confidence}] ${a.question}: ${a.answer} (F${a.supporting.join(", F")})`).join("\n") || "(nothing answered)"}

Findings:
${evidenceText(item)}

Experiments:
${experimentLines || "(none)"}

Contradictions: ${contradictions.map((c) => `${c.about}: ${c.assessment}`).join("; ") || "(none found)"}

Answer with JSON only:
{"executiveSummary":"...","scope":"...","methodology":"...",
 "recommendations":[{"title":"...","detail":"...","confidence":"high|medium|low","findings":[123],"experiments":["exp_id"]}],
 "procedure":["step by step, when the objective asks how to do something"],
 "confidenceNotes":"...","limitations":["..."],"unresolved":["material questions still open"],"physicalTestsNeeded":["..."]}`);
  const parsed = extractJson(answer);
  if (!parsed) throw new Error("The model did not write usable conclusions.");
  const experimentIds = new Set(item.experiments.map((e) => e.id));
  const recommendations: Recommendation[] = (Array.isArray(parsed.recommendations) ? parsed.recommendations : [])
    .map((r) => (r && typeof r === "object" ? (r as Record<string, unknown>) : {}))
    .map((r) => {
      const cited = Array.isArray(r.findings) ? r.findings.map(Number) : [];
      const findings = cited.filter((n) => known.has(n));
      return {
        title: String(r.title ?? "").slice(0, 200),
        detail: String(r.detail ?? "").slice(0, 1500),
        confidence: r.confidence === "high" || r.confidence === "low" ? r.confidence : ("medium" as Recommendation["confidence"]),
        findings,
        experiments: list(r.experiments).filter((e) => experimentIds.has(e)),
        uncited: findings.length === 0
      };
    })
    .filter((r) => r.title)
    // A recommendation with no evidence behind it is not a finding: it is left out.
    .filter((r) => !r.uncited)
    // A claim of high confidence needs evidence behind it.
    .map((r) => (r.findings.length < 2 && r.confidence === "high" ? { ...r, confidence: "medium" as const } : r))
    .slice(0, 30);
  // Still open: what the evidence did not answer, and what the model names as open.
  const unresolved = [...new Set([...(item.answers ?? []).filter((a) => a.verdict === "not answered").map((a) => a.question), ...list(parsed.unresolved)])].slice(0, 20);
  const report: InvestigationReport = {
    executiveSummary: String(parsed.executiveSummary ?? "").slice(0, 3000),
    scope: String(parsed.scope ?? item.plan?.scope ?? "").slice(0, 1500),
    methodology: String(parsed.methodology ?? "").slice(0, 2000),
    recommendations,
    procedure: list(parsed.procedure).slice(0, 30),
    confidenceNotes: String(parsed.confidenceNotes ?? "").slice(0, 1500),
    limitations: list(parsed.limitations).slice(0, 20),
    unresolved,
    physicalTestsNeeded: [...new Set([...list(parsed.physicalTestsNeeded), ...item.experiments.filter((e) => e.kind === "physical").map((e) => e.title)])].slice(0, 20),
    writtenAt: new Date().toISOString()
  };
  patch(id, { report });

  // Material questions go back to the specialists for another round.
  if (unresolved.length && item.round < MAX_ROUNDS) {
    const specialists = item.specialists.map((s) => ({ ...s }));
    unresolved.forEach((question, i) => {
      const specialist = specialists[i % specialists.length];
      if (specialist.topicId) ResearchStore.addPriorityQuestion(specialist.topicId, question, 0);
    });
    for (const specialist of specialists) {
      if (specialist.topicId) ResearchEngine.getInstance().resume(specialist.topicId);
      specialist.status = "researching";
      specialist.doneWhy = null;
    }
    patch(id, { specialists, round: item.round + 1, state: "researching", phase: `Round ${item.round + 1}: ${unresolved.length} open questions went back to the specialists` });
    return;
  }

  // What is well supported becomes knowledge, a candidate until later work proves it.
  const knowledge: number[] = [];
  for (const recommendation of recommendations.filter((r) => r.findings.length >= 2 && r.confidence !== "low").slice(0, 12)) {
    const { lesson } = LessonMemory.recordTaught("research", `investigation: ${item.objective.slice(0, 60)}: ${recommendation.title.slice(0, 80)}`, `${recommendation.title}: ${recommendation.detail}`.slice(0, 900), `From the investigation "${item.objective.slice(0, 100)}"; findings ${recommendation.findings.join(", ")}`);
    knowledge.push(lesson.id);
    Evidence.record({ kind: "knowledge", ref: `lesson:${lesson.id}`, task: `investigation:${id}`, agent: "research-lead", title: recommendation.title, outcome: "candidate", data: { confidence: recommendation.confidence, findings: recommendation.findings }, links: [{ to: `investigation:${id}`, relation: "learned-from" }] });
  }
  patch(id, { knowledge, state: "done", phase: "Finished", finishedAt: new Date().toISOString() });
  Evidence.record({ kind: "research", ref: `investigation:${id}`, task: `investigation:${id}`, agent: "research-lead", title: `Finished: ${item.objective.slice(0, 120)}`, outcome: "done", data: { recommendations: recommendations.length, contradictions: contradictions.length, experiments: item.experiments.length } });
};

const r3 = (value: number | undefined) => (typeof value === "number" ? Math.round(value * 1000) / 1000 : value);

const working = new Set<string>();

const advance = async (id: string) => {
  if (working.has(id)) return;
  working.add(id);
  try {
    const item = get(id);
    if (!item) return;
    if (item.state === "planning") await makePlan(item);
    else if (item.state === "researching") checkSpecialists(item);
    else if (item.state === "experimenting") {
      const pending = item.experiments.filter((e) => e.state === "planned");
      if (!item.experiments.length || (item.round > 1 && !pending.length && !item.experiments.some((e) => e.runAt && e.runAt > (item.report?.writtenAt ?? "")))) {
        if (!item.experiments.length) await designExperiments(item);
      }
      const fresh = get(id)!;
      const experiments = [...fresh.experiments];
      for (let i = 0; i < experiments.length; i++) {
        if (experiments[i].state !== "planned") continue;
        patch(id, { phase: `Running: ${experiments[i].title}` });
        experiments[i] = await conclude(fresh, await runExperiment(fresh, experiments[i]));
        patch(id, { experiments });
      }
      patch(id, { state: "synthesising", phase: "Bringing it together" });
    } else if (item.state === "synthesising") await synthesise(id);
  } catch (error) {
    const message = (error as Error).message;
    Logger.warn("An investigation step failed", { id, error: message });
    const item = get(id);
    // A model that does not answer is retried on the next tick; a repeated failure stops and says why.
    if (item) {
      const failures = (failuresOf.get(id) ?? 0) + 1;
      failuresOf.set(id, failures);
      if (failures >= 5) patch(id, { state: "failed", error: message, phase: "Failed", finishedAt: new Date().toISOString() });
      else patch(id, { error: message, phase: `${item.phase} (trying again: ${message.slice(0, 120)})` });
    }
    return;
  } finally {
    working.delete(id);
  }
  failuresOf.delete(id);
};
const failuresOf = new Map<string, number>();

let ticking = false;

export const Investigations = {
  list(): Investigation[] {
    return read().reverse();
  },

  get,

  start(objective: string, startedBy = "owner"): Investigation {
    const text = objective.trim().slice(0, 2000);
    if (text.length < 8) throw new Error("Say what to investigate.");
    const now = new Date().toISOString();
    const item: Investigation = { id: newId("inv"), objective: text, state: "planning", phase: "Starting", round: 1, createdAt: now, updatedAt: now, finishedAt: null, startedBy, error: null, plan: null, specialists: [], experiments: [], contradictions: [], report: null, knowledge: [], feedback: [] };
    write([...read(), item]);
    Investigations.ensureTicking();
    void advance(item.id);
    return item;
  },

  stop(id: string): Investigation | null {
    const item = get(id);
    if (!item) return null;
    for (const specialist of item.specialists) if (specialist.topicId) ResearchEngine.getInstance().pause(specialist.topicId);
    return patch(id, { state: "stopped", phase: "Stopped by you", finishedAt: new Date().toISOString() });
  },

  resume(id: string): Investigation | null {
    const item = get(id);
    if (!item) return null;
    if (item.state !== "stopped" && item.state !== "failed") throw new Error("It is not stopped.");
    for (const specialist of item.specialists) if (specialist.topicId && specialist.status === "researching") ResearchEngine.getInstance().resume(specialist.topicId);
    const next: InvestigationState = !item.plan ? "planning" : item.specialists.some((s) => s.status !== "done") ? "researching" : item.report ? "synthesising" : "experimenting";
    return patch(id, { state: next, phase: "Carrying on", error: null, finishedAt: null });
  },

  /** Your comment on it (a correction, a critique, what to look at again): kept, linked, and acted on where it can be. */
  feedback(id: string, input: { text: string; kind?: string; by?: string }): Investigation {
    const item = get(id);
    if (!item) throw new Error("Unknown investigation.");
    const text = input.text.trim().slice(0, 3000);
    if (!text) throw new Error("Write the feedback.");
    // It becomes a question the specialists must answer next.
    const target = item.specialists.find((s) => s.topicId);
    let followUp: string | null = null;
    if (target?.topicId) {
      ResearchStore.addPriorityQuestion(target.topicId, text, 0);
      followUp = `Added as a priority question for ${target.name}.`;
    }
    const entry = { at: new Date().toISOString(), by: input.by ?? "owner", text, kind: (input.kind ?? "comment").slice(0, 30), followUp };
    Evidence.record({ kind: "feedback", ref: `feedback:investigation:${id}:${item.feedback.length + 1}`, task: `investigation:${id}`, agent: entry.by, title: `${entry.kind}: ${text.slice(0, 120)}`, outcome: followUp ? "question added" : "recorded", data: entry, links: [{ to: `investigation:${id}`, relation: "feedback-on" }] });
    return patch(id, { feedback: [...item.feedback, entry] })!;
  },

  /** The full record: the report, plus the parts generated from the evidence itself. */
  full(id: string) {
    const item = get(id);
    if (!item) return null;
    const findings = findingsOf(item, 60);
    const sources = new Map<number, ResearchSource & { area: string; tierLabel: string }>();
    for (const specialist of item.specialists) {
      if (!specialist.topicId) continue;
      for (const source of ResearchStore.listSources(specialist.topicId, 80)) {
        const credibility = classifySource(source.url, source.title);
        sources.set(source.id, { ...source, area: specialist.name, tierLabel: TIER_LABEL[credibility.tier] });
      }
    }
    return {
      ...item,
      specialistsDetail: item.specialists.map((s) => ({
        ...s,
        summary: s.topicId ? ResearchStore.getTopicSummary(s.topicId) : null,
        findings: findings.filter((f) => f.topicId === s.topicId).slice(0, 30).map((f) => ({ id: f.id, claim: f.claim, confidence: f.confidence, status: f.status, supportCount: f.supportCount, sourceUrl: f.sourceUrl, sourceTitle: f.sourceTitle }))
      })),
      sourceRegister: [...sources.values()].map((s) => ({ id: s.id, url: s.url, title: s.title, area: s.area, credibility: s.tierLabel })),
      evidenceMatrix: (item.report?.recommendations ?? []).map((r) => ({ recommendation: r.title, confidence: r.confidence, findings: r.findings.map((n) => findings.find((f) => f.id === n)).filter(Boolean).map((f) => ({ id: f!.id, claim: f!.claim, source: f!.sourceTitle, url: f!.sourceUrl, status: f!.status })), experiments: r.experiments, uncited: r.uncited })),
      counts: { findings: findings.length, sources: sources.size, contradictions: item.contradictions.length, experimentsRun: item.experiments.filter((e) => e.state === "done").length, experimentsFailed: item.experiments.filter((e) => e.state === "failed").length, physicalTests: item.experiments.filter((e) => e.state === "needs-physical-test").length }
    };
  },

  /** Moves everything along; started once, and survives restarts because the state is on disk. */
  ensureTicking() {
    if (ticking || process.env.INVESTIGATION_NO_LOOP === "1") return;
    ticking = true;
    setInterval(() => {
      if (GameMode.isOn()) return;
      for (const item of read()) if (["planning", "researching", "experimenting", "synthesising"].includes(item.state)) void advance(item.id);
    }, TICK_MS).unref();
  },

  testHooks: { advance, findingsOf, patch }
};
