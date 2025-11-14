import { v4 as uuidv4 } from "uuid";
import { LoreEngine } from "./LoreEngine.js";
import { SocialGraph } from "../state/SocialGraph.js";
import type { SimulationEvent } from "./WorldSimulator.js";

export type EconomyFactionState = {
  factionId: string;
  name: string;
  resources: { food: number; gold: number; materials: number };
  trend: "up" | "down" | "stable";
  lastUpdated: string;
};

export type EconomySnapshot = {
  factions: EconomyFactionState[];
  players: PlayerEconomyState[];
  lastUpdated: string;
};

const clamp = (value: number, min = 0, max = 9999) => Math.max(min, Math.min(max, Math.round(value)));

export type PlayerEconomyState = {
  playerId: string;
  name: string;
  resources: { food: number; gold: number; materials: number };
  lastUpdated: string;
};

export class EconomyEngine {
  private static instance: EconomyEngine | null = null;
  private readonly lore = LoreEngine.getInstance();
  private readonly social = SocialGraph.getInstance();
  private readonly factions = new Map<string, EconomyFactionState>();
  private readonly players = new Map<string, PlayerEconomyState>();
  private lastUpdated = new Date().toISOString();

  static getInstance() {
    if (!this.instance) {
      this.instance = new EconomyEngine();
    }
    return this.instance;
  }

  private constructor() {}

  runTick(): SimulationEvent | null {
    const factions = this.lore.listFactions();
    if (factions.length === 0) {
      return null;
    }

    const faction = factions[Math.floor(Math.random() * factions.length)];
    const previous = this.factions.get(faction.id) ?? {
      factionId: faction.id,
      name: faction.name,
      resources: { food: 320, gold: 280, materials: 220 },
      trend: "stable" as const,
      lastUpdated: new Date().toISOString()
    } satisfies EconomyFactionState;

    const deltas = {
      food: Math.round((Math.random() - 0.45) * 60),
      gold: Math.round((Math.random() - 0.5) * 40),
      materials: Math.round((Math.random() - 0.4) * 50)
    };

    const updated: EconomyFactionState = {
      factionId: faction.id,
      name: faction.name,
      resources: {
        food: clamp(previous.resources.food + deltas.food, 0, 5000),
        gold: clamp(previous.resources.gold + deltas.gold, 0, 5000),
        materials: clamp(previous.resources.materials + deltas.materials, 0, 5000)
      },
      trend: this.resolveTrend(deltas),
      lastUpdated: new Date().toISOString()
    };

    this.factions.set(faction.id, updated);
    this.social.updateFactionResources(faction.id, updated.resources);
    this.lastUpdated = updated.lastUpdated;

    const tradeBalance = deltas.gold + deltas.food + deltas.materials;

    return {
      id: uuidv4(),
      category: "economy",
      label: "Faction Economy",
      description: `${updated.name} adjusted trade routes resulting in ${tradeBalance >= 0 ? "gains" : "losses"} across resources.`,
      timestamp: updated.lastUpdated,
      metadata: {
        faction: updated.name,
        trend: updated.trend,
        food: updated.resources.food,
        gold: updated.resources.gold,
        materials: updated.resources.materials
      }
    } satisfies SimulationEvent;
  }

  getSnapshot(): EconomySnapshot {
    return {
      factions: [...this.factions.values()],
      players: [...this.players.values()].sort((a, b) => b.resources.gold - a.resources.gold),
      lastUpdated: this.lastUpdated
    };
  }

  applyPlayerTransaction(
    playerId: string,
    delta: { food?: number; gold?: number; materials?: number },
    name?: string
  ) {
    const baseline: PlayerEconomyState =
      this.players.get(playerId) ?? {
        playerId,
        name: name ?? playerId,
        resources: { food: 120, gold: 120, materials: 120 },
        lastUpdated: new Date().toISOString()
      };

    const updated: PlayerEconomyState = {
      playerId,
      name: name ?? baseline.name,
      resources: {
        food: clamp(baseline.resources.food + (delta.food ?? 0), 0, 5000),
        gold: clamp(baseline.resources.gold + (delta.gold ?? 0), 0, 5000),
        materials: clamp(baseline.resources.materials + (delta.materials ?? 0), 0, 5000)
      },
      lastUpdated: new Date().toISOString()
    };

    this.players.set(playerId, updated);
    this.lastUpdated = updated.lastUpdated;
  }

  private resolveTrend(deltas: Record<string, number>): EconomyFactionState["trend"] {
    const total = deltas.food + deltas.gold + deltas.materials;
    if (total > 15) return "up";
    if (total < -15) return "down";
    return "stable";
  }
}
