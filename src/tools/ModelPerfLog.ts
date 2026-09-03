/**
 * ModelPerfLog - append-only, best-effort record of how long each model
 * call actually took. The hardware plan calls for "record actual
 * tokens-per-second per rung so estimates get honest over time" — this is
 * the first step: wall-clock duration and prompt/response size per call,
 * persisted locally so a future ladder/profile decision can be based on
 * what this machine actually measured instead of a published spec sheet.
 */
import fs from "fs/promises";
import path from "path";

const LOG_PATH = path.resolve("data/model-perf.json");
const MAX_ENTRIES = 500;

export type ModelPerfEntry = {
  timestamp: string;
  provider: string;
  model: string;
  durationMs: number;
  promptChars: number;
  responseChars: number;
};

export const ModelPerfLog = {
  async record(entry: ModelPerfEntry): Promise<void> {
    try {
      await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
      let entries: ModelPerfEntry[] = [];
      try {
        entries = JSON.parse(await fs.readFile(LOG_PATH, "utf8"));
      } catch {
        entries = [];
      }
      entries.push(entry);
      if (entries.length > MAX_ENTRIES) {
        entries = entries.slice(-MAX_ENTRIES);
      }
      await fs.writeFile(LOG_PATH, JSON.stringify(entries, null, 2), "utf8");
    } catch {
      // Best-effort telemetry — never fail a build because logging failed.
    }
  }
};
