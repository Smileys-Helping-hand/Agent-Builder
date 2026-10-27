/**
 * GeminiClient — Google Gemini API for multimodal vision, animation, and fast reasoning.
 *
 * Opt-in: reads GEMINI_API_KEY (or GOOGLE_API_KEY) from environment or .env.
 * Uses native fetch to call the Google Generative Language REST API directly,
 * with no external SDK dependencies.
 *
 * Model: GEMINI_MODEL, else "gemini-flash-latest". Google retires model IDs
 * (gemini-1.5-* went in 2025, gemini-2.0-flash on 2026-06-01) and a retired ID
 * answers 404; the -latest alias is the one name that follows the current
 * Flash. Pin a version (e.g. gemini-3.8-flash, gemini-3.1-pro-preview) in
 * GEMINI_MODEL when a build must not change under you.
 */
import dotenv from "dotenv";
dotenv.config();

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_DEFAULT_MODEL = "gemini-flash-latest";

export const geminiConfigured = (): boolean =>
  Boolean((process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim());

export interface GeminiOptions {
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string;
}

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
};

/** An answer that will not get better by asking again (bad key, retired model, blocked prompt). */
class GeminiRejected extends Error {}

export class GeminiClient {
  static getApiKey(): string | null {
    return (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY)?.trim() || null;
  }

  static modelName(model?: string): string {
    const name = model?.trim() || process.env.GEMINI_MODEL?.trim() || GEMINI_DEFAULT_MODEL;
    return name.startsWith("models/") ? name.slice(7) : name;
  }

  /** The models this key can call — the live check that a key and model name are good. */
  static async listModels(): Promise<string[]> {
    const apiKey = GeminiClient.getApiKey();
    if (!apiKey) throw new Error("GEMINI_API_KEY (or GOOGLE_API_KEY) is not set in the .env file.");
    const response = await fetch(`${API_BASE}/models?pageSize=200`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Gemini model list failed (${response.status}): ${(await response.text().catch(() => "")).slice(0, 300)}`);
    const data = (await response.json()) as { models?: Array<{ name?: string; supportedGenerationMethods?: string[] }> };
    return (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => (m.name ?? "").replace(/^models\//, ""))
      .filter(Boolean);
  }

  static async generate(prompt: string, modelOrOptions?: string | GeminiOptions): Promise<string> {
    const apiKey = GeminiClient.getApiKey();
    if (!apiKey) {
      throw new Error("Gemini is selected but GEMINI_API_KEY (or GOOGLE_API_KEY) is not set in the .env file.");
    }

    const options: GeminiOptions =
      typeof modelOrOptions === "string"
        ? { model: modelOrOptions }
        : modelOrOptions ?? {};

    const model = GeminiClient.modelName(options.model);
    // The key goes in a header, not the URL: URLs end up in proxy and error logs.
    const url = `${API_BASE}/models/${encodeURIComponent(model)}:generateContent`;

    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        // Gemini 3.6+ ignores temperature; older models still use it.
        temperature: options.temperature ?? 0.7,
        // Thinking models spend part of this on reasoning before the answer;
        // at 8192 a long file could come back cut off or empty.
        maxOutputTokens: options.maxOutputTokens ?? Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 32768)
      }
    };

    if (options.systemInstruction) {
      body.systemInstruction = { parts: [{ text: options.systemInstruction }] };
    }

    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(Number(process.env.GEMINI_TIMEOUT_MS ?? 300_000))
        });

        if (response.ok) {
          const data = (await response.json()) as GeminiResponse;
          if (data.error) throw new GeminiRejected(`Gemini API error: ${data.error.message}`);
          if (data.promptFeedback?.blockReason) {
            throw new GeminiRejected(`Gemini blocked the prompt (${data.promptFeedback.blockReason}).`);
          }

          const candidate = data.candidates?.[0];
          // Thought summaries (thought: true) are reasoning, not the answer.
          const text = candidate?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? "").join("") ?? "";
          if (!text.trim()) {
            // An empty answer is a failure, not a result: the callers parse it
            // as "the model wrote nothing" and quietly use canned output.
            throw new GeminiRejected(`Gemini (${model}) returned no text (finishReason: ${candidate?.finishReason ?? "none"}).`);
          }
          if (candidate?.finishReason === "MAX_TOKENS") {
            console.warn(`[gemini] ${model} hit maxOutputTokens; the answer is cut off. Raise GEMINI_MAX_OUTPUT_TOKENS.`);
          }
          return text;
        }

        const errText = await response.text().catch(() => "");
        lastError = `${response.status} ${errText.slice(0, 300)}`;

        if (response.status === 404) {
          throw new GeminiRejected(
            `Gemini model "${model}" was not found (404) — it may have been retired. Set GEMINI_MODEL to a current one (default: ${GEMINI_DEFAULT_MODEL}). ${errText.slice(0, 200)}`
          );
        }
        // Bad request or bad key: asking again gets the same answer.
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw new GeminiRejected(`Gemini API rejected request (${lastError})`);
        }
      } catch (err: any) {
        if (err instanceof GeminiRejected) throw err;
        lastError = err?.message ?? String(err);
      }

      // 429 / 5xx / network: back off and try again.
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }

    throw new Error(`Gemini generation failed after 3 attempts: ${lastError}`);
  }
}
