import { FineTuner } from "./FineTuner.js";
import { Logger } from "../utils/Logger.js";
import { emitServerEvent } from "../server/eventBus.js";

export class AutoUpdater {
  private timer: NodeJS.Timeout | null = null;
  private readonly interval: number;

  constructor(intervalMs?: number) {
    const envIntervalRaw = Number(process.env.AUTO_UPDATER_INTERVAL_MS ?? "");
    const envInterval = Number.isFinite(envIntervalRaw) && envIntervalRaw > 0 ? envIntervalRaw : 0;
    if (typeof intervalMs === "number" && intervalMs > 0) {
      this.interval = intervalMs;
    } else if (envInterval > 0) {
      this.interval = envInterval;
    } else {
      this.interval = 300000;
    }
  }

  start() {
    if (this.timer || this.interval <= 0) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush();
    }, this.interval);
    Logger.log(`AutoUpdater scheduled every ${this.interval}ms`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async flush() {
    try {
      const pending = await FineTuner.prepareTrainingBatch();
      if (pending.length === 0) {
        return;
      }

      await FineTuner.markProcessed(pending.map((entry) => entry.id));
      const summary = {
        count: pending.length,
        ids: pending.map((entry) => entry.id)
      };
      Logger.log(`AutoUpdater processed ${pending.length} feedback entries.`);
      emitServerEvent({
        type: "feedback",
        payload: {
          summary,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      Logger.warn("AutoUpdater flush failed:", error);
    }
  }
}
