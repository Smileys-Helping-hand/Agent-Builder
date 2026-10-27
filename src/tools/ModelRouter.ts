import { Agent, fetch as undiciFetch } from "undici";
import { OpenAIClient } from "./OpenAIClient.js";
import { AnthropicClient } from "./AnthropicClient.js";
import { GeminiClient, geminiConfigured } from "./GeminiClient.js";
import { BuildGate } from "../utils/BuildGate.js";
import { gpuLock, type GpuPriority } from "../utils/GpuLock.js";
import { ModelPerfLog } from "./ModelPerfLog.js";
import { buildActivity, currentBuild } from "../utils/BuildContext.js";
import { GameMode, GameModeOnError } from "../utils/GameMode.js";

export type ModelProvider = "openai" | "ollama" | "lmstudio" | "anthropic" | "gemini";
export type ModelRole = "code" | "visual" | "animation" | "3d" | "prompter" | "qa" | "general";

export type GenerateOptions = {
  provider?: ModelProvider;
  model?: string;
  role?: ModelRole;
  /** "interactive" when a person is waiting on the answer: it goes ahead of background work on the GPU. */
  priority?: GpuPriority;
  /** The answer so far, as it is written (local models; other providers call it once at the end). */
  onText?: (textSoFar: string) => void;
};

const asProvider = (value: string | undefined): ModelProvider | null => {
  const provider = (value ?? "").toLowerCase();
  return provider === "ollama" || provider === "lmstudio" || provider === "openai" || provider === "anthropic" || provider === "gemini" ? provider : null;
};

/**
 * Which model server answers this call. A customer order's build can have its
 * own (ORDER_MODEL_PROVIDER, e.g. Claude for client work) while everything else
 * stays on the local model; "same" or unset means no difference.
 */
export const getProviderFromEnv = (): ModelProvider => {
  const order = currentBuild()?.orderId ? asProvider(process.env.ORDER_MODEL_PROVIDER) : null;
  if (order) return order;
  return asProvider(process.env.MODEL_PROVIDER ?? process.env.AI_PROVIDER ?? process.env.LLM_PROVIDER) ?? "ollama";
};

/** How much of the answer-in-progress to share, and how often. */
const THINKING_TAIL = 1800;
const THINKING_EVERY_MS = 350;

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * The window a model is loaded with. The build model gets OLLAMA_NUM_CTX; any
 * other (the 14b that reviews stuck repairs) gets OLLAMA_REVIEW_NUM_CTX, 16384
 * unless set: its prompt is a few thousand tokens, and loading a 14b split
 * across an 8 GB card and RAM took 103 s at the build model's 32768 and 18 s
 * at 16384 — paid on every swap.
 */
const contextFor = (model?: string): number => {
  const main = positiveInt(process.env.OLLAMA_NUM_CTX, 16384);
  const buildModel = process.env.OLLAMA_MODEL ?? process.env.MODEL ?? "qwen2.5-coder:7b";
  if (!model || model === buildModel) return main;
  return Math.min(main, positiveInt(process.env.OLLAMA_REVIEW_NUM_CTX, 16384));
};

/**
 * Settings sent with every Ollama call. Anything that loads the model (the
 * warm-up button too) must send the same window, or Ollama reloads it.
 */
export const ollamaOptions = (model?: string) => ({
  // Ollama's default window is 4096 tokens, and it silently drops the start
  // of a longer prompt: the instructions. Build prompts run to ~10k tokens.
  num_ctx: contextFor(model),
  // A ceiling on the answer, so a model that loses its way cannot hold the
  // GPU (and every build queued behind it) for ten minutes.
  num_predict: positiveInt(process.env.OLLAMA_NUM_PREDICT, 8192),
  // How the model is split between the graphics card and RAM. Left out, Ollama
  // puts as many layers on the GPU as fit (28 of a 14b's 49 on 8 GB) and runs
  // the rest from RAM. A number forces that many: more than fit makes Windows
  // page the card's memory, and a load took ten minutes.
  ...(positiveInt(process.env.OLLAMA_NUM_GPU, 0) > 0 ? { num_gpu: positiveInt(process.env.OLLAMA_NUM_GPU, 0) } : {}),
  // CPU threads for the layers in RAM: the physical cores, unless set.
  ...(positiveInt(process.env.OLLAMA_NUM_THREAD, 0) > 0 ? { num_thread: positiveInt(process.env.OLLAMA_NUM_THREAD, 0) } : {})
});

/**
 * The local model server, waited on as long as it takes. Ollama sends nothing,
 * not even its headers, until the model is loaded and has read the prompt; a
 * 14B model half in RAM, reading a long prompt beside a build, took more than
 * five minutes, and Node's fetch gives up on headers after five: "fetch failed",
 * taken for the server being down, retried, and failed again the same way.
 */
const ollamaAgent = new Agent({ headersTimeout: 30 * 60_000, bodyTimeout: 30 * 60_000, connectTimeout: 30_000 });

