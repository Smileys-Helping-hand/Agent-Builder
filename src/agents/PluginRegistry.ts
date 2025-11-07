import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { Logger } from "../utils/Logger.js";
import type { BaseAgent } from "./BaseAgent.js";
import { WasmPluginAgent } from "./WasmPluginAgent.js";
import { loadWasmRuntime } from "../security/WasmRuntime.js";

type AgentFactory = () => BaseAgent;

export type PluginMetadata = {
  name: string;
  agentType: string;
  description?: string;
  version?: string;
  author?: string;
  homepage?: string;
  defaultTask?: string;
};

export type PluginDefinition = {
  path: string;
  metadata?: Partial<PluginMetadata>;
  runtime?: "node" | "wasm";
  entry?: string;
};

export class PluginRegistry {
  private static factories: AgentFactory[] = [];
  private static metadata: PluginMetadata[] = [];
  private static initialized = false;
  private static configPath = "agent.config.json";
  private static pluginDefinitions: PluginDefinition[] = [];

  static async initialize(configPath = "agent.config.json"): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.configPath = configPath;
    try {
      const file = await fs.promises.readFile(configPath, "utf8");
      const config = JSON.parse(file) as { plugins?: PluginDefinition[] };
      const plugins = config.plugins ?? [];
      this.pluginDefinitions = [...plugins];

      await Promise.all(
        plugins.map(async (plugin) => {
          await this.loadPlugin(plugin);
        })
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        Logger.warn("Failed to initialize plugins:", error);
      }
    }
  }

  static register(factory: AgentFactory, metadata: PluginMetadata) {
    this.factories.push(factory);
    this.metadata.push(metadata);
    Logger.log(`Registered plugin agent ${metadata.agentType}`);
  }

  static getAgents(): BaseAgent[] {
    return this.factories.map((factory) => factory());
  }

  static getMetadata(): PluginMetadata[] {
    return [...this.metadata];
  }

  static getInstalledDefinitions(): PluginDefinition[] {
    return [...this.pluginDefinitions];
  }

  static getTaskTemplates(prompt: string): Array<{ agentType: string; desc: string }> {
    return this.metadata
      .filter((meta) => Boolean(meta.defaultTask))
      .map((meta) => ({
        agentType: meta.agentType,
        desc: (meta.defaultTask ?? meta.description ?? meta.name).replace(/\{\{prompt\}\}/g, prompt)
      }));
  }

  static async installPlugin(definition: PluginDefinition): Promise<PluginMetadata | null> {
    const success = await this.loadPlugin(definition);
    if (!success) {
      return null;
    }
    this.pluginDefinitions.push(definition);
    await this.persistConfig();
    const latestMeta = this.metadata[this.metadata.length - 1];
    return latestMeta ?? null;
  }

  private static async persistConfig() {
    try {
      const existing = await fs.promises.readFile(this.configPath, "utf8");
      const config = JSON.parse(existing) as { plugins?: PluginDefinition[] };
      config.plugins = this.pluginDefinitions;
      await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        const config = { plugins: this.pluginDefinitions };
        await fs.promises.writeFile(this.configPath, JSON.stringify(config, null, 2));
      } else {
        Logger.warn("Failed to persist plugin registry config", error);
      }
    }
  }

  private static async loadPlugin(definition: PluginDefinition): Promise<boolean> {
    try {
      const runtime = definition.runtime ?? (definition.path.endsWith(".wasm") ? "wasm" : "node");
      const resolvedPath = path.isAbsolute(definition.path)
        ? definition.path
        : path.resolve(process.cwd(), definition.path);

      if (runtime === "wasm") {
        const wasmRuntime = await loadWasmRuntime(resolvedPath);
        const metadata = this.resolveMetadata({}, definition.metadata, resolvedPath);
        const agentType = metadata.agentType;
        const factory = () => new WasmPluginAgent(agentType, wasmRuntime);
        this.register(factory, metadata);
        return true;
      }

      const module = await import(pathToFileURL(resolvedPath).href);

      const factory: AgentFactory | null = this.extractFactory(module, definition.entry);
      if (!factory) {
        Logger.warn(`Plugin at ${definition.path} does not export an agent factory.`);
        return false;
      }

      const metadata = this.resolveMetadata(module, definition.metadata, resolvedPath);
      this.register(factory, metadata);
      return true;
    } catch (error) {
      Logger.warn(`Failed to load plugin at ${definition.path}:`, error);
      return false;
    }
  }

  private static extractFactory(module: Record<string, unknown>, entry?: string): AgentFactory | null {
    if (entry && typeof module[entry] === "function") {
      return module[entry] as AgentFactory;
    }
    if (typeof module.createAgent === "function") {
      return module.createAgent as AgentFactory;
    }

    if (typeof module.default === "function") {
      return () => new (module.default as new () => BaseAgent)();
    }

    if (typeof module.Agent === "function") {
      return () => new (module.Agent as new () => BaseAgent)();
    }

    return null;
  }

  private static resolveMetadata(
    module: Record<string, unknown>,
    overrides: Partial<PluginMetadata> | undefined,
    resolvedPath: string
  ): PluginMetadata {
    const baseMeta: Partial<PluginMetadata> =
      (module.metadata as Partial<PluginMetadata> | undefined) ?? overrides ?? {};

    const name = baseMeta.name ?? path.basename(resolvedPath).replace(path.extname(resolvedPath), "");
    const agentType = baseMeta.agentType ?? name;

    return {
      name,
      agentType,
      description: baseMeta.description,
      version: baseMeta.version,
      author: baseMeta.author,
      homepage: baseMeta.homepage,
      defaultTask: baseMeta.defaultTask
    };
  }
}
