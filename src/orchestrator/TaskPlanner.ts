import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { PluginRegistry } from "../agents/PluginRegistry.js";
import { Logger } from "../utils/Logger.js";
import { Task } from "./types.js";

type PlannerConfig = {
  customPhases?: Array<{ agentType: string; desc: string; dependsOn?: string[] }>;
};

const CONFIG_PATH = "agent.config.json";

const loadConfig = (): PlannerConfig => {
  try {
    const file = fs.readFileSync(path.resolve(CONFIG_PATH), "utf8");
    const data = JSON.parse(file) as PlannerConfig;
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      Logger.warn("Failed to read agent.config.json for task planner", error);
    }
    return {};
  }
};

export class TaskPlanner {
  static plan(prompt: string): Task[] {
    const config = loadConfig();
    const phases: Array<{ agentType: string; desc: string; dependsOn?: string[] }> = [
      { agentType: "BuilderAgent", desc: "Generate and scaffold base code" },
      { agentType: "UXAgent", desc: "Design UI and visual components" },
      { agentType: "OpsAgent", desc: "Setup CI/CD and deployment pipeline" },
      { agentType: "QAAgent", desc: "Run tests and validate logic" }
    ];

    if (config.customPhases?.length) {
      phases.push(...config.customPhases);
    }

    const pluginPhases = PluginRegistry.getTaskTemplates(prompt);
    if (pluginPhases.length) {
      phases.push(...pluginPhases.map((phase) => ({ ...phase, dependsOn: [] })));
    }

    const createdAt = new Date().toISOString();
    const tasks: Task[] = [];
    const previousByAgent = new Map<string, string>();
    let lastTaskId: string | null = null;

    for (const phase of phases) {
      const id = uuidv4();
      const dependencies = new Set<string>();

      if (phase.dependsOn?.length) {
        phase.dependsOn.forEach((dep) => dependencies.add(dep));
      }

      if (lastTaskId) {
        dependencies.add(lastTaskId);
      }

      const lastAgentTask = previousByAgent.get(phase.agentType);
      if (lastAgentTask) {
        dependencies.add(lastAgentTask);
      }

      const description = phase.desc.includes(prompt) ? phase.desc : `${phase.desc} for: ${prompt}`;

      const task: Task = {
        id,
        description,
        agentType: phase.agentType,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        dependencies: dependencies.size ? Array.from(dependencies) : undefined
      };

      tasks.push(task);
      previousByAgent.set(phase.agentType, id);
      lastTaskId = id;
    }

    return tasks;
  }
}
