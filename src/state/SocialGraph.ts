import fs from "fs";
import path from "path";
import { Logger } from "../utils/Logger.js";

export type SocialGraphNode = {
  id: string;
  label?: string;
  factionId?: string;
  role?: string;
  mood?: number;
  lastInteraction?: string;
};

export type SocialGraphEdge = {
  id: string;
  source: string;
  target: string;
  trust: number;
  rivalry: number;
  trade: number;
  interactions: number;
  lastInteraction?: string;
  context?: string;
};

export type SocialFactionSnapshot = {
  id: string;
  name?: string;
  influence: number;
  resources?: Record<string, number>;
  lastUpdated?: string;
};

export type SocialGraphSnapshot = {
  nodes: SocialGraphNode[];
  edges: SocialGraphEdge[];
  factions: SocialFactionSnapshot[];
  updatedAt: string;
};

const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, Math.round(value)));

const DATA_DIR = path.resolve("./data/storyworld");
const GRAPH_FILE = path.join(DATA_DIR, "social-graph.json");

export class SocialGraph {
  private static instance: SocialGraph | null = null;
  private readonly nodes = new Map<string, SocialGraphNode>();
  private readonly edges = new Map<string, SocialGraphEdge>();
  private readonly factions = new Map<string, SocialFactionSnapshot>();
  private updatedAt = new Date().toISOString();
  private persistPromise: Promise<void> | null = null;

  static getInstance() {
    if (!this.instance) {
      this.instance = new SocialGraph();
    }
    return this.instance;
  }

  private constructor() {
    try {
      if (fs.existsSync(GRAPH_FILE)) {
        const raw = fs.readFileSync(GRAPH_FILE, "utf8");
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as SocialGraphSnapshot;
          parsed.nodes.forEach((node) => this.nodes.set(node.id, node));
          parsed.edges.forEach((edge) => this.edges.set(edge.id, edge));
          parsed.factions.forEach((faction) => this.factions.set(faction.id, faction));
          this.updatedAt = parsed.updatedAt ?? this.updatedAt;
        }
      }
    } catch (error) {
      Logger.warn("SocialGraph failed to load state", error);
    }
  }

  ensureNode(node: SocialGraphNode) {
    const existing = this.nodes.get(node.id);
    const merged: SocialGraphNode = {
      id: node.id,
      label: node.label ?? existing?.label,
      factionId: node.factionId ?? existing?.factionId,
      role: node.role ?? existing?.role,
      mood: node.mood ?? existing?.mood,
      lastInteraction: existing?.lastInteraction ?? node.lastInteraction
    };
    if (node.lastInteraction) {
      merged.lastInteraction = node.lastInteraction;
    }
    this.nodes.set(node.id, merged);
    this.touch();
  }

  syncFactions(factions: SocialFactionSnapshot[]) {
    factions.forEach((faction) => {
      const existing = this.factions.get(faction.id);
      this.factions.set(faction.id, {
        id: faction.id,
        name: faction.name ?? existing?.name,
        influence: faction.influence ?? existing?.influence ?? 40,
        resources: faction.resources ?? existing?.resources,
        lastUpdated: faction.lastUpdated ?? existing?.lastUpdated
      });
    });
    this.touch();
  }

  updateFactionResources(factionId: string, resources: Record<string, number>) {
    const existing = this.factions.get(factionId) ?? { id: factionId, influence: 40 };
    this.factions.set(factionId, {
      ...existing,
      resources,
      lastUpdated: new Date().toISOString()
    });
    this.touch();
  }

  getFactionInfluence(factionId: string): SocialFactionSnapshot | undefined {
    return this.factions.get(factionId);
  }

  getRelationships(npcId: string): SocialGraphEdge[] {
    return [...this.edges.values()].filter((edge) => edge.source === npcId || edge.target === npcId);
  }

  modifyRelation(
    source: SocialGraphNode,
    target: SocialGraphNode,
    deltas: { trust?: number; rivalry?: number; trade?: number; context?: string }
  ): SocialGraphEdge {
    this.ensureNode(source);
    this.ensureNode(target);
    const [a, b] = source.id < target.id ? [source, target] : [target, source];
    const edgeId = `${a.id}::${b.id}`;
    const existing = this.edges.get(edgeId) ?? {
      id: edgeId,
      source: a.id,
      target: b.id,
      trust: 50,
      rivalry: 20,
      trade: 30,
      interactions: 0,
      lastInteraction: undefined,
      context: undefined
    } satisfies SocialGraphEdge;

    const updated: SocialGraphEdge = {
      ...existing,
      trust: clamp(existing.trust + (deltas.trust ?? 0)),
      rivalry: clamp(existing.rivalry + (deltas.rivalry ?? 0)),
      trade: clamp(existing.trade + (deltas.trade ?? 0)),
      interactions: existing.interactions + 1,
      lastInteraction: new Date().toISOString(),
      context: deltas.context ?? existing.context
    };

    this.edges.set(edgeId, updated);
    this.touch();
    return updated;
  }

  getSnapshot(): SocialGraphSnapshot {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()],
      factions: [...this.factions.values()],
      updatedAt: this.updatedAt
    };
  }

  private touch() {
    this.updatedAt = new Date().toISOString();
    void this.persist();
  }

  private async persist() {
    if (this.persistPromise) {
      return this.persistPromise;
    }
    this.persistPromise = (async () => {
      try {
        await fs.promises.mkdir(DATA_DIR, { recursive: true });
        const payload: SocialGraphSnapshot = {
          nodes: [...this.nodes.values()],
          edges: [...this.edges.values()],
          factions: [...this.factions.values()],
          updatedAt: this.updatedAt
        };
        await fs.promises.writeFile(GRAPH_FILE, JSON.stringify(payload, null, 2), "utf8");
      } catch (error) {
        Logger.warn("SocialGraph persist failed", error);
      } finally {
        this.persistPromise = null;
      }
    })();

    await this.persistPromise;
  }
}
