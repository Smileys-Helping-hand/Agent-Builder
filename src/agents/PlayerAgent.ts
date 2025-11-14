import { v4 as uuidv4 } from "uuid";
import { BaseAgent } from "./BaseAgent.js";
import type { Task } from "../orchestrator/types.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { WorldMemory } from "../state/WorldMemory.js";
import { LoreEngine } from "../orchestrator/LoreEngine.js";
import { EconomyEngine } from "../orchestrator/EconomyEngine.js";
import { Logger } from "../utils/Logger.js";
import type { SimulationEvent } from "../orchestrator/WorldSimulator.js";
import { VoiceController } from "../voice/VoiceController.js";
import type { EmotionTone } from "../voice/EmotionSynthesizer.js";

export type PlayerDisposition = "adventurer" | "diplomat" | "conqueror" | "explorer";

export type PlayerTrait = "greedy" | "noble" | "curious" | "ambitious" | "cautious" | "reckless";

export type PlayerGoalState = {
  id: string;
  label: string;
  type: string;
  progress: number;
  targetFaction?: string;
  status: "active" | "completed" | "failed";
  assignedAt: string;
  resolvedAt?: string;
};

export type PlayerState = {
  id: string;
  name: string;
  disposition: PlayerDisposition;
  traits: PlayerTrait[];
  alignment: string;
  factionAffinity?: string;
  influence: number;
  reputation: number;
  goals: PlayerGoalState[];
  activeGoalId?: string;
  hunger: number;
  energy: number;
  morale: number;
  resources: { food: number; gold: number; materials: number };
  lastAction?: string;
  lastUpdated: string;
  paused: boolean;
  voice?: string;
};

export type PlayerAgentCommand =
  | { action: "spawn"; name?: string; disposition?: PlayerDisposition; traits?: PlayerTrait[] }
  | { action: "pause" }
  | { action: "resume" }
  | { action: "list" };

export type PlayerAgentResult = {
  players: PlayerState[];
  spawned?: PlayerState;
  running: boolean;
};

const TRAIT_POOL: PlayerTrait[] = ["greedy", "noble", "curious", "ambitious", "cautious", "reckless"];
const DISPOSITIONS: PlayerDisposition[] = ["adventurer", "diplomat", "conqueror", "explorer"];
const ALIGNMENTS = ["ally", "neutral", "chaotic", "opportunist"];
const VOICE_PROFILES = [
  "en-US-GuyNeural",
  "en-US-JennyNeural",
  "en-GB-SoniaNeural",
  "en-AU-NatashaNeural",
  "en-IN-AriaNeural"
];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const shouldNarrate = String(process.env.NARRATE_PLAYER_EVENTS ?? "true").toLowerCase() === "true";
const MAX_PLAYERS = Number(process.env.MAX_AI_PLAYERS ?? 10);

export class PlayerAgent extends BaseAgent {
  private static instance: PlayerAgent | null = null;
  private readonly world = WorldMemory.getInstance();
  private readonly lore = LoreEngine.getInstance();
  private readonly economy = EconomyEngine.getInstance();
  private readonly players = new Map<string, PlayerState>();
  private running = true;
  private voiceController: VoiceController | null = null;

  static getInstance() {
    if (!this.instance) {
      this.instance = new PlayerAgent();
    }
    return this.instance;
  }

  private constructor() {
    super("PlayerAgent");
    void this.world.init();
    if (shouldNarrate) {
      this.voiceController = new VoiceController();
      this.voiceController.setNarratorEnabled(true);
    }
  }

  canHandle(task: Task): boolean {
    return task.agentType === "PlayerAgent";
  }

  protected async execute(task: Task): Promise<PlayerAgentResult> {
    const command = (task.metadata ?? {}) as PlayerAgentCommand | undefined;
    if (!command) {
      return { players: this.listPlayers(), running: this.running };
    }

    switch (command.action) {
      case "spawn": {
        const spawned = await this.spawnPlayer({
          name: command.name,
          disposition: command.disposition,
          traits: command.traits
        });
        return { players: this.listPlayers(), spawned, running: this.running };
      }
      case "pause":
        this.running = false;
        return { players: this.listPlayers(), running: this.running };
      case "resume":
        this.running = true;
        return { players: this.listPlayers(), running: this.running };
      case "list":
      default:
        return { players: this.listPlayers(), running: this.running };
    }
  }

