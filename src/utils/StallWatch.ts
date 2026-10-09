/**
 * Says when the builder stopped answering, and for how long.
 *
 * Every request, every build's progress and the launcher's health check wait
 * on one event loop. Synchronous work that runs long (a big file, the
 * TypeScript compiler, a busy disk) freezes all of them, and from outside it
 * looks like a hang. This notices each freeze over STALL_LOG_MS once it ends
 * and logs it with how long it lasted, so the log says when it happened beside
 * whatever ran then.
 */
import { Logger } from "./Logger.js";

const TICK_MS = 500;
const STALL_LOG_MS = Number(process.env.STALL_LOG_MS) || 3000;

let last = Date.now();
let worst = 0;
let count = 0;

export const StallWatch = {
  start(): void {
    const timer = setInterval(() => {
      const now = Date.now();
      const late = now - last - TICK_MS;
      last = now;
      if (late < STALL_LOG_MS) return;
      count += 1;
      worst = Math.max(worst, late);
      Logger.warn(`The builder was frozen for ${(late / 1000).toFixed(1)} s (nothing answered meanwhile)`, { ms: late, stalls: count });
    }, TICK_MS);
    timer.unref();
  },

  /** For the health route and the app: how often and how badly it has frozen since it started. */
  status(): { stalls: number; worstMs: number } {
    return { stalls: count, worstMs: worst };
  }
};
