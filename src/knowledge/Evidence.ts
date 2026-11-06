/**
 * Evidence — one ledger for everything the agents do that matters later.
 *
 * Every meaningful activity writes a record here: a continuous-builder step,
 * a VM test run and each of its results, a research finding, an experiment,
 * a lesson learned, a piece of the owner's feedback, an evaluation. Records
 * are linked to each other ("produced", "tested-by", "learned-from",
 * "feedback-on"…), so any record leads to where it came from and to what it
 * caused — research → experiment → finding → lesson → step that used it →
 * test that proved it — in both directions.
 *
 * A record's `ref` is its stable address ("step:<session>:<n>",
 * "vmrun:<id>", "lesson:<id>", "finding:<id>"…); `task` is what it was done
 * for (a session, a research topic, a VM). Stored in the knowledge database
 * (tables evidence and evidence_links, created if missing; dropping them
 * removes the ledger and nothing else).
 */
import { getKnowledgeDb, nowIso } from "./KnowledgeDb.js";

export type EvidenceKind =
  | "step"
  | "build"
  | "check"
  | "vm-test"
  | "vm-event"
  | "research"
  | "finding"
  | "experiment"
  | "lesson"
  | "knowledge"
  | "feedback"
  | "evaluation"
  | "release";

export interface EvidenceRecord {
  id: number;
  kind: EvidenceKind;
  ref: string;
  task: string | null;
  agent: string | null;
  title: string;
  outcome: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface EvidenceLink {
  from: string;
  to: string;
  relation: string;
  createdAt: string;
}

interface Row {
  id: number;
  kind: string;
  ref: string;
  task: string | null;
  agent: string | null;
  title: string;
  outcome: string | null;
  data: string | null;
  created_at: string;
}

const map = (row: Row): EvidenceRecord => {
  let data: Record<string, unknown> | null = null;
  try {
    data = row.data ? (JSON.parse(row.data) as Record<string, unknown>) : null;
  } catch {
    data = null;
  }
  return { id: row.id, kind: row.kind as EvidenceKind, ref: row.ref, task: row.task, agent: row.agent, title: row.title, outcome: row.outcome, data, createdAt: row.created_at };
};

export const Evidence = {
  /** Write a record (and its links). Never throws: losing a ledger line must not fail the work it describes. */
  record(input: {
    kind: EvidenceKind;
    ref: string;
    title: string;
    task?: string | null;
    agent?: string | null;
    outcome?: string | null;
    data?: Record<string, unknown> | null;
    links?: Array<{ to: string; relation: string }>;
  }): EvidenceRecord | null {
    try {
      const db = getKnowledgeDb();
      const at = nowIso();
      const result = db
        .prepare("INSERT INTO evidence (kind, ref, task, agent, title, outcome, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(input.kind, input.ref, input.task ?? null, input.agent ?? null, input.title.slice(0, 500), input.outcome ?? null, input.data ? JSON.stringify(input.data).slice(0, 200_000) : null, at);
      for (const link of input.links ?? []) Evidence.link(input.ref, link.to, link.relation);
      return map(db.prepare("SELECT * FROM evidence WHERE id = ?").get(Number(result.lastInsertRowid)) as Row);
    } catch {
      return null;
    }
  },

  link(from: string, to: string, relation: string): void {
    try {
      getKnowledgeDb().prepare("INSERT OR IGNORE INTO evidence_links (from_ref, to_ref, relation, created_at) VALUES (?, ?, ?, ?)").run(from, to, relation, nowIso());
    } catch {
      // The record itself is what matters.
    }
  },

  /** Every record written under a ref (newest last), and what it links to and from. */
  trace(ref: string): { records: EvidenceRecord[]; outgoing: EvidenceLink[]; incoming: EvidenceLink[] } {
    const db = getKnowledgeDb();
    const records = (db.prepare("SELECT * FROM evidence WHERE ref = ? ORDER BY id").all(ref) as Row[]).map(map);
    const links = (sql: string) =>
      (db.prepare(sql).all(ref) as Array<{ from_ref: string; to_ref: string; relation: string; created_at: string }>).map((l) => ({ from: l.from_ref, to: l.to_ref, relation: l.relation, createdAt: l.created_at }));
    return { records, outgoing: links("SELECT * FROM evidence_links WHERE from_ref = ?"), incoming: links("SELECT * FROM evidence_links WHERE to_ref = ?") };
  },

  forTask(task: string, limit = 200): EvidenceRecord[] {
    return (getKnowledgeDb().prepare("SELECT * FROM evidence WHERE task = ? ORDER BY id DESC LIMIT ?").all(task, limit) as Row[]).map(map);
  },

  recent(options: { kind?: EvidenceKind; limit?: number } = {}): EvidenceRecord[] {
    const db = getKnowledgeDb();
    const rows = options.kind
      ? db.prepare("SELECT * FROM evidence WHERE kind = ? ORDER BY id DESC LIMIT ?").all(options.kind, options.limit ?? 50)
      : db.prepare("SELECT * FROM evidence ORDER BY id DESC LIMIT ?").all(options.limit ?? 50);
    return (rows as Row[]).map(map);
  },

  /** Records written between two times for a task: what happened during one iteration. */
  between(task: string, from: string, to: string): EvidenceRecord[] {
    return (getKnowledgeDb().prepare("SELECT * FROM evidence WHERE task = ? AND created_at >= ? AND created_at <= ? ORDER BY id").all(task, from, to) as Row[]).map(map);
  },

  /**
   * The connections: every link within `depth` steps of a record, or the most recent ones, with what each end is.
   * Knowledge connects across projects through the records that used it.
   */
  graph(options: { ref?: string; depth?: number; limit?: number } = {}): { nodes: Array<{ ref: string; kind: string; title: string; outcome: string | null }>; edges: EvidenceLink[] } {
    const db = getKnowledgeDb();
    const limit = Math.min(500, options.limit ?? 120);
    type LinkRow = { from_ref: string; to_ref: string; relation: string; created_at: string };
    const rows: LinkRow[] = [];
    if (options.ref) {
      const seen = new Set<string>([options.ref]);
      let frontier = [options.ref];
      for (let i = 0; i < Math.min(4, options.depth ?? 2) && frontier.length && rows.length < limit; i++) {
        const next: string[] = [];
        for (const ref of frontier) {
          for (const row of db.prepare("SELECT * FROM evidence_links WHERE from_ref = ? OR to_ref = ? LIMIT 60").all(ref, ref) as LinkRow[]) {
            if (rows.some((r) => r.from_ref === row.from_ref && r.to_ref === row.to_ref && r.relation === row.relation)) continue;
            rows.push(row);
            for (const end of [row.from_ref, row.to_ref]) {
              if (!seen.has(end)) {
                seen.add(end);
                next.push(end);
              }
            }
          }
        }
        frontier = next;
      }
    } else rows.push(...(db.prepare("SELECT * FROM evidence_links ORDER BY created_at DESC LIMIT ?").all(limit) as LinkRow[]));
    const refs = [...new Set(rows.flatMap((r) => [r.from_ref, r.to_ref]))];
    const nodes = refs.map((ref) => {
      const record = db.prepare("SELECT * FROM evidence WHERE ref = ? ORDER BY id DESC LIMIT 1").get(ref) as Row | undefined;
      return { ref, kind: record?.kind ?? ref.split(":")[0], title: record?.title ?? ref, outcome: record?.outcome ?? null };
    });
    return { nodes, edges: rows.map((l) => ({ from: l.from_ref, to: l.to_ref, relation: l.relation, createdAt: l.created_at })) };
  },

  counts(): Record<string, number> {
    const rows = getKnowledgeDb().prepare("SELECT kind, COUNT(*) AS n FROM evidence GROUP BY kind").all() as Array<{ kind: string; n: number }>;
    return Object.fromEntries(rows.map((r) => [r.kind, r.n]));
  }
};
