/**
 * JarvisClient — tells Jarvis what this machine is doing.
 *
 * Jarvis exposes one universal ingress: POST /api/assistant/webhook/<apiKey>,
 * authenticated by the key in the path, which triages the payload and files it
 * as a communication and (when it matters) an action item. So this is a small
 * sender rather than a protocol: a subject, a body, and a type.
 *
 * Delivery is best-effort and never blocks the work being reported. Anything
 * that cannot be delivered is kept in a short queue and retried, because Jarvis
 * is frequently asleep while the builder keeps running.
 */
import { Logger } from "../utils/Logger.js";

export type JarvisEventType = "build" | "repair" | "issue" | "research" | "status" | "test";

export interface JarvisEvent {
  type: JarvisEventType;
  subject: string;
  body: string;
  project?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown>;
}

interface Queued extends JarvisEvent {
  attempts: number;
  firstTried: number;
}

const QUEUE_LIMIT = 50;
const RETRY_AFTER_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;

const queue: Queued[] = [];
let retryTimer: NodeJS.Timeout | null = null;
let lastResult: { at: string; ok: boolean; detail: string } | null = null;

/**
 * Where to post. Prefer an explicit webhook URL; otherwise build one from the
 * host and key, which is how the gateway addresses are shaped.
 */
const webhookUrl = (): string | null => {
  const explicit = process.env.JARVIS_WEBHOOK_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = process.env.JARVIS_HOST?.trim().replace(/\/+$/, "");
  const key = process.env.JARVIS_API_KEY?.trim();
  if (!host || !key) return null;
  return `${host}/api/assistant/webhook/${key}`;
};

const deliver = async (event: JarvisEvent): Promise<{ ok: boolean; detail: string }> => {
  const url = webhookUrl();
  if (!url) return { ok: false, detail: "No Jarvis webhook configured (set JARVIS_WEBHOOK_URL or JARVIS_HOST + JARVIS_API_KEY)." };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        app: "Agent Builder",
        sender: "Agent Builder",
        type: event.type,
        subject: event.subject,
        body: event.body,
        project: event.project ?? undefined,
        url: event.url ?? undefined,
        owner_user_id: process.env.JARVIS_OWNER_ID || undefined,
        metadata: event.metadata,
        sent_at: new Date().toISOString()
      })
    });

    const text = await response.text();
    if (!response.ok) {
      // 530 and friends come from the tunnel in front of Jarvis, not Jarvis.
      return { ok: false, detail: `Jarvis answered ${response.status}: ${text.slice(0, 160)}` };
    }
    return { ok: true, detail: text.slice(0, 200) || "delivered" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      detail: message.includes("timeout") ? "Jarvis did not answer in time." : `Could not reach Jarvis: ${message}`
    };
  }
};

const scheduleRetry = (): void => {
  if (retryTimer || queue.length === 0) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void JarvisClient.flush();
  }, RETRY_AFTER_MS);
  retryTimer.unref?.();
};

export const JarvisClient = {
  isConfigured(): boolean {
    return webhookUrl() !== null;
  },

  /** The webhook, with the key masked - safe to show in a UI or a log. */
  describe(): { configured: boolean; url: string | null; owner: string | null; queued: number; last: typeof lastResult } {
    const url = webhookUrl();
    return {
      configured: url !== null,
      url: url ? url.replace(/(jb_live_sk_)[^/]+/, "$1…") : null,
      owner: process.env.JARVIS_OWNER_ID || null,
      queued: queue.length,
      last: lastResult
    };
  },

  /** Report something. Never throws; failures are queued and retried. */
  async send(event: JarvisEvent): Promise<{ ok: boolean; detail: string }> {
    const result = await deliver(event);
    lastResult = { at: new Date().toISOString(), ...result };

    if (!result.ok) {
      queue.push({ ...event, attempts: 1, firstTried: Date.now() });
      if (queue.length > QUEUE_LIMIT) queue.shift();
      scheduleRetry();
      Logger.log("Jarvis delivery deferred", { subject: event.subject, detail: result.detail, queued: queue.length });
    }
    return result;
  },

  /** Retry whatever is waiting. Called on a timer and after a successful test. */
  async flush(): Promise<{ delivered: number; remaining: number }> {
    let delivered = 0;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      const event = queue[index];
      const result = await deliver(event);
      if (result.ok) {
        queue.splice(index, 1);
        delivered += 1;
      } else {
        event.attempts += 1;
      }
    }
    if (queue.length > 0) scheduleRetry();
    return { delivered, remaining: queue.length };
  }
};
