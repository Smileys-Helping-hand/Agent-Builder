/**
 * AgentActivity — what machine callers did here, and what we told them.
 *
 * Jarvis holds a key with full access (read, write, execute), so it matters
 * what he does with it. Every request made with an agent key is recorded
 * ("in"), and every message sent to Jarvis is recorded too ("out"), so the app
 * can show a plain log of both directions and tell whether he is actually
 * watching — rather than whether he was configured once.
 *
 * Kept in data/knowledge.db beside everything else, trimmed to the newest
 * rows so it never grows without bound.
 */
import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";

export type ActivityDirection = "in" | "out";

export interface ActivityEntry {
  id: number;
  at: string;
  direction: ActivityDirection;
  /** The agent key's name for "in"; who we sent to for "out". */
  agent: string;
  method: string;
  path: string;
  /** HTTP status for "in"; 200 or 0 (not delivered) for "out". */
  status: number;
  ms: number | null;
  summary: string | null;
}

const KEEP = 3000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  direction TEXT NOT NULL,
  agent TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  ms INTEGER,
  summary TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_activity ON agent_activity(agent, id DESC);
`;

let ready = false;
let writes = 0;
const db = () => {
  const database = getKnowledgeDb();
  if (!ready) {
    database.exec(SCHEMA);
    ready = true;
  }
  return database;
};

type Row = {
  id: number;
  at: string;
  direction: ActivityDirection;
  agent: string;
  method: string;
  path: string;
  status: number;
  ms: number | null;
  summary: string | null;
};

export const AgentActivity = {
  record(entry: Omit<ActivityEntry, "id" | "at" | "ms" | "summary"> & { ms?: number | null; summary?: string | null }): void {
    try {
      db()
        .prepare("INSERT INTO agent_activity (at, direction, agent, method, path, status, ms, summary) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(nowIso(), entry.direction, entry.agent, entry.method, entry.path.slice(0, 300), entry.status, entry.ms ?? null, entry.summary?.slice(0, 500) ?? null);
      // Trim now and then rather than on every write.
      if (++writes % 200 === 0) {
        db().prepare("DELETE FROM agent_activity WHERE id <= (SELECT MAX(id) FROM agent_activity) - ?").run(KEEP);
      }
    } catch {
      // A log that cannot be written must never break the request it describes.
    }
  },

  list(options: { agent?: string; limit?: number } = {}): ActivityEntry[] {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
    const rows = (
      options.agent
        ? db().prepare("SELECT * FROM agent_activity WHERE agent = ? ORDER BY id DESC LIMIT ?").all(options.agent, limit)
        : db().prepare("SELECT * FROM agent_activity ORDER BY id DESC LIMIT ?").all(limit)
    ) as Row[];
    return rows.map((row) => ({ ...row }));
  },

  /** When an agent last made a request here, or null if never. */
  lastSeen(agent: string): string | null {
    const row = db()
      .prepare("SELECT at FROM agent_activity WHERE agent = ? AND direction = 'in' ORDER BY id DESC LIMIT 1")
      .get(agent) as { at: string } | undefined;
    return row?.at ?? null;
  },

  /** Requests from an agent in the last `minutes`. */
  countSince(agent: string, minutes: number): number {
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const row = db()
      .prepare("SELECT COUNT(*) AS n FROM agent_activity WHERE agent = ? AND direction = 'in' AND at >= ?")
      .get(agent, since) as { n: number };
    return row.n;
  }
};
