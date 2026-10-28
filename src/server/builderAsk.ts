/**
 * Ask Agent Builder in plain words.
 *
 *   POST /api/agent-builder/ask  { text }  →  { ok, action, params, say, result }
 *
 * Jarvis's own patterns cover a few requests ("draw a sprite of…", "build me…").
 * Anything else he wants from the builder he passes on as it was said, and the
 * builder chooses: the local model (free, on this PC) is shown the actions it
 * may pick, with the builds, topics and template ideas it can refer to by id,
 * and answers with one action and its input. That action then runs exactly as
 * if Jarvis had named it on the bridge: same checks, same scope rules, and it
 * goes in his library.
 *
 * Only actions that make or look at things are offered. Settings, restarts,
 * deleting, repairing projects, orders and putting templates on sale stay
 * things he must name himself (and the owner can see in the activity log).
 */
import type { Express, Request, Response } from "express";

import { TemplateAcademy } from "../academy/TemplateAcademy.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { StudyCourse } from "../research/StudyCourse.js";
import { AgentActivity } from "../state/AgentActivity.js";
import { JarvisLibrary } from "../state/JarvisLibrary.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { BRIDGE_ACTIONS, callAsCaller, resolveBridgeAction } from "./jarvisActions.js";

/** What the planner may choose. */
export const ASKABLE = [
  "build",
  "build.continue",
  "build.status",
  "builds",
  "build.preview",
  "build.download",
  "app.make",
  "app.link",
  "art.draw",
  "art.edit",
  "art.list",
  "media.generate",
  "research.start",
  "research.ask",
  "research.topics",
  "research.chat",
  "research.report",
  "learn.courses",
  "learn.plan",
  "learn.course",
  "learn.next",
  "learn.lesson",
  "learn.answer",
  "learn.cards",
  "learn.pack",
  "knowledge.search",
  "rl.feedback",
  "rl.stats",
  "agent.chat",
  "agent.act",
  "agent.profile",
  "ground.state",
  "continuous.list",
  "reconstruct.list",
  "academy",
  "academy.add",
  "academy.propose",
  "academy.practise",
  "library",
  "projects",
  "search",
  "model.status",
  "hardware",
  "services"
];

export interface Plan {
  action: string;
  params: Record<string, unknown>;
  say: string;
}

/** The planner's answer, from whatever it wrapped the JSON in. Null when there is none. */
export const parsePlan = (answer: string): Plan | null => {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
    const action = typeof parsed.action === "string" ? parsed.action.trim().toLowerCase() : "";
    if (!action) return null;
    const params = parsed.params && typeof parsed.params === "object" && !Array.isArray(parsed.params) ? (parsed.params as Record<string, unknown>) : {};
    const say = typeof parsed.say === "string" ? parsed.say.trim().slice(0, 300) : "";
    return { action, params, say };
  } catch {
    return null;
  }
};

const catalogueLines = (): string =>
  BRIDGE_ACTIONS.filter((action) => ASKABLE.includes(action.name))
    .map((action) => {
      const params = Object.entries(action.params)
        .map(([name, what]) => `${name}: ${what}`)
        .join("; ");
      return `- ${action.name}: ${action.label}${params ? ` (${params})` : ""}`;
    })
    .join("\n");

/** What it can refer to by id: recent builds, research topics, template ideas. */
const contextLines = (): string => {
  const builds = BuildService.list()
    .slice(0, 10)
    .map((build) => `- build ${build.buildId}: "${build.projectName}", ${build.state}${build.passed ? ", passed" : ""}, best ${Math.round(build.bestScore ?? 0)}`);
  const topics = ResearchStore.listTopics()
    .slice(0, 8)
    .map((topic) => `- topic ${topic.id}: "${topic.title}"`);
  const courses = StudyCourse.list()
    .slice(0, 8)
    .map((course) => `- course on topic ${course.topicId}: "${course.title}", ${course.status}, ${course.completed}/${course.total} lessons done`);
  const ideas = TemplateAcademy.list()
    .slice(0, 8)
    .map((idea) => `- template idea ${idea.id}: "${idea.name}", ${idea.status}`);
  return [...builds, ...topics, ...courses, ...ideas].join("\n") || "- nothing yet";
};

