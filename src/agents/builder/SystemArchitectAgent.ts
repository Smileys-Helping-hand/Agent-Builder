/**
 * SystemArchitectAgent — Lead Architect in the Multi-Agent Builder Swarm.
 *
 * Responsibilities:
 *   - Deconstructs requirements into modular interfaces, state trees, and file boundaries.
 *   - Defines strict contracts between Code Engine (logic/state), Visual Agent (UI/Canvas),
 *     3D Blender Agent (assets/meshes), and Sound Agent (audio).
 *   - Eliminates monolithic spaghetti generation by coordinating specialist agents.
 */
import { ModelRouter } from "../../tools/ModelRouter.js";
import { Logger } from "../../utils/Logger.js";
import type { SuperPromptBlueprint } from "../../media/SuperPrompter.js";

export interface AgentPartitionPlan {
  codeEngineTasks: {
    files: string[];
    objectives: string[];
  };
  visualAnimationTasks: {
    files: string[];
    stylingRules: string[];
    canvasOrComponents: string[];
  };
  blender3DTasks: {
    generateBlenderScripts: boolean;
    assets: string[];
  };
  soundFxTasks: {
    generateAudioModule: boolean;
    sounds: string[];
  };
}

export class SystemArchitectAgent {
  /**
   * Plans the division of labor across specialized agents based on the blueprint.
   */
  static planPartitions(blueprint: SuperPromptBlueprint): AgentPartitionPlan {
    const isGame = blueprint.kind === "game";

    const codeFiles: string[] = [];
    const visualFiles: string[] = [];

    for (const f of blueprint.filesToGenerate) {
      if (f.path.includes("test") || f.path.includes("logic") || f.path.includes("state") || f.path.includes("store") || f.path.includes("types")) {
        codeFiles.push(f.path);
      } else {
        visualFiles.push(f.path);
      }
    }

    return {
      codeEngineTasks: {
        files: codeFiles,
        objectives: [
          "Implement fully deterministic business/gameplay logic",
          "Create state management with reactive stores and error guards",
          "Ensure 100% type safety and exported helper interfaces",
          "Provide passing unit test suites"
        ]
      },
      visualAnimationTasks: {
        files: visualFiles,
        stylingRules: [
          `Style: ${blueprint.theme.style}`,
          `Primary: ${blueprint.theme.palette.primary}, Accent: ${blueprint.theme.palette.accent}`,
          `Motion easing: ${blueprint.animationRules.easing}`
        ],
        canvasOrComponents: isGame
          ? ["Canvas rendering loop with double-buffering & particle VFX", "HUD overlay with score, health, and status", "Modal upgrade/game over screens"]
          : ["Responsive navigation sidebar", "KPI metric cards with SVG charts", "Search/filter table with modals"]
      },
      blender3DTasks: {
        generateBlenderScripts: Boolean(blueprint.is3D && blueprint.blender3DAssets && blueprint.blender3DAssets.length > 0),
        assets: blueprint.blender3DAssets ? blueprint.blender3DAssets.map(a => a.name) : []
      },
      soundFxTasks: {
        generateAudioModule: blueprint.soundEffects.length > 0,
        sounds: blueprint.soundEffects.map(s => s.name)
      }
    };
  }
}
