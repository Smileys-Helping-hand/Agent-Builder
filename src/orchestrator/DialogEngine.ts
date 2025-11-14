import { v4 as uuidv4 } from "uuid";
import { CognitiveNpcAgent } from "../agents/CognitiveNpcAgent.js";
import { DialogMemory } from "../tools/DialogMemory.js";
import { WorldMemory } from "../state/WorldMemory.js";
import { SocialGraph } from "../state/SocialGraph.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import type { SimulationEvent } from "./WorldSimulator.js";

export type DialogueSummary = {
  id: string;
  participants: string[];
  summary: string;
  timestamp: string;
  sentiment?: string;
};

export type DialogueSnapshot = {
  recent: DialogueSummary[];
};

const DEFAULT_INTERVAL = Number(process.env.DIALOGUE_LOOP_INTERVAL ?? 5_000);
const SOCIAL_ENABLED = String(process.env.SOCIAL_SIMULATION ?? "true").toLowerCase() !== "false";

export class DialogEngine {
  private static instance: DialogEngine | null = null;
  private readonly npcAgent = CognitiveNpcAgent.getInstance();
  private readonly dialog = DialogMemory.getInstance();
  private readonly world = WorldMemory.getInstance();
  private readonly social = SocialGraph.getInstance();
  private readonly recent: DialogueSummary[] = [];
  private lastRun = 0;

  static getInstance() {
    if (!this.instance) {
      this.instance = new DialogEngine();
    }
    return this.instance;
  }

  private constructor() {}

  async runTick(): Promise<SimulationEvent[]> {
    if (!SOCIAL_ENABLED) return [];
    const now = Date.now();
    if (now - this.lastRun < DEFAULT_INTERVAL) {
      return [];
    }
    this.lastRun = now;

    const npcs = this.npcAgent.listActiveNpcs();
    if (npcs.length < 2) {
      return [];
    }

    const [first, second] = this.pickPair(npcs);
    if (!first || !second) {
      return [];
    }

    const sessionSummary = await this.world.summarizeSession("storyworld").catch((error) => {
      Logger.warn("DialogEngine summary fallback", error);
      return { summary: "The world is calm." };
    });

    const prompt = `Two NPCs are conversing inside a Roblox simulation. NPC A: ${first.name} (${first.traits.join(", ")}). NPC B: ${
      second.name
    } (${second.traits.join(", ")}). Based on the world summary below, craft a short exchange of two sentences total where they share news or gossip. Format as "A: ...\nB: ...". Keep under 50 words.\n\nWorld summary: ${
      sessionSummary.summary ?? "(no recent events)"
    }`;

    let conversation = `${first.name}: It has been a quiet day.` + `\n${second.name}: Let's keep watching the horizon.`;
    try {
      const completion = await ModelRouter.generate(prompt);
      if (completion.trim()) {
        conversation = completion.trim();
      }
    } catch (error) {
      Logger.warn("DialogEngine language model fallback", error);
    }

    const lines = conversation.split(/\r?\n/).slice(0, 2);
    const firstLine = lines[0] ?? `${first.name}: All is well."`;
    const secondLine = lines[1] ?? `${second.name}: Indeed.`;

    const timestamp = new Date().toISOString();

    await this.dialog.recordUtterance(first.id, first.name, firstLine.replace(/^.*?:\s*/, ""), {
      partnerId: second.id,
      channel: "npc_to_npc",
      generatedAt: timestamp
    });
    await this.dialog.recordUtterance(second.id, second.name, secondLine.replace(/^.*?:\s*/, ""), {
      partnerId: first.id,
      channel: "npc_to_npc",
      generatedAt: timestamp
    });

    const edge = this.social.modifyRelation(
      {
        id: first.id,
        label: first.name,
        role: first.role,
        mood: first.mood,
        factionId: undefined,
        lastInteraction: timestamp
      },
      {
        id: second.id,
        label: second.name,
        role: second.role,
        mood: second.mood,
        factionId: undefined,
        lastInteraction: timestamp
      },
      { trust: 6, rivalry: -2, trade: 3, context: "dialogue" }
    );

    const summary: DialogueSummary = {
      id: uuidv4(),
      participants: [first.name, second.name],
      summary: `${firstLine}\n${secondLine}`,
      timestamp,
      sentiment: edge.trust >= 60 ? "positive" : edge.rivalry > 40 ? "tense" : "neutral"
    };

    this.recent.unshift(summary);
    if (this.recent.length > 30) {
      this.recent.length = 30;
    }

    const event: SimulationEvent = {
      id: uuidv4(),
      category: "social",
      label: "NPC Conversation",
      description: `${first.name} and ${second.name} traded words: ${summary.summary.replace(/\n/g, " ")}`,
      timestamp,
      metadata: {
        participants: summary.participants,
        trust: edge.trust,
        rivalry: edge.rivalry,
        interactions: edge.interactions
      }
    };

    return [event];
  }

  getSnapshot(): DialogueSnapshot {
    return { recent: [...this.recent] };
  }

  private pickPair(npcs: ReturnType<CognitiveNpcAgent["listActiveNpcs"]>) {
    if (npcs.length < 2) {
      return [undefined, undefined] as const;
    }
    const shuffled = [...npcs].sort(() => Math.random() - 0.5);
    return [shuffled[0], shuffled[1]] as const;
  }
}
