/**
 * AnthropicClient — Claude, for when the local model is not enough.
 *
 * Opt-in: nothing uses it unless MODEL_PROVIDER (every build) or
 * ORDER_MODEL_PROVIDER (customer orders only) is set to "anthropic" and
 * ANTHROPIC_API_KEY is in the PC's .env. The key is never shown or settable
 * from the app. Plain HTTPS to the Messages API, no SDK.
 *
 *   ANTHROPIC_API_KEY   required
 *   ANTHROPIC_MODEL     default claude-sonnet-5-5
 *   ANTHROPIC_MAX_TOKENS default 16000 (a whole small app in one answer)
 */
const API = "https://api.anthropic.com/v1/messages";

export const anthropicConfigured = (): boolean => Boolean(process.env.ANTHROPIC_API_KEY?.trim());

export class AnthropicClient {
  static async generate(prompt: string, model?: string): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("Claude is selected but ANTHROPIC_API_KEY is not set in the PC's .env file.");
    }
    const maxTokens = Number(process.env.ANTHROPIC_MAX_TOKENS) > 0 ? Number(process.env.ANTHROPIC_MAX_TOKENS) : 16000;
    // A local model name (qwen2.5-coder:7b) passed through is not a Claude model.
    const chosen = model && model.startsWith("claude") ? model : process.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-5-5";

    let lastError = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const response = await fetch(API, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: chosen,
          max_tokens: maxTokens,
          messages: [{ role: "user", content: prompt }]
        }),
        signal: AbortSignal.timeout(10 * 60 * 1000)
      }).catch((error: unknown) => {
        lastError = error instanceof Error ? error.message : String(error);
        return null;
      });

      if (response?.ok) {
        const body = (await response.json()) as { content?: Array<{ type: string; text?: string }> };
        return (body.content ?? [])
          .filter((block) => block.type === "text" && typeof block.text === "string")
          .map((block) => block.text)
          .join("");
      }
      if (response) {
        lastError = `${response.status} ${(await response.text().catch(() => "")).slice(0, 300)}`;
        // Wrong key or a bad request will not fix itself by retrying.
        if (response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404) break;
      }
      // Rate limited or overloaded: wait and try again.
      await new Promise((resolve) => setTimeout(resolve, 4000 * attempt));
    }
    throw new Error(`Claude request failed: ${lastError}`);
  }
}
