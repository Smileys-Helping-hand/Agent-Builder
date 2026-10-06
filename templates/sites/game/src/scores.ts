/**
 * A high-score table kept in the browser: the best scores, highest first,
 * each with a name and an optional detail ("Level 3", "Wave 5"). Games built
 * on this engine use it for a leaderboard or "hall of fame" instead of
 * storing their own records (a ScoreEntry is not the player or the game
 * state: it is what a finished game is remembered by).
 *
 * Storage can be blocked (private windows, sandboxed previews): then the
 * table is kept in memory for the session and nothing throws.
 */

export interface ScoreEntry {
  name: string;
  score: number;
  /** Anything worth showing beside the score: "Level 3", "Wave 5", "Floor 2". */
  detail?: string;
  /** When it was set, as an ISO date. */
  at: string;
}

/** Where the table is kept, unless a game names its own key. */
export const SCORES_KEY = "high-scores";

/** How many entries the table keeps. */
export const MAX_SCORES = 10;

/** Kept in memory when the browser has no storage, so the table still works for the session. */
const memory = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, value),
  removeItem: (key: string) => void memory.delete(key),
};

function storage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  try {
    if (typeof localStorage !== "undefined" && localStorage) return localStorage;
  } catch {
    // Blocked: fall back to memory.
  }
  return memoryStorage;
}

/** The saved table, best first. Empty when there is none or it cannot be read. */
export function loadScores(key: string = SCORES_KEY): ScoreEntry[] {
  try {
    const raw = storage().getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is ScoreEntry => typeof entry?.name === "string" && typeof entry?.score === "number")
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_SCORES);
  } catch {
    return [];
  }
}

/**
 * Add a finished game's score and keep the best MAX_SCORES. Returns the new
 * table and the entry's place in it (1 = top), or 0 when it did not make it.
 */
export function addScore(entry: { name: string; score: number; detail?: string; at?: string }, key: string = SCORES_KEY): { scores: ScoreEntry[]; place: number } {
  const added: ScoreEntry = { name: entry.name.trim() || "Player", score: Math.round(entry.score), detail: entry.detail, at: entry.at ?? new Date().toISOString() };
  const scores = [...loadScores(key), added].sort((a, b) => b.score - a.score).slice(0, MAX_SCORES);
  try {
    storage().setItem(key, JSON.stringify(scores));
  } catch {
    // Full or blocked: the table still comes back for this session.
  }
  const place = scores.indexOf(added) + 1;
  return { scores, place };
}

/** The best score so far, or 0. */
export function bestScore(key: string = SCORES_KEY): number {
  return loadScores(key)[0]?.score ?? 0;
}

/** Empty the table. */
export function clearScores(key: string = SCORES_KEY): void {
  try {
    storage().removeItem(key);
  } catch {
    // Nothing to clear.
  }
}
