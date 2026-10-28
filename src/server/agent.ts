/**
 * Agent Builder as an agent: its profile and growth, conversations with it,
 * its training ground, and continuous improvement with approvals.
 *
 *   GET    /api/agent/profile                      level, XP, abilities (new ones flagged), strength, growth, doing
 *   GET    /api/agent/chat                         the conversation and the answer being written
 *   POST   /api/agent/chat                         { message, source? } → 202 (?wait=1: the answer)
 *   POST   /api/agent/chat/:id/act                 run the action it proposed (:id "latest" = newest not yet run)
 *   DELETE /api/agent/chat
 *   GET    /api/agent/ground                       challenges, scores, runs
 *   POST   /api/agent/ground/practise              { challengeId? }
 *   POST   /api/agent/ground/enabled               { enabled }
 *   POST   /api/agent/ground/harder                ask the model for harder challenges
 *   GET    /api/agent/continuous                   sessions (roadmap, journal), deliveries waiting and decided
 *   POST   /api/agent/continuous/start             { projectId | newProject: name, goal?, mode?: "complete"|"forever", checkCommand? }
 *   POST   /api/agent/continuous/:id/instruct      { text }  a new instruction; the roadmap is revised
 *   POST   /api/agent/continuous/:id/configure     { mode?, checkCommand? }
 *   POST   /api/agent/continuous/:id/stop
 *   POST   /api/agent/continuous/:id/restart       carry on from where it got to
 *   GET    /api/agent/approvals/:id/diff           ?file=… one file
 *   POST   /api/agent/approvals/:id/approve        { files? } the parts to add; applied + committed on the live branch
 *   POST   /api/agent/approvals/:id/reject         { note? }
 */
import type { Express, Request, Response } from "express";

