import { io, type Socket } from "socket.io-client";

export type Task = {
  id: string;
  description: string;
  agentType: string;
  status: "pending" | "in_progress" | "done" | "failed";
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
};

export type VectorRecord = {
  id: string;
  taskId: string;
  agentType: string;
  description: string;
  result: string;
  createdAt: string;
  metadata: Record<string, unknown>;
  score?: number;
};

export type PluginMetadata = {
  name: string;
  agentType: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  defaultTask?: string;
};

export type MarketplacePlugin = {
  id: string;
  name: string;
  agentType: string;
  description: string;
  version: string;
  author: string;
  homepage?: string;
  path: string;
  requiresApproval?: boolean;
};

export type MarketplaceRequest = {
  id: string;
  pluginId: string;
  status: "pending" | "installed" | "failed";
  requestedBy: string;
  requestedAt: string;
  approvedBy?: string;
  approvedAt?: string;
  error?: string;
};

export type FeedbackEntry = {
  id: string;
  taskId?: string;
  prompt?: string;
  output?: string;
  rating?: number;
  notes?: string;
  tags?: string[];
  createdAt: string;
  processedAt?: string | null;
};

export type TeamRole = {
  teamId: string;
  teamName: string;
  role: "owner" | "admin" | "editor" | "viewer";
};

export type AuthUser = {
  id: string;
  email: string;
  teams: TeamRole[];
};

export type AnalyticsSummary = {
  tasks: {
    total: number;
    byStatus: Record<string, number>;
    byAgent: Record<string, number>;
    averageDuration: number | null;
    longestDuration: number | null;
    shortestDuration: number | null;
  };
  memory: {
    vectorEnabled: boolean;
    vectorCount: number;
  };
  feedback: Record<string, unknown>;
};

export type ContainerRecord = {
  id: string;
  image: string;
  command?: string;
  status: "pending" | "approved" | "running" | "completed" | "failed";
  requestedBy: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  logs?: string[];
  error?: string;
};

export type QueueMetrics = {
  provider: string;
  connected: boolean;
  queueDepth: number;
  details?: Record<string, unknown>;
};

export type ClusterNode = {
  id: string;
  host: string;
  role: "leader" | "worker";
  connectedAt: string;
};

export type QueueClusterInfo = {
  nodes: ClusterNode[];
  leader: ClusterNode | null;
};

export type TemplateRecord = {
  id: string;
  name: string;
  description?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type DiffSegment = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

export type RollbackRecord = {
  id: string;
  taskId: string;
  snapshot: Task;
  createdAt: string;
};

export type HealthSnapshot = {
  status: "ok" | "degraded" | "down";
  uptimeSeconds: number;
  timestamp: string;
  components: Record<string, { status: "ok" | "degraded" | "down"; details?: Record<string, unknown> }>;
};

export type LogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

export type AuditRecord = {
  id: string;
  action: string;
  actor: string;
  target: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
};

export type ConsentRecord = {
  id: string;
  subject: string;
  grantedBy: string;
  scope: string;
  expiresAt?: string;
  timestamp: string;
};

export type VoiceCommand = {
  id: string;
  text: string;
  confidence: number;
  timestamp: string;
};

export type ArGesture = {
  id: string;
  gesture: string;
  context?: string;
  timestamp: string;
};

export type PolicyRule = {
  id: string;
  action: string;
  description?: string;
  effect: "allow" | "deny";
  conditions?: Record<string, unknown>;
};

export type ServerEvent =
  | {
      type: "log";
      payload: { level: "info" | "warn" | "error"; message: string; timestamp: string };
    }
  | { type: "task"; payload: { task: Task; timestamp: string } }
  | {
      type: "feedback";
      payload: { summary: { count: number; ids: string[] }; timestamp: string };
    }
  | {
      type: "analytics";
      payload: { summary: Record<string, unknown>; timestamp: string };
    }
  | { type: "marketplace"; payload: Record<string, unknown> & { timestamp: string } }
  | { type: "container"; payload: Record<string, unknown> & { timestamp: string } }
  | { type: "queue"; payload: Record<string, unknown> & { timestamp: string } }
  | { type: "health"; payload: { snapshot: HealthSnapshot; timestamp: string } }
  | { type: "security"; payload: Record<string, unknown> & { timestamp: string } };

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const getToken = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem("agent-builder-token");
};