export const planPrompt = (text: string): string =>
  [
    "You turn one request into one Agent Builder action. Answer with JSON only, no other words:",
    '{"action": "<an action name below, or none>", "params": { ... }, "say": "<one short sentence, first person, saying what you are doing>"}',
    "",
    "Actions:",
    catalogueLines(),
    "",
    "What you can refer to by id:",
    contextLines(),
    "",
    "Rules:",
    "- Keep the request's own words in the brief: build.message, art.draw.subject, media.generate.prompt, research.start.question.",
    "- A website, app, game or tool to make is \"build\" with a short title and the whole request as message.",
    "- A picture, sprite, icon or background is \"art.draw\"; a photo-like image or a video is \"media.generate\" (type image_fast, image_hd or video_short).",
    '- Teaching: "teach me / explain / next lesson / I want to learn / study" about a topic that has a course is learn.next; a topic without a course is learn.plan (research.start first when no topic covers it). "Quiz me" is learn.next (its quiz). Answers to a quiz ("quiz answers: b, a, d, c") are learn.answer with answers as said. "My flashcards" is learn.cards. A question about what a topic found is research.chat with the question as message. "Teach me about X" with no topic on X is research.start (title X), so there is research to teach from.',
    '- Talking WITH Agent Builder itself (how it is, what it is doing or has learned, its opinion, "tell me about yourself") is agent.chat with the words as message; "do it / go ahead" right after it proposed something is agent.act. Its level, abilities or growth is agent.profile.',
    '- A verdict on the last answer or lesson ("that was great / helpful / confusing / wrong", "good lesson") is rl.feedback with good true or false and his words as note. "What do you know about X" across everything is knowledge.search.',
    "- Use an id only from the list above; when the request names a build, topic or idea that is not listed, use the action that lists them.",
    '- If no action fits, answer {"action": "none", "params": {}, "say": "<why, in one sentence>"}.',
    "",
    `Request: ${text}`
  ].join("\n");

export const registerBuilderAskRoutes = (app: Express) => {
  app.post("/api/agent-builder/ask", authenticateAgent("write"), async (req: Request, res: Response) => {
    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, 4000) : "";
    if (text.length < 3) return res.status(400).json({ ok: false, error: "Say what you want in text." });
    const canExecute = Boolean((req as AgentRequest).agent?.scopes.includes("execute"));

    let plan: Plan | null = null;
    try {
      // Jarvis is waiting on this: ahead of research and builds on the GPU.
      plan = parsePlan(await ModelRouter.generate(planPrompt(text), { priority: "interactive" }));
    } catch (error) {
      return res.status(503).json({ ok: false, error: `The builder's model could not read the request: ${error instanceof Error ? error.message : String(error)}` });
    }
    if (!plan) return res.status(422).json({ ok: false, error: "The builder could not work out what to do with that. Say it another way, or name the action." });
    if (plan.action === "none") return res.json({ ok: false, action: "none", say: plan.say || "That is not something Agent Builder does." });
    if (!ASKABLE.includes(plan.action)) {
      return res.status(422).json({ ok: false, action: plan.action, error: `"${plan.action}" is not something the builder does when asked in words; name it on the bridge instead.` });
    }

    const resolved = resolveBridgeAction(plan.action, plan.params);
    if ("error" in resolved) return res.status(422).json({ ok: false, action: plan.action, params: plan.params, error: resolved.error });
    const scope = resolved.action?.scope ?? (resolved.call[0] === "GET" ? "read" : "execute");
    if (scope === "execute" && !canExecute) return res.status(403).json({ ok: false, action: plan.action, error: `"${plan.action}" needs the "execute" scope.` });

    try {
      const result = await callAsCaller(req, resolved.call);
      AgentActivity.record({
        direction: "in",
        agent: (req as AgentRequest).agent?.name ?? "jarvis",
        method: "ASK",
        path: plan.action,
        status: result.status,
        summary: `Asked: ${text.slice(0, 160)}`
      });
      JarvisLibrary.record(plan.action, { ...plan.params, message: plan.params.message ?? text }, result.status, result.body);
      Logger.log("Agent Builder was asked in words", { action: plan.action, status: result.status });
      const payload = result.body && typeof result.body === "object" && !Array.isArray(result.body) ? (result.body as Record<string, unknown>) : { result: result.body };
      return res.status(result.status).json({ ok: result.status < 400, action: plan.action, params: plan.params, say: plan.say, status: result.status, ...payload });
    } catch (error) {
      return res.status(502).json({ ok: false, action: plan.action, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
