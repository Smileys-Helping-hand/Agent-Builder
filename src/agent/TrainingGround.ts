/**
 * TrainingGround — where Agent Builder practises.
 *
 * Challenges are small, complete apps and games of rising difficulty. When the
 * PC is idle (no build running, no customer order accepted and waiting, not in
 * game mode) it takes the challenge it is weakest at, builds it from the
 * prompt, and the checks score it. Every practice build is a real try for its
 * build.approach policy (RewardWiring rewards it), every fix it makes is a
 * lesson LessonMemory keeps, and every win is XP. So practice is genuinely how
 * it gets stronger, and the scores per challenge show by how much.
 *
 * When it has beaten every challenge it asks the model for harder ones.
 *
 *   GROUND=off            no practice on its own (the Practise now button still works)
 *   GROUND_DAILY_LIMIT=4  practice builds a day
 */
import fs from "fs";
import path from "path";

import { BuildService, buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { OrderStore } from "../orders/OrderStore.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";

export interface Challenge {
  id: string;
  title: string;
  /** 1 easy … 5 hard */
  level: number;
  brief: string;
  source: "set" | "model";
}

export interface PracticeRun {
  id: string;
  challengeId: string;
  buildId: string;
  startedAt: string;
  finishedAt: string | null;
  state: "running" | "won" | "lost" | "stopped";
  score: number | null;
}

interface GroundState {
  enabled: boolean;
  challenges: Challenge[];
  runs: PracticeRun[];
}

const SET: Challenge[] = [
  { id: "tip-split", title: "Tip & bill splitter", level: 1, brief: "A tip calculator: bill, tip %, number of people, rounding up per person; shows each share and the total. Pure calculation logic with tests.", source: "set" },
  { id: "unit-convert", title: "Unit converter", level: 1, brief: "A unit converter for length, weight and temperature with instant two-way conversion and a history of the last 10 conversions.", source: "set" },
  { id: "pomodoro", title: "Pomodoro timer", level: 2, brief: "A pomodoro timer: 25/5 minute cycles, a long break every 4, start/pause/reset, a session counter and a sound at each change.", source: "set" },
  { id: "habits", title: "Habit tracker", level: 2, brief: "A habit tracker: add habits, tick them off per day, show the current streak and a 4-week grid; saved in the browser.", source: "set" },
  { id: "snake", title: "Snake game", level: 2, brief: "A snake game on a canvas: arrow keys and swipe, growing snake, food, score, speed-up every 5 points, game over and restart, high score saved.", source: "set" },
  { id: "kanban", title: "Kanban board", level: 3, brief: "A kanban board with To do / Doing / Done columns, add/edit/delete cards, move cards between columns (buttons and drag), saved in the browser.", source: "set" },
  { id: "quiz-game", title: "Quiz game", level: 3, brief: "A quiz game: 10 multiple-choice questions, a 15-second timer per question, score with streak bonus, a results screen with the right answers.", source: "set" },
  { id: "budget", title: "Budget planner", level: 3, brief: "A monthly budget planner: income and expense entries with categories, totals per category, remaining balance, a bar chart, filters by month.", source: "set" },
  { id: "breakout", title: "Breakout", level: 4, brief: "A breakout game: paddle, ball physics with angle on paddle hits, 5 rows of bricks, 3 lives, levels that speed up, power-up that widens the paddle.", source: "set" },
  { id: "markdown-notes", title: "Markdown notes", level: 4, brief: "A notes app: create, search, tag and delete notes written in Markdown with a live preview; notes saved in the browser; keyboard shortcuts.", source: "set" },
  { id: "recipe-scaler", title: "Recipe scaler", level: 4, brief: "A recipe app: add recipes with ingredients and amounts, scale servings up or down with sensible unit conversion, and a combined shopping list.", source: "set" },
  { id: "platformer", title: "Platformer level", level: 5, brief: "A side-scrolling platformer: running and jumping with gravity, moving platforms, coins, one enemy type, a goal flag, a timer and restart on falling.", source: "set" },
  { id: "booking", title: "Appointment booking", level: 5, brief: "An appointment booking app: services with durations, a weekly calendar of free slots, booking with name and phone, no double bookings, cancel by code.", source: "set" }
];

const FILE = () => path.resolve("data", "agent", "ground.json");
const enabledByEnv = () => (process.env.GROUND ?? "on").toLowerCase() !== "off";
const dailyLimit = () => Number(process.env.GROUND_DAILY_LIMIT) || 4;

const read = (): GroundState => {
  try {
    const state = JSON.parse(fs.readFileSync(FILE(), "utf8")) as GroundState;
    const known = new Set(state.challenges.map((c) => c.id));
    for (const c of SET) if (!known.has(c.id)) state.challenges.push(c);
    return state;
  } catch {
    return { enabled: true, challenges: [...SET], runs: [] };
  }
};
const write = (state: GroundState) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify({ ...state, runs: state.runs.slice(-300) }, null, 2), "utf8");
};

const today = () => new Date().toISOString().slice(0, 10);
let timer: NodeJS.Timeout | null = null;
let wired = false;

const best = (state: GroundState, id: string) =>
  state.runs.filter((r) => r.challengeId === id && r.score !== null).reduce<number | null>((m, r) => (m === null || (r.score ?? 0) > m ? r.score : m), null);

/** Weakest first: never tried, then lowest best score, easier before harder. */
const pick = (state: GroundState): Challenge | null => {
  const open = state.challenges.filter((c) => (best(state, c.id) ?? -1) < 95);
  return open.sort((a, b) => (best(state, a.id) ?? -1) - (best(state, b.id) ?? -1) || a.level - b.level)[0] ?? null;
};

