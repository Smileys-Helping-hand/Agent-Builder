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
let cpu = process.cpuUsage();

export const StallWatch = {
  start(): void {
    // From now: the time since this module loaded is starting up, not a freeze
    // (counting it logged a 47.9 s "freeze" on every start).
    last = Date.now();
    cpu = process.cpuUsage();
    const timer = setInterval(() => {
      const now = Date.now();
      const late = now - last - TICK_MS;
      last = now;
      const used = process.cpuUsage(cpu);
      cpu = process.cpuUsage();
      if (late < STALL_LOG_MS) return;
      count += 1;
      worst = Math.max(worst, late);
      // CPU time spent meanwhile tells the two kinds apart: busy computing, or
      // waiting (on the disk, or the PC paging memory) with the CPU idle.
      const cpuMs = Math.round((used.user + used.system) / 1000);
      const why = cpuMs > late / 2 ? "busy computing" : "waiting on the disk or the PC";
      Logger.warn(`The builder was frozen for ${(late / 1000).toFixed(1)} s (${why}; nothing answered meanwhile)`, { ms: late, cpuMs, stalls: count });
    }, TICK_MS);
    timer.unref();
  },

  /** For the health route and the app: how often and how badly it has frozen since it started. */
  status(): { stalls: number; worstMs: number } {
    return { stalls: count, worstMs: worst };
  }
};
