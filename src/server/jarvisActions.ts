/**
 * Everything Jarvis can ask the builder to do, through the one bridge he is
 * written against (POST /api/agent-builder/bridge with metadata.action).
 *
 * Each action is a call into the builder's own API, made on the loopback with
 * the key (or sign-in) Jarvis came with: the route checks its own scope and
 * input exactly as it does for the app, so the bridge can do nothing his key
 * could not do directly. The catalogue is also what GET on the bridge returns,
 * so Jarvis can see what he can do and what each action takes.
 *
 * "api" is the open door for anything the catalogue does not name yet: any
 * /api/ route, except the few that hand out or change keys and accounts.
 */
import type { Request } from "express";

import type { AgentScope } from "../models/AgentKeyModel.js";

type Params = Record<string, unknown>;
type Call = [method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: Record<string, unknown>];

export interface BridgeAction {
  name: string;
  /** Group in the catalogue: builds, apps, art, media, projects, research, orders, model, machine. */
  area: string;
  label: string;
  scope: AgentScope;
  /** Each parameter with what it is; a trailing "?" in the name marks it optional. */
  params: Record<string, string>;
  call: (p: Params) => Call;
}

const enc = encodeURIComponent;
const str = (value: unknown): string => (typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "");
/** The fields of p that are set, for a request body. */
const pick = (p: Params, ...names: string[]): Record<string, unknown> =>
  Object.fromEntries(names.filter((name) => p[name] !== undefined && p[name] !== "").map((name) => [name, p[name]]));
const query = (p: Params, ...names: string[]): string => {
  const pairs = names.filter((name) => str(p[name])).map((name) => `${name}=${enc(str(p[name]))}`);
  return pairs.length ? `?${pairs.join("&")}` : "";
};

