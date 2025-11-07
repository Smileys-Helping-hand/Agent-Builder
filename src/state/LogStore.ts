import fs from "fs";
import path from "path";

export type LogEntry = {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

const LOG_PATH = path.resolve("./data/logs.json");

const ensureDirectory = async () => {
  await fs.promises.mkdir(path.dirname(LOG_PATH), { recursive: true });
};

export class LogStore {
  private static buffer: LogEntry[] = [];
  private static maxEntries = 500;
  private static initialized = false;

  private static async hydrate() {
    if (this.initialized) {
      return;
    }
    try {
      const raw = await fs.promises.readFile(LOG_PATH, "utf8");
      const parsed = JSON.parse(raw) as LogEntry[];
      this.buffer = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    this.initialized = true;
  }

  static async append(entry: LogEntry) {
    await this.hydrate();
    this.buffer = [entry, ...this.buffer].slice(0, this.maxEntries);
    await ensureDirectory();
    await fs.promises.writeFile(LOG_PATH, JSON.stringify(this.buffer, null, 2));
  }

  static async list(limit = 100): Promise<LogEntry[]> {
    await this.hydrate();
    return this.buffer.slice(0, limit);
  }
}
