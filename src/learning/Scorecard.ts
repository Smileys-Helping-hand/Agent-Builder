/**
 * The learning scorecard: does what Agent Builder learned make it better, measured.
 *
 * From the evaluation runs (the same fixed challenges, with and without what
 * was learned, each recording the model that answered) and KnowledgeImpact:
 *   - baseline: the score without knowledge before anything was benched;
 *   - the latest scores with and without knowledge, for the same model;
 *   - retrieval precision: of the items handed out in recent runs that have
 *     enough evidence (3+ uses), the share that did not make answers worse;
 *   - harmful knowledge excluded: how many are benched, and whether any benched
 *     item was still handed out after it was benched (it must be none);
 *   - verified useful knowledge: items that raised the pass rate;
 *   - regression rate: the share of challenges that do worse with knowledge;
 *   - the trend: every run's score over time.
 * If knowledge still makes things worse, the scorecard says so plainly.
 */
import fs from "fs";
import path from "path";

import { KnowledgeImpact } from "./KnowledgeImpact.js";

interface Run {
  id: string;
  withKnowledge: boolean;
  state: string;
  model: string | null;
  startedAt: string;
  score: number | null;
  results: Array<{ id: string; passRate: number; knowledgeUsed?: string[] }>;
}

const readRuns = (): Run[] => {
  try {
    const raw = JSON.parse(fs.readFileSync(path.resolve(process.env.EVALUATIONS_PATH ?? process.env.EVALUATIONS_FILE ?? "data/agent/evaluations.json"), "utf8")) as Run[] | Record<string, Run>;
    return (Array.isArray(raw) ? raw : Object.values(raw)).filter((r) => r.state === "done" && r.score !== null).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  } catch {
    return [];
  }
};

const mean = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000 : null);

/** Wrong names recorded before 22 November: those runs answered on the local 14B. */
const modelOf = (run: Run) => (!run.model || /gpt|openai/i.test(run.model) ? "qwen2.5-coder:14b" : run.model);

export const scorecard = () => {
  const runs = readRuns();
  const benched = KnowledgeImpact.benched();
  const firstBench = benched.map((b) => b.since).sort()[0] ?? null;
  const impacts = KnowledgeImpact.impacts();
  const evidenced = impacts.filter((i) => i.uses >= 3);
  const latestWith = [...runs].reverse().find((r) => r.withKnowledge) ?? null;
  const model = latestWith ? modelOf(latestWith) : null;
  const latestWithout = [...runs].reverse().find((r) => !r.withKnowledge && (!model || modelOf(r) === model)) ?? null;
  const before = runs.filter((r) => !r.withKnowledge && (!firstBench || r.startedAt < firstBench));
  const after = firstBench ? runs.filter((r) => r.startedAt >= firstBench) : [];
  // Benched items must not be handed out after they were benched.
  const leaked = after.filter((r) => r.withKnowledge).flatMap((r) => r.results.flatMap((c) => (c.knowledgeUsed ?? []).filter((ref) => benched.some((b) => b.ref === ref && b.since <= r.startedAt))));
  let regressions: string[] = [];
  if (latestWith && latestWithout) {
    const without = new Map(latestWithout.results.map((c) => [c.id, c.passRate]));
    regressions = latestWith.results.filter((c) => without.has(c.id) && c.passRate < without.get(c.id)!).map((c) => c.id);
  }
  const withScore = latestWith?.score ?? null;
  const withoutScore = latestWithout?.score ?? null;
  const verdict =
    withScore === null || withoutScore === null
      ? "Not enough runs yet to compare with and without knowledge on the same model."
      : withScore > withoutScore
        ? `Knowledge helps: ${withScore} with it against ${withoutScore} without, on ${model}.`
        : withScore === withoutScore
          ? `Knowledge makes no difference yet: ${withScore} either way, on ${model}.`
          : `Knowledge still makes answers worse: ${withScore} with it against ${withoutScore} without, on ${model}. ${regressions.length} challenge(s) regress: ${regressions.join(", ")}.`;
  return {
    verdict,
    model,
    baselineWithout: mean(before.map((r) => r.score!)),
    latest: { with: withScore, without: withoutScore, withRun: latestWith?.id ?? null, withoutRun: latestWithout?.id ?? null, at: latestWith?.startedAt ?? null },
    sinceBenching: firstBench ? { from: firstBench, withRuns: after.filter((r) => r.withKnowledge).length, withoutRuns: after.filter((r) => !r.withKnowledge).length, withMean: mean(after.filter((r) => r.withKnowledge).map((r) => r.score!)), withoutMean: mean(after.filter((r) => !r.withKnowledge).map((r) => r.score!)) } : null,
    retrievalPrecision: evidenced.length ? Math.round((evidenced.filter((i) => i.impact >= 0).length / evidenced.length) * 100) / 100 : null,
    harmfulExcluded: { benched: benched.length, handedOutAfterBenching: [...new Set(leaked)] },
    verifiedUseful: evidenced.filter((i) => i.impact > 0).map((i) => ({ ref: i.ref, impact: i.impact, uses: i.uses })),
    harmful: evidenced.filter((i) => i.impact <= -0.25).map((i) => ({ ref: i.ref, impact: i.impact, uses: i.uses, benched: KnowledgeImpact.isBenched(i.ref) })),
    regressionRate: latestWith && latestWithout ? Math.round((regressions.length / Math.max(1, latestWith.results.length)) * 100) / 100 : null,
    regressions,
    trend: runs.map((r) => ({ at: r.startedAt, withKnowledge: r.withKnowledge, score: r.score, model: modelOf(r) }))
  };
};
