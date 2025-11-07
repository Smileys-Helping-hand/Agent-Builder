import { Logger } from "../utils/Logger.js";
import { AgentResponse, Task } from "./types.js";

export type TaskExecutor = (task: Task) => Promise<AgentResponse>;

export type GraphHooks = {
  onTaskStart?: (task: Task) => void | Promise<void>;
  onTaskComplete?: (task: Task, response: AgentResponse) => void | Promise<void>;
  onTaskFailure?: (task: Task, response: AgentResponse) => void | Promise<void>;
  onTaskSkipped?: (task: Task, reason: string) => void | Promise<void>;
};

export class GraphEngine {
  static async execute(tasks: Task[], executor: TaskExecutor, hooks: GraphHooks = {}): Promise<Task[]> {
    if (tasks.length === 0) {
      return tasks;
    }

    const taskById = new Map(tasks.map((task) => [task.id, task] as const));
    const completed = new Set<string>();
    const skipped = new Set<string>();
    const inProgress = new Set<string>();

    const resolveDependencies = (task: Task) => {
      const deps = task.dependencies ?? [];
      for (const dep of deps) {
        if (!taskById.has(dep)) {
          Logger.warn(`Task ${task.id} references missing dependency ${dep}. Marking as skipped.`);
          skipped.add(task.id);
          void hooks.onTaskSkipped?.(task, `Missing dependency ${dep}`);
          return false;
        }
        if (!completed.has(dep)) {
          if (skipped.has(dep)) {
            Logger.warn(`Task ${task.id} dependency ${dep} was skipped. Task will be skipped.`);
            skipped.add(task.id);
            void hooks.onTaskSkipped?.(task, `Dependency ${dep} skipped`);
            return false;
          }
          return false;
        }
      }
      return true;
    };

    while (completed.size + skipped.size < tasks.length) {
      const ready = tasks.filter(
        (task) => !completed.has(task.id) && !skipped.has(task.id) && !inProgress.has(task.id) && resolveDependencies(task)
      );

      if (ready.length === 0) {
        const pending = tasks.filter((task) => !completed.has(task.id) && !skipped.has(task.id));
        if (pending.length === 0) {
          break;
        }
        const unresolvedIds = pending.map((task) => task.id).join(", ");
        throw new Error(`Graph execution stalled. Unresolved tasks: ${unresolvedIds}`);
      }

      for (const task of ready) {
        inProgress.add(task.id);
        await hooks.onTaskStart?.(task);
        let response: AgentResponse;
        try {
          response = await executor(task);
        } catch (error) {
          response = { taskId: task.id, success: false, error: error instanceof Error ? error.message : String(error) };
        }

        await hooks.onTaskComplete?.(task, response);
        if (!response.success) {
          await hooks.onTaskFailure?.(task, response);
        }
        completed.add(task.id);
        inProgress.delete(task.id);
      }
    }

    return tasks;
  }
}