const jsonFetcher = async <T>(path: string, init: RequestInit = {}, auth = false): Promise<T> => {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined)
  };

  if (auth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `API request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
};

export const fetchTasks = () => jsonFetcher<Task[]>("/api/agent/tasks");

export const runAgent = (prompt: string) =>
  jsonFetcher<Task[]>("/api/agent/run", {
    method: "POST",
    body: JSON.stringify({ prompt })
  });

export const updateTask = (taskId: string, instruction: string) =>
  jsonFetcher<{ updated: boolean; result: Task[] }>("/api/agent/update", {
    method: "POST",
    body: JSON.stringify({ taskId, instruction })
  });

export const fetchPlugins = () => jsonFetcher<{ plugins: PluginMetadata[] }>("/api/plugins");

export const fetchRecentMemory = () => jsonFetcher<{ records: VectorRecord[] }>("/api/memory/recent");

export const searchMemory = (query: string, limit = 10) =>
  jsonFetcher<{ records: VectorRecord[] }>(
    "/api/memory/search",
    {
      method: "POST",
      body: JSON.stringify({ query, limit })
    },
    true
  );

export const submitFeedback = (payload: Partial<FeedbackEntry>) =>
  jsonFetcher<{ entry: FeedbackEntry }>(
    "/api/feedback",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchFeedback = (processed?: boolean) =>
  jsonFetcher<{ entries: FeedbackEntry[] }>(
    `/api/feedback${processed === undefined ? "" : `?processed=${processed}`}`,
    {},
    true
  );

export const registerUser = (email: string, password: string) =>
  jsonFetcher<{ token: string; user: AuthUser }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

export const loginUser = (email: string, password: string) =>
  jsonFetcher<{ token: string; user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

export const fetchCurrentUser = () => jsonFetcher<{ user: AuthUser }>("/api/auth/me", {}, true);

export const fetchMarketplaceCatalog = () =>
  jsonFetcher<{ catalog: MarketplacePlugin[] }>("/api/marketplace/catalog", {}, true);

export const fetchMarketplaceRequests = () =>
  jsonFetcher<{ requests: MarketplaceRequest[] }>("/api/marketplace/requests", {}, true);

export const requestMarketplaceInstall = (pluginId: string) =>
  jsonFetcher<{ request: MarketplaceRequest; requiresApproval: boolean }>(
    "/api/marketplace/install",
    {
      method: "POST",
      body: JSON.stringify({ pluginId })
    },
    true
  );

export const approveMarketplaceRequest = (requestId: string) =>
  jsonFetcher<{ request: MarketplaceRequest }>(
    "/api/marketplace/approve",
    {
      method: "POST",
      body: JSON.stringify({ requestId })
    },
    true
  );

export const fetchAnalytics = () => jsonFetcher<AnalyticsSummary>("/api/analytics/usage", {}, true);

export const listContainers = () => jsonFetcher<{ containers: ContainerRecord[] }>("/api/containers", {}, true);

export const requestContainerRun = (payload: { image: string; command?: string }) =>
  jsonFetcher<{ container: ContainerRecord }>(
    "/api/containers/run",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const approveContainerRun = (id: string) =>
  jsonFetcher<{ container: ContainerRecord }>(
    `/api/containers/${id}/approve`,
    {
      method: "POST"
    },
    true
  );

export const fetchQueueMetrics = () =>
  jsonFetcher<{ metrics: QueueMetrics; cluster: QueueClusterInfo }>("/api/queue/metrics", {}, true);

export const publishQueueMessage = (queue: string, message: Record<string, unknown>) =>
  jsonFetcher<{ status: string }>(
    "/api/queue/publish",
    {
      method: "POST",
      body: JSON.stringify({ queue, message })
    },
    true
  );

export const fetchHealthSnapshot = () => jsonFetcher<HealthSnapshot>("/api/health", {}, true);

export const fetchPolicies = () => jsonFetcher<{ revision: string; rules: PolicyRule[] }>("/api/security/policies", {}, true);

export const validatePolicy = (payload: Record<string, unknown>) =>
  jsonFetcher<{ allowed: boolean }>(
    "/api/security/validate",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchLogs = () => jsonFetcher<{ entries: LogEntry[] }>("/api/logs", {}, true);

export const fetchAuditTrail = () => jsonFetcher<{ records: AuditRecord[] }>("/api/governance/audit", {}, true);

export const createAuditEntry = (payload: {
  action: string;
  actor: string;
  target: string;
  metadata?: Record<string, unknown>;
}) =>
  jsonFetcher<{ record: AuditRecord }>(
    "/api/governance/audit",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchConsents = () => jsonFetcher<{ records: ConsentRecord[] }>("/api/governance/consent", {}, true);

export const createConsent = (payload: {
  subject: string;
  grantedBy: string;
  scope: string;
  expiresAt?: string;
  timestamp?: string;
}) =>
  jsonFetcher<{ record: ConsentRecord }>(
    "/api/governance/consent",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchVoiceCommands = () => jsonFetcher<{ commands: VoiceCommand[] }>("/api/controls/voice", {}, true);

export const submitVoiceControl = (text: string, confidence = 0.5) =>
  jsonFetcher<{ command: VoiceCommand }>(
    "/api/controls/voice",
    {
      method: "POST",
      body: JSON.stringify({ text, confidence })
    },
    true
  );

export const fetchGestures = () => jsonFetcher<{ gestures: ArGesture[] }>("/api/controls/gestures", {}, true);

export const submitGesture = (gesture: string, context?: string) =>
  jsonFetcher<{ gesture: ArGesture }>(
    "/api/controls/gestures",
    {
      method: "POST",
      body: JSON.stringify({ gesture, context })
    },
    true
  );

export const fetchTemplates = () => jsonFetcher<{ templates: TemplateRecord[] }>("/api/templates", {}, true);

export const createTemplate = (payload: { name: string; description?: string; content: string }) =>
  jsonFetcher<{ template: TemplateRecord }>(
    "/api/templates",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const requestDiff = (original: string, updated: string) =>
  jsonFetcher<{ diff: DiffSegment[] }>(
    "/api/diff",
    {
      method: "POST",
      body: JSON.stringify({ original, updated })
    },
    true
  );

export const fetchRollbacks = (taskId?: string) =>
  jsonFetcher<{ records: RollbackRecord[] }>(
    `/api/rollbacks${taskId ? `?taskId=${taskId}` : ""}`,
    {},
    true
  );

export const restoreRollback = (id: string) =>
  jsonFetcher<{ task: Task | null }>(
    "/api/rollbacks/restore",
    {
      method: "POST",
      body: JSON.stringify({ id })
    },
    true
  );

type ServerToClientEvents = {
  event: (payload: ServerEvent) => void;
};

type EventSocket = Socket<ServerToClientEvents>;

export const subscribeToEvents = (onEvent: (event: ServerEvent) => void) => {
  if (typeof window === "undefined") {
    throw new Error("subscribeToEvents can only be used in a browser context");
  }

  const token = getToken();
  const socket: EventSocket = io(API_BASE, {
    transports: ["websocket"],
    autoConnect: true,
    auth: token ? { token } : undefined
  });

  const handler = (payload: ServerEvent) => {
    onEvent(payload);
  };

  socket.on("event", handler);

  socket.on("connect_error", (error: Error) => {
    console.error("Socket connection error", error);
  });

  return {
    close: () => {
      socket.off("event", handler);
      socket.disconnect();
    }
  };
};
