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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Replace `target` with `source`. Windows refuses a rename onto a file that
 * something else (antivirus, the search indexer, a reader) holds open for a
 * moment, with EPERM/EBUSY/EACCES. Those clear within milliseconds, so retry
 * briefly before giving up.
 */
const renameWithRetry = async (source: string, target: string) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fs.promises.rename(source, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY" && code !== "EACCES") || attempt >= 5) throw error;
      await sleep(20 * 2 ** attempt);
    }
  }
};

export class LogStore {
  private static buffer: LogEntry[] = [];
  private static maxEntries = 500;
  private static initialized = false;
  // Every read and write runs through this chain, one at a time. Concurrent
  // appends used to race: two renames onto logs.json at once fail with EPERM
  // on Windows, and two first calls could both hydrate.
  private static queue: Promise<unknown> = Promise.resolve();

  private static serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private static async hydrate() {
    if (this.initialized) {
      return;
    }
    try {
      const raw = await fs.promises.readFile(LOG_PATH, "utf8");
      const parsed = JSON.parse(raw) as LogEntry[];
      this.buffer = Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // An unreadable log (e.g. truncated by a process killed mid-write) used to
        // throw here, so every later log write failed too. Keep the bad file for
        // inspection and start a fresh log instead.
        const aside = `${LOG_PATH}.corrupt-${Date.now()}`;
        await fs.promises.rename(LOG_PATH, aside).catch(() => undefined);
        console.warn(`[logs] ${LOG_PATH} was unreadable; moved it to ${aside} and started a new log.`);
        this.buffer = [];
      }
    }
    this.initialized = true;
  }

  static append(entry: LogEntry): Promise<void> {
    return this.serialize(async () => {
      await this.hydrate();
      this.buffer = [entry, ...this.buffer].slice(0, this.maxEntries);
      await ensureDirectory();
      // Write a temp file, then rename over the log. Rewriting LOG_PATH in place
      // truncates it first, so a crash mid-write left a 0-byte, unparseable file.
      // Writes are serialized, so one temp name per process never collides.
      const tempPath = `${LOG_PATH}.${process.pid}.tmp`;
      try {
        await fs.promises.writeFile(tempPath, JSON.stringify(this.buffer, null, 2));
        await renameWithRetry(tempPath, LOG_PATH);
      } catch (error) {
        await fs.promises.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }
    });
  }

  static list(limit = 100): Promise<LogEntry[]> {
    return this.serialize(async () => {
      await this.hydrate();
      return this.buffer.slice(0, limit);
    });
  }
}
