import fs from "fs";
import path from "path";
import WebSocket from "ws";
import { EventEmitter } from "events";
import { Logger } from "../utils/Logger.js";
import { FileWatcher, type FileWatcherEvent } from "../utils/FileWatcher.js";
import { CollaborationHub, type RobloxSyncStatus } from "../orchestrator/CollaborationHub.js";
import type { RobloxGame } from "../agents/RobloxAgent.js";

const DEFAULT_PORT = 34872;
const PROJECT_ROOT = path.resolve("games/roblox");

const normalizePath = (target: string) => path.relative(process.cwd(), target).replace(/\\/g, "/");

type BridgeEvent = {
  type: "status" | "sync" | "playtest";
  payload: { status: RobloxSyncStatus; message: string; path?: string; metadata?: Record<string, unknown> };
};

export class RobloxBridge extends EventEmitter {
  private static instance: RobloxBridge | null = null;

  static getInstance() {
    if (!this.instance) {
      this.instance = new RobloxBridge();
    }
    return this.instance;
  }

  private socket: WebSocket | null = null;
  private connecting: Promise<boolean> | null = null;
  private readonly watcher: FileWatcher | null;
  private readonly hub = CollaborationHub.getInstance();
  private readonly pendingPaths = new Set<string>();
  private readonly enabled = String(process.env.ROBLOX_SYNC_ENABLED ?? "true").toLowerCase() === "true";
  private readonly port = Number(process.env.ROBLOX_SYNC_PORT ?? DEFAULT_PORT);
  private readonly host = process.env.ROBLOX_SYNC_HOST ?? "127.0.0.1";

  private constructor() {
    super();

    if (!this.enabled) {
      Logger.log("RobloxBridge disabled via configuration");
      this.watcher = null;
      return;
    }

    this.watcher = new FileWatcher(PROJECT_ROOT);
    this.watcher.on("event", (event: FileWatcherEvent) => {
      if (event.type === "removed") {
        return;
      }
      void this.handleFileChange(event.path);
    });
    void this.watcher.start();

    void this.connect();
  }

  isEnabled() {
    return this.enabled;
  }

  getProjectDirectory() {
    return PROJECT_ROOT;
  }

  async connect() {
    if (!this.enabled) {
      return false;
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      return true;
    }

    if (this.connecting) {
      return this.connecting;
    }

    this.updateStatus("connecting", "Connecting to Roblox Studio bridge...");
    const url = `ws://${this.host}:${this.port}`;

    this.connecting = new Promise<boolean>((resolve) => {
      const ws = new WebSocket(url);
      let settled = false;

      const finalize = (result: boolean) => {
        if (!settled) {
          settled = true;
          this.connecting = null;
          resolve(result);
        }
      };

      ws.on("open", () => {
        this.socket = ws;
        Logger.log("RobloxBridge connected", { url });
        this.updateStatus("connected", "Roblox Studio bridge connected.");
        finalize(true);
      });

      ws.on("close", () => {
        if (this.socket === ws) {
          this.socket = null;
        }
        Logger.warn("RobloxBridge disconnected", { url });
        this.updateStatus("disconnected", "Roblox Studio bridge disconnected.");
        finalize(false);
        setTimeout(() => {
          if (this.enabled) {
            void this.connect();
          }
        }, 1500);
      });

      ws.on("error", (error: Error) => {
        Logger.warn("RobloxBridge connection error", {
          url,
          error: error instanceof Error ? error.message : String(error)
        });
        this.updateStatus("error", "Failed to connect to Roblox Studio bridge.");
        ws.close();
        finalize(false);
      });
    });

    return this.connecting;
  }

  async pushAsset(filePath: string) {
    if (!this.enabled) {
      return false;
    }

    const absolute = path.resolve(filePath);
    const relative = normalizePath(absolute);

    if (!(await this.ensureSocket())) {
      Logger.warn("Cannot push Roblox asset; bridge disconnected", { path: relative });
      return false;
    }

    if (this.pendingPaths.has(relative)) {
      this.pendingPaths.delete(relative);
    }

    const payload = JSON.stringify({ type: "sync", path: relative });
    this.socket?.send(payload);
    Logger.log("Roblox asset pushed", { path: relative });
    this.emitEvent({
      type: "sync",
      payload: { status: "sync", message: `Synced ${relative}`, path: relative }
    });
    return true;
  }