export const BRIDGE_ACTIONS: BridgeAction[] = [
  // ── Builds: from a prompt, all the way through ────────────────────────────
  {
    name: "build",
    area: "builds",
    label: "Build an app, site or game from a prompt",
    scope: "execute",
    params: {
      projectName: "what to call it (or title)",
      description: "the brief, in plain words (or message)",
      "profile?": "fast | balanced | deep (deep: more repairs and a reviewer)",
      "targetPlatforms?": "[web, android, windows]: android/windows also make the phone or PC app once it passes",
      "headStart?": "prompt (written from the brief) | engine | template",
      "qualityThreshold?": "40-100, the score it stops at",
      "maxIterations?": "passes at most"
    },
    call: (p) => [
      "POST",
      "/api/autonomous/start",
      {
        projectName: str(p.projectName) || str(p.title) || "Jarvis request",
        description: str(p.description) || str(p.message),
        ...pick(p, "profile", "targetPlatforms", "headStart", "qualityThreshold", "maxIterations", "patience")
      }
    ]
  },
  {
    name: "build.continue",
    area: "builds",
    label: "Carry a finished build on: fix what fails, or do something more",
    scope: "execute",
    params: { buildId: "the build", "instruction?": "what to do next (empty: finish and fix)", "profile?": "fast | balanced | deep" },
    call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/continue`, pick(p, "instruction", "profile")]
  },
  {
    name: "guidance",
    area: "builds",
    label: "Steer a running build: joins every prompt from the next pass",
    scope: "execute",
    params: { buildId: "the running build", text: "the instruction (or message)" },
    call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/guidance`, { text: str(p.text) || str(p.message) }]
  },
  { name: "build.pause", area: "builds", label: "Pause a build (frees the GPU, keeps the work)", scope: "execute", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/pause`] },
  { name: "build.resume", area: "builds", label: "Resume a paused build", scope: "execute", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/resume`] },
  { name: "build.stop", area: "builds", label: "Stop a build", scope: "execute", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/stop`] },
  { name: "build.status", area: "builds", label: "How a build is doing: stage, score, checks", scope: "read", params: { buildId: "the build" }, call: (p) => ["GET", `/api/autonomous/${enc(str(p.buildId))}/status`] },
  { name: "build.passes", area: "builds", label: "Every pass of a build, with what each check said", scope: "read", params: { buildId: "the build" }, call: (p) => ["GET", `/api/autonomous/${enc(str(p.buildId))}/iterations`] },
  { name: "builds", area: "builds", label: "All builds, newest first", scope: "read", params: {}, call: () => ["GET", "/api/autonomous/builds"] },
  { name: "builds.active", area: "builds", label: "What is building now", scope: "read", params: {}, call: () => ["GET", "/api/autonomous/active"] },
  { name: "build.files", area: "builds", label: "The files a build wrote", scope: "read", params: { buildId: "the build" }, call: (p) => ["GET", `/api/autonomous/${enc(str(p.buildId))}/files`] },
  {
    name: "build.file",
    area: "builds",
    label: "Read one file of a build",
    scope: "read",
    params: { buildId: "the build", path: "e.g. src/App.tsx" },
    call: (p) => ["GET", `/api/autonomous/${enc(str(p.buildId))}/file${query(p, "path")}`]
  },
  { name: "build.preview", area: "builds", label: "A link to try the build in a browser", scope: "read", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/preview-link`] },
  { name: "build.download", area: "builds", label: "A download link for the built site", scope: "read", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/download-link`] },
  { name: "build.audit", area: "builds", label: "Check the built site in a browser: broken links, console errors", scope: "execute", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/audit`] },

  // ── Phone and PC apps ─────────────────────────────────────────────────────
  {
    name: "app.make",
    area: "apps",
    label: "Make the Android APK or Windows .exe of a passed build",
    scope: "execute",
    params: { buildId: "the build", platform: "android | windows" },
    call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/app`, { platform: str(p.platform) }]
  },
  { name: "app.status", area: "apps", label: "Whether the app is being made, made, or failed", scope: "read", params: { buildId: "the build", platform: "android | windows" }, call: (p) => ["GET", `/api/autonomous/${enc(str(p.buildId))}/app/${enc(str(p.platform))}`] },
  { name: "app.link", area: "apps", label: "A download link for the APK or .exe", scope: "read", params: { buildId: "the build", platform: "android | windows" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/app/${enc(str(p.platform))}/link`] },

  // ── Art: sprites, icons, backgrounds drawn on this PC ─────────────────────
  { name: "art.status", area: "art", label: "Whether the image engine (ComfyUI) and MediaGen are up", scope: "read", params: {}, call: () => ["GET", "/api/art/status"] },
  {
    name: "art.draw",
    area: "art",
    label: "Draw a picture: a sprite (cut out), icon, ui piece or background",
    scope: "execute",
    params: { subject: "what it shows", "kind?": "sprite | icon | ui | background", "name?": "short name for it", "style?": "art style", "count?": "how many variations (1-4)", "seed?": "number, to repeat one" },
    call: (p) => ["POST", "/api/art/draw", pick(p, "subject", "prompt", "kind", "name", "style", "count", "seed")]
  },
  { name: "art.jobs", area: "art", label: "Pictures being drawn and just drawn", scope: "read", params: {}, call: () => ["GET", "/api/art/jobs"] },
  { name: "art.job", area: "art", label: "One drawing job", scope: "read", params: { id: "the job" }, call: (p) => ["GET", `/api/art/jobs/${enc(str(p.id))}`] },
  { name: "art.list", area: "art", label: "The picture library", scope: "read", params: { "q?": "search words", "kind?": "sprite | icon | ui | background" }, call: (p) => ["GET", `/api/art${query(p, "q", "kind")}`] },
  { name: "art.get", area: "art", label: "One picture's details", scope: "read", params: { id: "the picture" }, call: (p) => ["GET", `/api/art/${enc(str(p.id))}`] },
  { name: "art.edit", area: "art", label: "Redraw a picture with a change (\"make the roof blue\")", scope: "execute", params: { id: "the picture", change: "what to change", "strength?": "0.2-0.9, how much to change" }, call: (p) => ["POST", `/api/art/${enc(str(p.id))}/edit`, pick(p, "change", "strength")] },
  { name: "art.use", area: "art", label: "Put library pictures into a build (public/assets and its manifest)", scope: "execute", params: { buildId: "the build", ids: "[picture ids]" }, call: (p) => ["POST", "/api/art/use", pick(p, "buildId", "ids")] },
  { name: "art.link", area: "art", label: "A link to view a picture", scope: "read", params: { id: "the picture" }, call: (p) => ["POST", `/api/art/${enc(str(p.id))}/link`] },
  { name: "art.pack", area: "art", label: "A zip of pictures (a sprite pack)", scope: "read", params: { ids: "[picture ids]" }, call: (p) => ["POST", "/api/art/pack", pick(p, "ids")] },
  { name: "art.delete", area: "art", label: "Remove a picture from the library", scope: "write", params: { id: "the picture" }, call: (p) => ["DELETE", `/api/art/${enc(str(p.id))}`] },

  // ── Media: MediaGen images and short videos ───────────────────────────────
  {
    name: "media.generate",
    area: "media",
    label: "Make an image or a short video with MediaGen (a video can start from a library picture)",
    scope: "execute",
    params: { prompt: "what to make", "type?": "image_fast | image_hd | video_short", "fromId?": "a library picture to animate", "aspectRatio?": "e.g. 16:9" },
    call: (p) => ["POST", "/api/art/mediagen/queue", pick(p, "prompt", "type", "fromId", "aspectRatio")]
  },
  { name: "media.job", area: "media", label: "A MediaGen job", scope: "read", params: { id: "the job" }, call: (p) => ["GET", `/api/art/mediagen/jobs/${enc(str(p.id))}`] },
  { name: "media.gallery", area: "media", label: "What MediaGen has made", scope: "read", params: {}, call: () => ["GET", "/api/art/mediagen/gallery"] },
  { name: "media.import", area: "media", label: "Bring a finished MediaGen result into the library", scope: "write", params: { jobId: "the job" }, call: (p) => ["POST", "/api/art/mediagen/import", pick(p, "jobId")] },

  // ── Projects on this PC: read, diagnose, repair, change ───────────────────
  { name: "projects", area: "projects", label: "Every project the builder knows", scope: "read", params: {}, call: () => ["GET", "/api/ecosystem/projects"] },
  { name: "project.context", area: "projects", label: "A briefing on one project", scope: "read", params: { projectId: "the project" }, call: (p) => ["GET", `/api/ecosystem/projects/${enc(str(p.projectId))}/context?format=markdown`] },
  { name: "project.diagnose", area: "projects", label: "Install, typecheck, build and test a project; say what fails", scope: "execute", params: { projectId: "the project" }, call: (p) => ["POST", `/api/ecosystem/projects/${enc(str(p.projectId))}/diagnose`, {}] },
  { name: "project.repair", area: "projects", label: "Fix what fails in a project, checking each fix", scope: "execute", params: { projectId: "the project", "maxAttempts?": "1-5" }, call: (p) => ["POST", `/api/ecosystem/projects/${enc(str(p.projectId))}/repair`, { maxAttempts: Number(p.maxAttempts) || 3 }] },
  {
    name: "project.instruct",
    area: "projects",
    label: "Change a project from a prompt (a build on a copy, checked before it is applied)",
    scope: "execute",
    params: { projectId: "the project", instruction: "what to change", "profile?": "fast | balanced | deep" },
    call: (p) => ["POST", `/api/ecosystem/projects/${enc(str(p.projectId))}/instruct`, { instruction: str(p.instruction) || str(p.message), profile: str(p.profile) || "balanced" }]
  },
  { name: "project.file", area: "projects", label: "Read a file of a project", scope: "read", params: { projectId: "the project", path: "the file" }, call: (p) => ["GET", `/api/ecosystem/projects/${enc(str(p.projectId))}/file${query(p, "path")}`] },
  { name: "project.create", area: "projects", label: "Create a new empty project folder", scope: "write", params: { name: "its name" }, call: (p) => ["POST", "/api/ecosystem/projects/create", pick(p, "name", "description")] },
  { name: "search", area: "projects", label: "Search everything the builder knows", scope: "read", params: { q: "words" }, call: (p) => ["GET", `/api/ecosystem/search${query(p, "q")}`] },
  { name: "issues", area: "projects", label: "Open issues", scope: "read", params: {}, call: () => ["GET", "/api/ecosystem/issues"] },
  { name: "issue.report", area: "projects", label: "Report an issue", scope: "write", params: { title: "what is wrong", "detail?": "more", "project?": "which project", "severity?": "info | warning | error" }, call: (p) => ["POST", "/api/ecosystem/issues", pick(p, "title", "detail", "project", "severity")] },

  // ── Research ───────────────────────────────────────────────────────────────
  { name: "research.topics", area: "research", label: "Research topics", scope: "read", params: {}, call: () => ["GET", "/api/research/topics"] },
  { name: "research.start", area: "research", label: "Start researching a topic", scope: "write", params: { title: "the topic", "question?": "what to find out" }, call: (p) => ["POST", "/api/research/topics", { title: str(p.title), question: str(p.question) || str(p.title) }] },
  { name: "research.ask", area: "research", label: "Ask a question inside a topic", scope: "write", params: { topicId: "the topic", text: "the question" }, call: (p) => ["POST", `/api/research/topics/${enc(str(p.topicId))}/questions`, { text: str(p.text) }] },

  // ── Customer orders ───────────────────────────────────────────────────────
  { name: "orders", area: "orders", label: "Customer orders", scope: "read", params: {}, call: () => ["GET", "/api/orders"] },
  { name: "order.build", area: "orders", label: "Build an order now", scope: "execute", params: { orderId: "the order" }, call: (p) => ["POST", `/api/orders/${enc(str(p.orderId))}/build`] },
  { name: "order.instruct", area: "orders", label: "Tell an order's build something", scope: "execute", params: { orderId: "the order", text: "the instruction" }, call: (p) => ["POST", `/api/orders/${enc(str(p.orderId))}/instruct`, { text: str(p.text) || str(p.message) }] },

  // ── The model, and the machine ────────────────────────────────────────────
  { name: "model.status", area: "model", label: "The coding model: which, and how it is split between the GPU and RAM", scope: "read", params: {}, call: () => ["GET", "/api/power/model"] },
  { name: "model.load", area: "model", label: "Load the coding model now", scope: "execute", params: {}, call: () => ["POST", "/api/power/warm-model"] },
  { name: "model.restart", area: "model", label: "Restart the model server with its settings", scope: "execute", params: {}, call: () => ["POST", "/api/power/model/restart"] },
  { name: "settings", area: "model", label: "The builder's settings, with choices", scope: "read", params: {}, call: () => ["GET", "/api/settings/builder"] },
  { name: "settings.set", area: "model", label: "Change settings (e.g. {\"OLLAMA_MODEL\": \"qwen2.5-coder:14b\"})", scope: "execute", params: { values: "{ NAME: value }" }, call: (p) => ["PUT", "/api/settings/builder", { values: p.values ?? {} }] },
  { name: "services", area: "machine", label: "Every service and whether it is up", scope: "read", params: {}, call: () => ["GET", "/api/services/status"] },
  { name: "services.start", area: "machine", label: "Switch everything on", scope: "execute", params: {}, call: () => ["POST", "/api/services/start"] },
  { name: "service.toggle", area: "machine", label: "Start or stop one service (ollama, comfy)", scope: "execute", params: { service: "ollama | comfy", "action?": "start | stop" }, call: (p) => ["POST", "/api/services/toggle", pick(p, "service", "action")] },
  { name: "troubleshoot", area: "machine", label: "What is wrong on the machine, with fixes", scope: "read", params: {}, call: () => ["GET", "/api/services/troubleshoot"] },
  { name: "hardware", area: "machine", label: "CPU, RAM and GPU now", scope: "read", params: {}, call: () => ["GET", "/api/hardware/metrics"] },
  { name: "game-mode", area: "machine", label: "Game mode on or off (frees the GPU for games)", scope: "execute", params: { on: "true | false" }, call: (p) => ["POST", "/api/game-mode", { on: p.on === true || p.on === "true" }] },
  { name: "log", area: "machine", label: "The builder's log", scope: "read", params: { "lines?": "how many", "level?": "error | warn" }, call: (p) => ["GET", `/api/power/log${query(p, "lines", "level")}`] }
];

