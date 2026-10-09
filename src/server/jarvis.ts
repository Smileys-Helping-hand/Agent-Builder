/**
 * Jarvis routes — check the connection, test it, and push a note by hand.
 *
 * The builder reports to Jarvis on its own (repairs, issues), so these exist for
 * the moments you want certainty: is it configured, did the last delivery work,
 * and what happens if I send one right now.
 */
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { JarvisClient, type JarvisEventType } from "../integrations/JarvisClient.js";
import { ContextPack } from "../ecosystem/ContextPack.js";
import { AgentKeyModel } from "../models/AgentKeyModel.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { AgentActivity } from "../state/AgentActivity.js";
import { setEnvValues } from "../utils/EnvFile.js";
import { Logger } from "../utils/Logger.js";
import { readPublicUrl } from "../utils/PublicUrl.js";
import { HEAD_STARTS, type HeadStart } from "../orchestrator/AutonomousOrchestrator.js";
import { bridgeCatalogue, callAsCaller, resolveBridgeAction } from "./jarvisActions.js";

/** The agent key Jarvis uses to reach into the builder. */
const JARVIS_KEY_NAME = "jarvis";
/** Jarvis counts as monitoring if he has made a request within this long. */
const MONITORING_WINDOW_MIN = 15;

/** Is Jarvis's server answering at all? Cached briefly so the app's polling does not hammer it. */
let reachability: { at: number; host: string; reachable: boolean; status: number | null; detail: string } | null = null;
const probeJarvis = async (): Promise<NonNullable<typeof reachability> | null> => {
  const host = process.env.JARVIS_HOST?.trim().replace(/\/+$/, "");
  if (!host) return null;
  if (reachability && reachability.host === host && Date.now() - reachability.at < 30_000) return reachability;
  try {
    const response = await fetch(host, { method: "GET", signal: AbortSignal.timeout(6000), redirect: "manual" });
    // 5xx from the tunnel in front of him (530, 502) means Jarvis himself is not running.
    const reachable = response.status < 500;
    reachability = {
      at: Date.now(),
      host,
      reachable,
      status: response.status,
      detail: reachable ? `Answering at ${host}` : `${host} answered ${response.status}: Jarvis is not running behind it`
    };
  } catch (error) {
    reachability = { at: Date.now(), host, reachable: false, status: null, detail: `No answer from ${host}` };
  }
  return reachability;
};

/** Show only the end of a secret. */
const hint = (value: string | undefined): string | null => (value ? `…${value.slice(-4)}` : null);

