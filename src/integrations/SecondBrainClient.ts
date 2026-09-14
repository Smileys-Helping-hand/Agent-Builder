/**
 * SecondBrainClient - pushes what Agent-Builder learns into Second-Brain.
 *
 * Research documents are queued locally (brain_sync_queue) and delivered to
 * Second-Brain's authenticated POST /api/ecosystem/knowledge, which stores
 * them as workspace documents and embeds them, so Second-Brain's own assistant
 * can recall them through its memory search. Delivery retries with exponential
 * backoff: Second-Brain being offline delays sync but never loses or blocks
 * learning, because the local knowledge store is the source of truth.
 */
import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";
import { Logger } from "../utils/Logger.js";

export interface BrainQueueItem {
  id: number;
  externalId: string;
  title: string;
  attempts: number;
  lastError: string | null;
  nextAttemptAt: string;
  syncedAt: string | null;
  remoteId: string | null;
  updatedAt: string;
}

export interface BrainStatus {
  enabled: boolean;
  host: string | null;
  hasApiKey: boolean;
  reachable: boolean;
  /** True when the host answered /api/health with JSON — i.e. it is an API, not another app's web page. */
  identityVerified: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  queue: { pending: number; retrying: number; synced: number };
  warnings: string[];
}

export interface SyncResult {
  synced: number;
  failed: number;
  skipped: boolean;
  reason?: string;
}

type QueueRow = {
  id: number;
  external_id: string;
  title: string;
  content: string;
  attempts: number;
  last_error: string | null;
  next_attempt_at: string;
  synced_at: string | null;
  remote_id: string | null;
  updated_at: string;
};

const SYNC_INTERVAL_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
const MAX_CONTENT_CHARS = 190_000;
const BATCH_SIZE = 10;

let loopTimer: NodeJS.Timeout | null = null;
let syncing = false;
let lastSyncAt: string | null = null;
let lastError: string | null = null;

const readConfig = () => ({
  host: (process.env.SECOND_BRAIN_HOST ?? process.env.JARVIS_HOST ?? "").trim().replace(/\/+$/, ""),
  apiKey: (process.env.SECOND_BRAIN_API_KEY ?? process.env.JARVIS_API_KEY ?? "").trim(),
  enabled: (process.env.SECOND_BRAIN_SYNC ?? "true").toLowerCase() !== "false"
});

const originOf = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const timedFetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const backoffMs = (attempts: number): number => Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.max(0, attempts - 1));

