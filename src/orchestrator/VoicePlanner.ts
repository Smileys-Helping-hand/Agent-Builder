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
  api: {
    overview: "Design and ship a production-grade API with docs and tests.",
    steps: [
      { id: "design", title: "Design API", detail: "Outline endpoints, auth, and data contracts.", agent: "UXAgent" },
      { id: "implement", title: "Implement Services", detail: "Build controllers, services, and data models.", agent: "BuilderAgent" },
      { id: "docs", title: "Document", detail: "Generate OpenAPI specs and usage examples.", agent: "BuilderAgent" },
      { id: "qa", title: "Validate", detail: "Run integration tests and linting.", agent: "QAAgent" }
    ]
  },
  fullstack: {
    overview: "Create a full-stack experience with UI, API, and persistence.",
    steps: [
      { id: "plan", title: "Plan Architecture", detail: "Define routes, screens, and data flow.", agent: "UXAgent" },
      { id: "build", title: "Build Backend", detail: "Implement core services and database migrations.", agent: "BuilderAgent" },
      { id: "ui", title: "Build UI", detail: "Create responsive pages and components.", agent: "BuilderAgent" },
      { id: "qa", title: "Test", detail: "Execute unit and e2e tests.", agent: "QAAgent" }
    ]
  },
  automation: {
    overview: "Automate workflows with schedulers, hooks, and clean logging.",
    steps: [
      { id: "intake", title: "Gather Workflow", detail: "Capture triggers, inputs, and success criteria.", agent: "UXAgent" },
      { id: "wire", title: "Connect APIs", detail: "Wire webhooks, schedulers, and third-party APIs.", agent: "BuilderAgent" },
      { id: "observe", title: "Add Observability", detail: "Instrument logs and alerts for each step.", agent: "OpsAgent" }
    ]
  },
  script: {
    overview: "Generate a reusable script with flags, docs, and tests.",
    steps: [
      { id: "outline", title: "Outline", detail: "Describe CLI flags and behaviour.", agent: "UXAgent" },
      { id: "implement", title: "Implement Script", detail: "Write the script with clear logging and errors.", agent: "BuilderAgent" },
      { id: "validate", title: "Validate", detail: "Add smoke tests and usage notes.", agent: "QAAgent" }
    ]
  },
  cli: {
    overview: "Deliver a polished CLI with subcommands and help text.",
    steps: [
      { id: "design", title: "Design Commands", detail: "Map subcommands and options.", agent: "UXAgent" },
      { id: "build", title: "Build CLI", detail: "Implement commands, parsing, and output.", agent: "BuilderAgent" },
      { id: "docs", title: "Document", detail: "Write help text and usage examples.", agent: "BuilderAgent" }
    ]
  },
  desktop: {
    overview: "Create a desktop utility with native menus and updates.",
    steps: [
      { id: "plan", title: "Plan UI", detail: "Map windows, menus, and offline behaviour.", agent: "UXAgent" },
      { id: "implement", title: "Implement", detail: "Create the desktop shell and core features.", agent: "BuilderAgent" },
      { id: "ship", title: "Prepare Packaging", detail: "Bundle installers and update stubs.", agent: "OpsAgent" }
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
