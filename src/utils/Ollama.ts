/**
 * Ollama — the local model server every build talks to. Finding it, asking
 * whether it is up, and starting it when it is not, so that opening the app and
 * pressing Build works even when nobody remembered to start Ollama first.
 */
import { execFile, spawn } from "child_process";
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

/**
 * How the model server itself is set up. These are read once when Ollama
 * starts, so every start (here, the power button, the launcher) passes them:
 *
 *   flash attention + an 8-bit KV cache halve what the context window costs,
 *   which leaves more of the model's layers on the GPU. A 14b on an 8 GB card
 *   measured 28 of 49 layers on the GPU this way; the rest run from RAM.
 *
 *   The context window is the builder's own (OLLAMA_NUM_CTX), so a caller that
 *   cannot ask for one (Jarvis, through the OpenAI-style endpoint) gets the
 *   same window and Ollama does not reload the model each time they take turns.
 */
export const ollamaServerEnv = (): Record<string, string> => ({
  OLLAMA_FLASH_ATTENTION: process.env.OLLAMA_FLASH_ATTENTION === "false" ? "0" : "1",
  OLLAMA_KV_CACHE_TYPE: process.env.OLLAMA_KV_CACHE_TYPE?.trim() || "q8_0",
  OLLAMA_CONTEXT_LENGTH: process.env.OLLAMA_NUM_CTX?.trim() || "16384",
  // One model at a time on one card: a second one would push the first off the GPU.
  OLLAMA_MAX_LOADED_MODELS: process.env.OLLAMA_MAX_LOADED_MODELS?.trim() || "1"
});

/** Start the model server, detached, with the server settings above. */
export const spawnOllama = (binary: string): void => {
  // Detached: it must outlive whatever asked for it.
  const child = spawn(binary, ["serve"], { detached: true, stdio: "ignore", windowsHide: true, env: { ...process.env, ...ollamaServerEnv() } });
  child.unref();
};

/** Which models are loaded, and how much of each sits on the GPU versus in RAM. */
export const loadedModels = async (): Promise<Array<{ name: string; totalGB: number; gpuGB: number; ramGB: number; onGpuPercent: number; context: number | null; until: string | null }>> => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return [];
    const body = (await response.json()) as { models?: Array<{ name: string; size: number; size_vram: number; context_length?: number; expires_at?: string }> };
    const gb = (bytes: number) => Math.round((bytes / 1e9) * 10) / 10;
    return (body.models ?? []).map((model) => ({
      name: model.name,
      totalGB: gb(model.size),
      gpuGB: gb(model.size_vram),
      ramGB: gb(Math.max(0, model.size - model.size_vram)),
      onGpuPercent: model.size > 0 ? Math.round((model.size_vram / model.size) * 100) : 0,
      context: model.context_length ?? null,
      until: model.expires_at ?? null
    }));
  } catch {
    return [];
  }
};

/**
 * Stop the model server and start it again, so changed server settings
 * (flash attention, KV cache, context window) take effect.
 */
export const restartOllama = async (waitMs = 30_000): Promise<boolean> => {
  const binary = ollamaBinary();
  if (!binary) return false;
  if (process.platform === "win32") {
    for (const image of ["ollama.exe", "llama-server.exe"]) {
      await new Promise<void>((resolve) => execFile("taskkill", ["/F", "/IM", image], { windowsHide: true, timeout: 10_000 }, () => resolve()));
    }
  } else {
    await new Promise<void>((resolve) => execFile("pkill", ["-f", "ollama serve"], () => resolve()));
  }
  for (let waited = 0; waited < 10_000 && (await checkOllama()).state !== "down"; waited += 500) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  spawnOllama(binary);
  for (let waited = 0; waited < waitMs; waited += 750) {
    await new Promise((resolve) => setTimeout(resolve, 750));
    if ((await checkOllama()).state !== "down") return true;
  }
  return false;
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
      spawnOllama(binary);
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
