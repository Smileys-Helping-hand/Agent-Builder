import dotenv from "dotenv";
import { Orchestrator } from "./orchestrator/Orchestrator.js";
import { PluginRegistry } from "./agents/PluginRegistry.js";
import { VectorMemory } from "./state/VectorMemory.js";
dotenv.config();

(async () => {
  await PluginRegistry.initialize();
  await VectorMemory.init();
  const orchestrator = new Orchestrator();
  const result = await orchestrator.run("Build a React dashboard with Node.js API backend");
  console.log(JSON.stringify(result, null, 2));
})();
