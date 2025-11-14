import type { Express, Request, Response } from "express";
import { authenticate, authorizeRoles, type AuthenticatedRequest } from "./auth.js";
import { StoryOrchestrator } from "../orchestrator/StoryOrchestrator.js";
import { CollaborationHub } from "../orchestrator/CollaborationHub.js";
import { WorldSimulator } from "../orchestrator/WorldSimulator.js";
import { DialogEngine } from "../orchestrator/DialogEngine.js";
import { SocialGraph } from "../state/SocialGraph.js";
import { DiplomacyEngine } from "../orchestrator/DiplomacyEngine.js";
import { EconomyEngine } from "../orchestrator/EconomyEngine.js";
import { PlayerAgent } from "../agents/PlayerAgent.js";
import { GoalEngine } from "../orchestrator/GoalEngine.js";

const orchestrator = StoryOrchestrator.getInstance();
const hub = CollaborationHub.getInstance();
const simulator = WorldSimulator.getInstance();
const dialog = DialogEngine.getInstance();
const social = SocialGraph.getInstance();
const diplomacy = DiplomacyEngine.getInstance();
const economy = EconomyEngine.getInstance();
const players = PlayerAgent.getInstance();
const goals = GoalEngine.getInstance();

export const registerStoryworldRoutes = (app: Express) => {
  app.get(
    "/api/storyworld/events",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const events = await orchestrator.getTimeline(Number.isFinite(limit) ? Number(limit) : 150);
      res.json({ events });
    }
  );

  app.get(
    "/api/storyworld/summary",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
      const summary = await orchestrator.summarize(sessionId);
      res.json(summary);
    }
  );

  app.get(
    "/api/storyworld/entities/:entityId",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const entityId = req.params.entityId;
      const result = await orchestrator.recall(entityId);
      res.json(result);
    }
  );

  app.post(
    "/api/storyworld/command",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { command, sessionId, narrate } = req.body as {
        command?: string;
        sessionId?: string;
        narrate?: boolean;
      };

      if (!command?.trim()) {
        return res.status(400).json({ error: "Command text is required" });
      }

      const user = (req as AuthenticatedRequest).user;
      const result = await orchestrator.handleCommand(command, {
        sessionId,
        author: user?.email,
        narrate
      });

      res.json(result);
    }
  );

  app.get(
    "/api/storyworld/timeline",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      const events = hub.getStoryTimeline(Number.isFinite(limit) ? Number(limit) : 150);
      res.json({ events });
    }
  );

  app.get(
    "/api/storyworld/simulation/state",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (_req: Request, res: Response) => {
      res.json({ state: simulator.getState(), log: hub.getSimulationLog(120) });
    }
  );

  app.get(
    "/api/storyworld/social/state",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (_req: Request, res: Response) => {
      res.json({
        state: {
          graph: social.getSnapshot(),
          diplomacy: diplomacy.getSnapshot(),
          economy: economy.getSnapshot(),
          dialogue: dialog.getSnapshot()
        }
      });
    }
  );

  app.get(
    "/api/storyworld/players",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (_req: Request, res: Response) => {
      res.json({
        players: players.listPlayers(),
        goals: goals.getSnapshot(),
        running: players.isRunning()
      });
    }
  );

  app.post(
    "/api/storyworld/players",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { name, disposition, traits } = req.body as {
        name?: string;
        disposition?: string;
        traits?: string[];
      };

      const player = await players.spawnPlayer({
        name,
        disposition: disposition as any,
        traits: traits as any
      });

      res.json({ player, players: players.listPlayers(), goals: goals.getSnapshot(), running: players.isRunning() });
    }
  );

  app.post(
    "/api/storyworld/players/control",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      const { action } = req.body as { action?: string };
      if (action === "pause") {
        players.pause();
      } else if (action === "resume") {
        players.resume();
      } else {
        return res.status(400).json({ error: "Unsupported action" });
      }

      res.json({ running: players.isRunning(), players: players.listPlayers() });
    }
  );

  app.post(
    "/api/storyworld/goals",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { type, catalyst } = req.body as { type?: string; catalyst?: string };
      const goal = await goals.spawnGoal({ catalyst, type: type as any });
      res.json({ goal, goals: goals.getSnapshot() });
    }
  );

  app.post(
    "/api/storyworld/simulation/control",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { action, speed, steps } = req.body as {
        action?: string;
        speed?: number;
        steps?: number;
      };

      if (!action) {
        return res.status(400).json({ error: "Action is required" });
      }

      let state;
      switch (action) {
        case "pause":
          simulator.pause();
          state = simulator.getState();
          break;
        case "resume":
          await simulator.start();
          state = simulator.getState();
          break;
        case "step":
          state = await simulator.step();
          break;
        case "fast_forward":
          state = await simulator.fastForward(steps && Number.isFinite(steps) ? Number(steps) : 3);
          break;
        case "set_speed":
          if (!Number.isFinite(speed ?? NaN)) {
            return res.status(400).json({ error: "Speed must be a number" });
          }
          simulator.setSpeed(Number(speed));
          state = simulator.getState();
          break;
        default:
          return res.status(400).json({ error: `Unsupported action: ${action}` });
      }

      res.json({ state });
    }
  );
};
