import { OpenAIClient } from "./OpenAIClient.js";
import { gpuLock } from "../utils/GpuLock.js";
import { ModelPerfLog } from "./ModelPerfLog.js";

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

const generateWithOllama = async (prompt: string, model?: string): Promise<string> => {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
  const targetModel = model ?? process.env.OLLAMA_MODEL ?? process.env.MODEL ?? "qwen2.5-coder:7b";
  // Ollama unloads a model from VRAM 5 minutes after its last use by default.
  // Reloading weights between every generate() call is the largest avoidable
  // cost in an iterate-verify-repair loop that calls the model every few
  // seconds — keep_alive keeps it resident between calls.
  const keepAlive = process.env.OLLAMA_KEEP_ALIVE ?? "30m";
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: targetModel,
      prompt,
      stream: false,
      keep_alive: keepAlive
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText} - ${message}`);
  }

  const data = (await response.json()) as { response?: string; output?: string };
  return data.response ?? data.output ?? "";
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
