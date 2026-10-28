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
  /** Group in the catalogue: builds, apps, art, invites, media, projects, research, orders, academy, library, model, machine. */
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
      "maxIterations?": "passes at most",
      "database?": "the database the app will use: local (decide later) | supabase | firebase | pocketbase | appwrite | rest (own API); the app gets a ready data layer and a keys panel"
    },
    call: (p) => [
      "POST",
      "/api/autonomous/start",
      {
        projectName: str(p.projectName) || str(p.title) || "Jarvis request",
        description: str(p.description) || str(p.message),
        ...pick(p, "profile", "targetPlatforms", "headStart", "qualityThreshold", "maxIterations", "patience", "database")
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
  { name: "build.database", area: "builds", label: "A build's database: the platform it uses and which keys are in", scope: "read", params: { buildId: "the build" }, call: (p) => ["GET", `/api/autonomous/${enc(str(p.buildId))}/database`] },
  { name: "build.preview", area: "builds", label: "A link to try the build in a browser", scope: "read", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/preview-link`] },
  { name: "build.download", area: "builds", label: "A download link for the built site", scope: "read", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/download-link`] },
  { name: "build.audit", area: "builds", label: "Check the built site in a browser: broken links, console errors", scope: "execute", params: { buildId: "the build" }, call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/audit`] },
  {
    name: "findings.autoConfirm",
    area: "builds",
    label: "Auto-confirm all audit findings and runtime errors for a build and dispatch repair pass",
    scope: "execute",
    params: { buildId: "the build" },
    call: (p) => ["POST", `/api/autonomous/${enc(str(p.buildId))}/findings/auto-confirm`]
  },
  {
    name: "super.build",
    area: "builds",
    label: "Super-build from a single prompt with 10-point blueprint, 3D assets, audio, and multi-agent synthesis",
    scope: "execute",
    params: { prompt: "the brief or game idea", "projectName?": "what to call it" },
    call: (p) => [
      "POST",
      "/api/autonomous/super-build",
      {
        prompt: str(p.prompt) || str(p.description) || str(p.message),
        projectName: str(p.projectName) || str(p.title) || undefined
      }
    ]
  },
  {
    name: "super.expand",
    area: "builds",
    label: "Expand a single prompt into an exhaustive 10-point production blueprint",
    scope: "read",
    params: { prompt: "the brief or game idea", "projectName?": "what to call it" },
    call: (p) => [
      "POST",
      "/api/autonomous/super-prompt/expand",
      {
        prompt: str(p.prompt) || str(p.description) || str(p.message),
        projectName: str(p.projectName) || str(p.title) || undefined
      }
    ]
  },

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
  {
    name: "app.deconstruct",
    area: "apps",
    label: "Tear down an existing codebase to dissect features, components, state, flaws, and generate a rebuild blueprint",
    scope: "read",
    params: { projectPath: "path to the project folder" },
    call: (p) => ["POST", "/api/autonomous/deconstruct", pick(p, "projectPath")]
  },
  {
    name: "app.rebuild",
    area: "apps",
    label: "Rebuild and elevate an existing project using modern architecture, zero stubs, and optional 3D/audio",
    scope: "execute",
    params: { projectPath: "path to the project folder", "projectName?": "new project name", "elevate3D?": "boolean" },
    call: (p) => ["POST", "/api/autonomous/rebuild", pick(p, "projectPath", "projectName", "elevate3D")]
  },
  {
    name: "gamemaker.status",
    area: "apps",
    label: "Check KingdomForge Unity AI Builder status and integration",
    scope: "read",
    params: {},
    call: () => ["GET", "/api/autonomous/gamemaker/status"]
  },
  {
    name: "gamemaker.checkup",
    area: "apps",
    label: "Run a full Game Studio checkup: story, mechanics, VFX, audio polish, and next evolution plan",
    scope: "read",
    params: { gameDir: "directory of the game to inspect", "gameName?": "optional game name" },
    call: (p) => ["POST", "/api/autonomous/games/checkup", pick(p, "gameDir", "gameName", "gameId")]
  },
  {
    name: "gamemaker.promote",
    area: "apps",
    label: "Promote a game's staged version to live",
    scope: "execute",
    params: { gameId: "the game identifier" },
    call: (p) => ["POST", "/api/autonomous/games/promote", pick(p, "gameId")]
  },
  {
    name: "unity.status",
    area: "apps",
    label: "Unity Level Studio: the Unity editor, Blender and the level project on this PC",
    scope: "read",
    params: {},
    call: () => ["GET", "/api/autonomous/unity/status"]
  },
  {
    name: "unity.level",
    area: "apps",
    label: "Design and build a full playable 3D Unity level from a prompt (terrain, assets, enemies, goal); minutes",
    scope: "execute",
    params: { prompt: "the level to build", "target?": "none | windows | webgl (also build a player)" },
    call: (p) => ["POST", "/api/autonomous/unity/levels", { prompt: str(p.prompt) || str(p.description) || str(p.message), target: str(p.target) || "none" }]
  },
  {
    name: "unity.levels",
    area: "apps",
    label: "Unity Level Studio jobs and their progress",
    scope: "read",
    params: { "jobId?": "one job" },
    call: (p) => ["GET", str(p.jobId) ? `/api/autonomous/unity/levels/${enc(str(p.jobId))}` : "/api/autonomous/unity/levels"]
  },

  // ── Art: sprites, icons, backgrounds drawn on this PC ─────────────────────
  { name: "art.status", area: "art", label: "Whether the image engine (ComfyUI) and MediaGen are up", scope: "read", params: {}, call: () => ["GET", "/api/art/status"] },
  {
    name: "art.draw",
    area: "art",
    label: "Draw a picture: any image (illustration, poster, scene), a photo, or game art (a sprite cut out, an icon, a ui piece, a background)",
    scope: "execute",
    params: {
      "subject?": "what it shows (leave it out with surprise)",
      "kind?": "image | photo | sprite | icon | ui | background",
      "size?": "wide | square | tall (image and photo)",
      "enhance?": "true: richer words from a few before drawing",
      "surprise?": "true: invent the idea (no subject)",
      "name?": "short name for it",
      "style?": "art style",
      "count?": "how many variations (1-4)",
      "seed?": "number, to repeat one"
    },
    call: (p) => ["POST", "/api/art/draw", pick(p, "subject", "prompt", "kind", "size", "enhance", "surprise", "name", "style", "count", "seed")]
  },
  {
    name: "art.deliver",
    area: "art",
    label: "The finished pictures themselves (PNG, base64), from drawing jobs or library ids: a few at a time, the rest named in rest",
    scope: "read",
    params: { "jobs?": "[drawing job ids]", "ids?": "[picture ids]" },
    call: (p) => ["POST", "/api/art/deliver", pick(p, "jobs", "ids")]
  },
  { name: "art.enhance", area: "art", label: "Turn a short picture idea into a rich description that draws better", scope: "execute", params: { subject: "the idea", "kind?": "image | photo | sprite | icon | ui | background" }, call: (p) => ["POST", "/api/art/enhance", pick(p, "subject", "kind")] },
  { name: "art.idea", area: "art", label: "Invent a picture idea for a kind of picture", scope: "execute", params: { "kind?": "image | photo | sprite | icon | ui | background" }, call: (p) => ["POST", "/api/art/idea", pick(p, "kind")] },
  { name: "art.jobs", area: "art", label: "Pictures being drawn and just drawn", scope: "read", params: {}, call: () => ["GET", "/api/art/jobs"] },
  { name: "art.job", area: "art", label: "One drawing job", scope: "read", params: { id: "the job" }, call: (p) => ["GET", `/api/art/jobs/${enc(str(p.id))}`] },
  { name: "art.list", area: "art", label: "The picture library", scope: "read", params: { "q?": "search words", "kind?": "sprite | icon | ui | background" }, call: (p) => ["GET", `/api/art${query(p, "q", "kind")}`] },
  { name: "art.get", area: "art", label: "One picture's details", scope: "read", params: { id: "the picture" }, call: (p) => ["GET", `/api/art/${enc(str(p.id))}`] },
  { name: "art.edit", area: "art", label: "Redraw a picture with a change (\"make the roof blue\")", scope: "execute", params: { id: "the picture", change: "what to change", "strength?": "0.2-0.9, how much to change" }, call: (p) => ["POST", `/api/art/${enc(str(p.id))}/edit`, pick(p, "change", "strength")] },
  { name: "art.use", area: "art", label: "Put library pictures into a build (public/assets and its manifest)", scope: "execute", params: { buildId: "the build", ids: "[picture ids]" }, call: (p) => ["POST", "/api/art/use", pick(p, "buildId", "ids")] },
  { name: "art.link", area: "art", label: "A link to view a picture", scope: "read", params: { id: "the picture" }, call: (p) => ["POST", `/api/art/${enc(str(p.id))}/link`] },
  { name: "art.pack", area: "art", label: "A zip of pictures (a sprite pack)", scope: "read", params: { ids: "[picture ids]" }, call: (p) => ["POST", "/api/art/pack", pick(p, "ids")] },
  { name: "art.delete", area: "art", label: "Remove a picture from the library", scope: "write", params: { id: "the picture" }, call: (p) => ["DELETE", `/api/art/${enc(str(p.id))}`] },

  // ── Invites: the invitation platform and its design studio ────────────────
  { name: "invites.status", area: "invites", label: "Whether the invites design studio is connected and what it last did", scope: "read", params: {}, call: () => ["GET", "/api/invites/status"] },
  { name: "invites.briefing", area: "invites", label: "How the invitations are going: upcoming celebrations, replies, who has not answered, systems", scope: "read", params: { "format?": "json | markdown" }, call: (p) => ["GET", `/api/invites/platform${query(p, "format")}`] },
  {
    name: "invites.templates",
    area: "invites",
    label: "Design new invitation templates from a brief (they wait for review in the invites admin)",
    scope: "execute",
    params: { brief: "the look and occasion, e.g. sage and gold garden nikkah", "eventTypes?": "[wedding, nikkah, birthday, …]", "culture?": "islamic, indian, xhosa…", "variants?": "how many, 1-4" },
    call: (p) => ["POST", "/api/invites/templates", pick(p, "brief", "eventTypes", "culture", "variants")]
  },

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
  {
    name: "blender.status",
    area: "media",
    label: "Check Blender 3D environment status and executable path",
    scope: "read",
    params: {},
    call: () => ["GET", "/api/autonomous/blender/status"]
  },
  {
    name: "blender.generate",
    area: "media",
    label: "Generate 3D Blender Python script and Three.js runtime bridge for a project",
    scope: "execute",
    params: { projectName: "the project name", description: "description of the 3D scene" },
    call: (p) => ["POST", "/api/autonomous/blender/generate", pick(p, "projectName", "description")]
  },

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
  // ── Template Academy: the builder teaching itself new templates ────────────
  { name: "ask", area: "builds", label: "Ask in plain words; the builder picks the action (build, draw, research, apps, templates…) and does it", scope: "write", params: { text: "what you want, as it was said" }, call: (p) => ["POST", "/api/agent-builder/ask", { text: str(p.text) || str(p.message) }] },
  { name: "screens.link", area: "machine", label: "Connect the laptop to the builder's Screens (a screens-only key from the laptop); pairPc also puts this PC on your dashboard", scope: "execute", params: { key: "the laptop's screens key", "url?": "the laptop's address", "pairPc?": "true to also show this PC to Jarvis" }, call: (p) => ["POST", "/api/screens/link", pick(p, "key", "url", "pairPc")] },
  { name: "screens.unlink", area: "machine", label: "Take the laptop's key off the builder", scope: "execute", params: {}, call: () => ["DELETE", "/api/screens/link"] },
  { name: "library", area: "library", label: "Everything you asked the builder to make, and how each turned out (builds, apps, pictures, media, research, templates)", scope: "read", params: { "kind?": "build | app | picture | media | project | research | template" }, call: (p) => ["GET", `/api/jarvis/library${query(p, "kind")}`] },
  { name: "playbook", area: "academy", label: "What the builder taught itself: fixes it worked out when a build kept failing, why, and how often each worked", scope: "read", params: {}, call: () => ["GET", "/api/playbook"] },
  { name: "academy", area: "academy", label: "The Template Academy: ideas, practice attempts and scores, graduates", scope: "read", params: {}, call: () => ["GET", "/api/academy"] },
  { name: "academy.add", area: "academy", label: "Teach it a new template (it practises until it scores 100)", scope: "execute", params: { name: "e.g. Law Firm", brief: "what the site is for", "category?": "the kind of business", "mustHave?": "[things it must have]", "icon?": "an emoji" }, call: (p) => ["POST", "/api/academy/ideas", pick(p, "name", "brief", "category", "mustHave", "icon")] },
  { name: "academy.propose", area: "academy", label: "Let it suggest new templates the catalogue lacks", scope: "execute", params: { "count?": "1-5" }, call: (p) => ["POST", "/api/academy/propose", pick(p, "count")] },
  { name: "academy.practise", area: "academy", label: "Practise one idea now", scope: "execute", params: { id: "the idea" }, call: (p) => ["POST", `/api/academy/${enc(str(p.id))}/practise`] },
  { name: "academy.publish", area: "academy", label: "Put a graduated template on sale", scope: "execute", params: { id: "the idea", "price?": "rand" }, call: (p) => ["POST", `/api/academy/${enc(str(p.id))}/publish`, pick(p, "price")] },
  { name: "research.topics", area: "research", label: "Research topics", scope: "read", params: {}, call: () => ["GET", "/api/research/topics"] },
  { name: "research.start", area: "research", label: "Start researching a topic", scope: "write", params: { title: "the topic", "question?": "what to find out" }, call: (p) => ["POST", "/api/research/topics", { title: str(p.title), question: str(p.question) || str(p.title) }] },
  { name: "research.ask", area: "research", label: "Ask a question inside a topic", scope: "write", params: { topicId: "the topic", text: "the question" }, call: (p) => ["POST", `/api/research/topics/${enc(str(p.topicId))}/questions`, { text: str(p.text) }] },
  {
    name: "research.chat",
    area: "research",
    label: "Ask a topic's research a question and get its answer, citing its findings and saying which are real evidence, speculation or fiction (waits for the answer)",
    scope: "write",
    params: { topicId: "the topic", message: "the question" },
    call: (p) => ["POST", `/api/research/topics/${enc(str(p.topicId))}/chat?wait=1`, { message: str(p.message) || str(p.text) }]
  },
  { name: "research.report", area: "research", label: "A topic's reports (summary, study guide, full report) to read", scope: "read", params: { topicId: "the topic" }, call: (p) => ["GET", `/api/research/topics/${enc(str(p.topicId))}`] },

  // ── Agent Builder itself: conversation, growth, practice, continuous improvement ──
  {
    name: "agent.chat",
    area: "agent",
    label: "Talk with Agent Builder itself — what it is doing, what it has learned, how it is growing, what it thinks; it may propose an action (waits for its answer)",
    scope: "write",
    params: { message: "what to say to it" },
    call: (p) => ["POST", "/api/agent/chat?wait=1", { message: str(p.message) || str(p.text), source: "jarvis" }]
  },
  { name: "agent.act", area: "agent", label: "Do what Agent Builder just proposed in conversation (\"do it\", \"go ahead\")", scope: "write", params: {}, call: () => ["POST", "/api/agent/chat/latest/act", {}] },
  { name: "agent.profile", area: "agent", label: "Agent Builder's level, XP, abilities (new ones flagged), whether it is getting stronger, and what it is doing", scope: "read", params: {}, call: () => ["GET", "/api/agent/profile"] },
  { name: "ground.state", area: "agent", label: "Its training ground: practice challenges and how it scores on each", scope: "read", params: {}, call: () => ["GET", "/api/agent/ground"] },
  { name: "ground.practise", area: "agent", label: "Have it practise a challenge now (its weakest when none is named)", scope: "execute", params: { "challengeId?": "a challenge" }, call: (p) => ["POST", "/api/agent/ground/practise", pick(p, "challengeId")] },
  { name: "continuous.list", area: "agent", label: "Continuous builder: projects being built or improved (roadmap, stage), and deliveries waiting for approval", scope: "read", params: {}, call: () => ["GET", "/api/agent/continuous"] },
  {
    name: "continuous.start",
    area: "agent",
    label:
      "Continuous builder: work on a project 24/7 toward a goal — plan, build every milestone, fix until every check passes, then (mode forever) keep researching and improving it; all in its own workspace, delivered for approval",
    scope: "execute",
    params: {
      "projectId?": "an existing project",
      "newProject?": "or a name, to start a brand-new project from nothing",
      goal: "what to build or achieve, in the owner's words",
      "mode?": "complete (stop when done) | forever (keep improving, the default)",
      "checkCommand?": "a command that must pass, e.g. make or cargo test"
    },
    call: (p) => ["POST", "/api/agent/continuous/start", pick(p, "projectId", "newProject", "goal", "mode", "checkCommand")]
  },
  {
    name: "continuous.instruct",
    area: "agent",
    label: "Give a running continuous build a new instruction (its roadmap is revised)",
    scope: "execute",
    params: { sessionId: "the session", text: "the instruction" },
    call: (p) => ["POST", `/api/agent/continuous/${enc(str(p.sessionId))}/instruct`, pick(p, "text")]
  },
  {
    name: "reconstruct.start",
    area: "agent",
    label: "Reconstructor: study an app, rebuild it from its blueprint alone, compare feature by feature and learn from what it missed",
    scope: "execute",
    params: { "projectId?": "one of the owner's projects", "gitUrl?": "or a public Git repository's https address" },
    call: (p) => ["POST", "/api/agent/reconstruct", pick(p, "projectId", "gitUrl")]
  },
  { name: "reconstruct.list", area: "agent", label: "Reconstructor: apps rebuilt, their coverage and what it has learned", scope: "read", params: {}, call: () => ["GET", "/api/agent/reconstruct"] },
  { name: "continuous.stop", area: "agent", label: "Stop improving a project", scope: "execute", params: { sessionId: "the session" }, call: (p) => ["POST", `/api/agent/continuous/${enc(str(p.sessionId))}/stop`, {}] },
  {
    name: "approvals.approve",
    area: "agent",
    label: "Approve a delivery from the continuous builder (all of it, or only some files): apply it to the project and commit it on its live branch",
    scope: "execute",
    params: { candidateId: "the delivery", "files?": "only these files (a major change needs them listed)" },
    call: (p) => ["POST", `/api/agent/approvals/${enc(str(p.candidateId))}/approve`, pick(p, "files")]
  },
  { name: "approvals.reject", area: "agent", label: "Reject an improvement", scope: "execute", params: { candidateId: "the improvement", "note?": "why" }, call: (p) => ["POST", `/api/agent/approvals/${enc(str(p.candidateId))}/reject`, pick(p, "note")] },

  // ── Knowledge shared with Jarvis, and how the agents learn ────────────────
  {
    name: "knowledge.search",
    area: "knowledge",
    label: "Search everything the builder knows (research findings, reports, lessons, lessons from builds) and what you know, in one go",
    scope: "read",
    params: { q: "what to look for" },
    call: (p) => ["GET", `/api/knowledge/search${query(p, "q")}`]
  },
  { name: "knowledge.status", area: "knowledge", label: "Whether the builder's knowledge is reaching yours (the sync queue)", scope: "read", params: {}, call: () => ["GET", "/api/knowledge/status"] },
  {
    name: "rl.feedback",
    area: "knowledge",
    label: "His verdict on the builder's last answer or lesson (\"that was great\", \"that was confusing\"): the agent learns which way of explaining works",
    scope: "write",
    params: { good: "true | false", "note?": "his words", "policy?": "chat.style | lesson.style (default: the latest)", "episodeId?": "a specific one" },
    call: (p) => ["POST", "/api/rl/feedback", { ...pick(p, "note", "policy", "episodeId"), good: p.good === true || p.good === "true", source: "jarvis" }]
  },
  { name: "rl.stats", area: "knowledge", label: "What the agents have learned: each approach they try, how often, and how well it scores", scope: "read", params: {}, call: () => ["GET", "/api/rl/stats"] },

  // ── Learning: courses that teach what the research found ──────────────────
  { name: "learn.courses", area: "learning", label: "The owner's courses and how far through each one he is, plus flashcards due", scope: "read", params: {}, call: () => ["GET", "/api/learn"] },
  {
    name: "learn.plan",
    area: "learning",
    label: "Turn a research topic into a course (5-8 lessons) to teach him; takes a few minutes",
    scope: "write",
    params: { topicId: "the topic", "level?": "beginner | intermediate | advanced" },
    call: (p) => ["POST", `/api/learn/${enc(str(p.topicId))}/plan`, pick(p, "level")]
  },
  { name: "learn.course", area: "learning", label: "One course: its lessons, which are written, his progress and quiz scores", scope: "read", params: { topicId: "the topic" }, call: (p) => ["GET", `/api/learn/${enc(str(p.topicId))}`] },
  {
    name: "learn.next",
    area: "learning",
    label: "Teach the next lesson: its text (explanation, example, key terms, fact check, sources) and quiz questions. If status is not ready it is being written: ask again in a few minutes",
    scope: "write",
    params: { topicId: "the topic" },
    call: (p) => ["GET", `/api/learn/${enc(str(p.topicId))}/next`]
  },
  {
    name: "learn.lesson",
    area: "learning",
    label: "One lesson by number (0 is the first): its text and quiz questions; written on demand",
    scope: "write",
    params: { topicId: "the topic", lesson: "lesson number, from 0" },
    call: (p) => ["GET", `/api/learn/${enc(str(p.topicId))}/lessons/${enc(str(p.lesson) || "0")}`]
  },
  {
    name: "learn.answer",
    area: "learning",
    label: "Mark his quiz answers for a lesson: which were right, why, and his score (75% completes the lesson)",
    scope: "write",
    params: { topicId: "the topic", "lesson?": "lesson number from 0 (default: the one he is on)", answers: 'his answers in order: letters like "b, a, d, c" or option numbers from 0' },
    call: (p) => ["POST", `/api/learn/${enc(str(p.topicId))}/lessons/${enc(str(p.lesson) || "current")}/quiz`, { answers: Array.isArray(p.answers) ? p.answers : str(p.answers) }]
  },
  { name: "learn.done", area: "learning", label: "Mark a lesson studied (without a quiz)", scope: "write", params: { topicId: "the topic", lesson: "lesson number, from 0" }, call: (p) => ["POST", `/api/learn/${enc(str(p.topicId))}/lessons/${enc(str(p.lesson) || "0")}/done`, {}] },
  { name: "learn.cards", area: "learning", label: "Flashcards due for review (all courses, or one topic)", scope: "read", params: { "topicId?": "one topic" }, call: (p) => ["GET", str(p.topicId) ? `/api/learn/${enc(str(p.topicId))}/cards/due` : "/api/learn/cards/due"] },
  { name: "learn.review", area: "learning", label: "Record how a flashcard went: knew it (comes back later) or not (back tomorrow)", scope: "write", params: { cardId: "the card", knew: "true | false" }, call: (p) => ["POST", `/api/learn/cards/${enc(str(p.cardId))}/review`, { knew: p.knew === true || p.knew === "true" }] },
  { name: "learn.pack", area: "learning", label: "The whole course as one study pack to read: syllabus, lessons, answers, flashcards, reading list", scope: "read", params: { topicId: "the topic" }, call: (p) => ["GET", `/api/learn/${enc(str(p.topicId))}/pack`] },

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
  { name: "game-mode", area: "machine", label: "Pause everything on the PC for games, or start it all again (game mode: builds, research, the model server, Jarvis on the PC, the image engine, SaveState)", scope: "execute", params: { on: "true | false" }, call: (p) => ["POST", "/api/game-mode", { on: p.on === true || p.on === "true" }] },
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
