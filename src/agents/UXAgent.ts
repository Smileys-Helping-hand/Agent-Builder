import { BaseAgent } from "./BaseAgent.js";
import { Task } from "../orchestrator/types.js";
import { ModelRouter } from "../tools/ModelRouter.js";

export class UXAgent extends BaseAgent {
  constructor() {
    super("UXAgent");
  }

  canHandle(task: Task): boolean {
    return task.agentType === "UXAgent";
  }

  protected async execute(task: Task): Promise<any> {
    const prompt = `
    You are a senior UI/UX designer.
    Design the user interface and styling guidelines for:
    ${task.description}
    `;
    return await ModelRouter.generate(prompt);
  }
}