  isRunning() {
    return this.running;
  }

  pause() {
    this.running = false;
  }

  resume() {
    this.running = true;
  }

  listPlayers(): PlayerState[] {
    return [...this.players.values()].sort((a, b) => b.influence - a.influence);
  }

  getPlayer(playerId: string): PlayerState | undefined {
    return this.players.get(playerId);
  }

  async spawnPlayer(options: {
    name?: string;
    disposition?: PlayerDisposition;
    traits?: PlayerTrait[];
  } = {}): Promise<PlayerState> {
    const id = uuidv4();
    const name =
      options.name?.trim() ||
      `AI ${Math.random().toString(36).slice(2, 6).toUpperCase()} ${Date.now().toString(36).slice(-3).toUpperCase()}`;
    const disposition = options.disposition ?? DISPOSITIONS[Math.floor(Math.random() * DISPOSITIONS.length)];
    const traits =
      options.traits ??
      Array.from({ length: 2 }, () => TRAIT_POOL[Math.floor(Math.random() * TRAIT_POOL.length)]);

    const player: PlayerState = {
      id,
      name,
      disposition,
      traits,
      alignment: ALIGNMENTS[Math.floor(Math.random() * ALIGNMENTS.length)],
      factionAffinity: undefined,
      influence: 40 + Math.round(Math.random() * 30),
      reputation: 50,
      goals: [],
      activeGoalId: undefined,
      hunger: 30,
      energy: 70,
      morale: 65,
      resources: { food: 120, gold: 180, materials: 90 },
      lastUpdated: new Date().toISOString(),
      paused: false,
      voice: VOICE_PROFILES[Math.floor(Math.random() * VOICE_PROFILES.length)]
    };

    this.players.set(id, player);
    if (this.voiceController && player.voice) {
      this.voiceController.assignVoiceProfile(player.id, { voice: player.voice, style: "cheerful" });
    }

    if (this.players.size > MAX_PLAYERS) {
      const sorted = [...this.players.values()].sort((a, b) => a.influence - b.influence);
      const removed = sorted[0];
      if (removed) {
        this.players.delete(removed.id);
        this.voiceController?.removeVoiceProfile(removed.id);
        Logger.log("Removed lowest influence AI player to honor MAX_AI_PLAYERS", { removed: removed.name });
      }
    }

    try {
      await this.world.recordEvent({
        entityId: `player-${player.id}`,
        entityType: "player",
        entityLabel: player.name,
        description: `${player.name} joined the simulation as a ${player.disposition}.`,
        tags: ["player", "spawn"],
        metadata: { traits: player.traits, alignment: player.alignment },
        sessionId: "storyworld"
      });
    } catch (error) {
      Logger.warn("Failed to record player spawn", error);
    }

    return player;
  }

  async assignGoal(playerId: string, goal: PlayerGoalState) {
    const player = this.players.get(playerId);
    if (!player) return;
    player.activeGoalId = goal.id;
    player.goals.unshift(goal);
    player.lastUpdated = new Date().toISOString();
  }

