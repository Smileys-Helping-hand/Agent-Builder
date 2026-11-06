/**
 * LearningLoop — research and reconstruction as part of how the builder learns,
 * not features on the side.
 *
 * Every half hour it reads what the builder's own record says it cannot yet do
 * and acts on it:
 *   - a milestone it parked, or one failing the same way again and again, and a
 *     feature its rebuilds keep missing, becomes a research question in a standing
 *     topic ("How to build what keeps failing"). The research engine answers from
 *     sources; findings checked against those sources reach later builds through the
 *     same route as any research (ResearchStore.relevantFindings).
 *   - once a day, when the Reconstructor is idle, the next of your projects it has
 *     not rebuilt yet is queued: study, rebuild, compare, and what it missed
 *     becomes lessons and, through the point above, research.
 *   - lessons are verified as they are used (see LessonMemory.statusOf).
 *
 * Everything it starts is in the evidence ledger. State: data/agent/learning-loop.json.
 * Paused along with everything else in game mode; LEARNING_LOOP=off turns it off.
 */
import fs from "fs";
import path from "path";

import { ContinuousImprover } from "../agent/ContinuousImprover.js";
import { Reconstructor } from "../agent/Reconstructor.js";
import { EcosystemStore } from "../ecosystem/EcosystemStore.js";
import { Evidence } from "../knowledge/Evidence.js";
import { Evaluations } from "./Evaluations.js";
import { ResearchEngine } from "../research/ResearchEngine.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";

interface LoopState {
  topicId: string | null;
  asked: string[];
  reconstructedAt: string | null;
  reconstructed: string[];
  lastTickAt: string | null;
}

const FILE = () => path.resolve("data", "agent", "learning-loop.json");
const TICK_MS = Number(process.env.LEARNING_LOOP_MS) || 30 * 60_000;
const QUESTIONS_PER_TICK = 5;
const RECONSTRUCT_EVERY_MS = Number(process.env.LEARNING_RECONSTRUCT_MS) || 24 * 3_600_000;
const EVALUATE_EVERY_MS = Number(process.env.LEARNING_EVALUATE_MS) || 24 * 3_600_000;

const read = (): LoopState => {
  try {
    return { topicId: null, asked: [], reconstructedAt: null, reconstructed: [], lastTickAt: null, ...(JSON.parse(fs.readFileSync(FILE(), "utf8")) as Partial<LoopState>) };
  } catch {
    return { topicId: null, asked: [], reconstructedAt: null, reconstructed: [], lastTickAt: null };
  }
};
const write = (state: LoopState) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(state, null, 2));
};

/** What the record says the builder cannot do yet, as research questions. */
export const questionsFromRecord = (): string[] => {
  const questions: string[] = [];
  for (const session of ContinuousImprover.list().sessions) {
    for (const milestone of session.plan) {
      if (milestone.status === "parked" || (milestone.repeats ?? 0) >= 3) {
        const cause = milestone.diagnosis ?? milestone.note ?? "";
        questions.push(`How do experienced engineers do this: ${milestone.title}${cause ? ` (it failed here: ${cause.slice(0, 160)})` : ""}?`);
      }
    }
  }
  for (const run of Reconstructor.list().runs) {
    const last = run.rounds[run.rounds.length - 1];
    const kind = run.blueprint?.kind ?? "app";
    for (const name of last?.missing ?? []) {
      const detail = run.blueprint?.features.find((f) => f.name === name)?.detail ?? "";
      questions.push(`How do you build "${name}" in a ${kind}?${detail ? ` It should: ${detail.slice(0, 160)}` : ""}`);
    }
  }
  return [...new Set(questions)];
};

export const LearningLoop = {
  state: read,

  async tick(): Promise<{ asked: string[]; queued: string | null }> {
    const state = read();
    const asked: string[] = [];
    let queued: string | null = null;

    // What it cannot do yet, researched.
    const fresh = questionsFromRecord().filter((q) => !state.asked.includes(q)).slice(0, QUESTIONS_PER_TICK);
    if (fresh.length) {
      const engine = ResearchEngine.getInstance();
      let topic = state.topicId ? ResearchStore.getTopic(state.topicId) : null;
      if (!topic) {
        topic = engine.start("How to build what keeps failing", "The builder's own record: what it parks, repeats or misses. Find how it is really done, from sources, so later builds can use it.");
        state.topicId = topic.id;
      } else if (topic.status !== "running") engine.resume(topic.id);
      for (const question of fresh) {
        ResearchStore.addPriorityQuestion(topic.id, question, 0);
        asked.push(question);
        Evidence.record({ kind: "research", ref: `learning-question:${topic.id}:${state.asked.length + asked.length}`, task: "learning-loop", agent: "learning-loop", title: question.slice(0, 300), outcome: "asked", links: [{ to: `topic:${topic.id}`, relation: "asked-of" }] });
      }
      state.asked = [...state.asked, ...fresh].slice(-500);
    }

    // The next project rebuilt, to learn from what it misses.
    const idle = !Reconstructor.running() && !Reconstructor.list().runs.some((r) => r.state === "queued");
    const due = !state.reconstructedAt || Date.now() - Date.parse(state.reconstructedAt) > RECONSTRUCT_EVERY_MS;
    if (idle && due && process.env.LEARNING_RECONSTRUCT !== "off") {
      const done = new Set([...state.reconstructed, ...Reconstructor.list().runs.map((r) => r.source.path)]);
      const next = EcosystemStore.listProjects().find((p) => !done.has(p.path) && !done.has(p.id) && /node|web|next|react|vite/i.test(`${p.kind} ${p.stack.join(" ")}`) && !/agent-builder/i.test(p.name));
      if (next) {
        Reconstructor.fromProject(next.id, "learning-loop");
        state.reconstructed = [...state.reconstructed, next.id].slice(-500);
        state.reconstructedAt = new Date().toISOString();
        queued = next.name;
        Evidence.record({ kind: "research", ref: `learning-reconstruct:${next.id}`, task: "learning-loop", agent: "learning-loop", title: `Reconstructing ${next.name} to learn from it`, outcome: "queued" });
      }
    }

    // Measured regularly: with what it has learned, and now and then without, so the comparison stays honest.
    if (process.env.LEARNING_EVALUATE !== "off" && !Evaluations.isRunning()) {
      const runs = Evaluations.list().filter((r) => r.state === "done");
      const latest = runs[0];
      if (!latest || Date.now() - Date.parse(latest.startedAt) > EVALUATE_EVERY_MS) {
        const baseline = runs.find((r) => !r.withKnowledge);
        const needBaseline = !baseline || Date.now() - Date.parse(baseline.startedAt) > 7 * EVALUATE_EVERY_MS;
        Evaluations.start({ label: needBaseline ? "Weekly baseline, without what it has learned" : "Daily, with what it has learned", withKnowledge: !needBaseline, trials: 1 });
      }
    }

    state.lastTickAt = new Date().toISOString();
    write(state);
    return { asked, queued };
  },

  start(): void {
    if (process.env.LEARNING_LOOP === "off") return;
    setInterval(() => {
      if (GameMode.isOn()) return;
      void LearningLoop.tick().catch((error) => Logger.warn("The learning loop could not run", { error: (error as Error).message }));
    }, TICK_MS).unref();
  }
};
