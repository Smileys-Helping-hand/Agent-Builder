import { Orchestrator } from "../orchestrator/Orchestrator.js";
import { PluginRegistry } from "../agents/PluginRegistry.js";
import { VectorMemory } from "../state/VectorMemory.js";

export class AgentBuilder {
  async create(prompt: string) {
    await PluginRegistry.initialize();
    await VectorMemory.init();
    const orchestrator = new Orchestrator();
    return await orchestrator.run(prompt);
  }
}
