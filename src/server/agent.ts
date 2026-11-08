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
 *   POST   /api/agent/continuous/start             { projectId | newProject: name, goal?, mode?: "complete"|"forever", checkCommand?, kind?: "app"|"game", multiplayer? }
 *   POST   /api/agent/continuous/:id/instruct      { text }  a new instruction; the roadmap is revised
 *   POST   /api/agent/continuous/:id/configure     { mode?, checkCommand? }
 *   POST   /api/agent/continuous/:id/stop
 *   POST   /api/agent/continuous/:id/restart       carry on from where it got to
 *   GET    /api/agent/approvals/:id/diff           ?file=… one file
 *   POST   /api/agent/approvals/:id/approve        { files? } the parts to add; applied + committed on the live branch
 *   POST   /api/agent/approvals/:id/reject         { note? }
 *   GET    /api/agent/continuous/:id/iterations    the iteration explorer: the one in progress, then every one
 *   GET    /api/agent/continuous/:id/iterations/compare?a=&b=   two iterations side by side
 *   GET    /api/agent/continuous/:id/iterations/:n  one in full (n = current for the one in progress): changes, why, learning, tests, feedback
 *   GET    /api/agent/continuous/:id/iterations/:n/diff?file=   one file's diff
 *   POST   /api/agent/continuous/:id/iterations/:n/feedback     { text, kind? }
 *   GET    /api/agent/overview                     what is going on across everything: agents, VMs, research, learning, evaluations, what waits for you
 *   GET    /api/agent/learning                     the learning centre: knowledge by status and kind, where it came from, whether it helped
 *   POST   /api/agent/learning/lessons/:id         { decision: "verified"|"rejected"|null } your say on a lesson
 *   GET    /api/agent/evidence?ref=&limit=         the evidence ledger: recent records, or one record's trace in both directions
 *   GET    /api/agent/evaluations                  evaluation runs and challenges
 *   POST   /api/agent/evaluations                  { label?, withKnowledge?, trials?, only? } run them
 *   GET    /api/agent/evaluations/compare?a=&b=    two runs side by side, with regressions
 *   POST   /api/agent/evaluations/challenges       add one of your own (a defect once fixed stays tested)
 *   GET    /api/agent/investigations               deep research investigations
 *   POST   /api/agent/investigations               { objective }
 *   GET    /api/agent/investigations/:id           its plan, specialists, experiments, contradictions, report, evidence matrix, sources
 *   POST   /api/agent/investigations/:id/stop|resume
 *   POST   /api/agent/investigations/:id/feedback  { text, kind? }
 *   GET    /api/agent/experiments                  the Simulation Lab: experiments of your own and those inside investigations
 *   POST   /api/agent/experiments                  { title, description } | { title, code, variables, objective, … }
 *   POST   /api/agent/experiments/:id/run|optimise { seed? } | { rounds? }
 *   POST   /api/agent/experiments/:id/feedback     { text }
 *   GET    /api/agent/evidence/graph?ref=&depth=   how the records connect
 *   GET    /api/agent/twin/:projectId              what is known about a project now: parts, defects, what it can do
 *   POST   /api/agent/jarvis-tasks/sync            bring Jarvis's task list up to date now
 *   GET    /api/agent/self                         what it has learned about itself: findings, and its self-improvement session
 *   POST   /api/agent/self/start                   improve its own code from them (approval-gated, like any project)
 *   GET    /api/agent/reconstruct                  the Reconstructor: runs and what it has learned
 *   POST   /api/agent/reconstruct                  { projectId } | { gitUrl } | { siteUrl }: study, rebuild, compare, learn
 *   POST   /api/agent/reconstruct/:id/again        another round on what it still misses
 *   POST   /api/agent/reconstruct/:id/stop
 */
import type { Express, Request, Response } from "express";

