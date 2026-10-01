"use client";

/**
 * Talking to your machine.
 *
 * The address and key live in this browser only (localStorage) and every request
 * goes straight from your device to your machine — nothing passes through the
 * host this page was served from. That is why the hosted build is static: there
 * is no server here to leak anything.
 */

import { clearCache } from "./store";

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
  clearCache();
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const request = async <T>(path: string, init: RequestInit = {}, timeoutMs = 45000): Promise<T> => {
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
    const isHttps = typeof window !== "undefined" && window.location.protocol === "https:";
    const isHttpAddr = connection.address.toLowerCase().startsWith("http://");

    if (error instanceof Error && error.name === "TimeoutError") {
      throw new ApiError("Your machine did not answer in time (45s timeout).", 0);
    }
    if (isHttps && isHttpAddr) {
      throw new ApiError(
        "This app is on https, but your machine's address is plain http, so the browser blocks it. Use the https address (agent.savestate.co.za or a tunnel) in Settings, or open the app on the PC at http://127.0.0.1:4000.",
        0
      );
    }
    throw new ApiError(
      "Could not reach your machine. Is it awake, and are you using your public HTTPS tunnel or VPN?",
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

export interface GpuMetrics {
  name: string;
  vramTotalMB: number;
  vramUsedMB: number;
  vramFreeMB: number;
  vramUsagePercent: number;
  gpuUtilizationPercent: number;
  temperatureC?: number;
}

export interface DiskMetrics {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  usedPercent: number;
  freeGB: number;
  totalGB: number;
}

export interface ProcessUsage {
  name: string;
  count: number;
  totalMemoryMB: number;
}

export interface SystemMetrics {
  cpuUsagePercent: number;
  cpuCores: number;
  totalMemoryBytes: number;
  usedMemoryBytes: number;
  freeMemoryBytes: number;
  memoryUsagePercent: number;
  disk: DiskMetrics;
  gpu: GpuMetrics | null;
  topProcesses: ProcessUsage[];
  profile: "eco" | "balanced" | "turbo";
  concurrency: number;
  timestamp: string;
}

export interface CleanupReport {
  success: boolean;
  freedDiskMB: number;
  freedMemoryMB: number;
  cleanedFilesCount: number;
  categories: Array<{ name: string; freedMB: number; count: number }>;
  before: { freeDiskGB: number; freeMemoryGB: number };
  after: { freeDiskGB: number; freeMemoryGB: number };
  message: string;
}

export interface ProjectEntry {
  name: string;
  type: "file" | "directory";
  path: string;
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
  metrics?: SystemMetrics;
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
  fixId?: string;
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

export interface Commit {
  hash: string;
  subject: string;
  author: string;
  at: string;
  relative: string;
}

export interface AiSession {
  source: "claude" | "gemini";
  id: string;
  title: string;
  summary: string | null;
  projectId: string | null;
  updatedAt: string;
}

export interface TimelineEntry {
  kind: string;
  at: string;
  projectId: string | null;
  projectName: string | null;
  title: string;
  detail: string | null;
}

export interface BuildGuidance {
  text: string;
  at: string;
  from: string;
  appliedAtIteration: number | null;
}

export interface BuildCheck {
  name: string;
  applicable: boolean;
  passed: boolean;
  durationMs: number;
}

export interface BuildIterationDetail {
  iteration: number;
  at?: string;
  qualityScore: number;
  objectiveScore: number;
  status: string;
  improvements: string[];
  files?: number;
  passed?: boolean;
  checks?: BuildCheck[];
  /** The first check that failed, with the end of its output. */
  blocker?: { name: string; output: string } | null;
  metrics: {
    completeness: number;
    security: number;
    performance: number;
    usability: number;
    testCoverage: number;
  };
}

export interface BuildEvent {
  at: string;
  kind: "start" | "pass" | "stage" | "repair" | "score" | "guidance" | "lesson" | "package" | "control" | "warn" | "error" | "done";
  message: string;
}

export interface BuildThought {
  at: string;
  iteration: number;
  kind: "plan" | "lesson" | "check" | "critique" | "repair" | "review" | "decision";
  title: string;
  text: string;
  files?: string[];
}

export interface PreviewReport {
  kind: "error" | "resource" | "console" | "loaded" | string;
  message: string;
  page?: string;
}

export interface BuildAudit {
  at: string;
  passed: boolean;
  score: number;
  checks: BuildCheck[];
  blocker: { name: string; output: string } | null;
  findings: Array<{ severity: "error" | "warning" | "info"; check: string; message: string; file?: string }>;
  runtime: PreviewReport[];
  pages: number;
  site: boolean;
}

/** Something the builder learned, from a fix that worked or from research. */
export interface Lesson {
  id: number;
  scope: "build" | "research";
  signature: string;
  lesson: string;
  example: string | null;
  timesApplied: number;
  timesHelped: number;
  timesFailed: number;
  /** How often it helped, smoothed: (helped + 1) / (applied + 2). */
  utility: number;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt: string | null;
}

export interface BuilderVersion {
  available: boolean;
  reason: string | null;
  commit: string | null;
  subject: string | null;
  date: string | null;
  branch: string | null;
  upstream: string | null;
  dirty: number;
  behind: number;
  ahead: number;
  incoming: Array<{ commit: string; subject: string; date: string }>;
  checkedAt: string | null;
  fetchError: string | null;
}

export interface UpdateJob {
  state: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  steps: Array<{ at: string; text: string; ok: boolean }>;
  restarting: boolean;
  message: string | null;
}

export type BuildState = "running" | "paused" | "completed" | "stopped" | "error" | "interrupted";
export type BuildProfile = "fast" | "balanced" | "deep";

/** One of the builder's settings, as Settings → How the builder works shows it. */
export interface BuilderSetting {
  name: string;
  group: "Models" | "Orders" | "Projects" | "Site";
  label: string;
  help: string;
  kind: "model" | "bool" | "number" | "text" | "choice";
  value: string;
  fallback: string;
  isDefault: boolean;
  choices?: string[];
  min?: number;
  max?: number;
  restart?: boolean;
}

/** Where a new build starts: a working React app, an empty folder, or whichever fits. */
export type StarterChoice = "auto" | "web" | "none";

/** What the model is writing right now, streamed from the builder. */
export interface LiveWriting {
  phase: string;
  model: string;
  tail: string;
  chars: number;
  tokensPerSecond: number;
  done: boolean;
  at: string;
}

export interface Build {
  buildId: string;
  projectName: string;
  description: string;
  startedAt: string;
  finishedAt: string | null;
  state: BuildState;
  iterations: number;
  qualityScore: number;
  outputDir: string;
  startedBy: string;
  /** Set when this build is serving a customer order. */
  orderId: string | null;
  error?: string;
  /** Held in memory by the builder right now — running or paused. */
  live: boolean;
  /** What the current pass is doing right now. */
  stage?: string | null;
  repairAttempt?: number | null;
  /** When the current stage and pass began. */
  stageSince?: string | null;
  passSince?: string | null;
  guidance: BuildGuidance[];
  iterationDetail: BuildIterationDetail[];
  // Present on builders from this version on; older ones leave them out.
  profile?: BuildProfile;
  qualityThreshold?: number;
  maxIterations?: number;
  continuedFrom?: string | null;
  /** Every applicable check passed on the best pass. Null until a pass finishes. */
  passed?: boolean | null;
  bestScore?: number;
  outcome?: string | null;
  events?: BuildEvent[];
  /** The live feed of what it is thinking. Only on a single build; lists carry thoughtCount. */
  thoughts?: BuildThought[];
  thoughtCount?: number;
  /** The last "Test & audit" of what it made. */
  audit?: BuildAudit | null;
  /** The model's answer as it is being written (live builds; lists get it without the text). */
  writing?: LiveWriting | null;
}

export type OrderStatus =
  | "received"
  | "accepted"
  | "building"
  | "review"
  | "delivered"
  | "maintained"
  | "failed"
  | "cancelled";

/** A carry-on build: work done on a copy of a project, waiting to be applied. */
export interface ProjectBuild {
  buildId: string;
  projectId: string;
  projectName: string;
  projectPath: string;
  workDir: string;
  /** The newest build in this carry-on's chain (a continuation works in the same copy). */
  latestBuildId?: string;
  instruction: string;
  createdAt: string;
  appliedAt: string | null;
  lastApply: ApplyResult | null;
  /** "ended": finished before the builder last restarted, outcome not recorded. */
  state: "running" | "paused" | "completed" | "stopped" | "error" | "interrupted" | "ended";
  qualityScore: number | null;
  iterations: number | null;
  changes: FileChange[];
  /** The project's checks, run on the build's copy before applying. */
  lastTest?: BuildTest | null;
  /** The commit made from exactly the files this build applied. */
  commit?: { hash: string; branch: string; message: string; files: string[]; at: string } | null;
  /** The last push of that work, as the remote confirmed it. */
  push?: PushResult | null;
}

export interface FileChange {
  path: string;
  change: "added" | "modified" | "deleted";
}

export interface ApplyResult {
  applied: string[];
  unchanged: string[];
  conflicts: string[];
}

export type TemplateKind = "website" | "app" | "template";

export interface Template {
  id: string;
  name: string;
  kind: TemplateKind;
  category: string;
  description: string;
  price: number;
  currency: string;
  timeframe: string;
  icon: string;
  features: string[];
  techStack?: string[];
  previewUrl?: string;
  keywords?: string[];
  buildNotes?: string;
  sourcePath?: string;
  hidden?: boolean;
  builtIn?: boolean;
  /** The latest build working on its code. */
  developing?: string | null;
}

export interface Order {
  id: string;
  externalId: string | null;
  source: "site" | "manual" | "jarvis" | "api";
  customerName: string;
  customerEmail: string | null;
  productType: string;
  title: string;
  brief: string;
  budget: string | null;
  timeline: string | null;
  status: OrderStatus;
  buildId: string | null;
  deliverablePath: string | null;
  deliverableUrl: string | null;
  qualityScore: number;
  attempts: number;
  autoImprove: boolean;
  receivedAt: string;
  deliveredAt: string | null;
  updatedAt: string;
  /** Present on list responses when a build is attached. */
  build?: Build | null;
}

export interface OrderNote {
  id: number;
  kind: string;
  message: string;
  createdAt: string;
}

/** A note from any order, with the order it belongs to. */
export interface OrderActivity extends OrderNote {
  orderId: string;
  title: string;
  customerName: string;
}

/** The record of one hand-over. `verified` is false if it was edited afterwards. */
export interface OrderReceipt {
  id: string;
  number: string;
  kind: "delivery";
  orderId: string;
  title: string;
  customerName: string;
  customerEmail: string | null;
  buildId: string | null;
  qualityScore: number;
  attempts: number;
  deliverableUrl: string | null;
  by: string;
  createdAt: string;
  digest: string;
  verified: boolean;
}

export interface PipelineStatus {
  running: boolean;
  site: { configured: boolean; site: string | null };
  autoStart: boolean;
  autoImprove: boolean;
  maxConcurrent: number;
  lastIntakeAt: string | null;
  lastIntakeCount: number;
  counts: Record<OrderStatus, number>;
  /** "launching-soon" while the business is not taking orders yet. */
  ordersMode?: "open" | "launching-soon";
  launchMessage?: string | null;
  /** Set while the PC cannot build (its model is down): orders wait instead of failing. */
  hold?: { until: string; reason: string | null } | null;
}

export interface JarvisStatus {
  configured: boolean;
  url: string | null;
  owner: string | null;
  queued: number;
  last: { at: string; ok: boolean; detail: string } | null;
}

export interface Topic {
  id: string;
  title: string;
  question: string;
  status: string;
  findingCount: number;
  sourceCount: number;
  corroboratedCount: number;
  contestedCount?: number;
  documentCount: number;
  openQuestionCount: number;
  cycles?: number;
  lastCycleAt?: string | null;
  nextCycleAt?: string | null;
  lastError?: string | null;
  cycleRunning?: boolean;
  generatingDocuments?: boolean;
}

export interface TopicFinding {
  id: number;
  cycle: number;
  claim: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  confidence: number;
  supportCount: number;
  status: "open" | "corroborated" | "contested";
  createdAt: string;
}

export interface TopicQuestion {
  id: number;
  text: string;
  status: "open" | "explored";
  priority: number;
  timesExplored: number;
}

export interface TopicSource {
  id: number;
  url: string;
  title: string;
  provider: string;
  excerpt: string | null;
  cycle: number;
  fetchedAt: string;
}

export interface TopicDocumentMeta {
  id: number;
  kind: "summary" | "study_guide" | "report";
  version: number;
  title: string;
  findingCount: number;
  createdAt: string;
}

export interface TopicActivity {
  id: number;
  cycle: number;
  kind: string;
  message: string;
  createdAt: string;
}

export interface TopicDetail {
  topic: Topic;
  findings: TopicFinding[];
  openQuestions: TopicQuestion[];
  exploredQuestions: TopicQuestion[];
  sources: TopicSource[];
  documents: TopicDocumentMeta[];
  activity: TopicActivity[];
}

/** The app's own address when a builder is serving it (http://127.0.0.1:4000, a tunnel, a tailnet). */
export const servedByBuilder = async (): Promise<string | null> => {
  if (typeof window === "undefined") return null;
  const origin = window.location.origin;
  try {
    const response = await fetch(`${origin}/api/update/check`, { signal: AbortSignal.timeout(4000) });
    const type = response.headers.get("content-type") ?? "";
    return response.ok && type.includes("json") ? origin : null;
  } catch {
    return null;
  }
};

/** Where a live preview is served, from the builder. `url` is a path on the builder. */
export type PreviewKind = "template" | "build" | "project";

/** What it has learned, written to teach — and to hand on. */
export interface LearningReport {
  id: string;
  createdAt: string;
  title: string;
  markdown: string;
  rules: string[];
  stats: { topics: number; findings: number; confirmed: number; contested: number; lessons: number };
  writtenBy: "model" | "plain";
  taughtAt: string | null;
  taughtCount: number;
  sentToJarvisAt: string | null;
  sentResult: string | null;
}

export interface LearningReportJob {
  state: "running" | "done" | "failed";
  startedAt: string;
  step: string;
  reportId: string | null;
  error: string | null;
}

export interface PreviewInfo {
  kind: PreviewKind;
  id: string;
  ready: boolean;
  url: string | null;
  reason: string | null;
  preparing?: boolean;
  failed?: boolean;
  /** Changes when the built site changes, so the pane knows to reload. */
  version?: number | null;
  /** A template's published example, when it has one. */
  hosted?: string | null;
  /** Projects: when what is shown was built, and whether it is the project's own build or a fresh preview. */
  builtAt?: string | null;
  from?: "project" | "preview" | null;
  canBuild?: boolean;
  job?: { state: "running" | "done" | "failed"; startedAt: string; step: string; error: string | null } | null;
}

/** A path on the builder as a full address this device can load. */
export const onMachine = (pathOnMachine: string): string => {
  const connection = loadConnection();
  return connection ? `${connection.address}${pathOnMachine}` : pathOnMachine;
};

export interface AccessCheck {
  remote: string | null;
  remoteUrl: string | null;
  webUrl: string | null;
  isGitHub: boolean;
  branch: string | null;
  canRead: boolean;
  canPush: boolean;
  behind: boolean;
  detail: string;
}

export interface BuildTest {
  state: "running" | "done" | "error";
  startedAt: string;
  finishedAt: string | null;
  score: number | null;
  passed: boolean;
  checks: Array<{ name: string; applicable: boolean; passed: boolean; output: string }>;
  error?: string;
}

export interface JarvisActivity {
  id: number;
  at: string;
  /** "in": Jarvis did something here. "out": we told Jarvis something. */
  direction: "in" | "out";
  agent: string;
  method: string;
  path: string;
  status: number;
  ms: number | null;
  summary: string | null;
}

export interface JarvisOverview {
  outbound: JarvisStatus & {
    reachability: { host: string; reachable: boolean; status: number | null; detail: string } | null;
  };
  inbound: {
    hasAccess: boolean;
    scopes: string[];
    keyCreatedAt: string | null;
    lastSeen: string | null;
    requestsLastWindow: number;
    monitoring: boolean;
    windowMinutes: number;
  };
  config: { host: string | null; apiKeySet: boolean; apiKeyHint: string | null; ownerId: string | null };
  activity: JarvisActivity[];
}

export interface PendingCommit {
  hash: string;
  subject: string;
}

export interface PushPlan {
  branch: string;
  remote: string | null;
  remoteUrl: string | null;
  webUrl: string | null;
  isGitHub: boolean;
  hasUpstream: boolean;
  commits: PendingCommit[];
  uncommitted: number;
}

export interface PushResult {
  pushed: boolean;
  /** The remote now points the branch at the local commit. */
  confirmed: boolean;
  branch: string;
  commit: string | null;
  commits: PendingCommit[];
  commitUrl: string | null;
  message: string;
  at: string;
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
  toggleService: (service: string, action?: "start" | "stop") =>
    request<{ success: boolean; message: string; status: StatusResponse }>("/api/services/toggle", {
      method: "POST",
      body: JSON.stringify({ service, action })
    }),
  fixTrouble: (fixId: string) =>
    request<{ ok: boolean; message: string; report?: CleanupReport }>("/api/services/troubleshoot/fix", {
      method: "POST",
      body: JSON.stringify({ fixId })
    }),
  cleanup: () => request<CleanupReport>("/api/hardware/cleanup", { method: "POST" }, 60000),
  hardwareMetrics: () => request<SystemMetrics>("/api/hardware/metrics"),
  setProfile: (profile: "eco" | "balanced" | "turbo") =>
    request<{ profile: string; concurrency: number }>("/api/hardware/profile", {
      method: "POST",
      body: JSON.stringify({ profile })
    }),

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
  projectTree: (id: string, path = ".") =>
    request<{ project: string; path: string; entries: ProjectEntry[] }>(
      `/api/ecosystem/projects/${id}/tree?path=${encodeURIComponent(path)}`
    ),
  projectFile: (id: string, path: string) =>
    request<{ project: string; path: string; size: number; content: string }>(
      `/api/ecosystem/projects/${id}/file?path=${encodeURIComponent(path)}`
    ),
  editFile: (id: string, path: string, content: string) =>
    request<{ success: boolean; project: string; path: string; size: number }>(`/api/ecosystem/projects/${id}/file`, {
      method: "PUT",
      body: JSON.stringify({ path, content })
    }),
  gitCommit: (id: string, message: string) =>
    request<{ success: boolean; message: string }>(`/api/ecosystem/projects/${id}/git/commit`, {
      method: "POST",
      body: JSON.stringify({ message })
    }),
  gitSync: (id: string, action: "push" | "pull") =>
    request<{ success: boolean; message: string } & Partial<PushResult>>(
      `/api/ecosystem/projects/${id}/git/sync`,
      { method: "POST", body: JSON.stringify({ action }) },
      200000
    ),
  instructProject: (id: string, instruction: string) =>
    request<{ success: boolean; buildId: string; message: string }>(
      `/api/ecosystem/projects/${id}/instruct`,
      { method: "POST", body: JSON.stringify({ instruction }) },
      // Copying a big project takes a moment before the build starts.
      120000
    ),
  createProject: (data: { name: string; description?: string; root?: string; template?: string }) =>
    request<{ success: boolean; path: string; name: string; message: string }>(
      "/api/ecosystem/projects/create",
      {
        method: "POST",
        body: JSON.stringify(data)
      },
      45000
    ),
  cloneProject: (data: { url: string; name?: string; instruction?: string }) =>
    request<{ success: boolean; project: Project; buildId: string | null; message: string }>(
      "/api/ecosystem/projects/clone",
      { method: "POST", body: JSON.stringify(data) },
      10 * 60 * 1000
    ),
  projectBuilds: (id: string) =>
    request<{ builds: ProjectBuild[] }>(`/api/ecosystem/projects/${encodeURIComponent(id)}/builds`),
  projectBuildDiff: (buildId: string) =>
    request<{ changes: FileChange[]; diff: string }>(`/api/ecosystem/project-builds/${encodeURIComponent(buildId)}/diff`),
  applyProjectBuild: (buildId: string) =>
    request<{ success: boolean } & ApplyResult>(`/api/ecosystem/project-builds/${encodeURIComponent(buildId)}/apply`, {
      method: "POST"
    }),
  openProject: (id: string, target?: "editor" | "folder") =>
    request<{ success: boolean; message: string }>(`/api/ecosystem/projects/${id}/open`, {
      method: "POST",
      body: JSON.stringify({ target })
    }),
  openWorkspace: (target: "vscode" | "projects" | "ts" | "comfy") =>
    request<{ success: boolean; message: string }>("/api/ecosystem/workspace/open", {
      method: "POST",
      body: JSON.stringify({ target })
    }),
  voiceCommand: (text: string) =>
    request<{ text: string; reply: string; actionExecuted?: string; timestamp: string }>(
      "/api/services/voice",
      {
        method: "POST",
        body: JSON.stringify({ text })
      },
      45000
    ),

  issues: (status = "open") => request<{ issues: Issue[] }>(`/api/ecosystem/issues?status=${status}`),
  updateIssue: (id: number, patch: { status?: string; resolution?: string }) =>
    request<{ issue: Issue }>(`/api/ecosystem/issues/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  commits: (id: string) =>
    request<{ commits: Commit[]; workingChanges: Array<{ status: string; path: string }>; unpushed: Commit[] }>(
      `/api/ecosystem/projects/${id}/commits`,
      {},
      45000
    ),
  aiSessions: (projectId?: string) =>
    request<{ sessions: AiSession[]; available: { claude: boolean; gemini: boolean } }>(
      projectId ? `/api/ecosystem/ai-sessions?project=${projectId}` : "/api/ecosystem/ai-sessions",
      {},
      45000
    ),
  continueTimeline: () =>
    request<{ timeline: TimelineEntry[]; unfinished: Project[] }>("/api/ecosystem/continue", {}, 60000),

  // --- builds ---
  builds: () => request<{ count: number; active: number; builds: Build[] }>("/api/autonomous/builds"),
  build: (id: string) => request<Build>(`/api/autonomous/${id}/status`),
  startBuild: (config: {
    projectName: string;
    description: string;
    targetPlatforms?: string[];
    profile?: BuildProfile;
    qualityThreshold?: number;
    maxIterations?: number;
    starter?: StarterChoice;
  }) => request<{ buildId: string }>("/api/autonomous/start", { method: "POST", body: JSON.stringify(config) }, 60000),
  /** Add an instruction to a build that is already running. */
  guideBuild: (id: string, text: string) =>
    request<{ note: BuildGuidance; guidance: BuildGuidance[] }>(
      `/api/autonomous/${id}/guidance`,
      { method: "POST", body: JSON.stringify({ text }) }
    ),
  continueBuild: (id: string, options: { instruction?: string; profile?: BuildProfile } = {}) =>
    request<{ buildId: string; build: Build; message: string }>(
      `/api/autonomous/${encodeURIComponent(id)}/continue`,
      { method: "POST", body: JSON.stringify(options) },
      60000
    ),
  builderVersion: (refresh = false) => request<BuilderVersion>(`/api/power/version${refresh ? "?refresh=1" : ""}`, {}, 120000),
  updateStatus: () => request<{ job: UpdateJob | null }>("/api/power/update", {}, 10000),
  updateBuilder: (force = false) =>
    request<{ job: UpdateJob | null; message?: string }>("/api/power/update", { method: "POST", body: JSON.stringify({ force }) }, 120000),
  learningReports: () => request<{ reports: LearningReport[]; job: LearningReportJob | null }>("/api/learning/reports"),
  writeLearningReport: () => request<{ job: LearningReportJob }>("/api/learning/reports", { method: "POST" }),
  teachBuilder: (id: string, rules: string[]) =>
    request<{ report: LearningReport; taught: number; fresh?: number }>(`/api/learning/reports/${encodeURIComponent(id)}/teach`, {
      method: "POST",
      body: JSON.stringify({ rules })
    }),
  sendReportToJarvis: (id: string) =>
    request<{ report: LearningReport; knowledge: string; webhook: string; ok: boolean }>(
      `/api/learning/reports/${encodeURIComponent(id)}/jarvis`,
      { method: "POST" },
      60000
    ),
  deleteLearningReport: (id: string) => request<{ ok: boolean }>(`/api/learning/reports/${encodeURIComponent(id)}`, { method: "DELETE" }),
  lessons: (scope?: "build" | "research") =>
    request<{ lessons: Lesson[] }>(`/api/learning/lessons${scope ? `?scope=${scope}` : ""}`),
  retireLesson: (id: number) => request<{ ok: boolean }>(`/api/learning/lessons/${id}`, { method: "DELETE" }),
  auditBuild: (id: string, runtime: PreviewReport[]) =>
    request<{ audit: BuildAudit }>(
      `/api/autonomous/${encodeURIComponent(id)}/audit`,
      { method: "POST", body: JSON.stringify({ runtime }) },
      10 * 60_000
    ),
  forgetBuild: (id: string) => request<{ success: boolean }>(`/api/autonomous/${encodeURIComponent(id)}`, { method: "DELETE" }),
  buildFiles: (id: string) =>
    request<{ outputDir: string; exists: boolean; files: string[]; total?: number }>(`/api/autonomous/${encodeURIComponent(id)}/files`),
  buildFile: (id: string, path: string) =>
    request<{ path: string; size: number; truncated: boolean; content: string }>(
      `/api/autonomous/${encodeURIComponent(id)}/file?path=${encodeURIComponent(path)}`
    ),
  openBuild: (id: string, target: "editor" | "folder") =>
    request<{ success: boolean; message: string }>(`/api/autonomous/${encodeURIComponent(id)}/open`, {
      method: "POST",
      body: JSON.stringify({ target })
    }),
  buildProjectPreview: (id: string) =>
    request<{ success: boolean }>(`/api/previews/project/${encodeURIComponent(id)}/build`, { method: "POST" }),
  preview: (kind: PreviewKind, id: string) =>
    request<PreviewInfo>(`/api/previews/${kind}/${encodeURIComponent(id)}`),
  rebuildTemplatePreview: (id: string) =>
    request<{ success: boolean }>(`/api/previews/template/${encodeURIComponent(id)}/rebuild`, { method: "POST" }),
  pauseBuild: (id: string) => request<unknown>(`/api/autonomous/${id}/pause`, { method: "POST" }),
  resumeBuild: (id: string) => request<unknown>(`/api/autonomous/${id}/resume`, { method: "POST" }),
  stopBuild: (id: string) => request<unknown>(`/api/autonomous/${id}/stop`, { method: "POST" }),
  hardware: () =>
    request<{
      specs: {
        cpuCores?: number;
        /** Bytes, not gigabytes — the server reports os.totalmem() raw. */
        totalMemory?: number;
        freeMemory?: number;
        optimalConcurrency?: number;
        recommendedModelSize?: string;
        vramMB?: number | null;
        vramSource?: string;
      };
      utilization: { cpuUsage?: number; memoryUsage?: number; freeMemory?: number; recommendation?: string };
      recommendations: { model: string; tokens: number; delay: number; batchSize: number };
    }>("/api/autonomous/hardware"),

  // --- customer orders ---
  orders: (status?: OrderStatus[]) =>
    request<{ orders: Order[]; counts: Record<OrderStatus, number> }>(
      status?.length ? `/api/orders?status=${status.join(",")}` : "/api/orders"
    ),
  order: (id: string) => request<{ order: Order; notes: OrderNote[]; build: Build | null }>(`/api/orders/${id}`),
  pipeline: () => request<PipelineStatus>("/api/orders/status"),
  orderActivity: (limit = 100) => request<{ activity: OrderActivity[] }>(`/api/orders/activity?limit=${limit}`),
  orderReceipts: (limit = 100) => request<{ receipts: OrderReceipt[] }>(`/api/orders/receipts?limit=${limit}`),
  addOrder: (order: {
    customerName: string;
    customerEmail?: string;
    productType?: string;
    title?: string;
    brief: string;
    budget?: string;
    timeline?: string;
  }) => request<{ order: Order; created: boolean }>("/api/orders", { method: "POST", body: JSON.stringify(order) }),
  pullOrders: () => request<{ found: number; created: number }>("/api/orders/intake", { method: "POST" }, 45000),
  acceptOrder: (id: string) => request<{ order: Order }>(`/api/orders/${id}/accept`, { method: "POST" }),
  buildOrder: (id: string) => request<{ order: Order }>(`/api/orders/${id}/build`, { method: "POST" }, 45000),
  instructOrder: (id: string, text: string) =>
    request<{ success: boolean }>(`/api/orders/${id}/instruct`, { method: "POST", body: JSON.stringify({ text }) }),
  deliverOrder: (id: string, url?: string) =>
    request<{ order: Order }>(`/api/orders/${id}/deliver`, { method: "POST", body: JSON.stringify({ url }) }),
  cancelOrder: (id: string, reason: string) =>
    request<{ order: Order }>(`/api/orders/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason }) }),
  setOrderAutoImprove: (id: string, autoImprove: boolean) =>
    request<{ order: Order }>(`/api/orders/${id}`, { method: "PATCH", body: JSON.stringify({ autoImprove }) }),
  improveNow: () => request<{ started: string[] }>("/api/orders/improve", { method: "POST" }, 45000),
  hubStatus: () =>
    request<{
      siteUrl: string;
      configured: boolean;
      payfast: { configured: boolean; merchantId: string; mode: string };
      intake: { lastIntakeAt: string | null; lastIntakeCount: number };
      catalog: { at: string; ok: boolean; message: string; count: number; lastOkAt?: string | null; failures?: number } | null;
      counts: Record<string, number>;
    }>("/api/orders/hub/status"),
  testHub: () => request<{ ok: boolean; status: number; message: string }>("/api/orders/hub/test", { method: "POST" }),
  templates: () =>
    request<{
      templates: Template[];
      all: Template[];
      count: number;
    }>("/api/orders/templates"),
  createTemplate: (template: Partial<Template>) =>
    request<{ template: Template }>("/api/orders/templates", { method: "POST", body: JSON.stringify(template) }),
  updateTemplate: (id: string, patch: Partial<Template>) =>
    request<{ template: Template }>(`/api/orders/templates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  deleteTemplate: (id: string) =>
    request<{ removed: boolean; hidden: boolean }>(`/api/orders/templates/${encodeURIComponent(id)}`, { method: "DELETE" }),
  developTemplate: (id: string, instruction?: string) =>
    request<{ buildId: string; mode: "edit" | "create"; message: string }>(
      `/api/orders/templates/${encodeURIComponent(id)}/develop`,
      { method: "POST", body: JSON.stringify({ instruction }) },
      120000
    ),
  publishTemplates: () =>
    request<{ ok: boolean; message: string; count: number }>("/api/orders/templates/publish", { method: "POST" }, 45000),
  buildTemplate: (
    id: string,
    options?: { customerName?: string; customBrief?: string; budget?: string }
  ) =>
    request<{ order: Order; build?: Build; message: string }>(
      `/api/orders/templates/${id}/build`,
      { method: "POST", body: JSON.stringify(options ?? {}) },
      45000
    ),
  /**
   * A download link for an order's package. The builder signs it for an hour,
   * so the phone key never goes into a URL (and from there into history or logs).
   */
  downloadPackageUrl: async (id: string): Promise<string> => {
    const conn = loadConnection();
    if (!conn) throw new ApiError("Not connected to a machine yet.", 0);
    const res = await request<{ path: string }>(`/api/orders/${encodeURIComponent(id)}/download-link`, { method: "POST" });
    return `${conn.address}${res.path}`;
  },

  // --- Jarvis ---
  jarvis: () => request<JarvisStatus>("/api/jarvis/status"),
  testJarvis: () =>
    request<{ ok: boolean; detail: string; connection: JarvisStatus }>("/api/jarvis/test", { method: "POST" }, 45000),
  sendHandoff: () => request<{ ok: boolean; detail: string }>("/api/jarvis/handoff", { method: "POST" }, 60000),

  topics: () => request<{ topics: Topic[] }>("/api/research/topics"),
  startResearch: (title: string, question: string) =>
    request<{ topic: Topic }>("/api/research/topics", { method: "POST", body: JSON.stringify({ title, question }) }),
  pauseTopic: (id: string) => request<unknown>(`/api/research/topics/${id}/pause`, { method: "POST" }),
  resumeTopic: (id: string) => request<unknown>(`/api/research/topics/${id}/resume`, { method: "POST" }),
  stopTopic: (id: string) => request<unknown>(`/api/research/topics/${id}/stop`, { method: "POST" }),
  topic: (id: string) => request<TopicDetail>(`/api/research/topics/${id}`),
  editTopic: (id: string, patch: { title?: string; question?: string }) =>
    request<{ topic: Topic }>(`/api/research/topics/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  runTopicNow: (id: string) => request<unknown>(`/api/research/topics/${id}/run`, { method: "POST" }),
  deleteTopic: (id: string) => request<unknown>(`/api/research/topics/${id}`, { method: "DELETE" }),
  askTopic: (id: string, text: string) =>
    request<unknown>(`/api/research/topics/${id}/questions`, { method: "POST", body: JSON.stringify({ text }) }),
  dropQuestion: (id: string, questionId: number) =>
    request<unknown>(`/api/research/topics/${id}/questions/${questionId}`, { method: "DELETE" }),
  prioritiseQuestion: (id: string, questionId: number) =>
    request<unknown>(`/api/research/topics/${id}/questions/${questionId}/prioritise`, { method: "POST" }),
  judgeFinding: (id: string, findingId: number, verdict: "confirm" | "reject") =>
    request<unknown>(`/api/research/topics/${id}/findings/${findingId}`, { method: "POST", body: JSON.stringify({ verdict }) }),
  regenerateDocuments: (id: string) =>
    request<unknown>(`/api/research/topics/${id}/documents/regenerate`, { method: "POST" }, 180000),
  topicDocument: (id: string, documentId: number) =>
    request<{ document: TopicDocumentMeta & { markdown: string } }>(`/api/research/topics/${id}/documents/${documentId}`),

  warmModel: () => request<{ success: boolean; model: string; seconds: number; message: string }>("/api/power/warm-model", { method: "POST" }, 200000),
  restartBuilder: (force = false) =>
    request<{ success: boolean; message: string }>("/api/power/restart", { method: "POST", body: JSON.stringify({ force }) }, 30000),
  builderLog: (lines = 200, level?: "warn" | "error") =>
    request<{ lines: Array<{ at: string | null; level: string; message: string }>; file: string }>(
      `/api/power/log?lines=${lines}${level ? `&level=${level}` : ""}`
    ),
  builderSettings: () =>
    request<{ settings: BuilderSetting[]; models: string[]; ollama: string }>("/api/settings/builder", {}, 20000),
  saveBuilderSettings: (values: Record<string, string>) =>
    request<{ success: boolean; changed: string[]; message: string }>("/api/settings/builder", {
      method: "PUT",
      body: JSON.stringify({ values })
    }),

  testProjectBuild: (buildId: string) =>
    request<{ test: BuildTest }>(`/api/ecosystem/project-builds/${encodeURIComponent(buildId)}/test`, { method: "POST" }),
  commitProjectBuild: (buildId: string, options: { message?: string; push?: boolean } = {}) =>
    request<{ success: boolean; commit: NonNullable<ProjectBuild["commit"]>; push: PushResult | null }>(
      `/api/ecosystem/project-builds/${encodeURIComponent(buildId)}/commit`,
      { method: "POST", body: JSON.stringify(options) },
      200000
    ),
  pushProjectBuild: (buildId: string) =>
    request<{ success: boolean } & PushResult>(
      `/api/ecosystem/project-builds/${encodeURIComponent(buildId)}/push`,
      { method: "POST" },
      200000
    ),
  gitPlan: (id: string) => request<PushPlan>(`/api/ecosystem/projects/${id}/git/plan`, {}, 60000),
  gitCheck: (id: string) => request<AccessCheck>(`/api/ecosystem/projects/${id}/git/check`, { method: "POST" }, 200000),
  jarvisOverview: (limit = 100) => request<JarvisOverview>(`/api/jarvis/overview?limit=${limit}`, {}, 30000),
  saveJarvisConfig: (config: { host?: string; apiKey?: string; ownerId?: string }) =>
    request<{ success: boolean; config: JarvisOverview["config"] }>("/api/jarvis/config", {
      method: "POST",
      body: JSON.stringify(config)
    }),
  grantJarvisAccess: () =>
    request<{ key: string; scopes: string[]; builderAddress: string | null; howTo: string }>("/api/jarvis/access", { method: "POST" }),
  revokeJarvisAccess: () => request<{ success: boolean; revoked: boolean }>("/api/jarvis/access", { method: "DELETE" }),
};

/**
 * Swap a sign-in token from the ordering site's admin ("Open Agent Builder")
 * for an agent key, and connect with it. The token works once; the PC checks it
 * with the site before issuing anything.
 */
export const signInFromHub = async (address: string, token: string): Promise<{ ok: boolean; message: string }> => {
  const base = address.trim().replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) {
    return { ok: false, message: "The sign-in link pointed at an address that is not https." };
  }
  try {
    const response = await fetch(`${base}/api/auth/hub-sso`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(25000)
    });
    const body = (await response.json().catch(() => ({}))) as { key?: string; admin?: string; error?: string };
    if (!response.ok || !body.key) {
      return { ok: false, message: body.error ?? `Your PC answered ${response.status}.` };
    }
    saveConnection({ address: base, key: body.key });
    return { ok: true, message: `Signed in as ${body.admin ?? "admin"}.` };
  } catch {
    return { ok: false, message: "Could not reach your PC to sign in. Is it on, and is Agent Builder running?" };
  }
};

