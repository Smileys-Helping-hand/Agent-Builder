/**
 * GameMode — the "I want my PC back" switch.
 *
 * While it is on, nothing in Agent Builder uses the graphics card: running
 * builds and research are paused, new ones wait, and the model server is shut
 * down so nothing (Jarvis included) can load a model back into VRAM mid-game.
 * The launcher reads the same file and leaves the model server off.
 *
 * Kept in data/game-mode.json so it survives restarts. This module only holds
 * the state and has no heavy imports, so the model router, the order pipeline
 * and the Ollama helper can all ask it without import cycles; switching it on
 * and off lives in server/gameMode.ts.
 */
import fs from "fs";
import path from "path";

export interface GameModeState {
  on: boolean;
  since: string | null;
  /** What switching on paused, so switching off resumes exactly that. */
  pausedBuilds: string[];
  pausedTopics: string[];
}

const FILE = path.resolve(process.env.GAME_MODE_PATH ?? "./data/game-mode.json");
const OFF: GameModeState = { on: false, since: null, pausedBuilds: [], pausedTopics: [] };

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

  isOn(): boolean {
    return GameMode.read().on;
  },

  write(state: GameModeState): GameModeState {
    cache = state;
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state, null, 2));
    return state;
  },

  off(): GameModeState {
    return GameMode.write({ ...OFF });
  }
};

/** Thrown when something asks for the local model while game mode is on. */
export class GameModeOnError extends Error {
  constructor() {
    super("Game mode is on: the graphics card is free for you. Switch it off to build or research again.");
    this.name = "GameModeOnError";
  }
}
