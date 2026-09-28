import path from "path";
import { Logger } from "../utils/Logger.js";
import { CollaborationHub } from "./CollaborationHub.js";
import { WorldMemory } from "../state/WorldMemory.js";
import { QuestAgent } from "../agents/QuestAgent.js";
import { NpcAgent } from "../agents/NpcAgent.js";
import { RobloxAgent } from "../agents/RobloxAgent.js";
import { TerrainGenerator } from "../tools/TerrainGenerator.js";
import { VoiceController } from "../voice/VoiceController.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import type { StoryTimelineEvent } from "../models/NarrativeTypes.js";

export type StoryCommandResult = {
  events: StoryTimelineEvent[];
  narration?: { filePath: string; voice: string } | null;
  summary?: string;
};

const narratorVoice = process.env.VOICE_NARRATOR_VOICE ?? "en-US-GuyNeural";

export class StoryOrchestrator {
  private static instance: StoryOrchestrator | null = null;

  static getInstance() {
    if (!this.instance) {
      this.instance = new StoryOrchestrator();
    }
    return this.instance;
  }

  private readonly world = WorldMemory.getInstance();
  private readonly hub = CollaborationHub.getInstance();
  private readonly questAgent = new QuestAgent();
  private readonly npcAgent = new NpcAgent();
  private readonly robloxAgent = new RobloxAgent();
  private voiceController: VoiceController | null = null;

  private constructor() {
    void this.world.init();
  }

  async handleCommand(command: string, options: { sessionId?: string; author?: string; narrate?: boolean } = {}): Promise<StoryCommandResult> {
    const trimmed = command.trim();
    if (!trimmed) {
      return { events: [] };
    }

    const sessionId = options.sessionId ?? "storyworld";
    const baseEvent = await this.world.recordEvent({
      entityId: sessionId,
      entityType: "scene",
      entityLabel: "Story Session",
      description: trimmed,
      tags: ["command"],
      metadata: { author: options.author ?? "dashboard" },
      sessionId
    });

    this.hub.broadcastStoryEvent(baseEvent);

    const actions = this.determineActions(trimmed);
    const followupEvents: StoryTimelineEvent[] = [];

    for (const action of actions) {
      if (action === "quest") {
        const quest = await this.questAgent.generateQuest({ prompt: trimmed, sessionId });
        const event = await this.world.recordEvent({
          entityId: `quest-${quest.questId}`,
          entityType: "quest",
          entityLabel: quest.title,
          description: `Quest prepared with ${quest.steps.length} steps. Script saved to ${path.relative(process.cwd(), quest.scriptPath)}.`,
          tags: ["quest", "story"],
          metadata: { steps: quest.steps, rewards: quest.rewards, sessionId },
          sessionId,
          relatedEntities: [{ entityId: sessionId, relation: "belongs_to", label: "Story Session" }]
        });
        followupEvents.push(event);
        this.hub.broadcastStoryEvent(event);
      } else if (action === "npc") {
        const npc = await this.npcAgent.generateNpc({ prompt: trimmed, templateId: undefined });
        const event = await this.world.recordEvent({
          entityId: `npc-${path.basename(npc.filePath, ".lua")}`,
          entityType: "npc",
          entityLabel: npc.summary,
          description: `NPC script saved to ${path.relative(process.cwd(), npc.filePath)}.`,
          tags: ["npc", "story"],
          metadata: { summary: npc.summary },
          sessionId,
          relatedEntities: [{ entityId: sessionId, relation: "participates_in", label: "Story Session" }]
        });
        followupEvents.push(event);
        this.hub.broadcastStoryEvent(event);
      } else if (action === "terrain") {
        try {
          const terrain = await TerrainGenerator.generate({ prompt: trimmed });
          const event = await this.world.recordEvent({
            entityId: `terrain-${terrain.seed}`,
            entityType: "location",
            entityLabel: `Terrain ${terrain.seed}`,
            description: `Terrain preset generated at ${path.relative(process.cwd(), terrain.filePath)}.`,
            tags: ["terrain", "story"],
            metadata: { seed: terrain.seed },
            sessionId,
            relatedEntities: [{ entityId: sessionId, relation: "shapes", label: "Story Session" }]
          });
          followupEvents.push(event);
          this.hub.broadcastStoryEvent(event);
        } catch (error) {
          Logger.warn("StoryOrchestrator terrain generation failed", error);
        }
      } else if (action === "game") {
        try {
          const result = await this.robloxAgent.generateGame({ prompt: trimmed });
          const event = await this.world.recordEvent({
            entityId: `game-${Date.now()}`,
            entityType: "event",
            entityLabel: result.title,
            description: `Roblox experience refreshed with template ${result.templateId}.`,
            tags: ["game", "story"],
            metadata: { summary: result.summary, assets: result.assets.map((asset) => asset.path) },
            sessionId,
            relatedEntities: [{ entityId: sessionId, relation: "updates", label: "Story Session" }]
          });
          followupEvents.push(event);
          this.hub.broadcastStoryEvent(event);
        } catch (error) {
          Logger.warn("StoryOrchestrator Roblox update failed", error);
        }
      } else if (action === "lore") {
        const lore = await this.generateLore(trimmed, sessionId);
        const event = await this.world.recordEvent({
          entityId: `lore-${Date.now()}`,
          entityType: "event",
          entityLabel: "Story Lore",
          description: lore,
          tags: ["lore", "story"],
          metadata: { command: trimmed },
          sessionId,
          relatedEntities: [{ entityId: sessionId, relation: "narrates", label: "Story Session" }]
        });
        followupEvents.push(event);
        this.hub.broadcastStoryEvent(event);
      }
    }

    const narration = options.narrate ? await this.narrate(trimmed) : null;
    const { summary } = await this.world.summarizeSession(sessionId);

    return { events: [baseEvent, ...followupEvents], narration, summary };
  }

