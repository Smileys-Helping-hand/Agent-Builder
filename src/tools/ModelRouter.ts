import { OpenAIClient } from "./OpenAIClient.js";

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
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: targetModel,
      prompt,
      stream: false
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

export class ModelRouter {
  static async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const provider = options.provider ?? getProviderFromEnv();

    switch (provider) {
      case "ollama":
        return generateWithOllama(prompt, options.model);
      case "lmstudio":
        return generateWithLMStudio(prompt, options.model);
      case "openai":
      default:
        return OpenAIClient.generate(prompt, options.model);
    }
  }
}
