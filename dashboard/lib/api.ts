import { io, type Socket } from "socket.io-client";

export type TaskResult = {
  downloadUrl?: string;
  version?: string;
  artifacts?: string[];
  primaryArtifact?: string;
  error?: string;
  notes?: string;
  [key: string]: unknown;
};

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export type Task = {
  id: string;
  description: string;
  agentType: string;
  status: TaskStatus;
  result?: TaskResult | string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
};

export type BuildJobSnapshot = {
  id: string;
  prompt: string;
  status: string;
  updatedAt: string;
  createdAt: string;
  mode?: string;
  autonomy?: string;
  steps?: unknown[];
  logs?: string[];
  outputDir?: string;
  metadata?: Record<string, unknown>;
};

export type BuildEventPayload =
  | { job: BuildJobSnapshot }
  | {
      taskId: string;
      downloadUrl?: string;
      version?: string;
      artifacts?: string[];
      primaryArtifact?: string;
      notes?: string;
      stage?: string;
      timestamp?: string;
      error?: string;
    };

export type BuilderEvent =
  | { type: "task"; payload: { task: Task; timestamp: string } }
  | { type: "build"; payload: BuildEventPayload }
  | { type: "builder"; payload: Record<string, unknown> }
  | { type: "log"; payload: Record<string, unknown> };

const jsonFetcher = async <T>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
};

export const fetchTasks = () => jsonFetcher<Task[]>("/api/agent/tasks");

export const runAgent = (payload: { prompt?: string; template?: string }) =>
  jsonFetcher<Task[]>("/api/agent/run", {
    method: "POST",
    body: JSON.stringify(payload)
  });

export const updateTask = (taskId: string, payload: { prompt?: string; template?: string }) =>
  runAgent({ ...payload, template: payload.template, prompt: payload.prompt ?? `Adjust task ${taskId}` });

export const subscribeToEvents = (onEvent: (event: BuilderEvent) => void): (() => void) => {
  const socket: Socket<BuilderEvent> = io("/", { transports: ["websocket"], path: "/socket.io" });
  socket.on("event", (payload) => onEvent(payload as BuilderEvent));
  return () => socket.disconnect();
};

export const fetchUpdateStatus = () =>
  jsonFetcher<{ available: boolean; message: string }>("/api/system/check-updates");

export const fetchDownloadLink = (taskId: string, filename?: string, cacheTag?: string | number) => {
  const base = `/api/builds/download/${encodeURIComponent(taskId)}`;
  let url = filename ? `${base}?file=${encodeURIComponent(filename)}` : base;
  if (cacheTag !== undefined) {
    url += `${url.includes("?") ? "&" : "?"}t=${encodeURIComponent(String(cacheTag))}`;
  }
  return url;
};

export const downloadBuild = async (taskId: string, filename?: string, cacheTag?: string | number) => {
  const href = fetchDownloadLink(taskId, filename, cacheTag);
  const response = await fetch(href);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Download failed: ${response.status}`);
  }
  return response;
};
