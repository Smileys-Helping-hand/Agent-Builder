import EventEmitter from "events";
import type { Task } from "../orchestrator/types.js";

export type SdkConfig = {
  apiUrl?: string;
  token?: string;
};

export type RunResult = Task[];

export class DeveloperSDK extends EventEmitter {
  private apiUrl: string;
  private token?: string;

  constructor(config: SdkConfig = {}) {
    super();
    this.apiUrl = config.apiUrl ?? process.env.AGENT_BUILDER_API_URL ?? "http://localhost:4000";
    this.token = config.token ?? process.env.AGENT_BUILDER_TOKEN;
  }

  async run(prompt: string): Promise<RunResult> {
    const response = await fetch(`${this.apiUrl}/api/agent/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify({ prompt })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeveloperSDK.run failed: ${response.status} ${text}`);
    }

    const tasks = (await response.json()) as Task[];
    this.emit("run", { prompt, tasks });
    return tasks;
  }

  async update(taskId: string, instruction: string): Promise<Task[]> {
    const response = await fetch(`${this.apiUrl}/api/agent/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
      },
      body: JSON.stringify({ taskId, instruction })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`DeveloperSDK.update failed: ${response.status} ${text}`);
    }

    const result = (await response.json()) as { updated: boolean; result: Task[] };
    this.emit("update", { taskId, instruction, result });
    return result.result;
  }
}
