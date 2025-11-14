import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import chokidar, { type FSWatcher } from "chokidar";
import { Logger } from "./Logger.js";

export type FileWatcherEvent = {
  type: "added" | "changed" | "removed";
  path: string;
};

export class FileWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;

  constructor(private readonly directory: string) {
    super();
  }

  override on(event: "event", listener: (payload: FileWatcherEvent) => void) {
    return super.on(event, listener);
  }

  override off(event: "event", listener: (payload: FileWatcherEvent) => void) {
    return super.off(event, listener);
  }

  getDirectory() {
    return this.directory;
  }

  async start() {
    try {
      await fs.promises.mkdir(this.directory, { recursive: true });
    } catch (error) {
      Logger.warn("Failed to create watch directory", {
        directory: this.directory,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    if (this.watcher) {
      return;
    }

    const normalized = path.resolve(this.directory);
    this.watcher = chokidar.watch(normalized, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 250,
        pollInterval: 50
      }
    });

    const emitEvent = (type: FileWatcherEvent["type"], filePath: string) => {
      this.emit("event", {
        type,
        path: path.resolve(filePath)
      } satisfies FileWatcherEvent);
    };

    this.watcher.on("add", (filePath: string) => emitEvent("added", filePath));
    this.watcher.on("change", (filePath: string) => emitEvent("changed", filePath));
    this.watcher.on("unlink", (filePath: string) => emitEvent("removed", filePath));
    this.watcher.on("error", (error: Error) => {
      Logger.warn("File watcher error", {
        directory: this.directory,
        error: error instanceof Error ? error.message : String(error)
      });
    });

    Logger.log("File watcher started", { directory: normalized });
  }

  async stop() {
    if (!this.watcher) {
      return;
    }
    await this.watcher.close();
    this.watcher = null;
  }
}
