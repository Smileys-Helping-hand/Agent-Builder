import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { WorldMemory } from "../state/WorldMemory.js";
import { TerrainGenerator } from "../tools/TerrainGenerator.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { Logger } from "../utils/Logger.js";
import type { StoryTimelineEvent } from "../models/NarrativeTypes.js";
import type { PlayerState, PlayerGoalState } from "../agents/PlayerAgent.js";
import type { GlobalGoalState } from "./GoalEngine.js";

export type FactionState = {
  id: string;
  name: string;
  alignment: "ally" | "enemy" | "neutral";
  influence: number;
  territory?: string;
  traits?: string[];
  lastUpdated: string;
};

export type LoreUpdate = {
  id: string;
  description: string;
  factions: FactionState[];
  event?: StoryTimelineEvent;
};

type MythosEntry = {
  id: string;
  entry: string;
  createdAt: string;
  tags: string[];
  related?: string[];
};

const DATA_DIRECTORY = path.resolve("./data/storyworld");
const FACTIONS_FILE = path.join(DATA_DIRECTORY, "factions.json");
const MYTHOS_FILE = path.join(DATA_DIRECTORY, "mythos.json");

const randomAlignment = (): FactionState["alignment"] => {
  const options: FactionState["alignment"][] = ["ally", "enemy", "neutral"];
  return options[Math.floor(Math.random() * options.length)];
};

