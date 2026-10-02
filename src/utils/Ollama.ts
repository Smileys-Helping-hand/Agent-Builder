/**
 * Ollama — the local model server every build talks to. Finding it, asking
 * whether it is up, and starting it when it is not, so that opening the app and
 * pressing Build works even when nobody remembered to start Ollama first.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { Logger } from "./Logger.js";
import { GameMode } from "./GameMode.js";

export const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434";

export type OllamaState = "up" | "down" | "degraded";

/** Where Ollama is installed, for starting it when it is not running. */
export const ollamaBinary = (): string | null => {
  const candidates = [
    process.env.OLLAMA_PATH,
    path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
    "C:/Program Files/Ollama/ollama.exe",
    "/usr/local/bin/ollama",
    "/usr/bin/ollama"
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

export const checkOllama = async (): Promise<{ state: OllamaState; detail: string; models: string[] }> => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { state: "degraded", detail: `Answered ${response.status}`, models: [] };
    const body = (await response.json()) as { models?: Array<{ name: string }> };
    const models = (body.models ?? []).map((model) => model.name);
    return {
      state: models.length > 0 ? "up" : "degraded",
      detail: models.length > 0 ? `${models.length} model(s) available` : "Running, but no models are installed",
      models
    };
  } catch {
    return { state: "down", detail: "Not reachable", models: [] };
  }
};

let starting: Promise<boolean> | null = null;

/**
 * Make sure Ollama is answering, starting it if it is installed but not
 * running. Resolves true when it answers. Concurrent callers share one start.
 */
export const ensureOllama = async (waitMs = 20_000): Promise<boolean> => {
  if ((await checkOllama()).state !== "down") return true;
  // Game mode keeps the model server off on purpose; do not start it behind the gamer's back.
  if (GameMode.isOn()) return false;
  if (starting) return starting;

  starting = (async () => {
    const binary = ollamaBinary();
    if (!binary) {
      Logger.warn("Ollama is not running and is not installed where expected; set OLLAMA_PATH");
      return false;
    }
    Logger.log("Ollama was not running; starting it", { binary });
    try {
      // Detached: it must outlive whatever asked for it.
      const child = spawn(binary, ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
    } catch (error) {
      Logger.error("Could not start Ollama", { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
    for (let waited = 0; waited < waitMs; waited += 750) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      if ((await checkOllama()).state !== "down") return true;
    }
    return false;
  })();

  try {
    return await starting;
  } finally {
    starting = null;
  }
};
