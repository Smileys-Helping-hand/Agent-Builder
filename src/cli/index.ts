#!/usr/bin/env node
import { Orchestrator } from "../orchestrator/Orchestrator.js";
import { PluginRegistry } from "../agents/PluginRegistry.js";
import { VectorMemory } from "../state/VectorMemory.js";
const prompt = process.argv.slice(2).join(" ") || "Build a Next.js app";

(async () => {
  await PluginRegistry.initialize();
  await VectorMemory.init();
  const orchestrator = new Orchestrator();
  const result = await orchestrator.run(prompt);
  console.log(JSON.stringify(result, null, 2));
})();