export interface ConnectionReport {
  ok: boolean;
  message: string;
  /** Round trip in milliseconds, when the machine answered. */
  latencyMs?: number;
  status?: StatusResponse;
}

/** A quick reachability probe used by the connect screen and the connection check. */
export const testConnection = async (address: string, key: string): Promise<ConnectionReport> => {
  const base = address.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) {
    return { ok: false, message: "The address has to start with http:// or https://." };
  }
  if (typeof window !== "undefined" && window.location.protocol === "https:" && base.toLowerCase().startsWith("http://")) {
    const local = /^http:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/i.test(base);
    if (!local) {
      return {
        ok: false,
        message:
          "This page is on https, so the browser will not let it call an http:// address. Use the https address (agent.savestate.co.za or a tunnel), or open the app from the PC itself."
      };
    }
  }
  const started = performance.now();
  try {
    const response = await fetch(`${base}/api/services/status`, {
      headers: { "x-agent-key": key.trim() },
      signal: AbortSignal.timeout(12000)
    });
    const latencyMs = Math.round(performance.now() - started);
    if (response.status === 401 || response.status === 403) {
      return { ok: false, latencyMs, message: "Reached your machine, but the key was rejected." };
    }
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("json")) {
      return {
        ok: false,
        latencyMs,
        message: `Something answered at that address, but it is not the builder (${response.status}). Check the address points at your PC, not at this app.`
      };
    }
    if (!response.ok) return { ok: false, latencyMs, message: `Your machine answered ${response.status}.` };
    const body = (await response.json()) as StatusResponse;
    return { ok: true, latencyMs, status: body, message: `Connected to ${body.host}. ${body.counts.projects} projects.` };
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