export const SecondBrainClient = {
  /** Queue (or re-queue with fresh content) a document. The same externalId always updates the same Second-Brain document. */
  enqueueDocument(externalId: string, title: string, content: string): void {
    const now = nowIso();
    getKnowledgeDb()
      .prepare(
        `INSERT INTO brain_sync_queue (external_id, title, content, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(external_id) DO UPDATE SET
           title = excluded.title,
           content = excluded.content,
           attempts = 0,
           last_error = NULL,
           next_attempt_at = excluded.next_attempt_at,
           synced_at = NULL,
           updated_at = excluded.updated_at`
      )
      .run(externalId, title, content.slice(0, MAX_CONTENT_CHARS), now, now, now);
  },

  async processQueue(): Promise<SyncResult> {
    const { host, apiKey, enabled } = readConfig();
    if (!enabled) return { synced: 0, failed: 0, skipped: true, reason: "SECOND_BRAIN_SYNC is false" };
    if (!host) return { synced: 0, failed: 0, skipped: true, reason: "SECOND_BRAIN_HOST (or JARVIS_HOST) is not set" };
    if (!apiKey) return { synced: 0, failed: 0, skipped: true, reason: "SECOND_BRAIN_API_KEY (or JARVIS_API_KEY) is not set" };
    if (syncing) return { synced: 0, failed: 0, skipped: true, reason: "A sync pass is already running" };

    syncing = true;
    const db = getKnowledgeDb();
    const markSynced = db.prepare(
      "UPDATE brain_sync_queue SET synced_at = ?, remote_id = ?, last_error = NULL, updated_at = ? WHERE id = ?"
    );
    const markFailed = db.prepare(
      "UPDATE brain_sync_queue SET attempts = attempts + 1, last_error = ?, next_attempt_at = ?, updated_at = ? WHERE id = ?"
    );
    let synced = 0;
    let failed = 0;

    try {
      const due = db
        .prepare("SELECT * FROM brain_sync_queue WHERE synced_at IS NULL AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?")
        .all(nowIso(), BATCH_SIZE) as QueueRow[];

      for (const row of due) {
        const fail = (reason: string) => {
          const now = nowIso();
          markFailed.run(reason, new Date(Date.now() + backoffMs(row.attempts + 1)).toISOString(), now, row.id);
          lastError = reason;
          failed += 1;
        };

        try {
          const response = await timedFetch(`${host}/api/ecosystem/knowledge`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Jarvis-Api-Key": apiKey },
            body: JSON.stringify({ externalId: row.external_id, title: row.title, content: row.content })
          });

          if (response.ok) {
            const data = (await response.json().catch(() => ({}))) as { id?: string };
            const now = nowIso();
            markSynced.run(now, data.id ?? null, now, row.id);
            synced += 1;
            continue;
          }

          const detail = (await response.text().catch(() => "")).slice(0, 300);
          if (response.status === 404) {
            fail(
              `${host} returned 404 for /api/ecosystem/knowledge — either that address isn't Second-Brain, ` +
                "or its knowledge ingest route hasn't been deployed yet."
            );
          } else if (response.status === 401 || response.status === 403) {
            fail(`Second-Brain rejected the API key (${response.status}): ${detail}`);
          } else {
            fail(`Second-Brain returned HTTP ${response.status}: ${detail}`);
          }
          // Auth and missing-endpoint failures would repeat identically for every remaining item.
          if (response.status === 401 || response.status === 403 || response.status === 404) break;
        } catch (error) {
          fail(`Could not reach Second-Brain at ${host}: ${error instanceof Error ? error.message : String(error)}`);
          break;
        }
      }

      if (synced > 0) lastError = null;
      lastSyncAt = nowIso();
      if (failed > 0) Logger.warn("Second-Brain sync pass had failures", { synced, failed, lastError });
      return { synced, failed, skipped: false };
    } finally {
      syncing = false;
    }
  },

  startSyncLoop(): void {
    if (loopTimer) return;
    loopTimer = setInterval(() => {
      SecondBrainClient.processQueue().catch((error) =>
        Logger.warn("Second-Brain sync loop error", { error: error instanceof Error ? error.message : String(error) })
      );
    }, SYNC_INTERVAL_MS);
    loopTimer.unref();
  },

  listQueue(limit = 30): BrainQueueItem[] {
    const rows = getKnowledgeDb()
      .prepare(
        `SELECT id, external_id, title, attempts, last_error, next_attempt_at, synced_at, remote_id, updated_at
         FROM brain_sync_queue ORDER BY updated_at DESC LIMIT ?`
      )
      .all(limit) as Array<Omit<QueueRow, "content">>;
    return rows.map((row) => ({
      id: row.id,
      externalId: row.external_id,
      title: row.title,
      attempts: row.attempts,
      lastError: row.last_error,
      nextAttemptAt: row.next_attempt_at,
      syncedAt: row.synced_at,
      remoteId: row.remote_id,
      updatedAt: row.updated_at
    }));
  },

  async status(): Promise<BrainStatus> {
    const { host, apiKey, enabled } = readConfig();
    const warnings: string[] = [];
    if (!enabled) warnings.push("Sync is disabled (SECOND_BRAIN_SYNC=false).");
    if (!host) warnings.push("SECOND_BRAIN_HOST is not set, so nothing can be synced.");
    if (!apiKey) warnings.push("No Second-Brain API key is set (SECOND_BRAIN_API_KEY or JARVIS_API_KEY).");

    const dashboardOrigin = originOf(process.env.DASHBOARD_URL ?? "http://localhost:3000");
    if (host && originOf(host) === dashboardOrigin) {
      warnings.push(
        `SECOND_BRAIN_HOST (${host}) is the same address as the Agent-Builder dashboard. Both apps default to port 3000 — ` +
          "run Second-Brain on another port (e.g. PORT=3100) and point SECOND_BRAIN_HOST at it."
      );
    }

    let reachable = false;
    let identityVerified = false;
    if (host) {
      try {
        const response = await timedFetch(`${host}/api/health`, { headers: { Accept: "application/json" } });
        reachable = true;
        identityVerified = response.ok && (response.headers.get("content-type") ?? "").includes("application/json");
        if (!identityVerified) {
          warnings.push(`${host}/api/health did not return JSON (HTTP ${response.status}) — this may not be Second-Brain.`);
        }
      } catch {
        warnings.push(`Second-Brain is not reachable at ${host}. Documents stay queued and sync when it comes back.`);
      }
    }

    const counts = getKnowledgeDb()
      .prepare(
        `SELECT
           SUM(CASE WHEN synced_at IS NULL AND attempts = 0 THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN synced_at IS NULL AND attempts > 0 THEN 1 ELSE 0 END) AS retrying,
           SUM(CASE WHEN synced_at IS NOT NULL THEN 1 ELSE 0 END) AS synced
         FROM brain_sync_queue`
      )
      .get() as { pending: number | null; retrying: number | null; synced: number | null };

    return {
      enabled,
      host: host || null,
      hasApiKey: Boolean(apiKey),
      reachable,
      identityVerified,
      lastSyncAt,
      lastError,
      queue: { pending: counts.pending ?? 0, retrying: counts.retrying ?? 0, synced: counts.synced ?? 0 },
      warnings
    };
  }
};