const BY_NAME = new Map(BRIDGE_ACTIONS.map((action) => [action.name, action]));

/** Routes the open "api" action never reaches: they issue or change keys, accounts and secrets. */
const OFF_LIMITS = [/^\/api\/jarvis\/(access|config)/, /^\/api\/auth/, /^\/api\/admin/, /^\/api\/env/, /^\/api\/onboarding/, /^\/api\/agent-builder\/bridge/, /^\/api\/license/];

/** Resolve an action and its parameters to the call it makes; an error when it cannot. */
export const resolveBridgeAction = (name: string, params: Params): { call: Call; action: BridgeAction | null } | { error: string } => {
  if (name === "api") {
    const method = str(params.method).toUpperCase() || "GET";
    const target = str(params.path);
    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) return { error: "method is GET, POST, PUT or DELETE." };
    if (!target.startsWith("/api/") || target.includes("..")) return { error: "path is a builder route starting /api/." };
    if (OFF_LIMITS.some((pattern) => pattern.test(target))) return { error: "That route issues or changes keys and accounts; it is only done at the app." };
    const body = params.body && typeof params.body === "object" ? (params.body as Record<string, unknown>) : undefined;
    return { call: [method as Call[0], target, body], action: null };
  }
  const action = BY_NAME.get(name);
  if (!action) return { error: `No action "${name}". GET the bridge for the list.` };
  const missing = Object.keys(action.params).filter((key) => !key.endsWith("?") && params[key] === undefined && !(key === "description" && params.message) && !(key === "text" && params.message) && !(key === "instruction" && params.message) && !(key === "projectName" && params.title));
  if (missing.length) return { error: `${name} needs ${missing.join(", ")}.` };
  return { call: action.call(params), action };
};