  async runTick(goalEngine: {
    assignGoal(player: PlayerState): Promise<PlayerGoalState | null>;
    resolveGoal(
      goalId: string,
      outcome: "completed" | "failed",
      actorId: string,
      details: Record<string, unknown>
    ): Promise<void>;
    reportProgress(goalId: string, actorId: string, progress: number): Promise<void>;
    getActiveGoals(): PlayerGoalState[];
  }): Promise<SimulationEvent[]> {
    if (!this.running) {
      return [];
    }

    const events: SimulationEvent[] = [];
    for (const player of this.players.values()) {
      if (player.paused) continue;

      const now = new Date();
      player.hunger = clamp(player.hunger + 7, 0, 100);
      player.energy = clamp(player.energy - 5, 0, 100);
      player.morale = clamp(player.morale + (player.energy > 40 ? 3 : -4), 0, 100);

      if (!player.activeGoalId) {
        const goal = await goalEngine.assignGoal(player);
        if (goal) {
          await this.assignGoal(player.id, goal);
        }
      }

      const activeGoal = player.goals.find((goal) => goal.id === player.activeGoalId && goal.status === "active");
      const directive = this.buildDirective(player, activeGoal);
      let action = `${player.name} surveys the world awaiting inspiration.`;
      try {
        const completion = await ModelRouter.generate(directive);
        if (completion.trim()) {
          action = completion.trim();
        }
      } catch (error) {
        Logger.warn("PlayerAgent language model fallback", error);
      }

      player.lastAction = action;
      player.lastUpdated = now.toISOString();

      const event: SimulationEvent = {
        id: uuidv4(),
        category: "player",
        label: `${player.name} Action`,
        description: action,
        timestamp: now.toISOString(),
        npcId: player.id,
        metadata: {
          playerId: player.id,
          goalId: activeGoal?.id,
          morale: player.morale,
          hunger: player.hunger,
          energy: player.energy
        }
      };
      events.push(event);

      try {
        await this.world.recordEvent({
          entityId: `player-${player.id}`,
          entityType: "player",
          entityLabel: player.name,
          description: action,
          tags: ["player", activeGoal ? "goal" : "freeplay"],
          metadata: { goalId: activeGoal?.id, morale: player.morale },
          sessionId: "storyworld"
        });
        await this.lore.recordPlayerDeed(player, action, activeGoal ?? undefined);
      } catch (error) {
        Logger.warn("PlayerAgent failed to persist action", error);
      }

      if (activeGoal) {
        const progressDelta = Math.round(Math.random() * 28);
        activeGoal.progress = clamp(activeGoal.progress + progressDelta, 0, 100);
        await goalEngine.reportProgress(activeGoal.id, player.id, activeGoal.progress);
        if (activeGoal.progress >= 100) {
          activeGoal.status = "completed";
          activeGoal.resolvedAt = now.toISOString();
          player.activeGoalId = undefined;
          player.reputation = clamp(player.reputation + 8, 0, 120);
          player.influence = clamp(player.influence + 6, 0, 150);
          await goalEngine.resolveGoal(activeGoal.id, "completed", player.id, {
            action,
            morale: player.morale
          });
        } else if (player.energy < 15 || player.hunger > 90) {
          activeGoal.status = "failed";
          activeGoal.resolvedAt = now.toISOString();
          player.activeGoalId = undefined;
          player.reputation = clamp(player.reputation - 4, 0, 120);
          player.morale = clamp(player.morale - 6, 0, 100);
          await goalEngine.resolveGoal(activeGoal.id, "failed", player.id, {
            reason: player.energy < 15 ? "exhausted" : "hungry"
          });
        }
      }

      this.economy.applyPlayerTransaction(
        player.id,
        {
          gold: Math.round((Math.random() - 0.3) * 40),
          food: Math.round((Math.random() - 0.4) * 30),
          materials: Math.round((Math.random() - 0.4) * 20)
        },
        player.name
      );

      if (this.voiceController && player.voice) {
        void this.voiceController
          .narrate(action, { entityId: player.id, voice: player.voice, emotion: this.pickEmotionTone(player) })
          .catch((error) => Logger.warn("Player narration failed", error));
      }
    }

    return events;
  }

  private buildDirective(player: PlayerState, goal?: PlayerGoalState | null): string {
    const base = `You simulate autonomous AI players in a persistent Roblox storyworld. Generate a single sentence describing ${player.name}'s next action.`;
    const goalText = goal
      ? `Active goal: ${goal.label} (${goal.type}) progress ${goal.progress}%.`
      : "No active goal assigned.";
    const mood = `Morale ${player.morale}/100, hunger ${player.hunger}/100, energy ${player.energy}/100.`;
    const traits = `Traits: ${player.traits.join(", ")}. Disposition: ${player.disposition}. Alignment: ${player.alignment}.`;
    return `${base}\n${goalText}\n${mood}\n${traits}`;
  }

  private pickEmotionTone(player: PlayerState): EmotionTone {
    if (player.morale > 75) return "excited";
    if (player.morale < 30) return "sad";
    if (player.energy < 25) return "tired";
    return "neutral";
  }
}