const generateWithOllama = async (prompt: string, model?: string, onText?: (textSoFar: string) => void): Promise<string> => {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
  // A build can write with its own model (a site tailored from a template: SITE_BUILD_MODEL); a call that names one keeps it.
  const targetModel = model ?? currentBuild()?.model ?? process.env.OLLAMA_MODEL ?? process.env.MODEL ?? "qwen2.5-coder:7b";
  // Ollama unloads a model from VRAM 5 minutes after its last use by default.
  // Reloading weights between every generate() call is the largest avoidable
  // cost in an iterate-verify-repair loop that calls the model every few
  // seconds — keep_alive keeps it resident between calls.
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE ?? "30m";
  // Streamed, so a build can show its answer as it is written. The text
  // returned is exactly what a non-streamed call returned.
  const response = await undiciFetch(`${baseUrl}/api/generate`, {
    dispatcher: ollamaAgent,
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: targetModel,
      prompt,
      stream: true,
      keep_alive: keepAlive,
      options: ollamaOptions(targetModel)
    })
  });

  if (!response.ok || !response.body) {
    const message = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText} - ${message}`);
  }

  const scope = currentBuild();
  const started = Date.now();
  let text = "";
  let tokens = 0;
  let pending = "";
  let lastShared = 0;
  let lastTextAt = 0;
  const share = (done: boolean) => {
    if (!scope) return;
    const seconds = Math.max((Date.now() - started) / 1000, 0.001);
    buildActivity.emit("thinking", {
      buildId: scope.buildId,
      phase: scope.phase ?? "thinking",
      model: targetModel,
      tail: text.slice(-THINKING_TAIL),
      chars: text.length,
      tokensPerSecond: Math.round((tokens / seconds) * 10) / 10,
      done,
      at: new Date().toISOString()
    });
    lastShared = Date.now();
  };

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  // Ollama streams one JSON object per line: { response, done, ... }.
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    let newline = pending.indexOf("\n");
    while (newline >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      newline = pending.indexOf("\n");
      if (!line) continue;
      const chunk = JSON.parse(line) as { response?: string; error?: string };
      if (chunk.error) throw new Error(`Ollama: ${chunk.error}`);
      if (chunk.response) {
        text += chunk.response;
        tokens += 1;
      }
    }
    // share() only records the time inside a build, so the answer-so-far keeps its own clock.
    if (Date.now() - lastShared > THINKING_EVERY_MS) share(false);
    if (onText && Date.now() - lastTextAt > THINKING_EVERY_MS) {
      lastTextAt = Date.now();
      onText(text);
    }
  }
  if (pending.trim()) {
    const chunk = JSON.parse(pending) as { response?: string };
    text += chunk.response ?? "";
  }
  share(true);
  return text;
};

const generateWithLMStudio = async (prompt: string, model?: string): Promise<string> => {
  const baseUrl = process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234";
  const targetModel = model ?? process.env.LMSTUDIO_MODEL ?? "gpt-4o-mini";
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: targetModel,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`LM Studio request failed: ${response.status} ${response.statusText} - ${message}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
};

const dispatch = (provider: ModelProvider, prompt: string, model?: string, onText?: (textSoFar: string) => void): Promise<string> => {
  switch (provider) {
    case "ollama":
      return generateWithOllama(prompt, model, onText);
    case "lmstudio":
      return generateWithLMStudio(prompt, model);
    case "anthropic":
      return AnthropicClient.generate(prompt, model);
    case "gemini":
      return GeminiClient.generate(prompt, model);
    case "openai":
    default:
      return OpenAIClient.generate(prompt, model);
  }
};

/**
 * The model server for a specialist role in the multi-agent swarm.
 *
 * MODEL_PROVIDER_<ROLE> (+ MODEL_NAME_<ROLE>) picks one outright. Otherwise a
 * Gemini key is used for the visual, animation, 3D and prompt roles — adding
 * GEMINI_API_KEY is the opt-in. Anthropic/OpenAI keys are often in .env for
 * other things (embeddings), so they take over a role only with
 * ROLE_CLOUD_FALLBACK=true; without it every other role stays on the provider
 * Settings chose (MODEL_PROVIDER), and a local build never bills a cloud API.
 */