  async syncProject(game?: RobloxGame) {
    if (!this.enabled) {
      return false;
    }

    await fs.promises.mkdir(PROJECT_ROOT, { recursive: true });

    if (game) {
      await this.writeGameAssets(game);
    }

    const files = await this.collectProjectFiles();
    let synced = 0;
    for (const file of files) {
      if (!file.toLowerCase().endsWith(".lua")) {
        continue;
      }
      const relative = normalizePath(file);
      this.pendingPaths.add(relative);
      await this.pushAsset(file);
      synced += 1;
    }

    this.emitEvent({
      type: "sync",
      payload: {
        status: "sync",
        message: game
          ? `Synced Roblox project \"${game.title}\" with ${synced} assets.`
          : `Synced Roblox workspace with ${synced} assets.`,
        metadata: game
          ? {
              title: game.title,
              summary: game.summary,
              templateId: game.templateId,
              assets: game.assets.map((asset) => ({ path: asset.path, type: asset.type }))
            }
          : undefined
      }
    });

    return true;
  }

  async triggerPlaytest() {
    if (!this.enabled) {
      return false;
    }

    if (!(await this.ensureSocket())) {
      Logger.warn("Cannot trigger playtest; Roblox bridge is offline");
      return false;
    }

    this.socket?.send(JSON.stringify({ type: "playtest" }));
    Logger.log("Roblox playtest triggered");
    this.emitEvent({
      type: "playtest",
      payload: { status: "playtest", message: "Triggered playtest in Roblox Studio." }
    });
    return true;
  }

  async sendDebugLog(message: string) {
    if (!this.enabled) {
      return false;
    }

    if (!(await this.ensureSocket())) {
      Logger.warn("Cannot send debug log; Roblox bridge is offline");
      return false;
    }

    this.socket?.send(JSON.stringify({ type: "debug_log", message }));
    this.emitEvent({
      type: "status",
      payload: { status: "sync", message: `Studio debug: ${message}` }
    });
    return true;
  }

  async evaluateScript(script: string) {
    if (!this.enabled) {
      return false;
    }

    if (!(await this.ensureSocket())) {
      Logger.warn("Cannot evaluate debug script; bridge offline");
      return false;
    }

    this.socket?.send(JSON.stringify({ type: "debug_eval", script }));
    this.emitEvent({
      type: "status",
      payload: { status: "sync", message: "Sent evaluation script to Roblox Studio." }
    });
    return true;
  }

  private async handleFileChange(filePath: string) {
    const absolute = path.resolve(filePath);
    if (!absolute.toLowerCase().endsWith(".lua")) {
      return;
    }
    const relative = normalizePath(absolute);

    if (this.pendingPaths.has(relative)) {
      this.pendingPaths.delete(relative);
      return;
    }

    Logger.log("Roblox asset change detected", { path: relative });
    await this.pushAsset(absolute);
  }

  private async writeGameAssets(game: RobloxGame) {
    const metadata = {
      title: game.title,
      summary: game.summary,
      templateId: game.templateId,
      assets: game.assets.map((asset) => ({ path: asset.path, type: asset.type })),
      updatedAt: new Date().toISOString(),
      metadata: game.metadata ?? {}
    };

    const metadataPath = path.join(PROJECT_ROOT, "project.json");
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata, null, 2), "utf8");

    for (const asset of game.assets) {
      const target = path.join(PROJECT_ROOT, asset.path);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, asset.content, "utf8");
      const relative = normalizePath(target);
      if (relative.toLowerCase().endsWith(".lua")) {
        this.pendingPaths.add(relative);
      }
    }
  }

  private async ensureSocket() {
    const connected = await this.connect();
    return connected && this.socket?.readyState === WebSocket.OPEN;
  }

  private async collectProjectFiles() {
    const files: string[] = [];

    const traverse = async (directory: string) => {
      const entries = await fs.promises.readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
      await traverse(fullPath);
    } else {
      files.push(fullPath);
        }
      }
    };

    try {
      await traverse(PROJECT_ROOT);
    } catch (error) {
      Logger.warn("Failed to scan Roblox project directory", {
        directory: PROJECT_ROOT,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return files;
  }

  private updateStatus(status: RobloxSyncStatus, message: string) {
    this.emitEvent({ type: "status", payload: { status, message } });
  }

  private emitEvent(event: BridgeEvent) {
    const payload = {
      status: event.payload.status,
      message: event.payload.message,
      path: event.payload.path,
      metadata: event.payload.metadata
    };

    this.hub.broadcastRobloxSync(payload);
    this.emit(event.type, payload);
  }
}
