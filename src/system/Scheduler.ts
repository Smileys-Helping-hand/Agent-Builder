/**
 * Whether heavy background work should start now, from measurements.
 *
 * Heavy work (a continuous step, an install, a build pass) waits while the PC
 * is under real pressure for a while, not for one spike: the drive Agent
 * Builder works from saturated in the last two samples, memory nearly gone,
 * or commit near its limit. It never waits forever: after `maxWaitMs` (20
 * minutes) the work goes ahead and says so, because some pressure (a long
 * download on the same disk) is not going away by itself.
 *
 * Only reads the samples Telemetry already keeps; costs nothing to ask.
 */
import { Telemetry, type Telemetry as Sample } from "./Telemetry.js";

const LETTER = () => process.cwd()[0].toUpperCase();

/** Why to wait, from the recent samples, or null (exported for tests). */
export const pressureFrom = (samples: Sample[], letter = LETTER()): string | null => {
  const recent = samples.slice(-2);
  if (recent.length < 2 || Date.now() - Date.parse(recent[1].at) > 5 * 60_000) return null;
  const saturated = recent.every((s) => s.disks.some((d) => d.letters.includes(letter) && d.idlePercent < 10 && d.queue >= 4));
  if (saturated) {
    const d = recent[1].disks.find((x) => x.letters.includes(letter))!;
    return `${letter}: is saturated (${d.idlePercent}% idle, ${d.queue} waiting); heavy work waits for it`;
  }
  if (recent.every((s) => s.ram.availableMB !== null && s.ram.availableMB < 2000)) return `memory is nearly gone (${recent[1].ram.availableMB} MB free)`;
  if (recent.every((s) => s.ram.commitPercent !== null && s.ram.commitPercent > 94)) return `committed memory is at ${recent[1].ram.commitPercent}%`;
  return null;
};

const waitingSince = new Map<string, number>();

export const Scheduler = {
  /**
   * Whether `who` should wait before starting something heavy: the reason, or
   * null to go ahead. Waits at most maxWaitMs per caller, then lets it go.
   */
  shouldWait(who: string, maxWaitMs = Number(process.env.PRESSURE_MAX_WAIT_MS ?? 20 * 60_000)): string | null {
    const reason = pressureFrom(Telemetry.history());
    if (!reason) {
      waitingSince.delete(who);
      return null;
    }
    const since = waitingSince.get(who) ?? Date.now();
    waitingSince.set(who, since);
    if (Date.now() - since >= maxWaitMs) {
      waitingSince.delete(who);
      return null;
    }
    return reason;
  }
};
