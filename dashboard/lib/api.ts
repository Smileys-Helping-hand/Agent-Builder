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
  role: "owner" | "admin" | "developer" | "viewer";
};

export type AuthUser = {
  id: string;
  email: string;
  role: TeamRole["role"];
  teams: TeamRole[];
  status?: string;
  lastLoginAt?: string | null;
  createdAt?: string;
};

export type AuthSessionResponse = {
  token: string;
  accessToken?: string;
  refreshToken?: string;
  user: AuthUser;
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

export type BuildStep = {
  id: string;
  label: string;
  description?: string;
  agent?: string;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  startedAt?: string;
  finishedAt?: string;
  log?: string;
};

export type BuildJob = {
  id: string;
  prompt: string;
  mode: "app" | "game" | "simulation" | "fusion";
  autonomy: "manual" | "semi" | "full";
  status: "queued" | "planning" | "running" | "merging" | "testing" | "deploying" | "completed" | "failed" | "canceled";
  plan?: string[];
  steps: BuildStep[];
  logs: string[];
  createdAt: string;
  updatedAt: string;
  outputDir?: string;
  metadata?: Record<string, unknown>;
};

export type LicenseSnapshot = {
  id: number;
  key: string;
  tier: "free" | "pro" | "enterprise";
  activated_at: string;
  metadata: Record<string, unknown> | null;
};

export type OnboardingStatus = {
  configured: boolean;
  workspaceName?: string;
  adminEmail?: string;
  aiProvider?: string;
  tier?: string;
};

export type SystemStatus = {
  system: {
    cpuLoad: number;
    platform: string;
    release: string;
    uptimeSeconds: number;
    totalMem: number;
    freeMem: number;
    memoryUsage: Record<string, number>;
    queue: QueueMetrics;
    serverStartedAt: string;
  };
  builds: BuildJob[];
};

export type AdminUserRecord = {
  id: number;
  email: string;
  role: string;
  createdAt: string;
  status?: string;
  lastLoginAt?: string | null;
};

export type AuditLogEntry = {
  id: number;
  eventType: string;
  actorId: number | null;
  actorEmail: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type UpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
};

export type RobloxTemplate = {
  id: string;
  label: string;
  description: string;
};

export type RobloxAsset = {
  path: string;
  type: string;
  content: string;
};

export type RobloxGame = {
  title: string;
  summary: string;
  templateId: string;
  assets: RobloxAsset[];
};

export type DiffSegment = {
  value: string;
  added?: boolean;
  removed?: boolean;
};

export type ProposedEdit = {
  filePath: string;
  original: string;
  updated: string;
  diff: string;
  summary: string;
};

export type AutoCodeChatHistory = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

export type AutoCodeChatPayload =
  | { action: "read"; filePath: string }
  | { action: "propose"; filePath: string; instruction: string }
  | { action: "apply"; edit: ProposedEdit }
  | { action: "commit"; commitMessage: string; files?: string[] };

export type AutoCodeChatResponse = {
  message: string;
  content?: string;
  history?: AutoCodeChatHistory[];
  edits?: ProposedEdit[];
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

export type CollaborationParticipant = {
  id: string;
  name: string;
  role: "Builder" | "UX" | "QA" | "Ops";
  cursor?: { filePath: string; position: { line: number; column: number } } | null;
  presence?: "active" | "idle";
  isAI?: boolean;
};

export type CollaborationRoomContext = {
  summary: string;
  repos?: string[];
  activeAgents: string[];
  lastCommand?: string;
  updatedAt: string;
};

export type CollaborationSnapshot = {
  id: string;
  room: "default" | "sandbox" | "team";
  participants: CollaborationParticipant[];
  files: Record<string, string>;
  updatedAt: string;
  context?: CollaborationRoomContext | null;
};

export type NpcGeneration = {
  filePath: string;
  content: string;
  summary: string;
};

export type TerrainGeneration = {
  filePath: string;
  seed: number;
  summary: string;
};

export type StoryTimelineEvent = {
  id: string;
  entityId: string;
  entityType: string;
  entityLabel?: string;
  description: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  relatedEntities?: Array<{ entityId: string; relation: string; label?: string }>;
  sessionId?: string;
  createdAt: string;
};

export type StoryNarration = {
  filePath: string;
  voice: string;
};

export type StoryCommandResponse = {
  events: StoryTimelineEvent[];
  narration?: StoryNarration | null;
  summary?: string;
};

export type StoryEntitySnapshot = {
  entity: { id: string; type: string; label: string; updatedAt: string; metadata?: Record<string, unknown> } | null;
  events: StoryTimelineEvent[];
  relationships: Array<{ id: string; fromId: string; toId: string; relation: string; createdAt: string; metadata?: Record<string, unknown> }>;
};

export type SimulationEvent = {
  id: string;
  category: "lore" | "npc" | "environment" | "system" | "social" | "diplomacy" | "economy";
  label?: string;
  description: string;
  timestamp: string;
  npcId?: string;
  factionId?: string;
  metadata?: Record<string, unknown>;
};

export type SocialGraphNode = {
  id: string;
  label?: string;
  factionId?: string;
  role?: string;
  mood?: number;
  lastInteraction?: string;
};

export type SocialGraphEdge = {
  id: string;
  source: string;
  target: string;
  trust: number;
  rivalry: number;
  trade: number;
  interactions: number;
  lastInteraction?: string;
  context?: string;
};

export type SocialGraphSnapshot = {
  nodes: SocialGraphNode[];
  edges: SocialGraphEdge[];
  factions: Array<{ id: string; name?: string; influence: number; resources?: Record<string, number>; lastUpdated?: string }>;
  updatedAt: string;
};

export type DiplomacyRelation = {
  id: string;
  factionA: string;
  factionB: string;
  status: "alliance" | "neutral" | "rivalry" | "war" | "truce";
  tension: number;
  lastChange: string;
  summary?: string;
};

export type DiplomacySnapshot = {
  relations: DiplomacyRelation[];
  lastUpdated: string;
};

export type EconomyFactionState = {
  factionId: string;
  name: string;
  resources: { food: number; gold: number; materials: number };
  trend: "up" | "down" | "stable";
  lastUpdated: string;
};

export type EconomySnapshot = {
  factions: EconomyFactionState[];
  lastUpdated: string;
};

export type DialogueSummary = {
  id: string;
  participants: string[];
  summary: string;
  timestamp: string;
  sentiment?: string;
};

export type DialogueSnapshot = {
  recent: DialogueSummary[];
};

export type SocialState = {
  graph: SocialGraphSnapshot;
  diplomacy: DiplomacySnapshot;
  economy: EconomySnapshot;
  dialogue: DialogueSnapshot;
};

export type PlayerSimulationState = {
  id: string;
  name: string;
  disposition: string;
  traits: string[];
  alignment: string;
  influence: number;
  reputation: number;
  morale: number;
  hunger: number;
  energy: number;
  activeGoalId?: string;
  goals: Array<{ id: string; label: string; status: string; progress: number; assignedAt: string; resolvedAt?: string }>;
  voice?: string;
  lastAction?: string;
  lastUpdated: string;
};

export type GlobalGoalState = {
  id: string;
  label: string;
  description: string;
  scope: string;
  status: string;
  progress: number;
  ownerId?: string;
  contenders: string[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type GoalSnapshot = {
  goals: GlobalGoalState[];
  completed: GlobalGoalState[];
};

export type SimulationState = {
  running: boolean;
  speedMultiplier: number;
  intervalSeconds: number;
  lastTick: string | null;
  events: SimulationEvent[];
  factions: Array<{ id: string; name: string; alignment: string; influence: number; territory?: string; traits?: string[]; lastUpdated: string }>;
  npcStates: Array<{
    id: string;
    name: string;
    role?: string;
    mood: number;
    hunger: number;
    energy: number;
    goals: string[];
    traits: string[];
    isRunning: boolean;
    lastAction?: string;
    lastEvaluated?: string;
  }>;
  players: PlayerSimulationState[];
  playerSimulationRunning: boolean;
  goals: GoalSnapshot;
  social?: SocialState;
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
  | { type: "security"; payload: Record<string, unknown> & { timestamp: string } }
  | {
      type: "roblox_sync";
      payload: {
        status: "disconnected" | "connecting" | "connected" | "sync" | "playtest" | "error";
        message: string;
        path?: string;
        metadata?: Record<string, unknown>;
        timestamp: string;
      };
    }
  | {
      type: "collaboration";
      payload: {
        sessionId: string;
        message: string;
        participants: CollaborationParticipant[];
        timestamp: string;
        context?: CollaborationRoomContext | null;
      };
    }
  | { type: "build"; payload: { job: BuildJob } }
  | { type: "story"; payload: StoryTimelineEvent }
  | { type: "simulation"; payload: SimulationEvent };

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const ACCESS_TOKEN_KEY = "agent-builder-token";
const REFRESH_TOKEN_KEY = "agent-builder-refresh";

const getToken = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(ACCESS_TOKEN_KEY);
};

const getRefreshToken = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
};

export const ACCESS_TOKEN_STORAGE_KEY = ACCESS_TOKEN_KEY;
export const REFRESH_TOKEN_STORAGE_KEY = REFRESH_TOKEN_KEY;

export const getStoredAccessToken = () => getToken();
export const getStoredRefreshToken = () => getRefreshToken();

export const persistSessionTokens = (tokens: { accessToken: string; refreshToken?: string | null }) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(ACCESS_TOKEN_KEY, tokens.accessToken);
  if (tokens.refreshToken) {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  } else {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
};

export const clearSessionTokens = () => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  window.localStorage.removeItem(REFRESH_TOKEN_KEY);
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

  const refreshAndRetry = async (): Promise<T | null> => {
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      return null;
    }

    const refreshResponse = await fetch(`${API_BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken })
    });

    if (!refreshResponse.ok) {
      clearSessionTokens();
      return null;
    }

    const refreshPayload = (await refreshResponse.json()) as {
      token?: string;
      accessToken?: string;
      refreshToken?: string;
    };

    const nextAccessToken = refreshPayload.accessToken ?? refreshPayload.token;
    if (!nextAccessToken) {
      clearSessionTokens();
      return null;
    }

    persistSessionTokens({
      accessToken: nextAccessToken,
      refreshToken: refreshPayload.refreshToken ?? refreshToken
    });

    headers.Authorization = `Bearer ${nextAccessToken}`;

    const retryResponse = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers
    });

    if (!retryResponse.ok) {
      return null;
    }

    if (retryResponse.status === 204) {
      return {} as T;
    }

    return (await retryResponse.json()) as T;
  };

  if (!response.ok) {
    if (response.status === 401 && auth) {
      const retried = await refreshAndRetry();
      if (retried !== null) {
        return retried;
      }
    }
    const message = await response.text();
    throw new Error(message || `API request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return {} as T;
  }

  return (await response.json()) as T;
};

export const fetchTasks = () => jsonFetcher<Task[]>("/api/agent/tasks");

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
  jsonFetcher<AuthSessionResponse>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

export const loginUser = (email: string, password: string) =>
  jsonFetcher<AuthSessionResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password })
  });

