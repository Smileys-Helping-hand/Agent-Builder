"use client";

/**
 * Small, forgiving wrappers over localStorage. Storage can be full, disabled
 * (private mode) or throw on access, and none of that may break a screen: a
 * failed read is simply "nothing saved", a failed write is dropped.
 */

const PREFIX = "agent-builder.";

export const readJson = <T,>(key: string): T | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const writeJson = (key: string, value: unknown): void => {
  if (typeof window === "undefined") return;
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(PREFIX + key);
    else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Full or blocked; the screen still works from memory.
  }
};

/** Cached answers are per machine, so switching to another PC never shows the old one's data. */
export const machineScope = (): string => {
  const address = readRaw("address") ?? "none";
  return address.replace(/^https?:\/\//, "").replace(/[^a-z0-9.:-]/gi, "_");
};

const readRaw = (key: string): string | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
};

/** Drop every cached answer (on forgetting a machine). */
export const clearCache = (): void => {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith(`${PREFIX}cache.`)) keys.push(key);
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    // Nothing to do.
  }
};
