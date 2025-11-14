import { Logger } from "../utils/Logger.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import type { BuildMode, BuildPlan } from "../models/BuildTypes.js";

const DEFAULT_PLAN: Record<BuildMode, BuildPlan> = {
  app: {
    overview: "Scaffold web app, generate backend, validate build, and summarize results.",
    steps: [
      { id: "requirements", title: "Collect Requirements", detail: "Summarise requested app capabilities and dependencies.", agent: "UXAgent" },
      { id: "scaffold", title: "Generate Scaffolding", detail: "Create project skeleton, install dependencies, and configure environment.", agent: "BuilderAgent" },
      { id: "implement", title: "Implement Features", detail: "Fill in core business logic, APIs, and UI flows.", agent: "BuilderAgent" },
      { id: "qa", title: "Run Quality Checks", detail: "Execute lint/test commands and capture issues.", agent: "QAAgent" },
      { id: "deploy", title: "Prepare Deployment", detail: "Bundle artifacts and update deployment instructions.", agent: "OpsAgent" }
    ]
  },
  game: {
    overview: "Generate Roblox experience assets, NPCs, and sync with Studio.",
    steps: [
      { id: "concept", title: "Outline Game Concept", detail: "Describe mechanics, goals, and player flow.", agent: "StoryAgent" },
      { id: "world", title: "Generate World", detail: "Create terrain, assets, and lighting presets.", agent: "RobloxAgent" },
      { id: "npcs", title: "Add NPC Logic", detail: "Produce NPC behaviours and quests.", agent: "NpcAgent" },
      { id: "sync", title: "Sync to Studio", detail: "Push assets via Roblox Bridge and confirm playtest readiness.", agent: "RobloxAgent" }
    ]
  },
  simulation: {
    overview: "Configure StoryWorld simulation parameters and kick off live ticks.",
    steps: [
      { id: "timeline", title: "Extend Timeline", detail: "Update lore, quests, and memory context.", agent: "StoryOrchestrator" },
      { id: "actors", title: "Configure Actors", detail: "Spawn or update NPCs, factions, and AI players.", agent: "StoryOrchestrator" },
      { id: "run", title: "Advance Simulation", detail: "Trigger world ticks and capture notable events.", agent: "WorldSimulator" }
    ]
  },
  fusion: {
    overview: "Blend application workflows with StoryWorld simulation hooks.",
    steps: [
      { id: "analyze", title: "Analyze Domains", detail: "Map overlaps between app features and simulation loops.", agent: "BuilderAgent" },
      { id: "integrate", title: "Wire Integration", detail: "Connect APIs or UI to simulation events.", agent: "MergeEngine" },
      { id: "validate", title: "Validate Scenarios", detail: "Run combined tests ensuring both systems interoperate.", agent: "QAAgent" }
    ]
  }
};

const parsePlan = (text: string, fallback: BuildPlan): BuildPlan => {
  try {
    const parsed = JSON.parse(text) as Partial<BuildPlan>;
    if (!parsed || !Array.isArray(parsed.steps)) {
      return fallback;
    }
    const steps = parsed.steps
      .map((step, index) => ({
        id: step.id ?? `step-${index + 1}`,
        title: step.title ?? step.detail ?? `Step ${index + 1}`,
        detail: step.detail ?? step.title ?? "",
        agent: step.agent
      }))
      .filter((step) => step.title && step.detail);
    if (steps.length === 0) {
      return fallback;
    }
    return {
      overview: parsed.overview ?? fallback.overview,
      steps
    } satisfies BuildPlan;
  } catch (error) {
    Logger.warn("VoicePlanner JSON parse failed", error);
    return fallback;
  }
};

export class VoicePlanner {
  static async planBuild(prompt: string, mode: BuildMode): Promise<BuildPlan> {
    const fallback = DEFAULT_PLAN[mode];
    const plannerPrompt = `You are the BuildEngine planner. Create a JSON build plan with an overview string and steps array. Each step must include id, title, detail, and agent. Prompt: ${prompt}. Mode: ${mode}.`;
    try {
      const completion = await ModelRouter.generate(plannerPrompt, {
        model: process.env.MODEL ?? process.env.OPENAI_MODEL ?? "gpt-4-turbo"
      });
      const trimmed = completion.trim();
      if (!trimmed) {
        return fallback;
      }
      return parsePlan(trimmed, fallback);
    } catch (error) {
      Logger.warn("VoicePlanner fallback due to model error", error);
      return fallback;
    }
  }
}