const finished = (record: BuildRecord, how: "completed" | "failed" | "stopped") => {
  const state = read();
  const run = state.runs.find((r) => r.buildId === record.buildId && r.state === "running");
  if (!run) return;
  run.finishedAt = new Date().toISOString();
  run.score = Math.round(record.bestScore ?? 0);
  run.state = how === "stopped" ? "stopped" : record.passed ? "won" : "lost";
  write(state);
  Logger.log("Practice finished", { challenge: run.challengeId, state: run.state, score: run.score });
};

export const TrainingGround = {
  state() {
    const state = read();
    return {
      enabled: state.enabled && enabledByEnv(),
      dailyLimit: dailyLimit(),
      today: state.runs.filter((r) => r.startedAt.startsWith(today())).length,
      running: state.runs.find((r) => r.state === "running") ?? null,
      challenges: state.challenges.map((c) => {
        const runs = state.runs.filter((r) => r.challengeId === c.id);
        return { ...c, tries: runs.length, wins: runs.filter((r) => r.state === "won").length, best: best(state, c.id), lastScore: runs.filter((r) => r.score !== null).pop()?.score ?? null };
      }),
      runs: state.runs.slice(-30).reverse()
    };
  },

  wins(): number {
    return read().runs.filter((r) => r.state === "won").length;
  },

  practising(): string | null {
    const state = read();
    const run = state.runs.find((r) => r.state === "running");
    return run ? state.challenges.find((c) => c.id === run.challengeId)?.title ?? run.challengeId : null;
  },

  setEnabled(enabled: boolean) {
    const state = read();
    state.enabled = enabled;
    write(state);
  },

  /** Starts one practice build now (the owner pressed the button, or the PC is idle). */
  practise(challengeId?: string, startedBy = "training-ground"): PracticeRun {
    const state = read();
    if (state.runs.some((r) => r.state === "running" && BuildService.isRunning(r.buildId))) throw new Error("It is already practising.");
    // A run left "running" by a restart is over.
    for (const r of state.runs) if (r.state === "running" && !BuildService.isRunning(r.buildId)) r.state = "stopped";
    const challenge = challengeId ? state.challenges.find((c) => c.id === challengeId) : pick(state);
    if (!challenge) throw new Error(challengeId ? "No such challenge." : "Every challenge is beaten — ask for harder ones.");
    const build = BuildService.start({
      projectName: `practice-${challenge.id}`,
      description: challenge.brief,
      profile: "fast",
      maxIterations: 4,
      qualityThreshold: 90,
      starter: "auto",
      startedBy
    });
    const run: PracticeRun = { id: `run_${Date.now().toString(36)}`, challengeId: challenge.id, buildId: build.buildId, startedAt: new Date().toISOString(), finishedAt: null, state: "running", score: null };
    state.runs.push(run);
    write(state);
    Logger.log("Practice started", { challenge: challenge.id, buildId: build.buildId });
    return run;
  },

  /** Asks the model for harder challenges than the ones it has. */
  async addHarder(count = 3): Promise<Challenge[]> {
    const state = read();
    const answer = await ModelRouter.generate(
      `You set practice challenges for an AI that builds web apps and games (React + TypeScript in the browser, no server).
It has these already: ${state.challenges.map((c) => `"${c.title}" (level ${c.level})`).join(", ")}.
Write ${count} new, harder ones (level 4-5): complete small products with clear rules that checks and tests can verify.
Answer with JSON only: [{"id": "<kebab-id>", "title": "<title>", "level": <4|5>, "brief": "<2-3 sentences: exactly what to build>"}]`
    );
    const start = answer.indexOf("[");
    const end = answer.lastIndexOf("]");
    let added: Challenge[] = [];
    try {
      added = (JSON.parse(answer.slice(start, end + 1)) as Array<Partial<Challenge>>)
        .filter((c) => typeof c.id === "string" && typeof c.brief === "string" && typeof c.title === "string")
        .map((c) => ({ id: c.id!.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40), title: c.title!.slice(0, 60), level: Math.min(5, Math.max(1, Number(c.level) || 4)), brief: c.brief!.slice(0, 600), source: "model" as const }))
        .filter((c) => !state.challenges.some((x) => x.id === c.id));
    } catch {
      added = [];
    }
    state.challenges.push(...added);
    write(state);
    return added;
  },

  /** One practice when the PC is idle. */
  async tick(): Promise<void> {
    const state = read();
    if (!state.enabled || !enabledByEnv() || GameMode.isOn()) return;
    if (BuildService.active().length > 0) return;
    if (OrderStore.list({ status: "accepted" }).length > 0) return;
    if (state.runs.filter((r) => r.startedAt.startsWith(today())).length >= dailyLimit()) return;
    if (!pick(state)) await TrainingGround.addHarder().catch(() => []);
    try {
      TrainingGround.practise();
    } catch (error) {
      Logger.warn("Practice could not start", { error: (error as Error)?.message });
    }
  },

  start(intervalMs = Number(process.env.GROUND_TICK_MS) || 20 * 60_000) {
    if (!wired) {
      wired = true;
      buildEvents.on("completed", (r: BuildRecord) => finished(r, "completed"));
      buildEvents.on("failed", (r: BuildRecord) => finished(r, "failed"));
      buildEvents.on("stopped", (r: BuildRecord) => finished(r, "stopped"));
    }
    if (timer) return;
    timer = setInterval(() => void TrainingGround.tick().catch(() => undefined), intervalMs);
    timer.unref?.();
  }
};
