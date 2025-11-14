import { v4 as uuidv4 } from "uuid";
import { WorldMemory } from "../state/WorldMemory.js";
import { LoreEngine, type FactionState, type LoreUpdate } from "./LoreEngine.js";
import { CognitiveNpcAgent } from "../agents/CognitiveNpcAgent.js";
import { PlayerAgent, type PlayerState } from "../agents/PlayerAgent.js";
import { CollaborationHub } from "./CollaborationHub.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { DialogEngine, type DialogueSnapshot } from "./DialogEngine.js";
import { SocialGraph, type SocialGraphSnapshot } from "../state/SocialGraph.js";
import { DiplomacyEngine, type DiplomacySnapshot } from "./DiplomacyEngine.js";
import { EconomyEngine, type EconomySnapshot } from "./EconomyEngine.js";
import { GoalEngine, type GoalSnapshot } from "./GoalEngine.js";

export type SimulationEvent = {
  id: string;
  category:
    | "lore"
    | "npc"
    | "environment"
    | "system"
    | "social"
    | "diplomacy"
    | "economy"
    | "player"
    | "goal";
  label?: string;
  description: string;
  timestamp: string;
  npcId?: string;
  factionId?: string;
  metadata?: Record<string, unknown>;
};

export type SimulationState = {
  running: boolean;
  speedMultiplier: number;
  intervalSeconds: number;
  lastTick: string | null;
  events: SimulationEvent[];
  factions: FactionState[];
  npcStates: Array<{
    id: string;
    name: string;
    role?: string;
    mood: number;
    hunger: number;
    energy: number;
    goals: string[];
    traits: string[];
    isRunning: boolean;
    lastAction?: string;
    lastEvaluated?: string;
  }>;
  players: PlayerState[];
  playerSimulationRunning: boolean;
  goals: GoalSnapshot;
  social?: SimulationSocialState;
};

export type SimulationSocialState = {
  graph: SocialGraphSnapshot;
  diplomacy: DiplomacySnapshot;
  economy: EconomySnapshot;
  dialogue: DialogueSnapshot;
};

const DEFAULT_INTERVAL_MS = Number(process.env.STORYWORLD_TICK_MS ?? 60_000);
const AUTO_START = String(process.env.STORYWORLD_SIMULATION_ENABLED ?? "true").toLowerCase() === "true";
const FACTION_DYNAMICS_ENABLED = String(process.env.FACTION_DYNAMICS ?? "true").toLowerCase() !== "false";

export class WorldSimulator {
  private static instance: WorldSimulator | null = null;
  private readonly world = WorldMemory.getInstance();
  private readonly lore = LoreEngine.getInstance();
  private readonly npcAgent = CognitiveNpcAgent.getInstance();
  private readonly playerAgent = PlayerAgent.getInstance();
  private readonly hub = CollaborationHub.getInstance();
  private readonly dialog = DialogEngine.getInstance();
  private readonly social = SocialGraph.getInstance();
  private readonly diplomacy = DiplomacyEngine.getInstance();
  private readonly economy = EconomyEngine.getInstance();
  private readonly goals = GoalEngine.getInstance();
  private readonly events: SimulationEvent[] = [];
  private intervalMs = DEFAULT_INTERVAL_MS;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private speedMultiplier = 1;
  private lastTick: string | null = null;

  static getInstance() {
    if (!this.instance) {
      this.instance = new WorldSimulator();
    }
    return this.instance;
  }