import { AgentChat, setAgentActions } from "../agent/AgentChat.js";
import { AgentProfile, registerProfileSources } from "../agent/AgentProfile.js";
import { ContinuousImprover } from "../agent/ContinuousImprover.js";
import { Iterations } from "../agent/Iterations.js";
import type { VmTestConfig } from "../lab/VmCheck.js";
import { Reconstructor } from "../agent/Reconstructor.js";
import { SelfImprover } from "../agent/SelfImprover.js";
import { DiskGuard } from "../utils/DiskGuard.js";
import { ProjectTwin } from "../ecosystem/ProjectTwin.js";
import { JarvisTasks } from "../integrations/JarvisTasks.js";
import { SimulationLab } from "../research/SimulationLab.js";
import { Evidence } from "../knowledge/Evidence.js";
import { Evaluations } from "../learning/Evaluations.js";
import { LearningLoop } from "../learning/LearningLoop.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { VmLab } from "../lab/VmLab.js";
import { VmTests } from "../lab/VmTests.js";
import { Investigations } from "../research/Investigation.js";
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
    continuousProgress: () => ContinuousImprover.progress(),
    appsReconstructed: () => Reconstructor.skills().appsRebuilt,
    reconstructing: () => Reconstructor.running(),
    practiceWins: () => TrainingGround.wins(),
    continuousRunning: () => ContinuousImprover.running(),
    practising: () => TrainingGround.practising()
  });
  AgentProfile.start();
  TrainingGround.start();
  ContinuousImprover.resume();
  Reconstructor.resume();

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
      checkCommand: typeof body.checkCommand === "string" ? body.checkCommand : null,
      ...(body.kind === "game" || body.kind === "app" ? { kind: body.kind as "game" | "app" } : {}),
      ...(body.multiplayer === true || body.multiplayer === "true" ? { multiplayer: true } : body.multiplayer === false || body.multiplayer === "false" ? { multiplayer: false } : {})
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
      const vmTest = req.body?.vmTest === null ? null : req.body?.vmTest && typeof req.body.vmTest === "object" ? (req.body.vmTest as VmTestConfig) : undefined;
      res.json({ session: ContinuousImprover.configure(req.params.id, { mode, checkCommand, vmTest }) });
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

  app.get("/api/agent/continuous/:id/iterations", authenticateAgent("read"), (req: Request, res: Response) => {
    try {
      res.json(Iterations.timeline(req.params.id));
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });
  app.get("/api/agent/continuous/:id/iterations/compare", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json(await Iterations.compare(req.params.id, Number(req.query.a), Number(req.query.b)));
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });
  app.get("/api/agent/continuous/:id/iterations/:n", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json(await Iterations.detail(req.params.id, req.params.n === "current" ? "current" : Number(req.params.n)));
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });
  app.get("/api/agent/continuous/:id/iterations/:n/diff", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json({ diff: await Iterations.fileDiff(req.params.id, Number(req.params.n), String(req.query.file ?? "")) });
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });
  app.post("/api/agent/continuous/:id/iterations/:n/feedback", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json(Iterations.feedback(req.params.id, Number(req.params.n), { text: String(req.body?.text ?? ""), kind: typeof req.body?.kind === "string" ? req.body.kind : undefined, by: (req as AgentRequest).actor ?? "owner" }));
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });

  Investigations.ensureTicking();
  LearningLoop.start();
  Evaluations.resumeInterrupted();
  JarvisTasks.start();

  app.get("/api/agent/experiments", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(SimulationLab.list());
  });
  // Writing one with the model can outlast the tunnel: answer at once and let the app poll.
  app.post("/api/agent/experiments", authenticateAgent("execute"), (req: Request, res: Response) => {
    const work = SimulationLab.create(req.body ?? {});
    const timer = setTimeout(() => {
      if (!res.headersSent) res.status(202).json({ pending: true });
    }, 60_000);
    work
      .then((experiment) => {
        clearTimeout(timer);
        if (!res.headersSent) res.json({ experiment });
      })
      .catch((error) => {
        clearTimeout(timer);
        if (!res.headersSent) res.status(400).json({ error: message(error) });
      });
  });
  app.post("/api/agent/experiments/:id/run", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      res.json({ experiment: await SimulationLab.run(req.params.id, { seed: Number(req.body?.seed) || Math.floor(Math.random() * 1e9), label: "Another seed" }) });
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });
  app.post("/api/agent/experiments/:id/optimise", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      res.json({ experiment: await SimulationLab.optimise(req.params.id, Number(req.body?.rounds) || 3) });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });
  app.post("/api/agent/experiments/:id/feedback", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ experiment: SimulationLab.feedback(req.params.id, String(req.body?.text ?? ""), (req as AgentRequest).actor ?? "owner") });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });
  app.get("/api/agent/evidence/graph", authenticateAgent("read"), (req: Request, res: Response) => {
    res.json(Evidence.graph({ ref: typeof req.query.ref === "string" ? req.query.ref : undefined, depth: Number(req.query.depth) || 2, limit: Number(req.query.limit) || 120 }));
  });
  app.get("/api/agent/twin/:projectId", authenticateAgent("read"), async (req: Request, res: Response) => {
    const twin = await ProjectTwin.forProject(req.params.projectId).catch(() => null);
    if (!twin) return res.status(404).json({ error: "No session on that project." });
    res.json({ twin });
  });
  app.post("/api/agent/jarvis-tasks/sync", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    try {
      res.json(await JarvisTasks.sync());
    } catch (error) {
      res.status(502).json({ error: message(error) });
    }
  });

  app.get("/api/agent/investigations", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ investigations: Investigations.list().map(({ id, objective, state, phase, round, createdAt, finishedAt, specialists, experiments, contradictions, error }) => ({ id, objective, state, phase, round, createdAt, finishedAt, error, specialists: specialists.length, specialistsDone: specialists.filter((s) => s.status === "done").length, experiments: experiments.length, contradictions: contradictions.length })) });
  });
  app.post("/api/agent/investigations", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ investigation: Investigations.start(String(req.body?.objective ?? ""), (req as AgentRequest).actor ?? "owner") });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });
  app.get("/api/agent/investigations/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const full = Investigations.full(req.params.id);
    if (!full) return res.status(404).json({ error: "Unknown investigation." });
    res.json({ investigation: full });
  });
  app.post("/api/agent/investigations/:id/stop", authenticateAgent("execute"), (req: Request, res: Response) => {
    const item = Investigations.stop(req.params.id);
    if (!item) return res.status(404).json({ error: "Unknown investigation." });
    res.json({ investigation: item });
  });
  app.post("/api/agent/investigations/:id/resume", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ investigation: Investigations.resume(req.params.id) });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });
  app.post("/api/agent/investigations/:id/feedback", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ investigation: Investigations.feedback(req.params.id, { text: String(req.body?.text ?? ""), kind: typeof req.body?.kind === "string" ? req.body.kind : undefined, by: (req as AgentRequest).actor ?? "owner" }) });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });

  app.get("/api/agent/evaluations", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ runs: Evaluations.list().slice(0, 50), running: Evaluations.isRunning(), challenges: Evaluations.challenges().map(({ id, category, title, custom }) => ({ id, category, title, custom: Boolean(custom) })) });
  });
  app.post("/api/agent/evaluations", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      const { done: _done, ...run } = Evaluations.start({ label: typeof req.body?.label === "string" ? req.body.label : undefined, withKnowledge: req.body?.withKnowledge !== false, trials: Number(req.body?.trials) || 1, only: Array.isArray(req.body?.only) ? (req.body.only as string[]) : undefined });
      res.json({ run });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });
  app.get("/api/agent/evaluations/compare", authenticateAgent("read"), (req: Request, res: Response) => {
    try {
      res.json(Evaluations.compare(String(req.query.a ?? ""), String(req.query.b ?? "")));
    } catch (error) {
      res.status(404).json({ error: message(error) });
    }
  });
  app.post("/api/agent/evaluations/challenges", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ challenge: Evaluations.addChallenge(req.body ?? {}) });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });

  app.get("/api/agent/learning", authenticateAgent("read"), (_req: Request, res: Response) => {
    const lessons = LessonMemory.list(undefined, 1000);
    const tally = (key: (l: (typeof lessons)[number]) => string) => {
      const counts = new Map<string, { count: number; applied: number; helped: number }>();
      for (const lesson of lessons) {
        const row = counts.get(key(lesson)) ?? { count: 0, applied: 0, helped: 0 };
        row.count += 1;
        row.applied += lesson.timesApplied;
        row.helped += lesson.timesHelped;
        counts.set(key(lesson), row);
      }
      return [...counts].map(([name, row]) => ({ name, ...row })).sort((a, b) => b.count - a.count);
    };
    const loop = LearningLoop.state();
    res.json({
      total: lessons.length,
      byStatus: tally((l) => l.status),
      byCategory: tally((l) => l.category),
      bySource: tally((l) => l.source),
      lessons: lessons.slice(0, 300),
      contributions: LessonMemory.contributions().slice(0, 40),
      ledger: Evidence.counts(),
      loop: { topicId: loop.topicId, asked: loop.asked.slice(-20).reverse(), reconstructed: loop.reconstructed.length, lastTickAt: loop.lastTickAt }
    });
  });
  app.post("/api/agent/learning/lessons/:id", authenticateAgent("execute"), (req: Request, res: Response) => {
    const decision = req.body?.decision === "verified" || req.body?.decision === "rejected" ? req.body.decision : null;
    const lesson = LessonMemory.decide(Number(req.params.id), decision);
    if (!lesson) return res.status(404).json({ error: "Unknown lesson." });
    Evidence.record({ kind: "feedback", ref: `lesson-decision:${lesson.id}:${Date.now().toString(36)}`, agent: (req as AgentRequest).actor ?? "owner", title: `${decision ?? "undecided"}: ${lesson.lesson.slice(0, 120)}`, outcome: decision ?? "undecided", links: [{ to: `lesson:${lesson.id}`, relation: "feedback-on" }] });
    res.json({ lesson });
  });

  app.get("/api/agent/evidence", authenticateAgent("read"), (req: Request, res: Response) => {
    const ref = typeof req.query.ref === "string" ? req.query.ref : "";
    if (ref) return res.json(Evidence.trace(ref));
    res.json({ records: Evidence.recent({ limit: Math.min(200, Number(req.query.limit) || 50) }), counts: Evidence.counts() });
  });

  app.get("/api/agent/overview", authenticateAgent("read"), (_req: Request, res: Response) => {
    const { sessions, deliveries } = ContinuousImprover.list();
    const running = sessions.filter((s) => s.state !== "stopped");
    const vms = VmLab.list();
    const runs = VmTests.list(8);
    const investigations = Investigations.list();
    const evaluations = Evaluations.list();
    res.json({
      agents: running.map((s) => ({ id: s.id, project: s.projectName, stage: s.stage, phase: s.phase, kind: s.kind ?? "app", cycles: s.cycles, milestones: `${s.plan.filter((m) => m.status === "done").length}/${s.plan.length}`, buildId: s.currentBuildId, lastError: s.lastError })),
      iterations: running
        .flatMap((s) => s.journal.slice(-4).map((step) => ({ session: s.id, project: s.projectName, n: step.n ?? null, title: step.title, outcome: step.outcome, at: step.at })))
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 10),
      vms: { running: vms.filter((v) => v.state === "running" || v.state === "paused").map((v) => ({ id: v.id, name: v.name, state: v.state })), total: vms.length },
      tests: runs.map((r) => ({ id: r.id, vm: r.vmName, state: r.state, counts: r.counts, at: r.startedAt, iso: r.build.iso })),
      research: investigations.filter((i) => !["done", "failed", "stopped"].includes(i.state)).map((i) => ({ id: i.id, objective: i.objective, phase: i.phase })),
      discoveries: Evidence.recent({ kind: "knowledge", limit: 6 }).concat(Evidence.recent({ kind: "experiment", limit: 4 })).map((r) => ({ kind: r.kind, title: r.title, outcome: r.outcome, at: r.createdAt })),
      lessons: { total: LessonMemory.list(undefined, 2000).length, recent: LessonMemory.list(undefined, 2000).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5).map((l) => ({ id: l.id, lesson: l.lesson.slice(0, 200), status: l.status, at: l.createdAt })) },
      evaluation: evaluations[0] ? { id: evaluations[0].id, label: evaluations[0].label, state: evaluations[0].state, score: evaluations[0].score, at: evaluations[0].startedAt, withKnowledge: evaluations[0].withKnowledge } : null,
      failures: sessions.filter((s) => s.lastError).map((s) => ({ project: s.projectName, error: s.lastError })).slice(0, 6),
      approvals: { deliveries: deliveries.filter((d) => d.state === "awaiting").map((d) => ({ id: d.id, project: d.projectName, files: d.files.length, major: d.major })) },
      ledger: Evidence.counts(),
      disk: { freeGb: DiskGuard.freeGb(), low: DiskGuard.low() }
    });
  });

  app.get("/api/agent/self", authenticateAgent("read"), async (_req: Request, res: Response) => {
    try {
      res.json({ report: await SelfImprover.report(), session: SelfImprover.session() });
    } catch (error) {
      res.status(500).json({ error: message(error) });
    }
  });

  app.post("/api/agent/self/start", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      res.json(await SelfImprover.start((req as AgentRequest).actor ?? "owner"));
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });

  app.get("/api/agent/reconstruct", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(Reconstructor.list());
  });

  app.post("/api/agent/reconstruct", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const actor = (req as AgentRequest).actor ?? "owner";
    try {
      if (typeof req.body?.projectId === "string" && req.body.projectId) return res.json({ run: Reconstructor.fromProject(req.body.projectId, actor) });
      if (typeof req.body?.gitUrl === "string" && req.body.gitUrl) return res.json({ run: await Reconstructor.fromGit(req.body.gitUrl, actor) });
      if (typeof req.body?.siteUrl === "string" && req.body.siteUrl) return res.json({ run: await Reconstructor.fromWebsite(req.body.siteUrl, actor) });
      res.status(400).json({ error: "Choose one of your projects, or give a Git repository's or a website's address." });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });

  app.post("/api/agent/reconstruct/:id/again", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ run: Reconstructor.again(req.params.id) });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });

  app.post("/api/agent/reconstruct/:id/stop", authenticateAgent("execute"), (req: Request, res: Response) => {
    const run = Reconstructor.stop(req.params.id);
    if (!run) return res.status(404).json({ error: "Unknown run." });
    res.json({ run });
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
