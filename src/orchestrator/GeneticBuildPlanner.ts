import { randomUUID } from "crypto";
import { Logger } from "../utils/Logger.js";
import type { Task } from "./types.js";

export type GeneticPlan = {
  id: string;
  prompt: string;
  createdAt: string;
  generations: Array<{
    generation: number;
    score: number;
    ordering: string[];
  }>;
};

const plans: GeneticPlan[] = [];

export class GeneticBuildPlanner {
  static async dryRun(prompt: string, tasks: Task[]): Promise<GeneticPlan> {
    const createdAt = new Date().toISOString();
    const plan: GeneticPlan = {
      id: randomUUID(),
      prompt,
      createdAt,
      generations: []
    };

    const seed = tasks.map((task) => task.id);
    const generationCount = Math.min(5, Math.max(2, Math.floor(tasks.length / 2)));

    for (let generation = 0; generation < generationCount; generation += 1) {
      const ordering = [...seed].sort(() => Math.random() - 0.5);
      const score = GeneticBuildPlanner.scoreOrdering(ordering, tasks);
      plan.generations.push({ generation, score, ordering });
    }

    plans.push(plan);
    Logger.log("GeneticBuildPlanner", `evaluated ${plan.generations.length} dry-run permutations`);
    return plan;
  }

  static listRecent(limit = 5): GeneticPlan[] {
    return plans.slice(-limit).reverse();
  }

  private static scoreOrdering(ordering: string[], tasks: Task[]): number {
    const position = new Map<string, number>();
    ordering.forEach((taskId, index) => {
      position.set(taskId, index);
    });

    let penalty = 0;
    for (const task of tasks) {
      const deps = task.dependencies ?? [];
      for (const dep of deps) {
        const taskIndex = position.get(task.id) ?? ordering.length;
        const depIndex = position.get(dep) ?? -1;
        if (depIndex > taskIndex) {
          penalty += 5;
        }
      }
    }

    return Math.max(0, ordering.length * 10 - penalty);
  }
}
