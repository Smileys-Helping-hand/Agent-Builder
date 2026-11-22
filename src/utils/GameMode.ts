/**
 * GameMode — the "I want my PC back" switch, and the scheduler's hold.
 *
 * While it is on, nothing in Agent Builder uses the graphics card: running
 * builds and research are paused, new ones wait, and the model server is shut
 * down so nothing (Jarvis included) can load a model back into VRAM mid-game.
 * The launcher reads the same file and leaves the model server off.
 *
 * `hold` is the lighter switch ("stop new background jobs until further
 * notice", and the Quiet profile): nothing new starts in the background, but
 * the model stays usable for whatever the person asks directly. Background
 * loops ask `GameMode.paused()`, which is true for either.
 *
 * Kept in data/game-mode.json so it survives restarts. This module only holds
 * the state and has no heavy imports, so the model router, the order pipeline
 * and the Ollama helper can all ask it without import cycles; switching it on
 * and off lives in system/ResourceModes.ts (server/gameMode.ts keeps the old
 * routes on top of it).
 */
import fs from "fs";
import path from "path";

/** What one switch did to one workload, for the report and for putting it back. */
export interface WorkloadAction {
  id: string;
  label: string;
  /** paused/stopped/lowered: done and will be undone on resume; running: left alone, with why; failed: tried, with why. */
  outcome: "paused" | "stopped" | "lowered" | "running" | "failed" | "not-running";
  detail: string;
  /** What resume needs to undo it exactly (ids, previous priorities, torrent hashes). */
  undo?: Record<string, unknown>;
}

export interface ResourceSnapshot {
  at: string;
  cpuPercent: number | null;
  ramAvailableMB: number | null;
  vramUsedMB: number | null;
  gpuPercent: number | null;
  /** The busiest disk's idle time, and which. */
  busiestDisk: { letter: string; idlePercent: number } | null;
}

export interface ModeReport {
  profile: string;
  startedAt: string;
  finishedAt: string | null;
  actions: WorkloadAction[];
  before: ResourceSnapshot | null;
  after: ResourceSnapshot | null;
}

export interface ResumeProgress {
  startedAt: string;
  finishedAt: string | null;
  steps: Array<{ id: string; label: string; state: "waiting" | "done" | "failed" | "skipped"; detail: string; at: string | null }>;
}

export interface GameModeState {
  on: boolean;
  since: string | null;
  /** What switching on paused, so switching off resumes exactly that. */
  pausedBuilds: string[];
  pausedTopics: string[];
  /** Other services on the PC the pause stopped (Host Manager ids), started again on resume. */
  stoppedServices: string[];
  /** No new background jobs (Quiet profile, or "stop new background jobs until further notice"). */
  hold?: boolean;
  /** The profile in force (normal when nothing is). */
  profile?: string;
  /** Who switched it: "app", "jarvis", "detected: <game>". */
  activatedBy?: string | null;
  /** The game that is running, when one was detected. */
  game?: { name: string; exe: string; since: string } | null;
  report?: ModeReport | null;
  resume?: ResumeProgress | null;
}

const FILE = path.resolve(process.env.GAME_MODE_PATH ?? "./data/game-mode.json");
const OFF: GameModeState = { on: false, since: null, pausedBuilds: [], pausedTopics: [], stoppedServices: [], hold: false, profile: "normal", activatedBy: null, game: null, report: null, resume: null };

let cache: GameModeState | null = null;

export const GameMode = {
  read(): GameModeState {
    if (!cache) {
      try {
        cache = { ...OFF, ...(JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<GameModeState>) };
      } catch {
        cache = { ...OFF };
      }
    }
    return cache;
  },

  /** The graphics card is the person's: no local model calls at all. */
  isOn(): boolean {
    return GameMode.read().on;
  },

  /** Background work should not start anything new: game mode, a hold, or a resume still in progress. */
  paused(): boolean {
    const state = GameMode.read();
    return state.on || state.hold === true;
  },

  write(state: GameModeState): GameModeState {
    cache = state;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    const temp = `${FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, FILE);
    return state;
  },

  patch(changes: Partial<GameModeState>): GameModeState {
    return GameMode.write({ ...GameMode.read(), ...changes });
  },

  /** Back to normal, keeping the last report and resume progress to show. */
  off(): GameModeState {
    const { report, resume } = GameMode.read();
    return GameMode.write({ ...OFF, report: report ?? null, resume: resume ?? null });
  }
};

/** Thrown when something asks for the local model while game mode is on. */
export class GameModeOnError extends Error {
  constructor() {
    super("Game mode is on: the graphics card is free for you. Switch it off to build or research again.");
    this.name = "GameModeOnError";
  }
}
