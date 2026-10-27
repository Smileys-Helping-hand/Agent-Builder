/**
 * How the agents learn, and the knowledge they share with Jarvis.
 *
 *   GET  /api/rl/stats              every policy: its approaches, tries, rewards, chance each is best; recent episodes
 *   POST /api/rl/feedback           { episodeId? | policy?, good? | value?, note?, source? } — a reward; with neither
 *                                    id nor policy it goes to the latest chat answer or lesson ("that was great")
 *   POST /api/rl/export             writes data/rl/sft.jsonl and dpo.jsonl for fine-tuning
 *   GET  /api/knowledge/search?q=   what the builder knows (findings, reports, lessons) and what Jarvis knows
 *   GET  /api/knowledge/status      the sync of the builder's knowledge into Jarvis's
 */
import type { Express, Request, Response } from "express";

import { SecondBrainClient } from "../integrations/SecondBrainClient.js";
import { SharedKnowledge } from "../knowledge/SharedKnowledge.js";
import { Reinforcement } from "../learning/Reinforcement.js";
import { FineTune } from "../learning/FineTune.js";
import { authenticateAgent, type AgentRequest } from "./agentAuth.js";

export const registerAgentLearningRoutes = (app: Express) => {
  app.get("/api/rl/stats", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ policies: Reinforcement.stats(), recent: Reinforcement.recent(30) });
  });

  app.post("/api/rl/feedback", authenticateAgent("write"), (req: Request, res: Response) => {
    const body = req.body ?? {};
    const value = typeof body.value === "number" ? body.value : body.good === true || body.good === "true" ? 1 : body.good === false || body.good === "false" ? 0 : null;
    if (value === null) return res.status(400).json({ error: "Send good: true/false, or value between 0 and 1." });
    const episode = Number.isInteger(Number(body.episodeId)) && Number(body.episodeId) > 0
      ? { id: Number(body.episodeId) }
      : Reinforcement.latest(typeof body.policy === "string" ? body.policy : undefined);
    if (!episode) return res.status(404).json({ error: "There is nothing recent to rate." });
    const source = typeof body.source === "string" ? body.source.slice(0, 40) : (req as AgentRequest).agent?.name ?? "app";
    const rewarded = Reinforcement.reward(episode.id, value, `${source}-rating`, typeof body.note === "string" ? body.note : undefined);
    if (!rewarded) return res.status(404).json({ error: "Unknown episode." });
    const policy = Reinforcement.policies().find((p) => p.id === rewarded.policy);
    res.json({ episode: rewarded, say: `Noted — ${policy?.label.toLowerCase() ?? "that agent"} learns from it (approach: ${rewarded.arm}).` });
  });

  app.post("/api/rl/export", authenticateAgent("execute"), (req: Request, res: Response) => {
    const minReward = typeof req.body?.minReward === "number" ? req.body.minReward : 0.8;
    res.json(Reinforcement.exportDataset(minReward));
  });

  /** Fine-tuning the local model's weights on the rewarded work (FineTune). */
  app.get("/api/rl/finetune", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(FineTune.status());
  });

  /** { check?: true } — check runs a few real steps on a tiny model to prove the stack trains. */
  app.post("/api/rl/finetune", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.status(202).json({ job: FineTune.start(req.body?.check === true) });
    } catch (error) {
      res.status(409).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/knowledge/search", authenticateAgent("read"), async (req: Request, res: Response) => {
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (!q) return res.status(400).json({ error: "Search with ?q=" });
    res.json(await SharedKnowledge.search(q, Math.min(Number(req.query.limit) || 20, 50)));
  });

  app.get("/api/knowledge/status", authenticateAgent("read"), async (_req: Request, res: Response) => {
    res.json(await SecondBrainClient.status());
  });
};
