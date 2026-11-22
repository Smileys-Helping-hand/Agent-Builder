/**
 * KnowledgeImpact — whether each piece of knowledge helps, measured, and the
 * ones that hurt taken out of what builds are told.
 *
 * Evaluations run the same challenges with and without what was learned. On
 * 22 November, with knowledge scored lower than without (0.6–0.7 against
 * 0.8): the same few lessons and findings were given on every run of a
 * challenge they did not fit (a race-condition diagnosis went from 1.0 without
 * knowledge to 0.55 with it). A bigger knowledge base is not a better one.
 *
 * For each lesson and finding: every time it was given on a challenge, its pass
 * rate minus that challenge's pass rate without any knowledge. Its impact is
 * the mean of those. One that was given at least MIN_USES times with an impact
 * of BENCH_AT or lower is benched: LessonMemory.relevant and
 * ResearchStore.relevantFindings stop handing it out (it stays searchable).
 * Items always given together share the blame, because the data cannot
 * separate them; benching the group and measuring again is how that is found
 * out. A benched item comes back for another trial after PROBATION_DAYS, and
 * is benched again only if it still hurts.
 *
 * Reads data/agent/evaluations.json directly (no imports of the evaluator, so
 * the retrieval code can use this without a cycle); keeps data/learning/benched.json.
 */
import fs from "fs";
import path from "path";

const EVALUATIONS = () => path.resolve(process.env.EVALUATIONS_PATH ?? "data/agent/evaluations.json");
const FILE = () => path.resolve(process.env.BENCHED_PATH ?? "data/learning/benched.json");
const MIN_USES = 3;
const BENCH_AT = -0.25;
const PROBATION_DAYS = 14;

export interface Impact {
  ref: string;
  uses: number;
  impact: number;
  challenges: string[];
}

export interface Benched {
  ref: string;
  impact: number;
  uses: number;
  since: string;
  reason: string;
}

interface EvalRun {
  withKnowledge: boolean;
  state: string;
  results: Array<{ id: string; passRate: number; knowledgeUsed?: string[] }>;
}

/** Every item's impact from a set of evaluation runs (exported for tests). */
export const impactsFrom = (runs: EvalRun[]): Impact[] => {
  const done = runs.filter((r) => r.state === "done");
  const baseline = new Map<string, number[]>();
  for (const run of done.filter((r) => !r.withKnowledge)) for (const result of run.results) baseline.set(result.id, [...(baseline.get(result.id) ?? []), result.passRate]);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const items = new Map<string, { uses: number; sum: number; challenges: Set<string> }>();
  for (const run of done.filter((r) => r.withKnowledge)) {
    for (const result of run.results) {
      const base = baseline.get(result.id);
      if (!base?.length) continue;
      const delta = result.passRate - mean(base);
      for (const ref of result.knowledgeUsed ?? []) {
        const entry = items.get(ref) ?? { uses: 0, sum: 0, challenges: new Set<string>() };
        entry.uses += 1;
        entry.sum += delta;
        entry.challenges.add(result.id);
        items.set(ref, entry);
      }
    }
  }
  return [...items]
    .map(([ref, e]) => ({ ref, uses: e.uses, impact: Math.round((e.sum / e.uses) * 100) / 100, challenges: [...e.challenges] }))
    .sort((a, b) => a.impact - b.impact);
};

const readRuns = (): EvalRun[] => {
  try {
    const raw = JSON.parse(fs.readFileSync(EVALUATIONS(), "utf8")) as EvalRun[] | Record<string, EvalRun>;
    return Array.isArray(raw) ? raw : Object.values(raw);
  } catch {
    return [];
  }
};

let cache: { at: number; benched: Map<string, Benched> } | null = null;

const readBenched = (): Map<string, Benched> => {
  if (cache && Date.now() - cache.at < 60_000) return cache.benched;
  let list: Benched[] = [];
  try {
    list = JSON.parse(fs.readFileSync(FILE(), "utf8")) as Benched[];
  } catch {
    list = [];
  }
  cache = { at: Date.now(), benched: new Map(list.map((b) => [b.ref, b])) };
  return cache.benched;
};

export const KnowledgeImpact = {
  impacts(): Impact[] {
    return impactsFrom(readRuns());
  },

  /** Whether an item ("lesson:12", "finding:34") is benched now (not on probation). */
  isBenched(ref: string): boolean {
    const entry = readBenched().get(ref);
    if (!entry) return false;
    return Date.now() - Date.parse(entry.since) < PROBATION_DAYS * 86_400_000;
  },

  benched(): Benched[] {
    return [...readBenched().values()].filter((b) => KnowledgeImpact.isBenched(b.ref));
  },

  /**
   * Recompute from the evaluations and bench what hurts. Returns what changed.
   * Called after every evaluation run and at start.
   */
  refresh(): { benched: string[]; released: string[]; total: number } {
    const impacts = impactsFrom(readRuns());
    const current = readBenched();
    const next = new Map(current);
    const benched: string[] = [];
    const released: string[] = [];
    for (const item of impacts) {
      const existing = current.get(item.ref);
      if (item.uses >= MIN_USES && item.impact <= BENCH_AT) {
        // Still hurting: benched (again), from now if it was on probation.
        if (!existing || !KnowledgeImpact.isBenched(item.ref)) benched.push(item.ref);
        next.set(item.ref, { ref: item.ref, impact: item.impact, uses: item.uses, since: existing && KnowledgeImpact.isBenched(item.ref) ? existing.since : new Date().toISOString(), reason: `given ${item.uses} time(s) on ${item.challenges.join(", ")}: pass rate ${item.impact > 0 ? "+" : ""}${item.impact} against the same challenges without knowledge` });
      } else if (existing && item.uses >= MIN_USES && item.impact >= 0) {
        next.delete(item.ref);
        released.push(item.ref);
      }
    }
    fs.mkdirSync(path.dirname(FILE()), { recursive: true });
    fs.writeFileSync(FILE(), JSON.stringify([...next.values()], null, 2));
    cache = null;
    return { benched, released, total: [...next.values()].length };
  },

  /** For tests. */
  _reset(): void {
    cache = null;
  }
};