export const getProviderForRole = (role: ModelRole): { provider: ModelProvider; model?: string } => {
  const env = process.env;
  const cloudFallback = (env.ROLE_CLOUD_FALLBACK ?? "").toLowerCase() === "true";
  const cloud = (): { provider: ModelProvider; model?: string } | null => {
    if (!cloudFallback) return null;
    if (env.ANTHROPIC_API_KEY) return { provider: "anthropic", model: env.ANTHROPIC_MODEL };
    if (env.OPENAI_API_KEY) return { provider: "openai", model: env.OPENAI_MODEL };
    return null;
  };
  const gemini = (): { provider: ModelProvider; model?: string } | null =>
    geminiConfigured() ? { provider: "gemini", model: env.GEMINI_MODEL } : null;
  const settings = (): { provider: ModelProvider; model?: string } => ({ provider: getProviderFromEnv() });

  switch (role) {
    case "visual":
    case "animation": {
      const explicit = asProvider(env.MODEL_PROVIDER_VISUAL ?? env.MODEL_PROVIDER_ANIMATION);
      if (explicit) return { provider: explicit, model: env.MODEL_NAME_VISUAL ?? env.MODEL_NAME_ANIMATION };
      return gemini() ?? cloud() ?? settings();
    }
    case "3d": {
      const explicit = asProvider(env.MODEL_PROVIDER_3D);
      if (explicit) return { provider: explicit, model: env.MODEL_NAME_3D };
      return gemini() ?? cloud() ?? settings();
    }
    case "prompter": {
      const explicit = asProvider(env.MODEL_PROVIDER_PROMPTER ?? env.PROMPT_MODEL_PROVIDER);
      if (explicit) return { provider: explicit, model: env.MODEL_NAME_PROMPTER };
      return gemini() ?? cloud() ?? settings();
    }
    case "code": {
      // A customer order's ORDER_MODEL_PROVIDER is applied by settings() (getProviderFromEnv), only for orders.
      const explicit = asProvider(env.MODEL_PROVIDER_CODE);
      if (explicit) return { provider: explicit, model: env.MODEL_NAME_CODE };
      return cloud() ?? settings();
    }
    case "qa": {
      const explicit = asProvider(env.MODEL_PROVIDER_QA ?? env.REVIEW_MODEL_PROVIDER);
      if (explicit) return { provider: explicit, model: env.MODEL_NAME_QA };
      return cloud() ?? settings();
    }
    case "general":
    default:
      return settings();
  }
};

/** A local model server that is not there (stopped, restarting, crashed mid-answer), as opposed to one that answered badly. */
export const modelServerDown = (error: unknown): boolean => {
  const err = error as { message?: string; cause?: { code?: string; message?: string } } | undefined;
  const text = `${err?.message ?? ""} ${err?.cause?.code ?? ""} ${err?.cause?.message ?? ""}`;
  return /fetch failed|ECONNREFUSED|ECONNRESET|UND_ERR_SOCKET|socket hang up|other side closed|llama runner process has terminated|server busy|503/i.test(text);
};

export class ModelRouter {
  /**
   * A local call made while the model server is down waits for it instead of
   * failing at once. With Ollama stopped, every repair "failed" in a few
   * milliseconds and a build burned its eight passes in seven minutes, scoring
   * the same broken code each time; the launcher brings the server back within
   * a minute or two. Waits up to MODEL_WAIT_MS (10 minutes by default).
   */
  static async waitingOut<T>(call: () => Promise<T>, limitMs = Number(process.env.MODEL_WAIT_MS ?? 600_000), pauses = [5_000, 10_000, 20_000, 30_000]): Promise<T> {
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      try {
        return await call();
      } catch (error) {
        if (!modelServerDown(error) || Date.now() - started >= limitMs) throw error;
        const pause = pauses[Math.min(attempt, pauses.length - 1)];
        if (attempt === 0) console.warn(`[models] the local model server is not answering (${(error as Error)?.message ?? error}); waiting for it to come back`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(pause, Math.max(0, limitMs - (Date.now() - started)))));
      }
    }
  }

  static async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const provider = options.provider ?? getProviderFromEnv();
    // Ollama/LM Studio share one local GPU queue; concurrent calls just
    // contend for it. OpenAI is a remote API with its own concurrency —
    // serializing those too would only add latency for no reason.
    const isLocalProvider = provider === "ollama" || provider === "lmstudio";
    // Game mode: the GPU belongs to the person at the keyboard.
    if (isLocalProvider && GameMode.isOn()) throw new GameModeOnError();

    // A paused build, or practice while someone's build runs, waits here (BuildGate).
    if (isLocalProvider) await BuildGate.wait(currentBuild()?.buildId);
    const startedAt = Date.now();
    const response = isLocalProvider
      ? await ModelRouter.waitingOut(() => gpuLock.run(() => dispatch(provider, prompt, options.model, options.onText), options.priority))
      : await dispatch(provider, prompt, options.model, options.onText);
    options.onText?.(response);

    void ModelPerfLog.record({
      timestamp: new Date().toISOString(),
      provider,
      model: options.model ?? "(default)",
      durationMs: Date.now() - startedAt,
      promptChars: prompt.length,
      responseChars: response.length
    });

    return response;
  }

  /**
   * Generates output using the specialized model/provider assigned to this role
   * (e.g. code specialist vs visual/animation specialist vs 3D asset specialist).
   */
  static async generateForRole(role: ModelRole, prompt: string, options: GenerateOptions = {}): Promise<string> {
    const resolved = getProviderForRole(role);
    const provider = options.provider ?? resolved.provider;
    const model = options.model ?? resolved.model;
    return ModelRouter.generate(prompt, { ...options, provider, model, role });
  }
}
