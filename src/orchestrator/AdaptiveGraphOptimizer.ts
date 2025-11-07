import { Logger } from "../utils/Logger.js";
import type { Task } from "./types.js";

type OptimizationOptions = {
  ecoMode?: boolean;
};

const ENERGY_COST: Record<string, number> = {
  BuilderAgent: 5,
  UXAgent: 2,
  OpsAgent: 4,
  QAAgent: 3
};

export class AdaptiveGraphOptimizer {
  static optimize(tasks: Task[], options: OptimizationOptions = {}): Task[] {
    if (tasks.length === 0) {
      return tasks;
    }

    const ecoMode = options.ecoMode ?? process.env.ECO_MODE === "true";
    const reordered = [...tasks];

    const clusterByPhase = new Map<string, Task[]>();
    for (const task of reordered) {
      const key = task.agentType;
      const existing = clusterByPhase.get(key) ?? [];
      existing.push(task);
      clusterByPhase.set(key, existing);
    }

    const stableOrder: Task[] = [];
    for (const [agentType, cluster] of clusterByPhase.entries()) {
      cluster.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      for (const task of cluster) {
        task.metadata = {
          ...task.metadata,
          optimizer: {
            ...(task.metadata?.optimizer as Record<string, unknown> | undefined),
            cluster: agentType
          }
        };
      }
      stableOrder.push(...cluster);
    }

    if (ecoMode) {
      stableOrder.sort((a, b) => AdaptiveGraphOptimizer.energyCost(a) - AdaptiveGraphOptimizer.energyCost(b));
      for (const task of stableOrder) {
        task.metadata = {
          ...task.metadata,
          optimizer: {
            ...(task.metadata?.optimizer as Record<string, unknown> | undefined),
            ecoScheduled: true,
            energyCost: AdaptiveGraphOptimizer.energyCost(task)
          }
        };
      }
    }

    AdaptiveGraphOptimizer.relinkDependencies(stableOrder);

    Logger.log(
      "AdaptiveGraphOptimizer",
      `optimized ${tasks.length} tasks` + (ecoMode ? " with eco mode" : "")
    );

    return stableOrder;
  }

  private static energyCost(task: Task): number {
    if (typeof task.metadata?.energyCost === "number") {
      return task.metadata.energyCost;
    }
    return ENERGY_COST[task.agentType] ?? 3;
  }

  private static relinkDependencies(tasks: Task[]) {
    const seen = new Map<string, Task>();
    for (const task of tasks) {
      seen.set(task.id, task);
    }

    let previous: Task | null = null;
    for (const task of tasks) {
      const dependencies = new Set(task.dependencies ?? []);
      if (previous && !dependencies.has(previous.id)) {
        dependencies.add(previous.id);
      }
      task.dependencies = dependencies.size ? Array.from(dependencies) : undefined;
      task.metadata = {
        ...task.metadata,
        optimizer: {
          ...(task.metadata?.optimizer as Record<string, unknown> | undefined),
          adaptiveDependencies: task.dependencies
        }
      };
      previous = task;
    }
  }
}
