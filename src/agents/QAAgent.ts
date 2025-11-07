import { BaseAgent } from "./BaseAgent.js";
import { Task } from "../orchestrator/types.js";
import { ModelRouter } from "../tools/ModelRouter.js";

export class QAAgent extends BaseAgent {
  constructor() {
    super("QAAgent");
  }

  canHandle(task: Task): boolean {
    return task.agentType === "QAAgent";
  }

  protected async execute(task: Task): Promise<any> {
    const prompt = `
    You are a QA engineer.
    Write end-to-end tests and validation scripts for:
    ${task.description}
    `;
    return await ModelRouter.generate(prompt);
  }
}