export const registerJarvisRoutes = (app: Express) => {
  /**
   * Everything the app's Jarvis screen shows: both directions of the link,
   * whether he is actually watching, his access, and the log of what happened.
   */
  app.get("/api/jarvis/overview", authenticateAgent("read"), async (req: Request, res: Response) => {
    const key = AgentKeyModel.list().find((entry) => entry.name === JARVIS_KEY_NAME && !entry.revokedAt) ?? null;
    const lastSeen = [AgentActivity.lastSeen(JARVIS_KEY_NAME), key?.lastUsedAt ?? null]
      .filter((value): value is string => Boolean(value))
      .sort()
      .pop() ?? null;
    const recent = AgentActivity.countSince(JARVIS_KEY_NAME, MONITORING_WINDOW_MIN);
    const limit = Math.min(Number(req.query.limit) || 100, 300);

    res.json({
      // Builder → Jarvis: can we tell him things?
      outbound: {
        ...JarvisClient.describe(),
        reachability: await probeJarvis()
      },
      // Jarvis → builder: is he looking?
      inbound: {
        hasAccess: Boolean(key),
        scopes: key?.scopes ?? [],
        keyCreatedAt: key?.createdAt ?? null,
        lastSeen,
        requestsLastWindow: recent,
        monitoring: Boolean(lastSeen && Date.now() - new Date(lastSeen).getTime() < MONITORING_WINDOW_MIN * 60_000),
        windowMinutes: MONITORING_WINDOW_MIN
      },
      config: {
        host: process.env.JARVIS_HOST ?? null,
        apiKeySet: Boolean(process.env.JARVIS_API_KEY),
        apiKeyHint: hint(process.env.JARVIS_API_KEY),
        ownerId: process.env.JARVIS_OWNER_ID ?? null
      },
      activity: AgentActivity.list({ agent: JARVIS_KEY_NAME, limit })
    });
  });

  /**
   * Set Jarvis's address and API key from the app. Saved into .env on the PC
   * (never shown back in full) and used from the next message on.
   */
  app.post("/api/jarvis/config", authenticateAgent("execute"), (req: Request, res: Response) => {
    const { host, apiKey, ownerId } = (req.body ?? {}) as { host?: string; apiKey?: string; ownerId?: string };
    const changes: Record<string, string | null> = {};

    if (typeof host === "string" && host.trim()) {
      const clean = host.trim().replace(/\/+$/, "");
      if (!/^https?:\/\/[^\s/]+$/.test(clean)) return res.status(400).json({ error: "The address should look like https://jarvis.example.com" });
      changes.JARVIS_HOST = clean;
    }
    if (typeof apiKey === "string" && apiKey.trim()) {
      const clean = apiKey.trim();
      if (!/^jb_live_sk_[A-Za-z0-9_-]{16,}$/.test(clean)) {
        return res.status(400).json({ error: "That does not look like a Jarvis key: it should start with jb_live_sk_." });
      }
      changes.JARVIS_API_KEY = clean;
      // An explicit webhook URL would carry the old key inside it; build it from host + key instead.
      changes.JARVIS_WEBHOOK_URL = null;
    }
    if (typeof ownerId === "string" && ownerId.trim()) changes.JARVIS_OWNER_ID = ownerId.trim();
    if (Object.keys(changes).length === 0) return res.status(400).json({ error: "Nothing to save." });

    try {
      setEnvValues(changes);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
    reachability = null;
    Logger.log("Jarvis settings changed from the app", { fields: Object.keys(changes), by: (req as AgentRequest).actor });
    AgentActivity.record({
      direction: "in",
      agent: JARVIS_KEY_NAME,
      method: "CONFIG",
      path: "settings",
      status: 200,
      summary: `Settings changed from the app: ${Object.keys(changes).filter((k) => changes[k] !== null).join(", ")}`
    });
    res.json({ success: true, config: { host: process.env.JARVIS_HOST ?? null, apiKeySet: Boolean(process.env.JARVIS_API_KEY), apiKeyHint: hint(process.env.JARVIS_API_KEY) } });
  });

  /**
   * Give Jarvis his key into the builder: read, write and execute — he can see
   * every project and file, report issues, and run builds, repairs and the
   * machine's services. Shown once. Issuing again replaces the old key, so
   * Jarvis must be given the new one.
   */
  app.post("/api/jarvis/access", authenticateAgent("execute"), (req: Request, res: Response) => {
    const { secret, key } = AgentKeyModel.issue(JARVIS_KEY_NAME, ["read", "write", "execute"]);
    Logger.log("Jarvis access key issued from the app", { by: (req as AgentRequest).actor });
    AgentActivity.record({ direction: "in", agent: JARVIS_KEY_NAME, method: "ACCESS", path: "key", status: 200, summary: "New access key issued; the old one stops working" });
    res.json({
      key: secret,
      scopes: key.scopes,
      builderAddress: readPublicUrl(),
      howTo: "In Jarvis, set the Agent Builder address and this key (sent as the x-agent-key header). It is shown only once."
    });
  });

  app.delete("/api/jarvis/access", authenticateAgent("execute"), (req: Request, res: Response) => {
    const revoked = AgentKeyModel.revoke(JARVIS_KEY_NAME);
    Logger.log("Jarvis access revoked from the app", { by: (req as AgentRequest).actor, revoked });
    AgentActivity.record({ direction: "in", agent: JARVIS_KEY_NAME, method: "ACCESS", path: "key", status: 200, summary: "Access revoked from the app" });
    res.json({ success: true, revoked });
  });

  app.get("/api/jarvis/status", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(JarvisClient.describe());
  });

  /** Send a test event and report exactly what came back. */
  app.post("/api/jarvis/test", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const result = await JarvisClient.send({
      type: "test",
      subject: "Agent Builder connection test",
      body:
        "This is a test from Agent Builder. If you are reading it in Jarvis, the two are connected and " +
        "the builder can report builds, repairs and issues here.",
      metadata: { source: "manual-test" }
    });

    // A successful test is a good moment to clear anything that piled up.
    const flushed = result.ok ? await JarvisClient.flush() : { delivered: 0, remaining: 0 };
    res.status(result.ok ? 200 : 502).json({ ...result, flushed, connection: JarvisClient.describe() });
  });

  /** Push an arbitrary note - useful from the app, or from a script. */
  app.post("/api/jarvis/notify", authenticateAgent("write"), async (req: Request, res: Response) => {
    const { subject, body, type, project } = (req.body ?? {}) as {
      subject?: string;
      body?: string;
      type?: JarvisEventType;
      project?: string;
    };
    if (!subject || !body) return res.status(400).json({ error: "Both subject and body are required." });

    const result = await JarvisClient.send({
      type: type ?? "status",
      subject: subject.slice(0, 200),
      body: body.slice(0, 8000),
      project: project ?? null
    });
    res.status(result.ok ? 200 : 502).json(result);
  });

  /** Send the whole-machine briefing, so Jarvis knows where everything stands. */
  app.post("/api/jarvis/handoff", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const handoff = ContextPack.handoff();
    const result = await JarvisClient.send({
      type: "status",
      subject: `Agent Builder handoff: ${handoff.projects} projects, ${handoff.openIssues} open issue(s)`,
      body: handoff.markdown.slice(0, 8000),
      metadata: { projects: handoff.projects, openIssues: handoff.openIssues, errors: handoff.errors }
    });
    res.status(result.ok ? 200 : 502).json(result);
  });

  app.post("/api/jarvis/flush", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    res.json(await JarvisClient.flush());
  });

  /**
   * The bridge Jarvis drives the builder through (his AGENT_BUILDER_URL points
   * here). Same shape as the MyPortfolio bridge he was written against:
   * GET says whether it is up; POST carries { eventType, title, message,
   * metadata } and gets back what the builder did with it.
   *
   *   eventType "build" (or metadata.action "build") — start a build: title is
   *     the project name, message the brief.
   *   eventType "guidance" + metadata.buildId        — steer a running build.
   *   eventType "status"                             — what is building now.
   *   anything else                                  — kept as a note in the
   *     activity log, where the app's Jarvis screen shows it.
   */
  app.get("/api/agent-builder/bridge", authenticateAgent("read"), (_req: Request, res: Response) => {
    const active = BuildService.active();
    res.json({
      ok: true,
      name: "Agent Builder",
      address: readPublicUrl(),
      building: active.map((build) => ({ buildId: build.buildId, projectName: build.projectName, quality: build.bestScore ?? build.qualityScore ?? 0 })),
      accepts: ["build", "guidance", "status", "note", ...bridgeCatalogue().actions.map((action) => action.name), "api"],
      // Everything he can do here, what each action takes, and the scope it needs.
      ...bridgeCatalogue()
    });
  });

  app.post("/api/agent-builder/bridge", authenticateAgent("write"), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const metadata = body.metadata && typeof body.metadata === "object" ? (body.metadata as Record<string, unknown>) : {};
    const eventType = String(metadata.action ?? body.eventType ?? "note").toLowerCase();
    const title = typeof body.title === "string" ? body.title.trim().slice(0, 120) : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 8000) : "";
    const actor = (req as AgentRequest).actor ?? "agent:jarvis";
    const canExecute = Boolean((req as AgentRequest).agent?.scopes.includes("execute"));
    const note = (summary: string) =>
      AgentActivity.record({ direction: "in", agent: JARVIS_KEY_NAME, method: "BRIDGE", path: eventType, status: 200, summary });

    if (eventType === "build" || eventType === "build_request") {
      if (!canExecute) return res.status(403).json({ ok: false, error: 'Starting a build needs the "execute" scope.' });
      if (!message) return res.status(400).json({ ok: false, error: "Say what to build in message." });
      const platforms = Array.isArray(metadata.targetPlatforms) ? metadata.targetPlatforms.filter((p): p is string => typeof p === "string") : undefined;
      const headStart = typeof metadata.headStart === "string" && (HEAD_STARTS as readonly string[]).includes(metadata.headStart) ? (metadata.headStart as HeadStart) : undefined;
      const profile = metadata.profile === "fast" || metadata.profile === "balanced" || metadata.profile === "deep" ? metadata.profile : undefined;
      const record = BuildService.start({ projectName: title || "Jarvis request", description: message, startedBy: actor, targetPlatforms: platforms?.length ? platforms : undefined, headStart, profile });
      note(`Build started: ${record.projectName}`);
      return res.json({ ok: true, action: "build", buildId: record.buildId, projectName: record.projectName });
    }

    if (eventType === "guidance") {
      const buildId = typeof metadata.buildId === "string" ? metadata.buildId : "";
      if (!canExecute) return res.status(403).json({ ok: false, error: 'Steering a build needs the "execute" scope.' });
      const guidance = buildId && message ? BuildService.guide(buildId, message, actor) : null;
      if (!guidance) return res.status(404).json({ ok: false, error: "No running build with that buildId." });
      note(`Guidance for ${buildId}: ${message.slice(0, 80)}`);
      return res.json({ ok: true, action: "guidance", buildId });
    }

    if (eventType === "status") {
      return res.json({
        ok: true,
        action: "status",
        building: BuildService.active().map((build) => ({ buildId: build.buildId, projectName: build.projectName, state: build.state, quality: build.bestScore ?? 0 })),
        recent: BuildService.list().slice(0, 5).map((build) => ({ buildId: build.buildId, projectName: build.projectName, state: build.state, passed: build.passed, quality: build.bestScore ?? 0 }))
      });
    }

    // Any other action in the catalogue (art, apps, projects, the model…), or
    // "api" for a route it does not name: made as Jarvis, with his key.
    const params: Record<string, unknown> = { ...metadata, ...(title && metadata.title === undefined ? { title } : {}), ...(message && metadata.message === undefined ? { message } : {}) };
    const resolved = eventType === "note" || eventType === "jarvis_directive" ? null : resolveBridgeAction(eventType, params);
    if (resolved && !("error" in resolved)) {
      const scope = resolved.action?.scope ?? (resolved.call[0] === "GET" ? "read" : "execute");
      if (scope === "execute" && !canExecute) return res.status(403).json({ ok: false, action: eventType, error: `"${eventType}" needs the "execute" scope.` });
      try {
        const result = await callAsCaller(req, resolved.call);
        note(`${eventType}: ${resolved.call[0]} ${resolved.call[1].split("?")[0]} → ${result.status}`);
        const payload = result.body && typeof result.body === "object" && !Array.isArray(result.body) ? (result.body as Record<string, unknown>) : { result: result.body };
        return res.status(result.status).json({ ok: result.status < 400, action: eventType, status: result.status, ...payload });
      } catch (error) {
        return res.status(502).json({ ok: false, action: eventType, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (resolved && "error" in resolved && eventType !== "note" && !/^(jarvis_|note)/.test(eventType)) {
      // A name that looks like an action but is not one, or one missing what it needs: say so, rather than file it as a note.
      if (eventType.includes(".") || eventType === "api" || resolved.error.includes(" needs ")) return res.status(400).json({ ok: false, action: eventType, error: resolved.error });
    }

    note(`${title || "Note"}${message ? `: ${message.slice(0, 160)}` : ""}`);
    res.json({ ok: true, action: "note", received: true });
  });

  Logger.log("Jarvis routes registered", { configured: JarvisClient.isConfigured() });
};
