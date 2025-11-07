import { BaseAgent } from "./BaseAgent.js";
import { Task } from "../orchestrator/types.js";
import { ModelRouter } from "../tools/ModelRouter.js";

export class BuilderAgent extends BaseAgent {
  constructor() {
    super("BuilderAgent");
  }

  canHandle(task: Task): boolean {
    return task.agentType === "BuilderAgent";
  }

  protected async execute(task: Task): Promise<any> {
    const prompt = `
    You are a senior fullstack engineer.
    Generate the full project structure, dependencies, and base code for:
    ${task.description}
    `;
    return await ModelRouter.generate(prompt);
  }
}