import { AgentChat, setAgentActions } from "../agent/AgentChat.js";
import { AgentProfile, registerProfileSources } from "../agent/AgentProfile.js";
import { ContinuousImprover } from "../agent/ContinuousImprover.js";
import { TrainingGround } from "../agent/TrainingGround.js";
import { GameMode } from "../utils/GameMode.js";
import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { ASKABLE } from "./builderAsk.js";
import { BRIDGE_ACTIONS, callAsCaller, resolveBridgeAction } from "./jarvisActions.js";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const registerAgentRoutes = (app: Express) => {
  // What it may propose in conversation: the same safe list the ask planner uses.
  setAgentActions(() =>
    BRIDGE_ACTIONS.filter((a) => ASKABLE.includes(a.name) && !a.name.startsWith("agent.")).map((a) => ({ name: a.name, label: a.label, params: a.params }))
  );
  registerProfileSources({
    approvedImprovements: () => ContinuousImprover.approvedCount(),
    waitingApprovals: () => ContinuousImprover.waitingCount(),
    practiceWins: () => TrainingGround.wins(),
    continuousRunning: () => ContinuousImprover.running(),
    practising: () => TrainingGround.practising()
  });
  AgentProfile.start();
  TrainingGround.start();
  ContinuousImprover.resume();

  app.get("/api/agent/profile", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(AgentProfile.profile());
  });

  app.get("/api/agent/chat", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ messages: AgentChat.history(80), pending: AgentChat.pending() });
  });

  app.post("/api/agent/chat", authenticateAgent("write"), async (req: Request, res: Response) => {
    if (GameMode.isOn()) return res.status(409).json({ error: "Game mode is on: the graphics card is yours. Switch it off to talk." });
    const text = typeof req.body?.message === "string" ? req.body.message : "";
    // Jarvis says so himself (his bridge action sends source "jarvis"); everything else is the owner in the app.
    const source = req.body?.source === "jarvis" ? "jarvis" : "app";
    try {
      if (req.query.wait === "1") return res.json(await AgentChat.ask(text, source));
      const { question } = AgentChat.start(text, source);
      res.status(202).json({ question, pending: AgentChat.pending() });
    } catch (error) {
      res.status(/Still answering/.test(message(error)) ? 409 : 400).json({ error: message(error) });
    }
  });

  app.post("/api/agent/chat/:id/act", authenticateAgent("write"), async (req: Request, res: Response) => {
    const proposal = req.params.id === "latest" ? AgentChat.latestProposal() : AgentChat.get(Number(req.params.id));
    if (!proposal?.action) return res.status(404).json({ error: "There is no proposed action to run." });
    if (proposal.result) return res.status(409).json({ error: "That was already done.", result: proposal.result });
    const resolved = resolveBridgeAction(proposal.action.action, proposal.action.params);
    if ("error" in resolved) return res.status(422).json({ error: resolved.error });
    try {
      const result = await callAsCaller(req, resolved.call);
      const body = result.body as Record<string, unknown> | null;
      const summary =
        typeof body?.error === "string" ? body.error : typeof body?.message === "string" ? body.message : typeof body?.say === "string" ? body.say : result.status < 400 ? "Done." : `Failed (${result.status}).`;
      AgentChat.recordResult(proposal.id, result.status, summary);
      res.status(result.status).json({ ok: result.status < 400, action: proposal.action.action, summary, result: body });
    } catch (error) {
      AgentChat.recordResult(proposal.id, 500, message(error));
      res.status(502).json({ error: message(error) });
    }
  });

  app.delete("/api/agent/chat", authenticateAgent("write"), (_req: Request, res: Response) => {
    try {
      res.json({ cleared: AgentChat.clear() });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });

  app.get("/api/agent/ground", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(TrainingGround.state());
  });

  app.post("/api/agent/ground/practise", authenticateAgent("execute"), (req: Request, res: Response) => {
    if (GameMode.isOn()) return res.status(409).json({ error: "Game mode is on." });
    try {
      res.json({ run: TrainingGround.practise(typeof req.body?.challengeId === "string" ? req.body.challengeId : undefined, (req as AgentRequest).actor ?? "owner") });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });

  app.post("/api/agent/ground/enabled", authenticateAgent("execute"), (req: Request, res: Response) => {
    TrainingGround.setEnabled(req.body?.enabled === true || req.body?.enabled === "true");
    res.json(TrainingGround.state());
  });

  app.post("/api/agent/ground/harder", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    try {
      res.json({ added: await TrainingGround.addHarder() });
    } catch (error) {
      res.status(500).json({ error: message(error) });
    }
  });

  app.get("/api/agent/continuous", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(ContinuousImprover.list());
  });

  app.post("/api/agent/continuous/start", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const projectId = typeof body.projectId === "string" ? body.projectId : "";
    const newProject = typeof body.newProject === "string" ? body.newProject.trim() : "";
    const goal = typeof body.goal === "string" ? body.goal : typeof body.focus === "string" ? body.focus : "";
    const options = {
      goal,
      mode: body.mode === "complete" ? ("complete" as const) : ("forever" as const),
      checkCommand: typeof body.checkCommand === "string" ? body.checkCommand : null
    };
    if (!projectId && !newProject) return res.status(400).json({ error: "Choose a project, or name a new one." });
    if (newProject && goal.trim().length < 10) return res.status(400).json({ error: "Say what to build: a new project starts from its goal." });
    const actor = (req as AgentRequest).actor ?? "owner";
    try {
      res.json({ session: newProject ? await ContinuousImprover.startNew(newProject, options, actor) : ContinuousImprover.start(projectId, options, actor) });
    } catch (error) {
      res.status(/Unknown project/.test(message(error)) ? 404 : 409).json({ error: message(error) });
    }
  });

  app.post("/api/agent/continuous/:id/instruct", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ session: ContinuousImprover.instruct(req.params.id, typeof req.body?.text === "string" ? req.body.text : "") });
    } catch (error) {
      res.status(/Unknown/.test(message(error)) ? 404 : 400).json({ error: message(error) });
    }
  });

  app.post("/api/agent/continuous/:id/configure", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      const mode = req.body?.mode === "complete" || req.body?.mode === "forever" ? req.body.mode : undefined;
      const checkCommand = typeof req.body?.checkCommand === "string" || req.body?.checkCommand === null ? req.body.checkCommand : undefined;
      res.json({ session: ContinuousImprover.configure(req.params.id, { mode, checkCommand }) });
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });

  app.post("/api/agent/continuous/:id/restart", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ session: ContinuousImprover.restart(req.params.id) });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });

  app.post("/api/agent/continuous/:id/stop", authenticateAgent("execute"), (req: Request, res: Response) => {
    const session = ContinuousImprover.stop(req.params.id);
    if (!session) return res.status(404).json({ error: "Unknown session." });
    res.json({ session });
  });

  app.get("/api/agent/approvals/:id/diff", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json({ diff: await ContinuousImprover.diff(req.params.id, typeof req.query.file === "string" ? req.query.file : undefined) });
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });

  app.post("/api/agent/approvals/:id/approve", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      const files = Array.isArray(req.body?.files) ? (req.body.files as unknown[]).filter((f): f is string => typeof f === "string") : undefined;
      res.json({ candidate: await ContinuousImprover.approve(req.params.id, files) });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });

  app.post("/api/agent/approvals/:id/reject", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      res.json({ candidate: await ContinuousImprover.reject(req.params.id, typeof req.body?.note === "string" ? req.body.note : "") });
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });
};
