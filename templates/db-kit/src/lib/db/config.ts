/**
 * Which database the app uses, and its keys. In order:
 *   1. .env.local (VITE_DB_PROVIDER plus that platform's VITE_* keys) — permanent, baked in at build time
 *   2. what was saved from the "Connect a database" panel (this browser) — for trying a platform out
 *   3. nothing: this browser's own storage ("local"), so the app works with no setup at all
 */
import { PLATFORMS, platform, type PlatformId } from "./platforms";

export interface DbConfig {
  provider: PlatformId;
  values: Record<string, string>;
  /** Where the settings came from. */
  source: "env" | "browser" | "default";
}

const STORAGE_KEY = "ab-db-config";

const env = (name: string): string => {
  const value = (import.meta.env as Record<string, string | undefined>)[name];
  return typeof value === "string" ? value.trim() : "";
};

/** A platform's keys are all there (optional ones aside). */
export const complete = (provider: PlatformId, values: Record<string, string>): boolean =>
  platform(provider).fields.every((field) => field.optional || Boolean(values[field.key]?.trim()));

export const loadConfig = (): DbConfig => {
  const chosen = env("VITE_DB_PROVIDER") as PlatformId;
  if (chosen && PLATFORMS.some((p) => p.id === chosen)) {
    const values = Object.fromEntries(platform(chosen).fields.map((field) => [field.key, env(field.env)]));
    if (complete(chosen, values)) return { provider: chosen, values, source: "env" };
  }
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { provider?: PlatformId; values?: Record<string, string> } | null;
    if (saved?.provider && PLATFORMS.some((p) => p.id === saved.provider) && complete(saved.provider, saved.values ?? {})) {
      return { provider: saved.provider, values: saved.values ?? {}, source: "browser" };
    }
  } catch {
    // Private windows can refuse storage: fall through to the default.
  }
  return { provider: "local", values: {}, source: "default" };
};

export const saveConfig = (provider: PlatformId, values: Record<string, string>) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ provider, values }));
};

export const clearConfig = () => localStorage.removeItem(STORAGE_KEY);

/** The lines to put in .env.local to make this choice permanent. */
export const envLines = (provider: PlatformId, values: Record<string, string>): string =>
  [`VITE_DB_PROVIDER=${provider}`, ...platform(provider).fields.map((field) => `${field.env}=${values[field.key] ?? ""}`)].join("\n");
