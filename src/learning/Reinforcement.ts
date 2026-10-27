/**
 * Reinforcement — the agents learn which way of working earns the best results.
 *
 * Each decision an agent makes the same way every time is a policy with a few
 * arms (approaches): how the research chat explains, how a lesson teaches,
 * how a build plans its first pass. Every time it acts, it picks an arm by
 * Thompson sampling (draw from each arm's Beta posterior, take the best),
 * which keeps exploring while it is unsure and settles on what works. The
 * episode — context, arm, prompt and answer — is kept, and the reward comes
 * from what actually happened:
 *
 *   chat.style      👍/👎 on the answer (in the app or told to Jarvis)
 *   lesson.style    the learner's first quiz score on that lesson, and 👍/👎
 *   build.approach  the build's final score and whether it passed
 *
 * A reward r in [0, 1] adds r to the arm's α and 1 − r to its β. Old evidence
 * is discounted (γ = 0.995 per update, towards the prior) so a policy keeps
 * adapting when the model or the work changes. Arms are learned per context
 * bucket (a kind of build, a learner level) with the policy-wide posterior as
 * a weak prior, so a new bucket starts from what worked elsewhere.
 *
 * Every rewarded episode is training data: exportDataset() writes the best
 * answers (SFT) and preference pairs — two answers to the same request, one
 * rewarded over the other (DPO) — as JSONL in the shape TRL and Unsloth read,
 * ready for fine-tuning the local model's weights.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";
import { Logger } from "../utils/Logger.js";

export interface Arm {
  id: string;
  label: string;
  /** What is added to the agent's prompt when this arm is chosen ("" for the baseline). */
  instruction: string;
}

export interface Policy {
  id: string;
  agent: string;
  label: string;
  reward: string;
  arms: Arm[];
}

export const POLICIES: Policy[] = [
  {
    id: "chat.style",
    agent: "research-chat",
    label: "How the research chat explains",
    reward: "👍/👎 on the answer, in the app or told to Jarvis",
    arms: [
      { id: "direct", label: "Answer first, then detail", instruction: "Style: give the direct answer in the first two sentences, then the supporting detail." },
      { id: "tutor", label: "Teach it step by step", instruction: "Style: teach it — build up from what they likely know in small steps, and end with one short question that checks they followed." },
      { id: "example-first", label: "Example first", instruction: "Style: open with one concrete example or analogy, then explain the principle behind it." }
    ]
  },
  {
    id: "lesson.style",
    agent: "study-course",
    label: "How lessons teach",
    reward: "the learner's first quiz score on the lesson, and 👍/👎",
    arms: [
      { id: "analogy-first", label: "Analogy first", instruction: "Teaching approach: open \"The idea\" with an everyday analogy, then make it precise." },
      { id: "worked-example", label: "Worked example", instruction: "Teaching approach: build \"The idea\" around one worked example, step by step." },
      { id: "first-principles", label: "First principles", instruction: "Teaching approach: build \"The idea\" from first principles — the definitions first, then how they combine." }
    ]
  },
  {
    id: "improve.kind",
    agent: "continuous-improver",
    label: "What kind of improvement it proposes (per project)",
    reward: "your decision: approved 1, rejected 0 (a change that failed its checks: 0.2)",
    arms: [
      { id: "fixes", label: "Fixes and reliability", instruction: "Prefer: a bug fix, error handling or a reliability problem." },
      { id: "tests", label: "Tests and quality", instruction: "Prefer: missing tests, types or code quality that guards behaviour." },
      { id: "ux", label: "User experience", instruction: "Prefer: something the user sees — clearer screens, accessibility, feedback, mobile layout." },
      { id: "performance", label: "Performance", instruction: "Prefer: something slow — load time, rendering, data fetching, bundle size." },
      { id: "features", label: "Small features", instruction: "Prefer: a small feature that clearly fits what the app is for." }
    ]
  },
  {
    id: "build.approach",
    agent: "builder",
    label: "How a new build plans its first pass",
    reward: "the build's final score (0–100 → 0–1), +0.1 when it passes",
    arms: [
      { id: "baseline", label: "As it is", instruction: "" },
      {
        id: "plan-components",
        label: "Plan components first",
        instruction: "Approach: before writing, decide the components and the state each owns; write small focused components, and keep pure logic in its own files with tests.\n\n"
      },
      {
        id: "logic-first",
        label: "Logic and tests first",
        instruction: "Approach: write the pure logic (calculations, state changes, data shaping) and its tests first, then the UI that uses it.\n\n"
      }
    ]
  }
];

