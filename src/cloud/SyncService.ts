import fs from "fs";
import path from "path";
import { Logger } from "../utils/Logger.js";

export type CloudSyncConfig = {
  enabled: boolean;
  storagePath: string;
};

export class SyncService {
  private static instance: SyncService | null = null;
  private readonly config: CloudSyncConfig;

  static getInstance() {
    if (!this.instance) {
      this.instance = new SyncService({
        enabled: String(process.env.CLOUD_SYNC ?? "false").toLowerCase() === "true",
        storagePath: process.env.CLOUD_STORAGE_PATH ?? path.resolve("./cloud-data")
      });
    }
    return this.instance;
  }

  private constructor(config: CloudSyncConfig) {
    this.config = config;
  }

  isEnabled() {
    return this.config.enabled;
  }

  private ensureStorage() {
    return fs.promises.mkdir(this.config.storagePath, { recursive: true });
  }

  async uploadFile(relativePath: string, content: Buffer | string) {
    if (!this.isEnabled()) {
      Logger.log("Cloud sync disabled; skipping upload", { relativePath });
      return false;
    }

    await this.ensureStorage();
    const target = path.join(this.config.storagePath, relativePath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, content);
    Logger.log("Cloud sync uploaded", { relativePath });
    return true;
  }

  async downloadProject(projectId: string) {
    if (!this.isEnabled()) {
      return null;
    }

    const projectPath = path.join(this.config.storagePath, projectId);
    try {
      const files = await fs.promises.readdir(projectPath, { withFileTypes: true });
      const payload: Record<string, string> = {};
      await Promise.all(
        files
          .filter((file) => file.isFile())
          .map(async (file) => {
            const absolute = path.join(projectPath, file.name);
            payload[file.name] = await fs.promises.readFile(absolute, "utf8");
          })
      );
      return payload;
    } catch (error) {
      Logger.warn("Cloud sync download failed", { projectId, error });
      return null;
    }
  }

  async listProjects() {
    if (!this.isEnabled()) {
      return [] as string[];
    }

    await this.ensureStorage();
    const entries = await fs.promises.readdir(this.config.storagePath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  }
}
