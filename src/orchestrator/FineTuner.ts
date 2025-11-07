import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "../utils/Logger.js";

export type FeedbackPayload = {
  taskId?: string;
  prompt?: string;
  output?: string;
  rating?: number;
  notes?: string;
  tags?: string[];
};

export type FeedbackEntry = FeedbackPayload & {
  id: string;
  createdAt: string;
  processedAt?: string | null;
};

const FEEDBACK_PATH = path.resolve("./data/feedback.json");

const readFeedback = async (): Promise<FeedbackEntry[]> => {
  try {
    const raw = await fs.promises.readFile(FEEDBACK_PATH, "utf8");
    return JSON.parse(raw) as FeedbackEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeFeedback = async (entries: FeedbackEntry[]) => {
  await fs.promises.mkdir(path.dirname(FEEDBACK_PATH), { recursive: true });
  await fs.promises.writeFile(FEEDBACK_PATH, JSON.stringify(entries, null, 2));
};

export class FineTuner {
  static async recordFeedback(payload: FeedbackPayload): Promise<FeedbackEntry> {
    const entry: FeedbackEntry = {
      ...payload,
      id: uuidv4(),
      createdAt: new Date().toISOString(),
      processedAt: null
    };

    const entries = await readFeedback();
    entries.push(entry);
    await writeFeedback(entries);
    Logger.log("Captured feedback entry", entry.id);
    return entry;
  }

  static async listFeedback(options: { processed?: boolean } = {}): Promise<FeedbackEntry[]> {
    const entries = await readFeedback();
    if (options.processed === undefined) {
      return entries;
    }
    return entries.filter((entry) => (options.processed ? Boolean(entry.processedAt) : !entry.processedAt));
  }

  static async markProcessed(ids: string[]): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const entries = await readFeedback();
    const now = new Date().toISOString();
    let changed = false;
    for (const entry of entries) {
      if (ids.includes(entry.id)) {
        entry.processedAt = now;
        changed = true;
      }
    }
    if (changed) {
      await writeFeedback(entries);
      Logger.log(`Marked ${ids.length} feedback entries as processed.`);
    }
  }

  static async prepareTrainingBatch(limit = 25): Promise<FeedbackEntry[]> {
    const entries = await this.listFeedback({ processed: false });
    return entries.slice(0, limit);
  }
}
