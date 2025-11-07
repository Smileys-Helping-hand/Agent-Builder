import { BaseAgent } from "./BaseAgent.js";
import { Task } from "../orchestrator/types.js";
import { ModelRouter } from "../tools/ModelRouter.js";

export class OpsAgent extends BaseAgent {
  constructor() {
    super("OpsAgent");
  }

  canHandle(task: Task): boolean {
    return task.agentType === "OpsAgent";
  }

  protected async execute(task: Task): Promise<any> {
    const prompt = `
    You are a DevOps engineer.
    Create CI/CD workflows, Dockerfiles, and deployment instructions for:
    ${task.description}
    `;
    return await ModelRouter.generate(prompt);
  }
}
