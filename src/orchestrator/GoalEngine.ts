import { v4 as uuidv4 } from "uuid";
import { Logger } from "../utils/Logger.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { WorldMemory } from "../state/WorldMemory.js";
import { LoreEngine } from "./LoreEngine.js";
import type { PlayerGoalState, PlayerState } from "../agents/PlayerAgent.js";
import type { SimulationEvent } from "./WorldSimulator.js";

export type GlobalGoalType = "conquest" | "discovery" | "diplomacy" | "artifact" | "exploration";

export type GlobalGoalState = PlayerGoalState & {
  description: string;
  scope: GlobalGoalType;
  ownerId?: string;
  contenders: string[];
  reward?: string;
  worldImpact?: string;
  targetFaction?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
};

export type GoalSnapshot = {
  goals: GlobalGoalState[];
  completed: GlobalGoalState[];
};

const GOAL_TYPES: GlobalGoalType[] = ["conquest", "discovery", "diplomacy", "artifact", "exploration"];

const pick = <T>(values: T[]): T => values[Math.floor(Math.random() * values.length)];
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));
const GOAL_INTERVAL_MS = Number(process.env.PLAYER_GOAL_INTERVAL ?? 60_000);

export class GoalEngine {
  private static instance: GoalEngine | null = null;
  private readonly world = WorldMemory.getInstance();
  private readonly lore = LoreEngine.getInstance();
  private readonly goals = new Map<string, GlobalGoalState>();
  private lastGoalSpawn = Date.now();

  static getInstance() {
    if (!this.instance) {
      this.instance = new GoalEngine();
    }
    return this.instance;
  }

  private constructor() {
    void this.world.init();
  }

  listGoals(): GlobalGoalState[] {
    return [...this.goals.values()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getActiveGoals(): GlobalGoalState[] {
    return this.listGoals().filter((goal) => goal.status === "active");
  }

  getSnapshot(): GoalSnapshot {
    const goals = this.listGoals();
    return {
      goals: goals.filter((goal) => goal.status === "active"),
      completed: goals.filter((goal) => goal.status !== "active")
    };
  }

  async assignGoal(player: PlayerState): Promise<PlayerGoalState | null> {
    const reusable = this.getActiveGoals().find((goal) => !goal.ownerId || goal.ownerId === player.id);
    const target = reusable ?? (await this.spawnGoal({ catalyst: player }));
    if (!target) return null;

    target.ownerId = player.id;
    target.updatedAt = new Date().toISOString();
    if (!target.contenders.includes(player.id)) {
      target.contenders.push(player.id);
    }

    return {
      id: target.id,
      label: target.label,
      type: target.scope,
      progress: 0,
      status: "active",
      assignedAt: new Date().toISOString(),
      targetFaction: target.targetFaction,
      resolvedAt: undefined
    } satisfies PlayerGoalState;
  }

  async spawnGoal(options: { catalyst?: PlayerState | string; type?: GlobalGoalType } = {}): Promise<GlobalGoalState | null> {
    const type = options.type ?? pick(GOAL_TYPES);
    const id = uuidv4();
    const createdAt = new Date().toISOString();
    const context = typeof options.catalyst === "string" ? options.catalyst : options.catalyst?.name;
    const directive = `Create a ${type} goal for an agent builder project. Catalyst: ${context ?? "automation focus"}. ` +
      "Return a short label and description under 60 words.";

    let label = `${type.toUpperCase()} Objective`;
    let description = `Pursue a ${type} objective shaped by the simulation.`;
    try {
      const completion = await ModelRouter.generate(directive);
      const [firstLine, ...rest] = completion.split("\n").map((line) => line.trim()).filter(Boolean);
      if (firstLine) label = firstLine.slice(0, 80);
      if (rest.length > 0) {
        description = rest.join(" ").slice(0, 280);
      }
    } catch (error) {
      Logger.warn("GoalEngine language model fallback", error);
    }

    const goal: GlobalGoalState = {
      id,
      label,
      scope: type,
      type,
      description,
      progress: 0,
      status: "active",
      assignedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      contenders: [],
      reward: undefined,
      worldImpact: undefined
    };

    this.goals.set(id, goal);
    try {
      await this.world.recordEvent({
        entityId: `goal-${id}`,
        entityType: "quest",
        entityLabel: label,
        description,
        tags: ["goal", type],
        metadata: { scope: type, catalyst: context },
        sessionId: "storyworld"
      });
    } catch (error) {
      Logger.warn("Failed to persist goal seed", error);
    }

    return goal;
  }

  async resolveGoal(
    goalId: string,
    outcome: "completed" | "failed",
    actorId: string,
    details: Record<string, unknown>
  ) {
    const goal = this.goals.get(goalId);
    if (!goal) return;

    goal.status = outcome;
    goal.progress = outcome === "completed" ? 100 : goal.progress;
    goal.updatedAt = new Date().toISOString();
    goal.resolvedAt = goal.updatedAt;
    goal.ownerId = actorId;

    try {
      await this.world.recordEvent({
        entityId: `goal-${goalId}`,
        entityType: "quest",
        entityLabel: goal.label,
        description: `Goal ${outcome} by ${actorId}.`,
        tags: ["goal", outcome],
        metadata: { ...details, scope: goal.scope },
        sessionId: "storyworld",
        relatedEntities: [{ entityId: `player-${actorId}`, relation: "attempted_by" }]
      });
      await this.lore.recordGoalImpact(goal, outcome, actorId, details);
    } catch (error) {
      Logger.warn("GoalEngine failed to log resolution", error);
    }
  }

  async reportProgress(goalId: string, actorId: string, progress: number) {
    const goal = this.goals.get(goalId);
    if (!goal || goal.status !== "active") return;
    goal.progress = clamp(progress, 0, 100);
    goal.updatedAt = new Date().toISOString();
    if (!goal.contenders.includes(actorId)) {
      goal.contenders.push(actorId);
    }

    if (goal.progress % 25 < 10) {
      try {
        await this.world.recordEvent({
          entityId: `goal-${goalId}`,
          entityType: "quest",
          entityLabel: goal.label,
          description: `Goal progress updated to ${goal.progress}% by ${actorId}.`,
          tags: ["goal", "progress"],
          metadata: { actorId, progress: goal.progress },
          sessionId: "storyworld",
          relatedEntities: [{ entityId: `player-${actorId}`, relation: "contributed_by" }]
        });
      } catch (error) {
        Logger.warn("GoalEngine failed to persist progress", error);
      }
    }
  }

  async runTick(players: PlayerState[]): Promise<SimulationEvent | null> {
    const now = Date.now();
    const shouldSpawn = now - this.lastGoalSpawn >= GOAL_INTERVAL_MS;
    const insufficientGoals = this.getActiveGoals().length < Math.max(2, Math.round(players.length / 2));

    if (insufficientGoals || shouldSpawn) {
      const catalyst = players.length > 0 ? players[Math.floor(Math.random() * players.length)] : undefined;
      await this.spawnGoal({ catalyst });
      this.lastGoalSpawn = now;
    } else if (Math.random() > 0.85) {
      await this.spawnGoal();
      this.lastGoalSpawn = now;
    }

    const spotlight = this.listGoals()[0];
    if (!spotlight) {
      return null;
    }

    return {
      id: uuidv4(),
      category: "goal",
      label: "Global Goal",
      description: `${spotlight.label} is now at ${spotlight.progress}% progress.`,
      timestamp: new Date().toISOString(),
      metadata: { goalId: spotlight.id, status: spotlight.status, ownerId: spotlight.ownerId }
    } satisfies SimulationEvent;
  }
}
