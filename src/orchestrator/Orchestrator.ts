import { TaskPlanner } from "./TaskPlanner.js";
import { BuilderAgent } from "../agents/BuilderAgent.js";
import { UXAgent } from "../agents/UXAgent.js";
import { OpsAgent } from "../agents/OpsAgent.js";
import { QAAgent } from "../agents/QAAgent.js";
import { PluginRegistry } from "../agents/PluginRegistry.js";
import { Logger } from "../utils/Logger.js";
import { MemoryStore } from "../state/MemoryStore.js";
import { emitServerEvent } from "../server/eventBus.js";
import { VectorMemory } from "../state/VectorMemory.js";
import { GraphEngine, type GraphHooks, type TaskExecutor } from "./GraphEngine.js";
import { Telemetry } from "../observability/Telemetry.js";
import { RollbackManager } from "./RollbackManager.js";
import { Notifications } from "../integrations/Notifications.js";
import type { AgentResponse, Task } from "./types.js";
import { AdaptiveGraphOptimizer } from "./AdaptiveGraphOptimizer.js";
import { GeneticBuildPlanner } from "./GeneticBuildPlanner.js";
import { GovernanceStore } from "../state/GovernanceStore.js";

export class Orchestrator {
  private agents = [
    new BuilderAgent(),
    new UXAgent(),
    new OpsAgent(),
    new QAAgent(),
    ...PluginRegistry.getAgents()
  ];

  async run(prompt: string) {
    Logger.log("Starting orchestrator for:", prompt);
    const plannedTasks = TaskPlanner.plan(prompt);
    const optimizedTasks = AdaptiveGraphOptimizer.optimize(plannedTasks);
    const tasks = optimizedTasks;
    await GeneticBuildPlanner.dryRun(prompt, tasks);
    const memory = MemoryStore.load();

    const executor: TaskExecutor = async (task) => {
      Telemetry.recordTaskStart(task.agentType);
      const agent = this.agents.find((candidate) => candidate.canHandle(task));
      if (!agent) {
        const message = `No agent registered for ${task.agentType}`;
        Logger.warn(message);
        Telemetry.recordTaskEnd(task.agentType, false);
        return { taskId: task.id, success: false, error: message } satisfies AgentResponse;
      }
      const response = await agent.handle(task);
      Telemetry.recordTaskEnd(task.agentType, response.success);
      return response;
    };

    const hooks: GraphHooks = {
      onTaskStart: async (task: Task) => {
        task.status = "in_progress";
        task.error = undefined;
        const timestamp = new Date().toISOString();
        task.startedAt = timestamp;
        task.updatedAt = timestamp;
        emitServerEvent({ type: "task", payload: { task: { ...task }, timestamp } });
        await GovernanceStore.recordAudit({
          action: "task.start",
          actor: task.agentType,
          target: task.id,
          metadata: { prompt },
          timestamp
        });
      },
      onTaskComplete: async (task: Task, response: AgentResponse) => {
        task.status = response.success ? "done" : "failed";
        task.result = response.output ?? task.result;
        task.error = response.error;
        const timestamp = new Date().toISOString();
        task.completedAt = timestamp;
        task.updatedAt = timestamp;
        if (task.startedAt) {
          task.durationMs = new Date(timestamp).getTime() - new Date(task.startedAt).getTime();
        }
        emitServerEvent({ type: "task", payload: { task: { ...task }, timestamp } });
        memory[task.id] = task;
        MemoryStore.save(memory);
        await VectorMemory.storeTask(task);
        await RollbackManager.capture(task);
        await GovernanceStore.recordAudit({
          action: "task.complete",
          actor: task.agentType,
          target: task.id,
          metadata: { success: response.success, prompt },
          timestamp
        });
      },
      onTaskFailure: async (task: Task, response: AgentResponse) => {
        Logger.warn(`Task ${task.id} (${task.agentType}) failed: ${response.error ?? "Unknown error"}`);
        const timestamp = new Date().toISOString();
        await GovernanceStore.recordAudit({
          action: "task.failure",
          actor: task.agentType,
          target: task.id,
          metadata: { error: response.error, prompt },
          timestamp
        });
      },
      onTaskSkipped: async (task: Task, reason: string) => {
        task.status = "failed";
        task.error = reason;
        const timestamp = new Date().toISOString();
        task.updatedAt = timestamp;
        emitServerEvent({ type: "task", payload: { task: { ...task }, timestamp } });
        memory[task.id] = task;
        MemoryStore.save(memory);
        await GovernanceStore.recordAudit({
          action: "task.skipped",
          actor: task.agentType,
          target: task.id,
          metadata: { reason, prompt },
          timestamp
        });
      }
    };

    await GraphEngine.execute(tasks, executor, hooks);

    Logger.log("All tasks completed.");
    const completed = tasks.filter((task) => task.status === "done").length;
    const failed = tasks.filter((task) => task.status === "failed").length;
    void Notifications.sendSlackMessage(
      `Agent Builder completed prompt "${prompt}" — ${completed} tasks completed, ${failed} failed.`
    );
    const branch = process.env.GITHUB_BRANCH;
    if (branch) {
      void Notifications.createPullRequest(
        `Agent Builder: ${prompt.slice(0, 50)}...`,
        `Completed ${completed} tasks with ${failed} failures.`,
        branch
      );
    }
    return tasks;
  }
}
