/**
 * BuildGate — which build's model call goes next on the one graphics card.
 *
 * Every model call a build makes passes through `wait` first (ModelRouter).
 * It holds the call while:
 *
 *   - the build is paused. Pausing used to set a flag the build only read
 *     between passes, and a pass runs for half an hour: a "paused" academy
 *     build went on repairing for 15 minutes and starved the builds it was
 *     paused for. Now it stops at its next model call.
 *   - the build is background work (the Template Academy practising, and
 *     self-heal carrying one of its builds on) while a build someone asked
 *     for is running. Two QA prompts waited 37 minutes behind a practice
 *     build to write their first file; the GPU lock is first come, first
 *     served, and practice should never cost a person that.
 *
 * A build not registered here (a repair from the Projects screen, research,
 * a test) is never held.
 */
import { EventEmitter } from "events";

export type BuildLane = "foreground" | "background";

interface Entry {
  lane: BuildLane;
  paused: boolean;
}

const builds = new Map<string, Entry>();
let sleepers: Array<() => void> = [];

/** "waiting" { buildId, why: "paused" | "yielding" | null } — when a build starts or stops being held. */
export const buildGateEvents = new EventEmitter();
buildGateEvents.setMaxListeners(20);

const wakeAll = (): void => {
  const waking = sleepers;
  sleepers = [];
  for (const wake of waking) wake();
};

const holdReason = (buildId: string): "paused" | "yielding" | null => {
  const me = builds.get(buildId);
  if (!me) return null;
  if (me.paused) return "paused";
  if (me.lane === "background" && [...builds.entries()].some(([id, other]) => id !== buildId && other.lane === "foreground" && !other.paused)) return "yielding";
  return null;
};

export const BuildGate = {
  register(buildId: string, lane: BuildLane): void {
    builds.set(buildId, { lane, paused: false });
    wakeAll();
  },

  setPaused(buildId: string, paused: boolean): void {
    const entry = builds.get(buildId);
    if (!entry) return;
    entry.paused = paused;
    wakeAll();
  },

  /** The build ended (finished, stopped, failed): it holds nothing and is held by nothing. */
  release(buildId: string): void {
    if (builds.delete(buildId)) wakeAll();
  },

  /** Why the build would be held now, or null. */
  reason(buildId: string | undefined): "paused" | "yielding" | null {
    return buildId ? holdReason(buildId) : null;
  },

  /** Resolves when the build may make its model call. */
  async wait(buildId: string | undefined): Promise<void> {
    if (!buildId) return;
    let held: "paused" | "yielding" | null = null;
    for (;;) {
      const why = holdReason(buildId);
      if (why !== held) {
        held = why;
        buildGateEvents.emit("waiting", { buildId, why });
      }
      if (!why) return;
      // Woken by any change; the timer is a backstop, never the way out.
      await new Promise<void>((resolve) => {
        sleepers.push(resolve);
        setTimeout(resolve, 30_000).unref?.();
      });
    }
  },

  /** For tests: forget everything. */
  reset(): void {
    builds.clear();
    wakeAll();
  }
};
