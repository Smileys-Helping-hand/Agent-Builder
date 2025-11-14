import { v4 as uuidv4 } from "uuid";
import { LoreEngine } from "./LoreEngine.js";
import { SocialGraph } from "../state/SocialGraph.js";
import { WorldMemory } from "../state/WorldMemory.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import type { SimulationEvent } from "./WorldSimulator.js";

export type DiplomacyRelation = {
  id: string;
  factionA: string;
  factionB: string;
  status: "alliance" | "neutral" | "rivalry" | "war" | "truce";
  tension: number;
  lastChange: string;
  summary?: string;
};

export type DiplomacySnapshot = {
  relations: DiplomacyRelation[];
  lastUpdated: string;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));

export class DiplomacyEngine {
  private static instance: DiplomacyEngine | null = null;
  private readonly lore = LoreEngine.getInstance();
  private readonly social = SocialGraph.getInstance();
  private readonly world = WorldMemory.getInstance();
  private readonly relations = new Map<string, DiplomacyRelation>();
  private lastUpdated = new Date().toISOString();

  static getInstance() {
    if (!this.instance) {
      this.instance = new DiplomacyEngine();
    }
    return this.instance;
  }

  private constructor() {}

  async runTick(): Promise<SimulationEvent | null> {
    const factions = this.lore.listFactions();
    if (factions.length < 2) {
      return null;
    }

    factions.forEach((faction) => {
      this.social.syncFactions([
        { id: faction.id, name: faction.name, influence: faction.influence, lastUpdated: faction.lastUpdated }
      ]);
    });

    const [a, b] = this.pickPair(factions.map((faction) => faction.id));
    if (!a || !b) {
      return null;
    }

    const relation = this.ensureRelation(a, b);
    const delta = Math.round((Math.random() - 0.4) * 12);
    relation.tension = clamp(relation.tension + delta, 0, 100);
    relation.lastChange = new Date().toISOString();

    const status = this.classifyStatus(relation.tension);
    relation.status = status;

    let description = `${relation.factionA} and ${relation.factionB} reaffirm their ${status}.`;
    try {
      const summary = await this.world.summarizeSession("storyworld");
      const prompt = `Two factions named ${relation.factionA} and ${relation.factionB} are adjusting their diplomacy status to ${
        status
      } with tension ${relation.tension}. Write one sentence (max 30 words) describing the political shift. Recent summary: ${
        summary.summary ?? "no context"
      }`;
      const completion = await ModelRouter.generate(prompt);
      if (completion.trim()) {
        description = completion.trim();
      }
    } catch (error) {
      Logger.warn("DiplomacyEngine generation fallback", error);
    }

    relation.summary = description;
    this.lastUpdated = relation.lastChange;

    return {
      id: uuidv4(),
      category: "diplomacy",
      label: "Faction Diplomacy",
      description,
      timestamp: relation.lastChange,
      factionId: undefined,
      metadata: {
        factions: [relation.factionA, relation.factionB],
        status: relation.status,
        tension: relation.tension
      }
    } satisfies SimulationEvent;
  }

  getSnapshot(): DiplomacySnapshot {
    return { relations: [...this.relations.values()], lastUpdated: this.lastUpdated };
  }

  private pickPair(ids: string[]) {
    if (ids.length < 2) return [undefined, undefined] as const;
    const shuffled = [...ids].sort(() => Math.random() - 0.5);
    return [shuffled[0], shuffled[1]] as const;
  }

  private ensureRelation(aId: string, bId: string): DiplomacyRelation {
    const [first, second] = aId < bId ? [aId, bId] : [bId, aId];
    const key = `${first}::${second}`;
    if (!this.relations.has(key)) {
      const factionA = this.lookupFactionName(first);
      const factionB = this.lookupFactionName(second);
      this.relations.set(key, {
        id: key,
        factionA,
        factionB,
        status: "neutral",
        tension: 45 + Math.floor(Math.random() * 10),
        lastChange: new Date().toISOString()
      });
    }
    return this.relations.get(key)!;
  }

  private lookupFactionName(id: string) {
    const faction = this.lore.listFactions().find((entry) => entry.id === id);
    return faction?.name ?? id;
  }

  private classifyStatus(tension: number): DiplomacyRelation["status"] {
    if (tension >= 75) return "war";
    if (tension >= 55) return "rivalry";
    if (tension <= 15) return "alliance";
    if (tension <= 35) return "truce";
    return "neutral";
  }
}
