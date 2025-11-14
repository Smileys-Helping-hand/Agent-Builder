import fs from "fs";
import path from "path";
import { FineTuner } from "../orchestrator/FineTuner.js";
import { VectorMemory } from "../state/VectorMemory.js";
import { Logger } from "../utils/Logger.js";
import { FeedbackStore } from "../utils/FeedbackStore.js";

export type TrainingExample = {
  prompt: string;
  completion: string;
  metadata?: Record<string, unknown>;
};

export class LocalTrainer {
  private static readonly TRAIN_PATH = path.resolve("./data/train.jsonl");

  private static async ensureFile() {
    await fs.promises.mkdir(path.dirname(this.TRAIN_PATH), { recursive: true });
    if (!fs.existsSync(this.TRAIN_PATH)) {
      await fs.promises.writeFile(this.TRAIN_PATH, "");
    }
  }

  static async recordExample(example: TrainingExample): Promise<void> {
    await this.ensureFile();
    const line = JSON.stringify({
      prompt: example.prompt,
      completion: example.completion,
      metadata: example.metadata ?? {}
    });
    await fs.promises.appendFile(this.TRAIN_PATH, `${line}\n`);
    Logger.log("LocalTrainer recorded example");
  }

  static async buildFromFeedback(limit = 50): Promise<number> {
    const entries = await FineTuner.prepareTrainingBatch(limit);
    let processed = 0;
    for (const entry of entries) {
      const prompt = entry.prompt ?? entry.notes ?? "";
      const completion = entry.output ?? entry.notes ?? "";
      if (!prompt || !completion) {
        continue;
      }
      const metadata: Record<string, unknown> = { rating: entry.rating, taskId: entry.taskId };
      await this.recordExample({ prompt, completion, metadata });
      processed += 1;
    }
    await FineTuner.markProcessed(entries.map((entry) => entry.id));

    const remaining = Math.max(0, limit - processed);
    if (remaining > 0) {
      const records = await FeedbackStore.consume(remaining);
      for (const record of records) {
        await this.recordExample({
          prompt: record.message,
          completion: record.message,
          metadata: record.metadata
        });
        processed += 1;
      }
    }

    return processed;
  }

  static async collectContext(query: string): Promise<string[]> {
    if (!VectorMemory.isEnabled()) {
      return [];
    }
    const records = await VectorMemory.searchByText(query, 3);
    return records.map((record) => record.result);
  }

  static async startTraining(): Promise<{ examples: number; path: string; provider: string }> {
    const examples = await this.buildFromFeedback();
    const provider = process.env.AI_PROVIDER ?? process.env.MODEL_PROVIDER ?? "openai";
    Logger.log(`Local training dataset refreshed with ${examples} examples using provider ${provider}`);
    return { examples, path: this.TRAIN_PATH, provider };
  }
}