  private constructor() {
    if (AUTO_START) {
      void this.start();
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.scheduleNextTick();
  }

  pause() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async step(): Promise<SimulationState> {
    await this.runTick("manual");
    return this.getState();
  }

  async fastForward(steps = 3): Promise<SimulationState> {
    for (let index = 0; index < steps; index += 1) {
      await this.runTick("manual");
    }
    return this.getState();
  }

  setSpeed(multiplier: number) {
    this.speedMultiplier = Math.max(0.25, Math.min(multiplier, 8));
    if (this.running) {
      this.pause();
      void this.start();
    }
  }

  getState(): SimulationState {
    const factions = this.lore.listFactions();
    this.social.syncFactions(
      factions.map((faction) => ({
        id: faction.id,
        name: faction.name,
        influence: faction.influence,
        lastUpdated: faction.lastUpdated
      }))
    );

    return {
      running: this.running,
      speedMultiplier: this.speedMultiplier,
      intervalSeconds:
        Math.round(((this.intervalMs / this.speedMultiplier) / 1000) * 10) / 10,
      lastTick: this.lastTick,
      events: [...this.events],
      factions,
      npcStates: this.npcAgent.listActiveNpcs().map((state) => ({
        id: state.id,
        name: state.name,
        role: state.role,
        mood: state.mood,
        hunger: state.hunger,
        energy: state.energy,
        goals: state.goals,
        traits: state.traits,
        isRunning: state.isRunning,
        lastAction: state.lastAction,
        lastEvaluated: state.lastEvaluated
      })),
      players: this.playerAgent.listPlayers(),
      playerSimulationRunning: this.playerAgent.isRunning(),
      goals: this.goals.getSnapshot(),
      social: {
        graph: this.social.getSnapshot(),
        diplomacy: this.diplomacy.getSnapshot(),
        economy: this.economy.getSnapshot(),
        dialogue: this.dialog.getSnapshot()
      }
    };
  }

  private scheduleNextTick() {
    if (!this.running) return;
    const delay = Math.max(5_000, Math.round(this.intervalMs / this.speedMultiplier));
    this.timer = setTimeout(() => {
      void this.runTick("auto").catch((error) => {
        Logger.warn("World simulation tick failed", error);
      }).finally(() => {
        this.scheduleNextTick();
      });
    }, delay);
  }

  private async runTick(mode: "auto" | "manual") {
    const timestamp = new Date().toISOString();
    this.lastTick = timestamp;

    const loreUpdate = await this.generateLoreUpdate();
    if (loreUpdate) {
      this.pushEvent({
        id: loreUpdate.id,
        category: "lore",
        label: "Lore Update",
        description: loreUpdate.description,
        timestamp,
        factionId: loreUpdate.event?.entityId,
        metadata: { factions: loreUpdate.factions }
      });
      if (loreUpdate.event) {
        this.hub.broadcastStoryEvent(loreUpdate.event);
      }
    }

    const emergent = await this.generateEmergentEvent(mode);
    if (emergent) {
      this.pushEvent(emergent);
    }

    const dialogues = await this.dialog.runTick();
    dialogues.forEach((event) => this.pushEvent(event));

    if (FACTION_DYNAMICS_ENABLED) {
      const diplomacy = await this.diplomacy.runTick();
      if (diplomacy) {
        this.pushEvent(diplomacy);
      }

      const economy = this.economy.runTick();
      if (economy) {
        this.pushEvent(economy);
      }
    }

    for (const npc of this.npcAgent.listActiveNpcs()) {
      if (!npc.isRunning) {
        await this.npcAgent.evaluateNpc(npc.id);
      }
    }

    const playerEvents = await this.playerAgent.runTick(this.goals);
    playerEvents.forEach((event) => this.pushEvent(event));

    const goalEvent = await this.goals.runTick(this.playerAgent.listPlayers());
    if (goalEvent) {
      this.pushEvent(goalEvent);
    }
  }

  private pushEvent(event: SimulationEvent) {
    this.events.unshift(event);
    this.hub.broadcastSimulation(event);
    if (this.events.length > 120) {
      this.events.length = 120;
    }
  }

  private async generateLoreUpdate(): Promise<LoreUpdate | null> {
    try {
      return await this.lore.evolveWorld({ sessionId: "storyworld" });
    } catch (error) {
      Logger.warn("WorldSimulator lore update failed", error);
      return null;
    }
  }

  private async generateEmergentEvent(mode: "auto" | "manual"): Promise<SimulationEvent | null> {
    try {
      const summary = await this.world.summarizeSession("storyworld");
      const prompt = `You run a simulation loop for an evolving Roblox world. Based on the summary below, describe a dynamic world event in one sentence. Mention if it was triggered ${mode === "auto" ? "passively" : "manually"}.\n\n${summary.summary}`;
      const completion = await ModelRouter.generate(prompt);
      const description = (completion || "A calm moment passes in the world.").trim();
      const event: SimulationEvent = {
        id: uuidv4(),
        category: "environment",
        label: "World Event",
        description,
        timestamp: new Date().toISOString()
      };
      return event;
    } catch (error) {
      Logger.warn("WorldSimulator emergent event fallback", error);
      return {
        id: uuidv4(),
        category: "system",
        label: "Simulation",
        description: "Simulation tick completed without new narrative cues.",
        timestamp: new Date().toISOString()
      };
    }
  }
}
