import dotenv from "dotenv";
import { AutonomousOrchestrator } from "./orchestrator/AutonomousOrchestrator.js";
import { PluginRegistry } from "./agents/PluginRegistry.js";
import { VectorMemory } from "./state/VectorMemory.js";

dotenv.config();

(async () => {
  await PluginRegistry.initialize();
  await VectorMemory.init();

  const orchestrator = new AutonomousOrchestrator({
    projectName: "demo-app",
    description: "Build a React dashboard with a Node.js API backend",
    targetPlatforms: ["windows"],
    qualityThreshold: 100,
    maxIterations: 3,
    enableContinuousLearning: false,
    hardwareOptimization: true,
    autoPackaging: false,
    profile: "balanced"
  });

  orchestrator.on("iteration-complete", (iteration) => {
    console.log(
      `Iteration ${iteration.iteration}: objective score ${iteration.objectiveScore} ` +
        `(${iteration.verification?.passed ? "passed" : "not passed"})`
    );
  });

  await orchestrator.start();
  console.log("Output directory:", orchestrator.getStatus().outputDir);
})();
