/**
 * Blender3DAgent — Specialist for 3D Assets, Scenes, Animations & Blender Pipelines.
 *
 * Interfaces between the Multi-Agent Builder and BlenderStudio:
 *   - Translates project requirements into 3D scene plans and asset requests.
 *   - Generates executable Blender Python (bpy) automation scripts.
 *   - Generates client-side Three.js / WebGL procedural fallbacks.
 *   - Orchestrates headless compilation via Blender CLI when installed.
 */
import { BlenderStudio, type BlenderScenePlan } from "../../media/BlenderStudio.js";
import { Logger } from "../../utils/Logger.js";
import type { SuperPromptBlueprint } from "../../media/SuperPrompter.js";

export class Blender3DAgent {
  /**
   * Generates and writes all 3D assets, scripts, and bridges into the project workspace.
   */
  static async setup3DScene(
    workspaceDir: string,
    blueprint: SuperPromptBlueprint
  ): Promise<{ plan: BlenderScenePlan; compiled: boolean; filesCreated: string[] }> {
    Logger.log(`Blender3DAgent setting up 3D pipeline for '${blueprint.title}'`);

    const result = await BlenderStudio.setupWorkspace3D(
      workspaceDir,
      blueprint.projectName,
      blueprint.expandedBriefText || blueprint.tagline
    );

    const filesCreated = [
      "blender/generate_assets.py",
      "blender/build-in-blender.cmd",
      "src/lib/three3d.ts",
      "public/assets/3d/assets-3d.json"
    ];

    return {
      plan: result.plan,
      compiled: result.compiled,
      filesCreated
    };
  }
}
