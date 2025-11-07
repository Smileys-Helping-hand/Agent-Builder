import { FineTuner, type FeedbackEntry } from "./FineTuner.js";
import { MemoryStore } from "../state/MemoryStore.js";
import type { Task } from "./types.js";

type RatingSummary = {
  totalFeedback: number;
  averageRating: number | null;
  unprocessed: number;
  tagHistogram: Record<string, number>;
};

type AgentPerformance = {
  agentType: string;
  totalFeedback: number;
  averageRating: number | null;
  lastFeedbackAt?: string;
};

type IssueReport = {
  taskId?: string;
  prompt?: string;
  notes?: string;
  createdAt: string;
  rating?: number;
};

export type ReinforcementInsights = {
  ratings: RatingSummary;
  agentPerformance: AgentPerformance[];
  recentIssues: IssueReport[];
};

export class RLTrainer {
  static async analyzeFeedback(limit = 100): Promise<ReinforcementInsights> {
    const entries = await FineTuner.listFeedback();
    const recent = [...entries].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const slice = recent.slice(0, limit);

    const ratingSummary = this.computeRatingSummary(entries);
    const agentPerformance = this.computeAgentPerformance(entries, MemoryStore.load());
    const issues = slice
      .filter((entry) => (entry.rating ?? 0) <= 3 || (entry.notes ?? "").length > 0)
      .map((entry) => ({
        taskId: entry.taskId,
        prompt: entry.prompt,
        notes: entry.notes,
        createdAt: entry.createdAt,
        rating: entry.rating
      } satisfies IssueReport));

    return {
      ratings: ratingSummary,
      agentPerformance,
      recentIssues: issues
    };
  }

  private static computeRatingSummary(entries: FeedbackEntry[]): RatingSummary {
    if (entries.length === 0) {
      return { totalFeedback: 0, averageRating: null, unprocessed: 0, tagHistogram: {} };
    }

    let total = 0;
    let count = 0;
    const tags: Record<string, number> = {};
    let unprocessed = 0;

    for (const entry of entries) {
      if (typeof entry.rating === "number") {
        total += entry.rating;
        count += 1;
      }

      if (!entry.processedAt) {
        unprocessed += 1;
      }

      for (const tag of entry.tags ?? []) {
        tags[tag] = (tags[tag] ?? 0) + 1;
      }
    }

    return {
      totalFeedback: entries.length,
      averageRating: count > 0 ? Number((total / count).toFixed(2)) : null,
      unprocessed,
      tagHistogram: tags
    };
  }

  private static computeAgentPerformance(entries: FeedbackEntry[], memory: Record<string, Task>): AgentPerformance[] {
    const grouped = new Map<string, FeedbackEntry[]>();

    for (const entry of entries) {
      const task = entry.taskId ? memory[entry.taskId] : undefined;
      const agentKey = task?.agentType ?? "unknown";
      const bucket = grouped.get(agentKey) ?? [];
      bucket.push(entry);
      grouped.set(agentKey, bucket);
    }

    return Array.from(grouped.entries()).map(([agentType, bucket]) => {
      const ratings = bucket.filter((entry) => typeof entry.rating === "number");
      const averageRating =
        ratings.length > 0
          ? Number(
              (
                ratings.reduce((total, entry) => total + (entry.rating ?? 0), 0) /
                ratings.length
              ).toFixed(2)
            )
          : null;
      const lastFeedbackAt = bucket
        .map((entry) => entry.createdAt)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];

      return {
        agentType,
        totalFeedback: bucket.length,
        averageRating,
        lastFeedbackAt
      } satisfies AgentPerformance;
    });
  }
}
