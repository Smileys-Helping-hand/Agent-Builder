import type { AutonomousConfig, BuildIteration } from "../orchestrator/AutonomousOrchestrator.js";

type FetchFn = typeof fetch;

let cachedFetch: FetchFn | undefined;

async function resolveFetch(): Promise<FetchFn> {
  if (typeof globalThis.fetch === "function") {
    return globalThis.fetch.bind(globalThis);
  }

  if (!cachedFetch) {
    const module = await import("node-fetch");
    const fetchImpl = (module.default ?? module) as unknown;
    cachedFetch = fetchImpl as FetchFn;
  }

  return cachedFetch;
}

export type AgentBuilderSDKOptions = {
  baseUrl?: string;
  token?: string;
};

const defaultBaseUrl = process.env.AGENT_BUILDER_API_URL ?? "http://localhost:4000";

export class AgentBuilderSDK {
  private readonly baseUrl: string;
  private readonly token?: string;

  constructor(options: AgentBuilderSDKOptions = {}) {
    this.baseUrl = options.baseUrl ?? defaultBaseUrl;
    this.token = options.token;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined)
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }
    const runtimeFetch = await resolveFetch();
    const response = await runtimeFetch(`${this.baseUrl}${path}`, { ...init, headers });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Request failed with status ${response.status}`);
    }
    if (response.status === 204) {
      return {} as T;
    }
    return (await response.json()) as T;
  }

  async trainAgent() {
    return this.request<{ message: string; datasetPath: string; provider: string }>("/api/train/start", { method: "POST" });
  }

  // --- Autonomous build: the verification/repair/ratchet pipeline (server/autonomous.ts) ---

  async startAutonomousBuild(config: AutonomousConfig) {
    return this.request<{ success: boolean; buildId: string; config: AutonomousConfig }>("/api/autonomous/start", {
      method: "POST",
      body: JSON.stringify(config)
    });
  }

  async getAutonomousStatus(buildId: string) {
    return this.request<{
      buildId: string;
      isRunning: boolean;
      isPaused: boolean;
      currentIteration: number;
      config: AutonomousConfig;
      iterations: BuildIteration[];
      latestQualityScore: number;
    }>(`/api/autonomous/${buildId}/status`);
  }

  async listActiveAutonomousBuilds() {
    return this.request<{ count: number; builds: Array<{ buildId: string; projectName: string; isRunning: boolean; isPaused: boolean; currentIteration: number; qualityScore: number }> }>(
      "/api/autonomous/active"
    );
  }

  async pauseAutonomousBuild(buildId: string) {
    return this.request<{ success: boolean; message: string; buildId: string }>(`/api/autonomous/${buildId}/pause`, { method: "POST" });
  }

  async resumeAutonomousBuild(buildId: string) {
    return this.request<{ success: boolean; message: string; buildId: string }>(`/api/autonomous/${buildId}/resume`, { method: "POST" });
  }

  async stopAutonomousBuild(buildId: string) {
    return this.request<{ success: boolean; message: string; buildId: string }>(`/api/autonomous/${buildId}/stop`, { method: "POST" });
  }
}