/** Make the call on the loopback as the caller: their key or sign-in, so every route's own checks apply. */
export const callAsCaller = async (req: Request, [method, target, body]: Call): Promise<{ status: number; body: unknown }> => {
  const host = process.env.HOST && process.env.HOST !== "0.0.0.0" ? process.env.HOST : "127.0.0.1";
  const port = Number(process.env.PORT) || 4000;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  for (const name of ["x-agent-key", "authorization"]) {
    const value = req.headers[name];
    if (typeof value === "string") headers[name] = value;
  }
  const response = await fetch(`http://${host}:${port}${target}`, {
    method,
    headers,
    body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
    // A diagnose or repair runs for many minutes; the bridge answers with what it got.
    signal: AbortSignal.timeout(45 * 60_000)
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Not JSON (a log, markdown): passed on as text, trimmed.
    parsed = text.slice(0, 20_000);
  }
  return { status: response.status, body: parsed };
};

/** The catalogue as Jarvis reads it. */
export const bridgeCatalogue = () => ({
  howTo:
    'POST this address with { "eventType": "<action>", "title", "message", "metadata": { "action": "<action>", ...params } }. ' +
    'title and message stand in for a build\'s projectName and description. "api" with { method, path, body } calls any other /api/ route.',
  actions: BRIDGE_ACTIONS.map(({ call: _call, ...action }) => action),
  open: { name: "api", params: { method: "GET | POST | PUT | DELETE", path: "/api/...", "body?": "JSON" }, offLimits: "keys, accounts, settings secrets" }
});
