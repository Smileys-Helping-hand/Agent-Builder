import fs from "fs";
import path from "path";
import { BaseAgent } from "./BaseAgent.js";
import type { Task } from "../orchestrator/types.js";
import { Logger } from "../utils/Logger.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { RobloxBridge } from "../integrations/RobloxBridge.js";
import { TerrainGenerator } from "../tools/TerrainGenerator.js";

export type RobloxTemplate = {
  id: string;
  label: string;
  description: string;
  content: string;
};

export type RobloxAsset = {
  path: string;
  type: "lua" | "json" | "metadata";
  content: string;
};

export type RobloxGame = {
  title: string;
  summary: string;
  templateId: string;
  assets: RobloxAsset[];
  metadata?: Record<string, unknown>;
};

const TEMPLATE_DIR = path.resolve("./templates/roblox");

const readTemplates = async (): Promise<RobloxTemplate[]> => {
  const files = await fs.promises.readdir(TEMPLATE_DIR);
  const templates: RobloxTemplate[] = [];
  for (const file of files) {
    if (!file.endsWith(".lua")) continue;
    const id = file.replace(/\.lua$/, "");
    const content = await fs.promises.readFile(path.join(TEMPLATE_DIR, file), "utf8");
    templates.push({
      id,
      label: id.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()),
      description: `Starter template for a ${id} Roblox experience`,
      content
    });
  }
  return templates;
};

const buildAssetsFromTemplate = (template: RobloxTemplate, summary: string): RobloxAsset[] => {
  const basePath = `StarterPlayerScripts/${template.id}.client.lua`;
  return [
    {
      path: basePath,
      type: "lua",
      content: `-- ${summary}\n${template.content}`
    },
    {
      path: "GameMetadata.json",
      type: "json",
      content: JSON.stringify({ template: template.id, summary }, null, 2)
    }
  ];
};

export class RobloxAgent extends BaseAgent {
  constructor() {
    super("RobloxAgent");
  }

  canHandle(task: Task): boolean {
    return task.agentType === "RobloxAgent";
  }

  protected async execute(task: Task): Promise<RobloxGame> {
    return this.generateGame({
      templateId: task.metadata?.templateId as string | undefined,
      prompt: task.description
    });
  }

  async listTemplates(): Promise<RobloxTemplate[]> {
    try {
      await fs.promises.mkdir(TEMPLATE_DIR, { recursive: true });
      return await readTemplates();
    } catch (error) {
      Logger.warn("Failed to list Roblox templates", error);
      return [];
    }
  }

  async generateGame({ templateId, prompt }: { templateId?: string; prompt: string }): Promise<RobloxGame> {
    const templates = await this.listTemplates();
    const template = templateId
      ? templates.find((candidate) => candidate.id === templateId)
      : templates[0];

    if (!template) {
      throw new Error("No Roblox templates available. Add files to templates/roblox.");
    }

    let summary = prompt.trim();
    try {
      const completion = await ModelRouter.generate(
        `Create a short 2 sentence summary for a Roblox experience based on: ${prompt}`
      );
      if (completion.trim()) {
        summary = completion.trim();
      }
    } catch (error) {
      Logger.warn("RobloxAgent summary generation failed", error);
    }

    const assets = buildAssetsFromTemplate(template, summary);

    if (/terrain|biome|mountain|desert|cave/i.test(prompt)) {
      try {
        const terrain = await TerrainGenerator.generate({ prompt });
        assets.push({ path: `terrain/${path.basename(terrain.filePath)}`, type: "lua", content: await fs.promises.readFile(terrain.filePath, "utf8") });
      } catch (error) {
        Logger.warn("RobloxAgent terrain generation failed", error);
      }
    }

    const game: RobloxGame = {
      title: summary.slice(0, 60),
      summary,
      templateId: template.id,
      assets,
      metadata: {
        generatedAt: new Date().toISOString(),
        terrainIncluded: assets.some((asset) => asset.path.startsWith("terrain/"))
      }
    } satisfies RobloxGame;

    try {
      await RobloxBridge.getInstance().syncProject(game);
    } catch (error) {
      Logger.warn("Failed to sync Roblox project to Studio", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return game;
  }
}
