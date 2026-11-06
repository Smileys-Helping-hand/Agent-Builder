/** Saved progress and settings, in this browser. Never throws: private windows can refuse storage. */
const KEY = "game-save";

export interface SaveData {
  best: number;
  level: number;
  muted: boolean;
  [key: string]: unknown;
}

const empty = (): SaveData => ({ best: 0, level: 1, muted: false });

export function load(): SaveData {
  try {
    return { ...empty(), ...(JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<SaveData>) };
  } catch {
    return empty();
  }
}

export function save(changes: Partial<SaveData>): SaveData {
  const next = { ...load(), ...changes };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not saved; the game carries on.
  }
  return next;
}
