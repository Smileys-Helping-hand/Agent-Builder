import { BaseAgent } from "./BaseAgent.js";
import type { Task } from "../orchestrator/types.js";
import { WasmRuntime } from "../security/WasmRuntime.js";

export class WasmPluginAgent extends BaseAgent {
  private runtime: WasmRuntime;
  private exportedAgentType: string;

  constructor(agentType: string, runtime: WasmRuntime) {
    super(agentType);
    this.runtime = runtime;
    this.exportedAgentType = agentType;
  }

  canHandle(task: Task): boolean {
    return task.agentType === this.exportedAgentType;
  }

  protected async execute(task: Task): Promise<any> {
    const result = await this.runtime.execute({
      id: task.id,
      description: task.description,
      agentType: task.agentType,
      metadata: task.metadata
    });
    try {
      const parsed = JSON.parse(result.output);
      return { ...parsed, metrics: result.metrics };
    } catch (error) {
      return { output: result.output, metrics: result.metrics };
    }
  }
}