  async getTimeline(limit = 50): Promise<StoryTimelineEvent[]> {
    return this.world.listEvents(limit);
  }

  async recall(entityId: string) {
    return this.world.recall(entityId);
  }

  async summarize(sessionId?: string) {
    return this.world.summarizeSession(sessionId);
  }

  private determineActions(command: string): Array<"quest" | "npc" | "terrain" | "game" | "lore"> {
    const lowered = command.toLowerCase();
    const actions = new Set<"quest" | "npc" | "terrain" | "game" | "lore">();

    if (/quest|mission|hunt|objective/.test(lowered)) {
      actions.add("quest");
    }

    if (/npc|character|villager|vendor|shopkeep|ally/.test(lowered)) {
      actions.add("npc");
    }

    if (/terrain|biome|landscape|mountain|desert|cave|river|forest/.test(lowered)) {
      actions.add("terrain");
    }

    if (/game|experience|world|map|level/.test(lowered)) {
      actions.add("game");
    }

    actions.add("lore");

    return Array.from(actions.values());
  }

  private async generateLore(command: string, sessionId: string): Promise<string> {
    try {
      const context = await this.world.summarizeSession(sessionId);
      const prompt = `You are the Agent Builder StoryWorld narrator. Expand on the directive below with a short paragraph (<=120 words) that keeps continuity with the existing summary.\n\nDirective: ${command}\n\nExisting summary:\n${context.summary}`;
      const lore = await ModelRouter.generate(prompt);
      return lore.trim() || command;
    } catch (error) {
      Logger.warn("StoryOrchestrator lore generation failed", error);
      return command;
    }
  }

  private async narrate(text: string): Promise<{ filePath: string; voice: string } | null> {
    try {
      if (!this.voiceController) {
        this.voiceController = new VoiceController({ speechCacheDir: path.resolve("./data/voice/storyworld") });
        this.voiceController.setNarratorEnabled(true);
        this.voiceController.assignVoiceProfile("narrator", { voice: narratorVoice });
      }

      const filePath = await this.voiceController.narrate(text, { entityId: "narrator" });
      return filePath
        ? {
            filePath,
            voice: narratorVoice
          }
        : null;
    } catch (error) {
      Logger.warn("StoryOrchestrator narration failed", error);
      return null;
    }
  }
}
