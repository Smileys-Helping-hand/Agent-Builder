import { BaseAgent } from "./BaseAgent.js";
import type { Task } from "../orchestrator/types.js";
import { WorldMemory } from "../state/WorldMemory.js";
import { DialogMemory } from "../tools/DialogMemory.js";
import { CollaborationHub } from "../orchestrator/CollaborationHub.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import { v4 as uuidv4 } from "uuid";
import type { StoryTimelineEvent } from "../models/NarrativeTypes.js";

export type CognitiveNpcState = {
  id: string;
  name: string;
  role?: string;
  traits: string[];
  hunger: number;
  energy: number;
  mood: number;
  goals: string[];
  lastAction?: string;
  loop?: NodeJS.Timeout | null;
  lastEvaluated?: string;
  isRunning: boolean;
};

export type CognitiveNpcTaskMetadata = {
  npcId?: string;
  name?: string;
  role?: string;
  traits?: string[];
  goals?: string[];
  intervalMs?: number;
  command?: "start" | "stop" | "step" | "resume";
};

export type CognitiveNpcResult = {
  npcId: string;
  running: boolean;
  state: CognitiveNpcState;
  lastEvent?: StoryTimelineEvent;
};

const DEFAULT_INTERVAL_MS = Number(process.env.COGNITIVE_NPC_INTERVAL_MS ?? 45_000);

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value));

export class CognitiveNpcAgent extends BaseAgent {
  private static instance: CognitiveNpcAgent | null = null;
  private readonly world = WorldMemory.getInstance();
  private readonly dialog = DialogMemory.getInstance();
  private readonly hub = CollaborationHub.getInstance();
  private readonly npcs = new Map<string, CognitiveNpcState>();

  static getInstance() {
    if (!this.instance) {
      this.instance = new CognitiveNpcAgent();
    }
    return this.instance;
  }

  private constructor() {
    super("CognitiveNpcAgent");
  }

  canHandle(task: Task): boolean {
    return task.agentType === "CognitiveNpcAgent";
  }

  protected async execute(task: Task): Promise<CognitiveNpcResult> {
    const metadata = (task.metadata ?? {}) as CognitiveNpcTaskMetadata;
    const npc = this.ensureNpcState({
      npcId: metadata.npcId,
      name: metadata.name ?? task.description ?? "Autonomous NPC",
      role: metadata.role,
      traits: metadata.traits,
      goals: metadata.goals
    });

    if (metadata.command === "stop") {
      this.stopLoop(npc.id);
      return { npcId: npc.id, running: false, state: npc };
    }

    if (metadata.command === "step") {
      const event = await this.evaluateNpc(npc.id);
      return { npcId: npc.id, running: this.npcs.get(npc.id)?.loop != null, state: this.npcs.get(npc.id)!, lastEvent: event };
    }

    if (metadata.command === "resume" || metadata.command === "start" || !metadata.command) {
      this.startLoop(npc.id, metadata.intervalMs ?? DEFAULT_INTERVAL_MS);
      return { npcId: npc.id, running: true, state: this.npcs.get(npc.id)! };
    }

    return { npcId: npc.id, running: this.npcs.get(npc.id)?.loop != null, state: this.npcs.get(npc.id)! };
  }

  listActiveNpcs(): CognitiveNpcState[] {
    return [...this.npcs.values()].map((state) => ({
      ...state,
      loop: state.loop ? null : null,
      isRunning: state.loop != null
    }));
  }

  startLoop(npcId: string, intervalMs: number = DEFAULT_INTERVAL_MS) {
    const state = this.npcs.get(npcId);
    if (!state) return;
    this.stopLoop(npcId);
    const timer = setInterval(() => {
      void this.evaluateNpc(npcId).catch((error) => {
        Logger.warn("Cognitive NPC evaluation failed", { npcId, error });
      });
    }, Math.max(5_000, intervalMs));
    state.loop = timer;
    state.isRunning = true;
  }

  stopLoop(npcId: string) {
    const state = this.npcs.get(npcId);
    if (!state) return;
    if (state.loop) {
      clearInterval(state.loop);
    }
    state.loop = null;
    state.isRunning = false;
  }

