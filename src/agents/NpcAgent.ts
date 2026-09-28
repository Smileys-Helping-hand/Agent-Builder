import fs from "fs";
import path from "path";
import { BaseAgent } from "./BaseAgent.js";
import type { Task } from "../orchestrator/types.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { RobloxBridge } from "../integrations/RobloxBridge.js";
import { Logger } from "../utils/Logger.js";

const NPC_DIRECTORY = path.resolve("games/roblox/npcs");
const TEMPLATE_DIRECTORY = path.resolve("templates/roblox");

export type NpcRequest = {
  prompt: string;
  templateId?: "npc_dialogue" | "npc_patrol" | "npc_shop";
};

export type NpcResult = {
  filePath: string;
  content: string;
  summary: string;
};

const DEFAULT_TEMPLATE = "npc_dialogue";

const loadTemplate = async (templateId: string) => {
  const templatePath = path.join(TEMPLATE_DIRECTORY, `${templateId}.lua`);
  return fs.promises.readFile(templatePath, "utf8");
};

export class NpcAgent extends BaseAgent {
  constructor() {
    super("NpcAgent");
  }

  canHandle(task: Task): boolean {
    return task.agentType === "NpcAgent";
  }

  protected async execute(task: Task): Promise<NpcResult> {
    const prompt = task.description ?? "Generate a friendly NPC.";
    const templateId = (task.metadata?.templateId as string | undefined) ?? DEFAULT_TEMPLATE;
    return this.generateNpc({ prompt, templateId: templateId as NpcRequest["templateId"] });
  }

  async generateNpc({ prompt, templateId }: NpcRequest): Promise<NpcResult> {
    await fs.promises.mkdir(NPC_DIRECTORY, { recursive: true });
    const template = await loadTemplate(templateId ?? DEFAULT_TEMPLATE);

    let summary = prompt.trim();
    try {
      const completion = await ModelRouter.generate(
        `Create a concise NPC summary (under 80 chars) for: ${prompt}`
      );
      if (completion.trim()) {
        summary = completion.trim();
      }
    } catch (error) {
      Logger.warn("NpcAgent summary generation failed", error);
    }

    const scriptBody = `-- ${summary}\n${template}\n-- Behaviour prompt: ${prompt}\n`;
    const fileName = `${summary.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "npc"}.lua`;
    const filePath = path.join(NPC_DIRECTORY, fileName);
    await fs.promises.writeFile(filePath, scriptBody, "utf8");

    try {
      await RobloxBridge.getInstance().pushAsset(filePath);
    } catch (error) {
      Logger.warn("NpcAgent failed to push asset", { error });
    }

    return { filePath, content: scriptBody, summary };
  }
}
