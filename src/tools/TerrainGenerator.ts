import fs from "fs";
import path from "path";
import { ModelRouter } from "./ModelRouter.js";
import { RobloxBridge } from "../integrations/RobloxBridge.js";
import { Logger } from "../utils/Logger.js";

const TERRAIN_DIRECTORY = path.resolve("games/roblox/terrain");
const TEMPLATE_PATH = path.resolve("templates/roblox/terrain.lua");

export type TerrainRequest = {
  prompt: string;
  seed?: number;
};

export type TerrainResult = {
  filePath: string;
  seed: number;
  summary: string;
};

const randomSeed = () => Math.floor(Math.random() * 1_000_000);

export class TerrainGenerator {
  static async generate({ prompt, seed }: TerrainRequest): Promise<TerrainResult> {
    await fs.promises.mkdir(TERRAIN_DIRECTORY, { recursive: true });
    const base = await fs.promises.readFile(TEMPLATE_PATH, "utf8");
    const effectiveSeed = seed ?? randomSeed();

    let summary = prompt.trim();
    try {
      const completion = await ModelRouter.generate(
        `Write a short terrain summary (under 100 chars) for Roblox world: ${prompt}`
      );
      if (completion.trim()) {
        summary = completion.trim();
      }
    } catch (error) {
      Logger.warn("Terrain summary generation failed", error);
    }

    const script = `-- ${summary}\nlocal TerrainBuilder = require(script:FindFirstChild("TerrainBuilder") or script)\nTerrainBuilder.generate(${effectiveSeed})\n`;
    const fileName = `${effectiveSeed}-terrain.lua`;
    const filePath = path.join(TERRAIN_DIRECTORY, fileName);
    const builderPath = path.join(TERRAIN_DIRECTORY, "TerrainBuilder.lua");

    await fs.promises.writeFile(filePath, script, "utf8");
    await fs.promises.writeFile(builderPath, base, "utf8");

    try {
      await RobloxBridge.getInstance().pushAsset(filePath);
      await RobloxBridge.getInstance().pushAsset(builderPath);
    } catch (error) {
      Logger.warn("Terrain push failed", { error });
    }

    return { filePath, seed: effectiveSeed, summary };
  }
}
