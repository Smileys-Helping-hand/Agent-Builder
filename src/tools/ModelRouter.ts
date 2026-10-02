import { OpenAIClient } from "./OpenAIClient.js";
import { gpuLock } from "../utils/GpuLock.js";
import { ModelPerfLog } from "./ModelPerfLog.js";
import { buildActivity, currentBuild } from "../utils/BuildContext.js";
import { GameMode, GameModeOnError } from "../utils/GameMode.js";

export type ModelProvider = "openai" | "ollama" | "lmstudio";

type GenerateOptions = {
  provider?: ModelProvider;
  model?: string;
};

const getProviderFromEnv = (): ModelProvider => {
  const provider = (process.env.MODEL_PROVIDER ?? process.env.AI_PROVIDER ?? process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
  if (provider === "ollama" || provider === "lmstudio" || provider === "openai") {
    return provider;
  }
  return "ollama";
};

/** How much of the answer-in-progress to share, and how often. */
const THINKING_TAIL = 1800;
const THINKING_EVERY_MS = 350;

const positiveInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/**
 * Settings sent with every Ollama call. Anything that loads the model (the
 * warm-up button too) must send the same window, or Ollama reloads it.
 */
export const ollamaOptions = () => ({
  // Ollama's default window is 4096 tokens, and it silently drops the start
  // of a longer prompt: the instructions. Build prompts run to ~10k tokens.
  num_ctx: positiveInt(process.env.OLLAMA_NUM_CTX, 16384),
  // A ceiling on the answer, so a model that loses its way cannot hold the
  // GPU (and every build queued behind it) for ten minutes.
  num_predict: positiveInt(process.env.OLLAMA_NUM_PREDICT, 8192)
});

const generateWithOllama = async (prompt: string, model?: string): Promise<string> => {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
  const targetModel = model ?? process.env.OLLAMA_MODEL ?? process.env.MODEL ?? "qwen2.5-coder:7b";
  // Ollama unloads a model from VRAM 5 minutes after its last use by default.
  // Reloading weights between every generate() call is the largest avoidable
  // cost in an iterate-verify-repair loop that calls the model every few
  // seconds — keep_alive keeps it resident between calls.
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE ?? "30m";
  // Streamed, so a build can show its answer as it is written. The text
  // returned is exactly what a non-streamed call returned.
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: targetModel,
      prompt,
      stream: true,
      keep_alive: keepAlive,
      options: ollamaOptions()
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
    if (Date.now() - lastShared > THINKING_EVERY_MS) share(false);
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

const dispatch = (provider: ModelProvider, prompt: string, model?: string): Promise<string> => {
  switch (provider) {
    case "ollama":
      return generateWithOllama(prompt, model);
    case "lmstudio":
      return generateWithLMStudio(prompt, model);
    case "openai":
    default:
      return OpenAIClient.generate(prompt, model);
  }
};

export class ModelRouter {
  static async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const provider = options.provider ?? getProviderFromEnv();
    // Ollama/LM Studio share one local GPU queue; concurrent calls just
    // contend for it. OpenAI is a remote API with its own concurrency —
    // serializing those too would only add latency for no reason.
    const isLocalProvider = provider === "ollama" || provider === "lmstudio";
    // Game mode: the GPU belongs to the person at the keyboard.
    if (isLocalProvider && GameMode.isOn()) throw new GameModeOnError();

    const startedAt = Date.now();
    const response = isLocalProvider
      ? await gpuLock.run(() => dispatch(provider, prompt, options.model))
      : await dispatch(provider, prompt, options.model);

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
}
