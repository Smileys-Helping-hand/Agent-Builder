/**
 * SelfHeal — builds that ended short of working get another go on their own.
 *
 * A build that finished with failing checks used to stay that way until
 * someone pressed Continue, even after the builder learned to fix exactly
 * what stopped it. Now, while the PC is otherwise idle, the latest build of
 * each project that ended below its bar is carried on in its own folder —
 * once per version of the builder. Upgrading the builder therefore upgrades
 * every unfinished project: each one is retried with the new fixes.
 *
 * It stays out of the way:
 *  - only when nothing else is building and game mode is off;
 *  - one at a time, and it stops its own build the moment anyone starts one;
 *  - never a build someone stopped, and never a customer order's build (the
 *    order pipeline retries those itself and decides what reaches a customer);
 *  - SELF_HEAL=off turns it off.
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { BuildService, buildEvents, type BuildRecord, type BuildView } from "./BuildService.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";

const STATE_FILE = path.join(process.cwd(), "data", "self-heal.json");
const CHECK_EVERY_MS = Number(process.env.SELF_HEAL_INTERVAL_MS ?? 10 * 60 * 1000);
/** A build has to have been finished this long, so a person looking at it gets the first word. */
const SETTLE_MS = Number(process.env.SELF_HEAL_SETTLE_MS ?? 15 * 60 * 1000);
export const HEALER = "self-heal";

interface HealState {
  /** Project key → the builder version it was last retried on, and that build. */
  healed: Record<string, { version: string; buildId: string; at: string }>;
}

/** One card per project, as the app groups them: a customer order, else the name. */
export const projectKey = (build: Pick<BuildRecord, "orderId" | "projectName">): string =>
  build.orderId ? `order:${build.orderId}` : `name:${build.projectName.trim().toLowerCase()}`;

/**
 * The builds worth another go, newest project first: the latest build of each
 * project, finished, below its bar, not stopped by a person, not an order's,
 * settled, and not already retried on this version of the builder.
 */
export const candidates = (builds: BuildView[], version: string, state: HealState, now = Date.now()): BuildView[] => {
  const latest = new Map<string, BuildView>();
  for (const build of builds) {
    const key = projectKey(build);
    const seen = latest.get(key);
    if (!seen || build.startedAt > seen.startedAt) latest.set(key, build);
  }
  return Array.from(latest.values())
    .filter((build) => {
      if (build.orderId || build.live) return false;
      // A person's Stop is final; a retry that stepped aside for someone else's build is not.
      const stoppedForSomeone = build.state === "stopped" && build.startedBy === HEALER;
      if (build.state !== "completed" && build.state !== "error" && build.state !== "interrupted" && !stoppedForSomeone) return false;
      if (build.passed === true || build.bestScore >= build.qualityThreshold) return false;
      if (!build.outputDir || !fs.existsSync(build.outputDir)) return false;
      if (build.finishedAt && now - Date.parse(build.finishedAt) < SETTLE_MS) return false;
      return state.healed[projectKey(build)]?.version !== version;
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
};

const readState = (): HealState => {
  try {
    return { healed: {}, ...(JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as Partial<HealState>) };
  } catch {
    return { healed: {} };
  }
};

const writeState = (state: HealState) => {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
};

/** The builder's own version: the commit it runs from. */
const builderVersion = (): string => {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd(), encoding: "utf8", windowsHide: true }).trim();
  } catch {
    return "unknown";
  }
};

let timer: NodeJS.Timeout | null = null;
let healing: string | null = null;

export const SelfHeal = {
  enabled(): boolean {
    return !/^(off|false|0|no)$/i.test(process.env.SELF_HEAL ?? "");
  },

  /** What it is doing, for the API. */
  status() {
    return { enabled: this.enabled(), healing, version: builderVersion(), healed: readState().healed };
  },

  /** One look: start a retry if the PC is free and something is worth one. */
  tick(): string | null {
    if (!this.enabled() || healing || GameMode.isOn()) return null;
    if (BuildService.active().length > 0) return null;
    const version = builderVersion();
    const state = readState();
    const [next] = candidates(BuildService.list(), version, state);
    if (!next) return null;
    try {
      const build = BuildService.continue(next.buildId, {
        instruction:
          "Fix whatever still fails so every check passes, then make sure the app does everything the brief asks. " +
          "The builder has been upgraded since this last ran, so problems that stopped it before may now fix themselves.",
        startedBy: HEALER
      });
      healing = build.buildId;
      state.healed[projectKey(next)] = { version, buildId: build.buildId, at: new Date().toISOString() };
      writeState(state);
      Logger.log("Self-heal: carrying on a build that ended below its bar", { project: next.projectName, from: next.buildId, build: build.buildId, version });
      return build.buildId;
    } catch (error) {
      // Mark it, so one unrecoverable build is not retried every ten minutes.
      state.healed[projectKey(next)] = { version, buildId: next.buildId, at: new Date().toISOString() };
      writeState(state);
      Logger.log("Self-heal: could not carry on", { project: next.projectName, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  },

  start(): void {
    if (timer || !this.enabled()) return;
    buildEvents.on("started", (record: BuildRecord) => {
      // Someone wants the GPU: step aside, and try again later on this version.
      if (!healing || record.buildId === healing || record.startedBy === HEALER) return;
      const yielded = healing;
      healing = null;
      BuildService.control(yielded, "stop");
      const state = readState();
      for (const [key, entry] of Object.entries(state.healed)) if (entry.buildId === yielded) delete state.healed[key];
      writeState(state);
      Logger.log("Self-heal: stepped aside for a new build", { stopped: yielded, for: record.buildId });
    });
    for (const done of ["completed", "failed", "stopped"]) {
      buildEvents.on(done, (record: BuildRecord) => {
        if (record.buildId === healing) healing = null;
      });
    }
    timer = setInterval(() => {
      try {
        this.tick();
      } catch (error) {
        Logger.log("Self-heal check failed", { error: error instanceof Error ? error.message : String(error) });
      }
    }, CHECK_EVERY_MS);
    timer.unref?.();
  }
};
