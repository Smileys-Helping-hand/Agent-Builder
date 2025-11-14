import type { Application, Request, Response } from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { RobloxAgent } from "../agents/RobloxAgent.js";
import { NpcAgent } from "../agents/NpcAgent.js";
import { TerrainGenerator } from "../tools/TerrainGenerator.js";
import { Logger } from "../utils/Logger.js";

const agent = new RobloxAgent();
const npcAgent = new NpcAgent();

type GenerateRequest = {
  templateId?: string;
  prompt: string;
};

type ExportRequest = {
  title: string;
  assets: Array<{ path: string; content: string }>;
};

const createRbxlx = (title: string, assets: Array<{ path: string; content: string }>): string => {
  const body = assets
    .map((asset) => `    <Item class="Script" name="${asset.path}">\n      <Properties>\n        <Content name="Source">${Buffer.from(asset.content).toString("base64")}</Content>\n      </Properties>\n    </Item>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<roblox version="4">\n  <Item class="DataModel" name="${title}">\n${body}\n  </Item>\n</roblox>`;
};

export const registerRobloxRoutes = (app: Application) => {
  app.get(
    "/api/roblox/templates",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (_req: Request, res: Response) => {
      try {
        const templates = await agent.listTemplates();
        res.json({ templates });
      } catch (error) {
        Logger.error("Failed to fetch Roblox templates", error);
        res.status(500).json({ error: "Unable to load templates" });
      }
    }
  );

  app.post(
    "/api/roblox/generate",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { templateId, prompt } = req.body as GenerateRequest;
      if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
      }
      try {
        const game = await agent.generateGame({ templateId, prompt });
        res.json({ game });
      } catch (error) {
        Logger.error("Failed to generate Roblox experience", error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
      }
    }
  );

  app.post(
    "/api/roblox/export",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { title, assets } = req.body as ExportRequest;
      if (!title || !assets?.length) {
        return res.status(400).json({ error: "title and assets are required" });
      }
      try {
        const payload = createRbxlx(title, assets);
        res.json({
          filename: `${title.replace(/\s+/g, "-").toLowerCase()}.rbxlx`,
          content: Buffer.from(payload).toString("base64")
        });
      } catch (error) {
        Logger.error("Failed to export Roblox experience", error);
        res.status(500).json({ error: "Failed to export Roblox file" });
      }
    }
  );

  app.post(
    "/api/roblox/npc",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { prompt, templateId } = req.body as { prompt?: string; templateId?: string };
      if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
      }

      try {
        const npc = await npcAgent.generateNpc({ prompt, templateId: templateId as any });
        res.json({ npc });
      } catch (error) {
        Logger.error("Failed to generate NPC", error);
        res.status(500).json({ error: "NPC generation failed" });
      }
    }
  );

  app.post(
    "/api/roblox/terrain",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { prompt, seed } = req.body as { prompt?: string; seed?: number };
      if (!prompt) {
        return res.status(400).json({ error: "prompt is required" });
      }

      try {
        const terrain = await TerrainGenerator.generate({ prompt, seed });
        res.json({ terrain });
      } catch (error) {
        Logger.error("Failed to generate terrain", error);
        res.status(500).json({ error: "Terrain generation failed" });
      }
    }
  );
};