const GAMMA = 0.995;
/** How strongly a bucket leans on the policy-wide posterior. */
const SHRINK = 0.3;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rl_arms (
  policy TEXT NOT NULL,
  bucket TEXT NOT NULL,
  arm TEXT NOT NULL,
  alpha REAL NOT NULL DEFAULT 1,
  beta REAL NOT NULL DEFAULT 1,
  pulls INTEGER NOT NULL DEFAULT 0,
  rewarded INTEGER NOT NULL DEFAULT 0,
  reward_sum REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (policy, bucket, arm)
);
CREATE TABLE IF NOT EXISTS rl_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  policy TEXT NOT NULL,
  bucket TEXT NOT NULL,
  arm TEXT NOT NULL,
  agent TEXT NOT NULL,
  ref TEXT,
  prompt_hash TEXT,
  prompt TEXT,
  response TEXT,
  reward REAL,
  rewards TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  rewarded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_rl_episodes_ref ON rl_episodes(policy, ref);
CREATE INDEX IF NOT EXISTS idx_rl_episodes_prompt ON rl_episodes(policy, prompt_hash);
`;

let ready = false;
const db = () => {
  const database = getKnowledgeDb();
  if (!ready) {
    database.exec(SCHEMA);
    ready = true;
  }
  return database;
};

type ArmRow = { policy: string; bucket: string; arm: string; alpha: number; beta: number; pulls: number; rewarded: number; reward_sum: number; updated_at: string };
type EpisodeRow = {
  id: number;
  policy: string;
  bucket: string;
  arm: string;
  agent: string;
  ref: string | null;
  prompt_hash: string | null;
  prompt: string | null;
  response: string | null;
  reward: number | null;
  rewards: string;
  created_at: string;
  rewarded_at: string | null;
};

export interface Episode {
  id: number;
  policy: string;
  bucket: string;
  arm: string;
  agent: string;
  ref: string | null;
  reward: number | null;
  rewards: Array<{ source: string; value: number; note?: string; at: string }>;
  createdAt: string;
}

const toEpisode = (row: EpisodeRow): Episode => ({
  id: row.id,
  policy: row.policy,
  bucket: row.bucket,
  arm: row.arm,
  agent: row.agent,
  ref: row.ref,
  reward: row.reward,
  rewards: (() => {
    try {
      return JSON.parse(row.rewards);
    } catch {
      return [];
    }
  })(),
  createdAt: row.created_at
});

// ---------------------------------------------------------------- sampling

/** A standard normal draw (Box–Muller). */
const normal = (): number => {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** A Gamma(shape, 1) draw — Marsaglia & Tsang; shape < 1 by the boost trick. */
const gamma = (shape: number): number => {
  if (shape < 1) return gamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
};

/** A Beta(α, β) draw. */
export const sampleBeta = (alpha: number, beta: number): number => {
  const x = gamma(alpha);
  const y = gamma(beta);
  return x / (x + y);
};

const policyOf = (id: string): Policy => {
  const policy = POLICIES.find((p) => p.id === id);
  if (!policy) throw new Error(`Unknown policy ${id}.`);
  return policy;
};

const armRow = (policy: string, bucket: string, arm: string): ArmRow =>
  (db().prepare("SELECT * FROM rl_arms WHERE policy = ? AND bucket = ? AND arm = ?").get(policy, bucket, arm) as ArmRow | undefined) ?? {
    policy,
    bucket,
    arm,
    alpha: 1,
    beta: 1,
    pulls: 0,
    rewarded: 0,
    reward_sum: 0,
    updated_at: nowIso()
  };

const saveArm = (row: ArmRow) =>
  db()
    .prepare(
      `INSERT INTO rl_arms (policy, bucket, arm, alpha, beta, pulls, rewarded, reward_sum, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(policy, bucket, arm) DO UPDATE SET alpha = excluded.alpha, beta = excluded.beta, pulls = excluded.pulls,
         rewarded = excluded.rewarded, reward_sum = excluded.reward_sum, updated_at = excluded.updated_at`
    )
    .run(row.policy, row.bucket, row.arm, row.alpha, row.beta, row.pulls, row.rewarded, row.reward_sum, nowIso());

const hash = (text: string) => crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Folds a reward into an arm's posterior, in its bucket and policy-wide. */
const learn = (policy: string, bucket: string, arm: string, reward: number) => {
  for (const b of new Set([bucket, "*"])) {
    const row = armRow(policy, b, arm);
    // Discount old evidence towards the Beta(1, 1) prior, then add this one.
    row.alpha = 1 + (row.alpha - 1) * GAMMA + reward;
    row.beta = 1 + (row.beta - 1) * GAMMA + (1 - reward);
    row.rewarded += 1;
    row.reward_sum += reward;
    saveArm(row);
  }
};

export const Reinforcement = {
  policies: () => POLICIES,

  /**
   * Chooses an arm for this decision and opens an episode. Returns the arm's
   * instruction for the prompt and the episode id to reward later. With
   * RL=off it always takes the first arm (and still records, so it can be compared).
   */
  choose(policyId: string, input: { bucket?: string; agent?: string; ref?: string; prompt?: string }): { episodeId: number; arm: Arm } {
    const policy = policyOf(policyId);
    const bucket = (input.bucket ?? "*").toLowerCase().slice(0, 60) || "*";
    let arm = policy.arms[0];
    if ((process.env.RL ?? "on").toLowerCase() !== "off") {
      let best = -1;
      for (const candidate of policy.arms) {
        const local = armRow(policy.id, bucket, candidate.id);
        const global = armRow(policy.id, "*", candidate.id);
        const a = bucket === "*" ? local.alpha : local.alpha + SHRINK * (global.alpha - 1);
        const b = bucket === "*" ? local.beta : local.beta + SHRINK * (global.beta - 1);
        const draw = sampleBeta(a, b);
        if (draw > best) {
          best = draw;
          arm = candidate;
        }
      }
    }
    for (const b of new Set([bucket, "*"])) {
      const row = armRow(policy.id, b, arm.id);
      row.pulls += 1;
      saveArm(row);
    }
    const result = db()
      .prepare(
        "INSERT INTO rl_episodes (policy, bucket, arm, agent, ref, prompt_hash, prompt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      )
      .run(policy.id, bucket, arm.id, input.agent ?? policy.agent, input.ref ?? null, input.prompt ? hash(input.prompt) : null, input.prompt?.slice(0, 12_000) ?? null, nowIso());
    return { episodeId: Number(result.lastInsertRowid), arm };
  },

  /** Names what an episode produced (an answer's message, a lesson, a build) so it can be rewarded by that. */
  setRef(episodeId: number, ref: string) {
    db().prepare("UPDATE rl_episodes SET ref = ? WHERE id = ?").run(ref, episodeId);
  },

  /** Takes back a choice that was not used (it does not count as a try). */
  forget(episodeId: number) {
    const row = db().prepare("SELECT * FROM rl_episodes WHERE id = ?").get(episodeId) as EpisodeRow | undefined;
    if (!row || row.reward !== null) return;
    for (const b of new Set([row.bucket, "*"])) {
      const arm = armRow(row.policy, b, row.arm);
      arm.pulls = Math.max(0, arm.pulls - 1);
      saveArm(arm);
    }
    db().prepare("DELETE FROM rl_episodes WHERE id = ?").run(episodeId);
  },

  /** Keeps what the agent produced, for the training dataset. */
  recordResponse(episodeId: number, response: string) {
    db().prepare("UPDATE rl_episodes SET response = ? WHERE id = ?").run(response.slice(0, 16_000), episodeId);
  },

  /**
   * Rewards an episode (0 bad … 1 good). Several rewards from different
   * sources average; the arm learns from the change, so a 👍 after a quiz
   * score refines rather than double-counts.
   */
  reward(episodeId: number, value: number, source: string, note?: string): Episode | null {
    const row = db().prepare("SELECT * FROM rl_episodes WHERE id = ?").get(episodeId) as EpisodeRow | undefined;
    if (!row) return null;
    const v = clamp01(value);
    const rewards = toEpisode(row).rewards.filter((r) => r.source !== source);
    rewards.push({ source, value: v, note: note?.slice(0, 300), at: nowIso() });
    const mean = rewards.reduce((sum, r) => sum + r.value, 0) / rewards.length;
    db().prepare("UPDATE rl_episodes SET reward = ?, rewards = ?, rewarded_at = ? WHERE id = ?").run(mean, JSON.stringify(rewards), nowIso(), episodeId);
    // The arm learns this episode once: from its first reward in full, from later ones by how far they moved the mean.
    if (row.reward === null) learn(row.policy, row.bucket, row.arm, mean);
    else if (Math.abs(mean - row.reward) > 1e-6) {
      const delta = mean - row.reward;
      for (const b of new Set([row.bucket, "*"])) {
        const arm = armRow(row.policy, b, row.arm);
        arm.alpha = Math.max(1e-3, arm.alpha + delta);
        arm.beta = Math.max(1e-3, arm.beta - delta);
        arm.reward_sum += delta;
        saveArm(arm);
      }
    }
    return toEpisode(db().prepare("SELECT * FROM rl_episodes WHERE id = ?").get(episodeId) as EpisodeRow);
  },

  /** The latest episode for something (a chat answer, a lesson, a build) — for rewarding it by what it is. */
  episodeFor(policyId: string, ref: string): Episode | null {
    const row = db().prepare("SELECT * FROM rl_episodes WHERE policy = ? AND ref = ? ORDER BY id DESC LIMIT 1").get(policyId, ref) as EpisodeRow | undefined;
    return row ? toEpisode(row) : null;
  },

  /** The most recent unrewarded episode of a policy ("that answer was great" with nothing more to go on). */
  latest(policyId?: string): Episode | null {
    const row = (
      policyId
        ? db().prepare("SELECT * FROM rl_episodes WHERE policy = ? ORDER BY id DESC LIMIT 1").get(policyId)
        : db().prepare("SELECT * FROM rl_episodes WHERE policy <> 'build.approach' ORDER BY id DESC LIMIT 1").get()
    ) as EpisodeRow | undefined;
    return row ? toEpisode(row) : null;
  },

  /** Each policy's arms: tries, rewards, average reward, and how likely each is to be the best right now. */
  stats() {
    return POLICIES.map((policy) => {
      const rows = db().prepare("SELECT * FROM rl_arms WHERE policy = ? AND bucket = '*'").all(policy.id) as ArmRow[];
      const byArm = new Map(rows.map((r) => [r.arm, r]));
      // P(best) by simulation: how often each arm wins a draw from the posteriors.
      const wins = new Map<string, number>(policy.arms.map((a) => [a.id, 0]));
      for (let i = 0; i < 2000; i++) {
        let best = "";
        let top = -1;
        for (const arm of policy.arms) {
          const r = byArm.get(arm.id);
          const draw = sampleBeta(r?.alpha ?? 1, r?.beta ?? 1);
          if (draw > top) {
            top = draw;
            best = arm.id;
          }
        }
        wins.set(best, (wins.get(best) ?? 0) + 1);
      }
      const episodes = (db().prepare("SELECT COUNT(*) AS n, SUM(reward IS NOT NULL) AS rewarded FROM rl_episodes WHERE policy = ?").get(policy.id) as { n: number; rewarded: number | null });
      const buckets = (db().prepare("SELECT DISTINCT bucket FROM rl_arms WHERE policy = ? AND bucket <> '*'").all(policy.id) as Array<{ bucket: string }>).map((b) => b.bucket);
      return {
        id: policy.id,
        label: policy.label,
        agent: policy.agent,
        reward: policy.reward,
        episodes: episodes.n,
        rewarded: episodes.rewarded ?? 0,
        buckets,
        arms: policy.arms.map((arm) => {
          const r = byArm.get(arm.id);
          return {
            id: arm.id,
            label: arm.label,
            tries: r?.pulls ?? 0,
            rewarded: r?.rewarded ?? 0,
            averageReward: r && r.rewarded ? Math.round((r.reward_sum / r.rewarded) * 1000) / 1000 : null,
            posteriorMean: Math.round(((r?.alpha ?? 1) / ((r?.alpha ?? 1) + (r?.beta ?? 1))) * 1000) / 1000,
            chanceBest: Math.round(((wins.get(arm.id) ?? 0) / 2000) * 1000) / 1000
          };
        })
      };
    });
  },

  recent(limit = 30): Episode[] {
    return (db().prepare("SELECT * FROM rl_episodes ORDER BY id DESC LIMIT ?").all(limit) as EpisodeRow[]).map(toEpisode);
  },

  /**
   * Writes the training data: sft.jsonl (the best-rewarded answers) and
   * dpo.jsonl (preference pairs: the same request answered twice, one
   * rewarded over the other by at least 0.25) to data/rl/.
   */
  exportDataset(minReward = 0.8): { dir: string; sft: number; dpo: number } {
    const dir = path.resolve("data", "rl");
    fs.mkdirSync(dir, { recursive: true });
    const rows = db()
      .prepare("SELECT * FROM rl_episodes WHERE reward IS NOT NULL AND prompt IS NOT NULL AND response IS NOT NULL ORDER BY id")
      .all() as EpisodeRow[];
    const sft = rows
      .filter((r) => (r.reward ?? 0) >= minReward)
      .map((r) => JSON.stringify({ messages: [{ role: "user", content: r.prompt }, { role: "assistant", content: r.response }], policy: r.policy, arm: r.arm, reward: r.reward }));
    const groups = new Map<string, EpisodeRow[]>();
    for (const row of rows) if (row.prompt_hash) groups.set(`${row.policy}:${row.prompt_hash}`, [...(groups.get(`${row.policy}:${row.prompt_hash}`) ?? []), row]);
    const dpo: string[] = [];
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const sorted = [...group].sort((a, b) => (b.reward ?? 0) - (a.reward ?? 0));
      const [best, worst] = [sorted[0], sorted[sorted.length - 1]];
      if ((best.reward ?? 0) - (worst.reward ?? 0) >= 0.25) dpo.push(JSON.stringify({ prompt: best.prompt, chosen: best.response, rejected: worst.response, policy: best.policy }));
    }
    fs.writeFileSync(path.join(dir, "sft.jsonl"), sft.join("\n") + (sft.length ? "\n" : ""), "utf8");
    fs.writeFileSync(path.join(dir, "dpo.jsonl"), dpo.join("\n") + (dpo.length ? "\n" : ""), "utf8");
    Logger.log("Exported reinforcement-learning dataset", { sft: sft.length, dpo: dpo.length });
    return { dir, sft: sft.length, dpo: dpo.length };
  }
};
