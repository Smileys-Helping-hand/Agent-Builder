import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "../utils/Logger.js";
import { VectorMemory } from "../state/VectorMemory.js";
import { ModelRouter } from "./ModelRouter.js";

export type DialogEntry = {
  id: string;
  npcId: string;
  speaker: string;
  content: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
};

const DIALOG_DIRECTORY = path.resolve("./data/storyworld/dialogs");

const ensureDirectory = async () => {
  await fs.promises.mkdir(DIALOG_DIRECTORY, { recursive: true });
};

const loadDialogFile = async (npcId: string) => {
  const filePath = path.join(DIALOG_DIRECTORY, `${npcId}.json`);
  try {
    const raw = await fs.promises.readFile(filePath, "utf8");
    return JSON.parse(raw) as DialogEntry[];
  } catch (error: any) {
    if (error?.code === "ENOENT") {
      return [];
    }
    Logger.warn("Failed to load dialog history", { npcId, error });
    return [];
  }
};

const persistDialogFile = async (npcId: string, entries: DialogEntry[]) => {
  const filePath = path.join(DIALOG_DIRECTORY, `${npcId}.json`);
  await fs.promises.writeFile(filePath, JSON.stringify(entries, null, 2), "utf8");
};

export class DialogMemory {
  private static instance: DialogMemory | null = null;
  private readonly cache = new Map<string, DialogEntry[]>();

  static getInstance() {
    if (!this.instance) {
      this.instance = new DialogMemory();
    }
    return this.instance;
  }

  private constructor() {
    void ensureDirectory();
  }

  async recordUtterance(
    npcId: string,
    speaker: string,
    content: string,
    metadata: Record<string, unknown> = {}
  ): Promise<DialogEntry> {
    await ensureDirectory();
    const entry: DialogEntry = {
      id: uuidv4(),
      npcId,
      speaker,
      content,
      timestamp: new Date().toISOString(),
      metadata
    };

    try {
      const history = await this.getHistory(npcId, 100);
      history.push(entry);
      this.cache.set(npcId, history);
      await persistDialogFile(npcId, history);
    } catch (error) {
      Logger.warn("Failed to persist dialog memory", { npcId, error });
    }

    try {
      await VectorMemory.storeConversationTurn(content, {
        type: "npc_dialog",
        npcId,
        speaker,
        ...metadata
      });
    } catch (error) {
      Logger.warn("Failed to store dialog turn in vector memory", { npcId, error });
    }

    return entry;
  }

  async getHistory(npcId: string, limit = 20): Promise<DialogEntry[]> {
    if (this.cache.has(npcId)) {
      return [...(this.cache.get(npcId) ?? [])].slice(-limit);
    }

    const entries = await loadDialogFile(npcId);
    this.cache.set(npcId, entries);
    return entries.slice(-limit);
  }

  async recallRelevant(npcId: string, query: string, limit = 5): Promise<DialogEntry[]> {
    if (!VectorMemory.isEnabled()) {
      return this.getHistory(npcId, limit);
    }

    try {
      const results = await VectorMemory.searchByText(`${npcId}: ${query}`, limit);
      const matches = results
        .filter((record) => record.metadata?.npcId === npcId)
        .map((record) => ({
          id: record.id,
          npcId,
          speaker: String(record.metadata?.speaker ?? "npc"),
          content: record.result,
          timestamp: record.createdAt,
          metadata: record.metadata
        } satisfies DialogEntry));
      if (matches.length > 0) {
        return matches;
      }
    } catch (error) {
      Logger.warn("DialogMemory recall fallback", { npcId, error });
    }

    return this.getHistory(npcId, limit);
  }

  async summarizeHistory(npcId: string, limit = 15): Promise<string> {
    const history = await this.getHistory(npcId, limit);
    if (history.length === 0) {
      return "This NPC has not interacted with anyone yet.";
    }

    const transcript = history
      .slice(-limit)
      .map((entry) => `${entry.speaker}: ${entry.content}`)
      .join("\n");

    try {
      const summary = await ModelRouter.generate(
        `You maintain continuity for NPCs. Summarize the persona and recent interactions for NPC ${npcId} in 3 sentences.\n\n${transcript}`
      );
      return summary.trim() || transcript.slice(-280);
    } catch (error) {
      Logger.warn("DialogMemory summarization fallback", { npcId, error });
      return transcript.slice(-280);
    }
  }
}
