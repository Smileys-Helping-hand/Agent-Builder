/**
 * EcosystemLoop — keeps the picture of the machine current without being asked.
 *
 * A rescan is cheap (git metadata only, no installs, no model calls), so it runs
 * on a timer. CI state is pulled for projects with a GitHub remote, and a failed
 * run is recorded as an issue — that is how a broken project gets noticed while
 * nobody is looking at it.
 *
 * Deliberately does NOT run builds or repairs on its own: those cost GPU time
 * and can change files, so they stay explicit actions.
 */
import { ContextPack } from "./ContextPack.js";
import { EcosystemStore } from "./EcosystemStore.js";
import { GitHubClient, repoFromRemote } from "./GitHubClient.js";
import { ProjectScanner } from "./ProjectScanner.js";
import { Logger } from "../utils/Logger.js";

const DEFAULT_INTERVAL_MS = Number(process.env.ECOSYSTEM_SCAN_INTERVAL_MS ?? 30 * 60 * 1000);

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastSweepAt: string | null = null;

const sweep = async (): Promise<void> => {
  if (running) return;
  running = true;
  try {
    const result = await ProjectScanner.scanAll();
    Logger.log("Ecosystem scan complete", { scanned: result.scanned, removed: result.removed, ms: result.durationMs });

    if (await GitHubClient.isAvailable()) {
      for (const project of EcosystemStore.listProjects()) {
        const nameWithOwner = repoFromRemote(project.gitRemote);
        if (!nameWithOwner) continue;
        const status = await GitHubClient.repoStatus(nameWithOwner);
        if (status.error) continue;
        const conclusion = status.lastWorkflowConclusion;
        if (conclusion && !["success", "none", "skipped", "neutral"].includes(conclusion)) {
          EcosystemStore.recordIssue({
            projectId: project.id,
            source: "maintenance",
            severity: "warning",
            title: `CI ${conclusion} on ${nameWithOwner}`,
            detail: `The most recent GitHub Actions run concluded "${conclusion}".`,
            signature: `ci:${nameWithOwner}:${conclusion}`
          });
        }
      }
    }
    lastSweepAt = new Date().toISOString();
  } catch (error) {
    Logger.log("Ecosystem sweep failed", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    running = false;
  }
};

export const EcosystemLoop = {
  start(): void {
    if (timer) return;
    // First sweep two minutes after boot: soon enough for the registry, and
    // out of the way of starting up. At five seconds it ran into every restart
    // on a busy PC (141 s for 68 repos) and the watchdog restarted the builder again.
    setTimeout(() => void sweep(), 120_000);
    timer = setInterval(() => void sweep(), DEFAULT_INTERVAL_MS);
    timer.unref?.();
    Logger.log("Ecosystem loop started", { intervalMs: DEFAULT_INTERVAL_MS });
  },

  stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  },

  async sweepNow(): Promise<void> {
    await sweep();
  },

  status(): { running: boolean; lastSweepAt: string | null; intervalMs: number; counts: ReturnType<typeof EcosystemStore.counts> } {
    return {
      running,
      lastSweepAt,
      intervalMs: DEFAULT_INTERVAL_MS,
      counts: EcosystemStore.counts()
    };
  },

  handoff(): ReturnType<typeof ContextPack.handoff> {
    return ContextPack.handoff();
  }
};
