/**
 * Local AI only: every model call runs on hardware the owner controls.
 *
 * LOCAL_AI_ONLY is on unless set to "false". While it is on:
 *   - the model router refuses OpenAI, Anthropic and Gemini outright, with an
 *     error that says so (no silent fallback anywhere: a role that names a
 *     cloud provider, a customer order's provider, Settings — all refused);
 *   - getProviderForRole and getProviderFromEnv only ever answer a local one.
 *
 * RESEARCH_OFFLINE=true is the separate switch for the internet itself:
 * research does not search or fetch anything, so nothing leaves the PC.
 *
 * aiPolicy() states plainly what is local, what reaches the internet, and why.
 */
import { OLLAMA_URL } from "../utils/Ollama.js";

export type AnyProvider = "openai" | "ollama" | "lmstudio" | "anthropic" | "gemini";

export const LOCAL_PROVIDERS: AnyProvider[] = ["ollama", "lmstudio"];

export const localOnly = (): boolean => (process.env.LOCAL_AI_ONLY ?? "true").trim().toLowerCase() !== "false";

export const researchOffline = (): boolean => (process.env.RESEARCH_OFFLINE ?? "").trim().toLowerCase() === "true";

export const isLocalProvider = (provider: string): boolean => LOCAL_PROVIDERS.includes(provider as AnyProvider);

export class CloudInferenceRefused extends Error {
  constructor(provider: string) {
    super(`Refused: this would send the request to ${provider}, a cloud AI service, and Agent Builder runs AI locally only (LOCAL_AI_ONLY). Use the local model, or set LOCAL_AI_ONLY=false in .env to allow cloud models.`);
    this.name = "CloudInferenceRefused";
  }
}

export class ResearchOffline extends Error {
  constructor() {
    super("Research is offline (RESEARCH_OFFLINE=true): nothing is searched or fetched from the internet.");
    this.name = "ResearchOffline";
  }
}

export const aiPolicy = () => {
  const lmstudio = process.env.LMSTUDIO_BASE_URL || "http://localhost:1234";
  return {
    localOnly: localOnly(),
    researchOffline: researchOffline(),
    inference: localOnly()
      ? [`Local model server (Ollama) at ${OLLAMA_URL}`, `LM Studio at ${lmstudio}, if it is chosen`]
      : [`Local model server (Ollama) at ${OLLAMA_URL}`, "Cloud models are allowed where Settings or a role names one (LOCAL_AI_ONLY=false)"],
    internet: researchOffline()
      ? ["Nothing: research is offline"]
      : ["Research reads public sources (Wikipedia, OpenAlex, Europe PMC, arXiv, GitHub, Hacker News, the web) and the local model processes what it reads", "Ordinary integrations: GitHub, the business site, the Cloudflare tunnel, Jarvis — no AI runs there"],
    cloudKeysPresent: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"].filter((key) => Boolean(process.env[key]?.trim())),
    note: localOnly() ? "Cloud AI keys in .env are ignored for model calls while LOCAL_AI_ONLY is on." : "LOCAL_AI_ONLY=false: a cloud model is used only where one is explicitly chosen."
  };
};