export const logoutSession = (payload: { refreshToken?: string; allSessions?: boolean } = {}) =>
  jsonFetcher<{ ok: boolean }>(
    "/api/auth/logout",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchCurrentUser = () => jsonFetcher<{ user: AuthUser }>("/api/auth/me", {}, true);

export const fetchEnvironmentConfig = () =>
  jsonFetcher<{ env: Record<string, string> }>("/api/env", {}, true);

export const updateEnvironmentConfig = (env: Record<string, string>) =>
  jsonFetcher<{ ok: boolean; env: Record<string, string> }>(
    "/api/env",
    {
      method: "POST",
      body: JSON.stringify(env)
    },
    true
  );

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

export const createCollaborationSession = (room: "default" | "sandbox" | "team" = "default") =>
  jsonFetcher<{ snapshot: CollaborationSnapshot }>("/api/collab/create", {
    method: "POST",
    body: JSON.stringify({ room })
  });

export const joinCollaborationSession = (
  sessionId: string,
  participant: { id: string; name: string; role: CollaborationParticipant["role"] }
) =>
  jsonFetcher<{ session: { id: string; participants: CollaborationParticipant[]; snapshot: CollaborationSnapshot } }>(
    "/api/collab/join",
    {
      method: "POST",
      body: JSON.stringify({ sessionId, participant })
    }
  );

export const fetchCollaborationSnapshot = (sessionId: string) =>
  jsonFetcher<{ snapshot: CollaborationSnapshot }>(`/api/collab/snapshot?sessionId=${sessionId}`);

export const updateCollaborationContext = (sessionId: string, context: Partial<CollaborationRoomContext>) =>
  jsonFetcher<{ context: CollaborationRoomContext }>(
    "/api/collab/context",
    {
      method: "POST",
      body: JSON.stringify({ sessionId, context })
    },
    true
  );

export const listCollaborationSessions = () =>
  jsonFetcher<{ sessions: CollaborationSnapshot[] }>("/api/collab/list", {}, true);

export const generateNpc = (prompt: string, templateId?: string) =>
  jsonFetcher<{ npc: NpcGeneration }>(
    "/api/roblox/npc",
    {
      method: "POST",
      body: JSON.stringify({ prompt, templateId })
    },
    true
  );

export const generateTerrain = (prompt: string, seed?: number) =>
  jsonFetcher<{ terrain: TerrainGeneration }>(
    "/api/roblox/terrain",
    {
      method: "POST",
      body: JSON.stringify({ prompt, seed })
    },
    true
  );

export const sendRobloxDebugLog = (message: string) =>
  jsonFetcher<{ forwarded: boolean }>(
    "/api/roblox/debug/log",
    {
      method: "POST",
      body: JSON.stringify({ message })
    },
    true
  );

export const evaluateRobloxScript = (script: string) =>
  jsonFetcher<{ forwarded: boolean }>(
    "/api/roblox/debug/eval",
    {
      method: "POST",
      body: JSON.stringify({ script })
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

export const sendAutoCodeMessage = (payload: AutoCodeChatPayload) =>
  jsonFetcher<AutoCodeChatResponse>(
    "/api/chat/autocode",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchRobloxTemplates = () =>
  jsonFetcher<{ templates: RobloxTemplate[] }>("/api/roblox/templates", {}, true);

export const generateRobloxGame = (payload: { templateId?: string; prompt: string }) =>
  jsonFetcher<{ game: RobloxGame }>(
    "/api/roblox/generate",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const exportRobloxGame = (payload: { title: string; assets: RobloxAsset[] }) =>
  jsonFetcher<{ filename: string; content: string }>(
    "/api/roblox/export",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const syncRobloxProject = () =>
  jsonFetcher<{ ok: boolean; connected: boolean }>(
    "/api/roblox/sync",
    {
      method: "POST"
    },
    true
  );

export const triggerRobloxPlaytest = () =>
  jsonFetcher<{ ok: boolean }>(
    "/api/roblox/playtest",
    {
      method: "POST"
    },
    true
  );

export const fetchStoryEvents = (limit = 100) =>
  jsonFetcher<{ events: StoryTimelineEvent[] }>(`/api/storyworld/events?limit=${limit}`);

export const fetchStoryTimeline = (limit = 100) =>
  jsonFetcher<{ events: StoryTimelineEvent[] }>(`/api/storyworld/timeline?limit=${limit}`);

export const fetchStorySummary = (sessionId?: string) => {
  const params = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  return jsonFetcher<{ summary: string; events: StoryTimelineEvent[] }>(`/api/storyworld/summary${params}`);
};

export const recallStoryEntity = (entityId: string) =>
  jsonFetcher<StoryEntitySnapshot>(`/api/storyworld/entities/${encodeURIComponent(entityId)}`);

export const sendStoryCommand = (payload: { command: string; sessionId?: string; narrate?: boolean }) =>
  jsonFetcher<StoryCommandResponse>(
    "/api/storyworld/command",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchSimulationState = () =>
  jsonFetcher<{ state: SimulationState; log: SimulationEvent[] }>("/api/storyworld/simulation/state", {}, true);

export const controlSimulation = (payload: { action: string; speed?: number; steps?: number }) =>
  jsonFetcher<{ state: SimulationState }>(
    "/api/storyworld/simulation/control",
    {
      method: "POST",
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchSocialState = () =>
  jsonFetcher<{ state: SocialState }>("/api/storyworld/social/state", {}, true);

export const fetchPlayerSimulation = () =>
  jsonFetcher<{ players: PlayerSimulationState[]; goals: GoalSnapshot; running: boolean }>(
    "/api/storyworld/players",
    {},
    true
  );

export const spawnPlayerAgent = (payload: { name?: string; disposition?: string; traits?: string[] }) =>
  jsonFetcher<{ player: PlayerSimulationState; players: PlayerSimulationState[]; goals: GoalSnapshot; running: boolean }>(
    "/api/storyworld/players",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    },
    true
  );

export const controlPlayerSimulation = (action: "pause" | "resume") =>
  jsonFetcher<{ running: boolean; players: PlayerSimulationState[] }>(
    "/api/storyworld/players/control",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    },
    true
  );

export const createGlobalGoal = (payload: { type?: string; catalyst?: string }) =>
  jsonFetcher<{ goal: GlobalGoalState | null; goals: GoalSnapshot }>(
    "/api/storyworld/goals",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchUpdateStatus = () => jsonFetcher<UpdateStatus>("/api/update/check");

export const fetchOnboardingStatus = () => jsonFetcher<OnboardingStatus>("/api/onboarding/status");

export const completeOnboardingSetup = (payload: {
  workspaceName: string;
  adminEmail: string;
  adminPassword: string;
  aiProvider: string;
  providerKey?: string;
}) =>
  jsonFetcher<{ ok: boolean }>(
    "/api/onboarding/complete",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );

export const fetchLicenseStatus = () =>
  jsonFetcher<{ license: LicenseSnapshot | null }>("/api/license/status", {}, true);

export const activateLicense = (payload: { key: string; tier: LicenseSnapshot["tier"]; metadata?: Record<string, unknown> }) =>
  jsonFetcher<{ license: LicenseSnapshot | null }>(
    "/api/license/activate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchSystemStatus = () => jsonFetcher<SystemStatus>("/api/admin/system-status", {}, true);

export const fetchAdminUsers = () => jsonFetcher<{ users: AdminUserRecord[] }>("/api/admin/users", {}, true);

export const inviteUserAccount = (payload: { email: string; role: string }) =>
  jsonFetcher<{ ok: boolean; temporaryPassword: string }>(
    "/api/admin/users",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    },
    true
  );

export const fetchAuditLog = (options: { limit?: number; eventType?: string } = {}) => {
  const params = new URLSearchParams();
  if (options.limit) {
    params.set("limit", String(options.limit));
  }
  if (options.eventType) {
    params.set("eventType", options.eventType);
  }
  const query = params.toString();
  return jsonFetcher<{ entries: AuditLogEntry[] }>(
    `/api/admin/audit-log${query ? `?${query}` : ""}`,
    {},
    true
  );
};

type ServerToClientEvents = {
  event: (payload: ServerEvent) => void;
};

type EventSocket = Socket<ServerToClientEvents>;

/** Authenticated request to the API with the same base URL and token-refresh handling as the built-in helpers. */
export const apiRequest = <T>(path: string, init: RequestInit = {}) => jsonFetcher<T>(path, init, true);

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
