import { Orchestrator } from "./Orchestrator.js";
import { MemoryStore } from "../state/MemoryStore.js";
import { Logger } from "../utils/Logger.js";
import { Task } from "./types.js";
import { emitServerEvent } from "../server/eventBus.js";

export class AgentUpdater {
  private orchestrator: Orchestrator;

  constructor(orchestrator?: Orchestrator) {
    this.orchestrator = orchestrator ?? new Orchestrator();
  }

  async apply(taskId: string, instruction?: string) {
    const memory = MemoryStore.load();
    const existingTask: Task | undefined = memory[taskId];

    if (!existingTask) {
      throw new Error(`Task with id ${taskId} not found`);
    }

    const updatePrompt = instruction?.trim().length
      ? instruction
      : `Update task: ${existingTask.description}\nPrevious output: ${JSON.stringify(existingTask.result ?? {}, null, 2)}`;

    Logger.log(`Updating task ${taskId} with prompt: ${updatePrompt}`);
    const updatedTasks = await this.orchestrator.run(updatePrompt);

    const refreshedMemory = MemoryStore.load();
    const updatedAt = new Date().toISOString();

    refreshedMemory[taskId] = {
      ...existingTask,
      status: "done",
      updatedAt,
      result: {
        updatedAt,
        instruction: updatePrompt,
        followUp: updatedTasks
      }
    };
    MemoryStore.save(refreshedMemory);

    emitServerEvent({
      type: "task",
      payload: { task: refreshedMemory[taskId], timestamp: updatedAt }
    });

    return updatedTasks;
  }
}