  async evaluateNpc(npcId: string): Promise<StoryTimelineEvent | undefined> {
    const state = this.npcs.get(npcId);
    if (!state) {
      return undefined;
    }

    const { hunger, energy } = state;
    state.hunger = clamp(hunger + 8);
    state.energy = clamp(energy - 5, 0, 100);

    const contextSummary = await this.dialog.summarizeHistory(npcId, 12);
    const relevantMemories = await this.dialog.recallRelevant(npcId, state.lastAction ?? "recent");
    const memorySnippet = relevantMemories.map((entry) => `${entry.speaker}: ${entry.content}`).join("\n");

    const directive = await this.buildDirective(state, { contextSummary, memorySnippet });
    let action = this.planFromStats(state);

    try {
      const completion = await ModelRouter.generate(directive);
      if (completion.trim()) {
        action = completion.trim();
      }
    } catch (error) {
      Logger.warn("Cognitive NPC language model fallback", { npcId, error });
    }

    state.lastAction = action;
    state.mood = clamp(state.mood + (state.hunger > 80 ? -5 : 3));
    state.lastEvaluated = new Date().toISOString();

    try {
      await this.dialog.recordUtterance(npcId, state.name, action, {
        npcId,
        role: state.role,
        type: "npc_action"
      });
    } catch (error) {
      Logger.warn("Failed to append NPC dialog", { npcId, error });
    }

    let event: StoryTimelineEvent | undefined;
    try {
      event = await this.world.recordEvent({
        entityId: npcId,
        entityType: "npc",
        entityLabel: state.name,
        description: action,
        tags: ["npc", "cognition", state.role ?? "ai"],
        metadata: {
          hunger: state.hunger,
          energy: state.energy,
          mood: state.mood,
          traits: state.traits,
          goals: state.goals
        }
      });
      this.hub.broadcastStoryEvent(event);
      this.hub.broadcastSimulation({
        id: uuidv4(),
        category: "npc",
        description: action,
        npcId,
        label: state.name,
        timestamp: event.createdAt,
        metadata: {
          hunger: state.hunger,
          energy: state.energy,
          mood: state.mood
        }
      });
    } catch (error) {
      Logger.warn("Cognitive NPC failed to record world memory", { npcId, error });
    }

    return event;
  }

  private ensureNpcState(options: {
    npcId?: string;
    name: string;
    role?: string;
    traits?: string[];
    goals?: string[];
  }): CognitiveNpcState {
    const id = options.npcId ?? `npc-${uuidv4()}`;
    const existing = this.npcs.get(id);
    if (existing) {
      if (options.name) existing.name = options.name;
      if (options.role) existing.role = options.role;
      if (options.traits) existing.traits = options.traits;
      if (options.goals && options.goals.length > 0) existing.goals = options.goals;
      return existing;
    }

    const baseline: CognitiveNpcState = {
      id,
      name: options.name,
      role: options.role,
      traits: options.traits ?? ["curious"],
      goals: options.goals ?? ["maintain relationships", "support storyline"],
      hunger: 30,
      energy: 80,
      mood: 60,
      loop: null,
      isRunning: false
    };

    this.npcs.set(id, baseline);
    return baseline;
  }

  private planFromStats(state: CognitiveNpcState) {
    if (state.hunger > 85) {
      return `${state.name} searches for a food vendor to satisfy their hunger.`;
    }
    if (state.energy < 25) {
      return `${state.name} takes a brief rest to regain energy.`;
    }
    if (state.mood < 30) {
      return `${state.name} seeks out a trusted ally for encouragement.`;
    }
    return `${state.name} observes the surroundings, preparing their next move.`;
  }

  private async buildDirective(
    state: CognitiveNpcState,
    context: { contextSummary: string; memorySnippet: string }
  ): Promise<string> {
    const needs: string[] = [];
    if (state.hunger > 70) needs.push("address hunger");
    if (state.energy < 35) needs.push("restore energy");
    if (state.mood < 40) needs.push("improve morale");

    const goals = state.goals.join(", ");
    const needsSummary = needs.length > 0 ? `Immediate needs: ${needs.join(", " )}.` : "Maintain narrative momentum.";

    return `You simulate NPC cognition inside a persistent Roblox world.
NPC profile: ${state.name} (${state.role ?? "citizen"}). Traits: ${state.traits.join(", ")}.
Goals: ${goals}.
${needsSummary}
Recent summary: ${context.contextSummary}
Relevant memories:
${context.memorySnippet || "(none)"}

Respond with a single sentence describing the NPC's next proactive action.`;
  }
}
