import { Task, AgentResponse } from "../orchestrator/types.js";
import { Logger } from "../utils/Logger.js";

export abstract class BaseAgent {
  agentType: string;

  constructor(agentType: string) {
    this.agentType = agentType;
  }

  abstract canHandle(task: Task): boolean;
  protected abstract execute(task: Task): Promise<any>;

  async handle(task: Task): Promise<AgentResponse> {
    Logger.log(`Executing ${task.agentType} → ${task.description}`);
    try {
      const output = await this.execute(task);
      return { taskId: task.id, success: true, output };
    } catch (err: any) {
      const message = err?.message ?? "Unknown agent failure";
      Logger.error(`${this.agentType} failed:`, message);
      return { taskId: task.id, success: false, error: message };
    }
  }
}