const clampInfluence = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export class LoreEngine {
  private static instance: LoreEngine | null = null;
  private factions = new Map<string, FactionState>();
  private readonly world = WorldMemory.getInstance();
  private mythos: MythosEntry[] = [];

  static getInstance() {
    if (!this.instance) {
      this.instance = new LoreEngine();
    }
    return this.instance;
  }

  private constructor() {
    void this.load();
    void this.loadMythos();
  }

  private async loadMythos() {
    try {
      await fs.promises.mkdir(DATA_DIRECTORY, { recursive: true });
      const raw = await fs.promises.readFile(MYTHOS_FILE, "utf8");
      const parsed = JSON.parse(raw) as MythosEntry[];
      this.mythos = parsed;
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        Logger.warn("LoreEngine failed to load mythos", error);
      }
    }
  }

  private async persistMythos() {
    const payload = JSON.stringify(this.mythos.slice(0, 200), null, 2);
    await fs.promises.writeFile(MYTHOS_FILE, payload, "utf8");
  }

  private async load() {
    try {
      await fs.promises.mkdir(DATA_DIRECTORY, { recursive: true });
      const raw = await fs.promises.readFile(FACTIONS_FILE, "utf8");
      const parsed = JSON.parse(raw) as FactionState[];
      parsed.forEach((faction) => this.factions.set(faction.id, faction));
    } catch (error: any) {
      if (error?.code !== "ENOENT") {
        Logger.warn("LoreEngine failed to load factions", error);
      }
    }
  }

  private async persist() {
    const payload = JSON.stringify([...this.factions.values()], null, 2);
    await fs.promises.writeFile(FACTIONS_FILE, payload, "utf8");
  }

  listFactions(): FactionState[] {
    return [...this.factions.values()].sort((a, b) => b.influence - a.influence);
  }

  ensureFaction(name: string, alignment?: FactionState["alignment"]): FactionState {
    for (const faction of this.factions.values()) {
      if (faction.name.toLowerCase() === name.toLowerCase()) {
        return faction;
      }
    }

    const faction: FactionState = {
      id: uuidv4(),
      name,
      alignment: alignment ?? randomAlignment(),
      influence: 40 + Math.floor(Math.random() * 20),
      lastUpdated: new Date().toISOString(),
      traits: ["emerging"],
      territory: undefined
    };
    this.factions.set(faction.id, faction);
    void this.persist();
    return faction;
  }

  async evolveWorld(options: { sessionId?: string; catalyst?: string } = {}): Promise<LoreUpdate> {
    if (this.factions.size === 0) {
      this.ensureFaction("Founders Guild", "ally");
      this.ensureFaction("Obsidian Syndicate", "enemy");
      this.ensureFaction("Skyward Collective", "neutral");
    }

    const factions = this.listFactions();
    const evolving = factions[Math.floor(Math.random() * factions.length)];
    const shift = Math.round((Math.random() - 0.5) * 10);
    evolving.influence = clampInfluence(evolving.influence + shift);
    evolving.lastUpdated = new Date().toISOString();

    if (!evolving.territory && Math.random() > 0.5) {
      const terrain = await this.pickTerrainSeed(evolving.name);
      evolving.territory = terrain;
    }

    const context = factions
      .map((faction) => `${faction.name} (${faction.alignment}) influence ${faction.influence}`)
      .join("; ");

    const directive = options.catalyst ?? "Generate a short lore beat about faction tensions.";

    let description = `${evolving.name} recalibrates their plans.`;
    try {
      const completion = await ModelRouter.generate(
        `You author evolving lore for a persistent Roblox world. Base your update on existing factions (${context}). Focus on ${evolving.name}. Keep it under 120 words. Directive: ${directive}`
      );
      if (completion.trim()) {
        description = completion.trim();
      }
    } catch (error) {
      Logger.warn("LoreEngine lore generation fallback", error);
    }

    let event: StoryTimelineEvent | undefined;
    try {
      event = await this.world.recordEvent({
        entityId: `faction-${evolving.id}`,
        entityType: "faction",
        entityLabel: evolving.name,
        description,
        tags: ["lore", "faction", "simulation"],
        metadata: { influence: evolving.influence, alignment: evolving.alignment },
        sessionId: options.sessionId ?? "storyworld",
        relatedEntities: factions
          .filter((faction) => faction.id !== evolving.id)
          .slice(0, 2)
          .map((faction) => ({
            entityId: `faction-${faction.id}`,
            relation: "interacts_with",
            label: faction.name
          }))
      });
    } catch (error) {
      Logger.warn("LoreEngine failed to record world memory", error);
    }

    await this.persist();

    return { id: uuidv4(), description, factions: this.listFactions(), event };
  }

  async recordPlayerDeed(player: PlayerState, description: string, goal?: PlayerGoalState) {
    const entry: MythosEntry = {
      id: uuidv4(),
      entry: `${player.name}: ${description}`.slice(0, 320),
      createdAt: new Date().toISOString(),
      tags: goal ? ["player", "goal"] : ["player"],
      related: [
        `player-${player.id}`,
        ...(goal?.id ? [`goal-${goal.id}`] : [])
      ]
    };

    this.mythos.unshift(entry);
    if (this.mythos.length > 200) {
      this.mythos.length = 200;
    }
    await this.persistMythos();
    return entry;
  }

  async recordGoalImpact(
    goal: GlobalGoalState,
    outcome: "completed" | "failed",
    actorId: string,
    details: Record<string, unknown>
  ) {
    const entry: MythosEntry = {
      id: uuidv4(),
      entry: `${goal.label} ${outcome === "completed" ? "achieved" : "faltered"} via ${actorId}.`,
      createdAt: new Date().toISOString(),
      tags: ["goal", outcome],
      related: [`goal-${goal.id}`, `player-${actorId}`]
    };
    const factionId = (details as { factionId?: string })?.factionId;
    if (factionId) {
      entry.related?.push(String(factionId));
    }

    this.mythos.unshift(entry);
    if (this.mythos.length > 200) {
      this.mythos.length = 200;
    }
    await this.persistMythos();
  }

  private async pickTerrainSeed(factionName: string): Promise<string | undefined> {
    try {
      const terrain = await TerrainGenerator.generate({ prompt: `Generate a landmark for ${factionName}` });
      return path.basename(terrain.filePath);
    } catch (error) {
      Logger.warn("LoreEngine terrain generation skipped", error);
      return undefined;
    }
  }
}
