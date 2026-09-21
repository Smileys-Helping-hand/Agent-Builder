"use client";

/**
 * Talking to your machine.
 *
 * The address and key live in this browser only (localStorage) and every request
 * goes straight from your device to your machine — nothing passes through the
 * host this page was served from. That is why the hosted build is static: there
 * is no server here to leak anything.
 */

const ADDRESS_KEY = "agent-builder.address";
const SECRET_KEY = "agent-builder.key";

export interface Connection {
  address: string;
  key: string;
}

export const loadConnection = (): Connection | null => {
  if (typeof window === "undefined") return null;
  try {
    const address = window.localStorage.getItem(ADDRESS_KEY);
    const key = window.localStorage.getItem(SECRET_KEY);
    return address && key ? { address, key } : null;
  } catch {
    return null;
  }
};

export const saveConnection = (connection: Connection): void => {
  const address = connection.address.trim().replace(/\/+$/, "");
  window.localStorage.setItem(ADDRESS_KEY, address);
  window.localStorage.setItem(SECRET_KEY, connection.key.trim());
};

export const clearConnection = (): void => {
  window.localStorage.removeItem(ADDRESS_KEY);
  window.localStorage.removeItem(SECRET_KEY);
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const request = async <T>(path: string, init: RequestInit = {}, timeoutMs = 20000): Promise<T> => {
  const connection = loadConnection();
  if (!connection) throw new ApiError("Not connected to a machine yet.", 0);

  const headers: Record<string, string> = {
    "x-agent-key": connection.key,
    ...((init.headers as Record<string, string>) ?? {})
  };
  if (init.body) headers["Content-Type"] = "application/json";

  let response: Response;
  try {
    response = await fetch(`${connection.address}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    // A network failure here almost always means the machine is asleep, the
    // tunnel is down, or you are off the VPN — say so rather than "fetch failed".
    throw new ApiError(
      error instanceof Error && error.name === "TimeoutError"
        ? "Your machine did not answer in time."
        : "Could not reach your machine. Is it awake, and are you on the same network or VPN?",
      0
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new ApiError("Your key was rejected. Check it in Settings.", response.status);
  }
  const text = await response.text();
  const body = text ? safeJson(text) : null;
  if (!response.ok) {
    throw new ApiError((body as { error?: string })?.error ?? `Request failed (${response.status})`, response.status);
  }
  return (body ?? {}) as T;
};

const safeJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

export interface ServiceReport {
  id: string;
  label: string;
  state: "up" | "down" | "degraded" | "unknown";
  detail: string;
  canStart: boolean;
}

export interface StatusResponse {
  services: ServiceReport[];
  /** Set when the launcher opened a tunnel, so the app can show where it is reachable. */
  publicUrl?: string | null;
  gpu: string;
  disk: string;
  host: string;
  counts: { projects: number; openIssues: number; errors: number };
  research: { running: number; topics: number; findings: number };
  healthy: boolean;
}

export interface FeedEntry {
  id: string;
  at: string;
  kind: string;
  message: string;
  projectId: string | null;
}

export interface Problem {
  title: string;
  detail: string;
  fix: string;
  severity: "warning" | "error";
}

export interface Project {
  id: string;
  name: string;
  path: string;
  kind: string;
  stack: string[];
  gitBranch: string | null;
  gitDirty: number;
  gitAhead: number;
  gitBehind: number;
  lastCommitAt: string | null;
  lastCommitSubject: string | null;
}

export interface Issue {
  id: number;
  projectId: string | null;
  severity: "info" | "warning" | "error";
  title: string;
  detail: string | null;
  status: string;
  source: string;
  updatedAt: string;
}

export interface Topic {
  id: string;
  title: string;
  question: string;
  status: string;
  findingCount: number;
  sourceCount: number;
  corroboratedCount: number;
  documentCount: number;
  openQuestionCount: number;
}

export const api = {
  status: () => request<StatusResponse>("/api/services/status"),
  feed: (limit = 40) => request<{ feed: FeedEntry[] }>(`/api/services/feed?limit=${limit}`),
  troubleshoot: () => request<{ problems: Problem[]; healthy: boolean }>("/api/services/troubleshoot", {}, 30000),
  stopBackgroundWork: (services?: string[]) =>
    request<{ steps: Array<{ service: string; action: string; ok: boolean }>; status: StatusResponse }>(
      "/api/services/stop",
      { method: "POST", body: JSON.stringify({ services }) },
      60000
    ),
  restartBackgroundWork: () =>
    request<{ steps: Array<{ service: string; action: string; ok: boolean }>; status: StatusResponse }>(
      "/api/services/restart",
      { method: "POST" },
      60000
    ),
  shutdown: () =>
    request<{ ok: boolean; message: string }>(
      "/api/services/shutdown",
      { method: "POST", body: JSON.stringify({ confirm: true }) },
      20000
    ),

  startEverything: () =>
    request<{ steps: Array<{ service: string; action: string; ok: boolean }>; status: StatusResponse }>(
      "/api/services/start",
      { method: "POST" },
      60000
    ),

  projects: () => request<{ projects: Project[] }>("/api/ecosystem/projects"),
  projectContext: (id: string) => request<{ markdown: string }>(`/api/ecosystem/projects/${id}/context?github=0`, {}, 45000),
  handoff: () => request<{ markdown: string }>("/api/ecosystem/handoff"),
  diagnose: (id: string) =>
    request<{ score: number; passed: boolean; issues: number }>(`/api/ecosystem/projects/${id}/diagnose`, { method: "POST" }, 600000),
  repair: (id: string) =>
    request<{ passed?: boolean; startScore?: number; finalScore?: number; reason?: string; branch?: string }>(
      `/api/ecosystem/projects/${id}/repair`,
      { method: "POST", body: JSON.stringify({ maxAttempts: 3 }) },
      900000
    ),
  scan: () => request<{ scanned: number; removed: number }>("/api/ecosystem/scan", { method: "POST" }, 180000),

  issues: (status = "open") => request<{ issues: Issue[] }>(`/api/ecosystem/issues?status=${status}`),
  updateIssue: (id: number, patch: { status?: string; resolution?: string }) =>
    request<{ issue: Issue }>(`/api/ecosystem/issues/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  topics: () => request<{ topics: Topic[] }>("/api/research/topics"),
  startResearch: (title: string, question: string) =>
    request<{ topic: Topic }>("/api/research/topics", { method: "POST", body: JSON.stringify({ title, question }) }),
  pauseTopic: (id: string) => request<unknown>(`/api/research/topics/${id}/pause`, { method: "POST" }),
  resumeTopic: (id: string) => request<unknown>(`/api/research/topics/${id}/resume`, { method: "POST" })
};

/** A quick reachability probe used by the connect screen. */
export const testConnection = async (address: string, key: string): Promise<{ ok: boolean; message: string }> => {
  try {
    const response = await fetch(`${address.replace(/\/+$/, "")}/api/services/status`, {
      headers: { "x-agent-key": key.trim() },
      signal: AbortSignal.timeout(12000)
    });
    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: "Reached your machine, but the key was rejected." };
    }
    if (!response.ok) return { ok: false, message: `Your machine answered ${response.status}.` };
    const body = (await response.json()) as StatusResponse;
    return { ok: true, message: `Connected to ${body.host}. ${body.counts.projects} projects.` };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? "No answer within 12 seconds."
          : "Could not reach that address from this device."
    };
  }
};
