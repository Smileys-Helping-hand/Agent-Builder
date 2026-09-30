/**
 * ResearchStore - persistence for continuous research.
 *
 * Every topic keeps its own frontier of open questions, the sources it has
 * already read (so a never-ending loop spends its time on new material rather
 * than rereading), deduplicated findings with support counts, and versioned
 * study documents generated from those findings.
 */
import crypto from "crypto";
import {
  contentTokens,
  getKnowledgeDb,
  indexKnowledge,
  jaccard,
  nowIso,
  toFtsQuery,
  toKey
} from "../knowledge/KnowledgeDb.js";

export type TopicStatus = "running" | "paused" | "stopped";
export type FindingStatus = "open" | "corroborated" | "contested";
export type QuestionStatus = "open" | "explored";
export type DocumentKind = "summary" | "study_guide" | "report";
export type ActivityKind = "cycle" | "search" | "source" | "finding" | "question" | "document" | "backoff" | "error" | "status";

export interface ResearchTopic {
  id: string;
  title: string;
  question: string;
  status: TopicStatus;
  cycles: number;
  consecutiveEmptyCycles: number;
  lastCycleAt: string | null;
  lastNewFindingAt: string | null;
  nextCycleAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchTopicSummary extends ResearchTopic {
  sourceCount: number;
  findingCount: number;
  corroboratedCount: number;
  contestedCount: number;
  openQuestionCount: number;
  documentCount: number;
}

export interface ResearchSource {
  id: number;
  topicId: string;
  url: string;
  title: string;
  provider: string;
  excerpt: string | null;
  cycle: number;
  fetchedAt: string;
}

export interface ResearchFinding {
  id: number;
  topicId: string;
  cycle: number;
  claim: string;
  sourceId: number | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  confidence: number;
  supportCount: number;
  status: FindingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ResearchQuestion {
  id: number;
  topicId: string;
  text: string;
  status: QuestionStatus;
  priority: number;
  timesExplored: number;
  createdCycle: number;
  createdAt: string;
}

export interface ResearchDocument {
  id: number;
  topicId: string;
  kind: DocumentKind;
  version: number;
  title: string;
  markdown: string;
  findingCount: number;
  createdAt: string;
}

export interface ActivityEntry {
  id: number;
  topicId: string;
  cycle: number;
  kind: ActivityKind;
  message: string;
  createdAt: string;
}

export interface KnowledgeSearchHit {
  kind: string;
  refId: string;
  topicId: string | null;
  title: string;
  snippet: string;
  score: number;
}

type TopicRow = {
  id: string;
  title: string;
  question: string;
  status: TopicStatus;
  cycles: number;
  consecutive_empty_cycles: number;
  last_cycle_at: string | null;
  last_new_finding_at: string | null;
  next_cycle_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type TopicSummaryRow = TopicRow & {
  source_count: number;
  finding_count: number;
  corroborated_count: number;
  contested_count: number;
  open_question_count: number;
  document_count: number;
};

type SourceRow = {
  id: number;
  topic_id: string;
  url: string;
  title: string;
  provider: string;
  excerpt: string | null;
  cycle: number;
  fetched_at: string;
};

type FindingRow = {
  id: number;
  topic_id: string;
  cycle: number;
  claim: string;
  claim_key: string;
  source_id: number | null;
  source_url: string | null;
  source_title: string | null;
  confidence: number;
  support_count: number;
  status: FindingStatus;
  created_at: string;
  updated_at: string;
};

type QuestionRow = {
  id: number;
  topic_id: string;
  text: string;
  status: QuestionStatus;
  priority: number;
  times_explored: number;
  created_cycle: number;
  created_at: string;
};

type DocumentRow = {
  id: number;
  topic_id: string;
  kind: DocumentKind;
  version: number;
  title: string;
  markdown: string;
  finding_count: number;
  created_at: string;
};

type ActivityRow = {
  id: number;
  topic_id: string;
  cycle: number;
  kind: ActivityKind;
  message: string;
  created_at: string;
};

const MAX_OPEN_QUESTIONS = 200;
const ACTIVITY_ROWS_KEPT = 500;
const NEAR_DUPLICATE_THRESHOLD = 0.8;

const mapTopic = (row: TopicRow): ResearchTopic => ({
  id: row.id,
  title: row.title,
  question: row.question,
  status: row.status,
  cycles: row.cycles,
  consecutiveEmptyCycles: row.consecutive_empty_cycles,
  lastCycleAt: row.last_cycle_at,
  lastNewFindingAt: row.last_new_finding_at,
  nextCycleAt: row.next_cycle_at,
  lastError: row.last_error,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapSummary = (row: TopicSummaryRow): ResearchTopicSummary => ({
  ...mapTopic(row),
  sourceCount: row.source_count,
  findingCount: row.finding_count,
  corroboratedCount: row.corroborated_count,
  contestedCount: row.contested_count,
  openQuestionCount: row.open_question_count,
  documentCount: row.document_count
});

const mapSource = (row: SourceRow): ResearchSource => ({
  id: row.id,
  topicId: row.topic_id,
  url: row.url,
  title: row.title,
  provider: row.provider,
  excerpt: row.excerpt,
  cycle: row.cycle,
  fetchedAt: row.fetched_at
});

const mapFinding = (row: FindingRow): ResearchFinding => ({
  id: row.id,
  topicId: row.topic_id,
  cycle: row.cycle,
  claim: row.claim,
  sourceId: row.source_id,
  sourceUrl: row.source_url ?? null,
  sourceTitle: row.source_title ?? null,
  confidence: row.confidence,
  supportCount: row.support_count,
  status: row.status,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapQuestion = (row: QuestionRow): ResearchQuestion => ({
  id: row.id,
  topicId: row.topic_id,
  text: row.text,
  status: row.status,
  priority: row.priority,
  timesExplored: row.times_explored,
  createdCycle: row.created_cycle,
  createdAt: row.created_at
});

const mapDocument = (row: DocumentRow): ResearchDocument => ({
  id: row.id,
  topicId: row.topic_id,
  kind: row.kind,
  version: row.version,
  title: row.title,
  markdown: row.markdown,
  findingCount: row.finding_count,
  createdAt: row.created_at
});

const mapActivity = (row: ActivityRow): ActivityEntry => ({
  id: row.id,
  topicId: row.topic_id,
  cycle: row.cycle,
  kind: row.kind,
  message: row.message,
  createdAt: row.created_at
});

const SUMMARY_SELECT = `
  SELECT t.*,
    (SELECT COUNT(*) FROM research_sources s WHERE s.topic_id = t.id) AS source_count,
    (SELECT COUNT(*) FROM research_findings f WHERE f.topic_id = t.id) AS finding_count,
    (SELECT COUNT(*) FROM research_findings f WHERE f.topic_id = t.id AND f.status = 'corroborated') AS corroborated_count,
    (SELECT COUNT(*) FROM research_findings f WHERE f.topic_id = t.id AND f.status = 'contested') AS contested_count,
    (SELECT COUNT(*) FROM research_questions q WHERE q.topic_id = t.id AND q.status = 'open') AS open_question_count,
    (SELECT COUNT(*) FROM research_documents d WHERE d.topic_id = t.id) AS document_count
  FROM research_topics t
`;

const FINDING_SELECT = `
  SELECT f.*, s.url AS source_url, s.title AS source_title
  FROM research_findings f
  LEFT JOIN research_sources s ON s.id = f.source_id
`;

export const ResearchStore = {
  createTopic(title: string, question: string): ResearchTopic {
    const db = getKnowledgeDb();
    const id = crypto.randomUUID();
    const now = nowIso();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO research_topics (id, title, question, status, next_cycle_at, created_at, updated_at)
         VALUES (?, ?, ?, 'running', ?, ?, ?)`
      ).run(id, title, question, now, now, now);
      db.prepare(
        `INSERT INTO research_questions (topic_id, text, text_key, priority, created_cycle, created_at)
         VALUES (?, ?, ?, 1, 0, ?)`
      ).run(id, question, toKey(question), now);
    })();
    return ResearchStore.getTopic(id) as ResearchTopic;
  },

  getTopic(id: string): ResearchTopic | null {
    const row = getKnowledgeDb().prepare("SELECT * FROM research_topics WHERE id = ?").get(id) as TopicRow | undefined;
    return row ? mapTopic(row) : null;
  },

  getTopicSummary(id: string): ResearchTopicSummary | null {
    const row = getKnowledgeDb().prepare(`${SUMMARY_SELECT} WHERE t.id = ?`).get(id) as TopicSummaryRow | undefined;
    return row ? mapSummary(row) : null;
  },

  listTopics(): ResearchTopicSummary[] {
    const rows = getKnowledgeDb().prepare(`${SUMMARY_SELECT} ORDER BY t.updated_at DESC`).all() as TopicSummaryRow[];
    return rows.map(mapSummary);
  },

  setStatus(id: string, status: TopicStatus): ResearchTopic | null {
    getKnowledgeDb().prepare("UPDATE research_topics SET status = ?, updated_at = ? WHERE id = ?").run(status, nowIso(), id);
    return ResearchStore.getTopic(id);
  },

  setNextCycleAt(id: string, iso: string | null): void {
    getKnowledgeDb().prepare("UPDATE research_topics SET next_cycle_at = ? WHERE id = ?").run(iso, id);
  },

  completeCycle(
    id: string,
    result: { cycle: number; newFindings: number; error: string | null; nextCycleAt: string }
  ): void {
    const now = nowIso();
    getKnowledgeDb()
      .prepare(
        `UPDATE research_topics SET
           cycles = ?,
           last_cycle_at = ?,
           next_cycle_at = ?,
           last_error = ?,
           consecutive_empty_cycles = CASE WHEN ? > 0 THEN 0 ELSE consecutive_empty_cycles + 1 END,
           last_new_finding_at = CASE WHEN ? > 0 THEN ? ELSE last_new_finding_at END,
           updated_at = ?
         WHERE id = ?`
      )
      .run(result.cycle, now, result.nextCycleAt, result.error, result.newFindings, result.newFindings, now, now, id);
  },

  deleteTopic(id: string): boolean {
    const db = getKnowledgeDb();
    let removed = false;
    db.transaction(() => {
      db.prepare("DELETE FROM knowledge_fts WHERE topic_id = ?").run(id);
      removed = db.prepare("DELETE FROM research_topics WHERE id = ?").run(id).changes > 0;
    })();
    return removed;
  },

  /** Rename a topic or sharpen its question; the next cycle works from the new wording. */
  updateTopic(id: string, patch: { title?: string; question?: string }): ResearchTopic | null {
    const topic = ResearchStore.getTopic(id);
    if (!topic) return null;
    const title = patch.title?.replace(/\s+/g, " ").trim() || topic.title;
    const question = patch.question?.replace(/\s+/g, " ").trim() || topic.question;
    getKnowledgeDb()
      .prepare("UPDATE research_topics SET title = ?, question = ?, updated_at = ? WHERE id = ?")
      .run(title.slice(0, 160), question.slice(0, 1000), nowIso(), id);
    return ResearchStore.getTopic(id);
  },

  // --- question frontier -------------------------------------------------

  nextQuestions(topicId: string, limit: number): ResearchQuestion[] {
    const rows = getKnowledgeDb()
      .prepare(
        `SELECT * FROM research_questions WHERE topic_id = ? AND status = 'open'
         ORDER BY priority DESC, times_explored ASC, id ASC LIMIT ?`
      )
      .all(topicId, limit) as QuestionRow[];
    return rows.map(mapQuestion);
  },

  listQuestions(topicId: string, limit: number, status?: QuestionStatus): ResearchQuestion[] {
    const db = getKnowledgeDb();
    const rows = (
      status
        ? db
            .prepare("SELECT * FROM research_questions WHERE topic_id = ? AND status = ? ORDER BY priority DESC, id DESC LIMIT ?")
            .all(topicId, status, limit)
        : db.prepare("SELECT * FROM research_questions WHERE topic_id = ? ORDER BY id DESC LIMIT ?").all(topicId, limit)
    ) as QuestionRow[];
    return rows.map(mapQuestion);
  },

  addQuestion(topicId: string, text: string, priority: number, cycle: number): boolean {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length < 10 || clean.length > 300) return false;
    const db = getKnowledgeDb();
    const open = (
      db.prepare("SELECT COUNT(*) AS c FROM research_questions WHERE topic_id = ? AND status = 'open'").get(topicId) as { c: number }
    ).c;
    if (open >= MAX_OPEN_QUESTIONS) return false;

    // Reject rewordings of a question already on the frontier or already asked.
    const tokens = contentTokens(clean);
    const existing = db
      .prepare("SELECT text FROM research_questions WHERE topic_id = ? ORDER BY id DESC LIMIT 400")
      .all(topicId) as Array<{ text: string }>;
    if (existing.some((row) => jaccard(tokens, contentTokens(row.text)) >= NEAR_DUPLICATE_THRESHOLD)) return false;

    const result = db
      .prepare(
        `INSERT OR IGNORE INTO research_questions (topic_id, text, text_key, priority, created_cycle, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(topicId, clean, toKey(clean), Math.max(0.05, Math.min(1, priority)), cycle, nowIso());
    return result.changes > 0;
  },

  /** A person's steer: goes straight to the top of the frontier. */
  addPriorityQuestion(topicId: string, text: string, cycle: number): boolean {
    return ResearchStore.addQuestion(topicId, text, 1, cycle);
  },

  /** Drop a question from the frontier (only within its own topic). */
  deleteQuestion(topicId: string, questionId: number): boolean {
    return (
      getKnowledgeDb().prepare("DELETE FROM research_questions WHERE id = ? AND topic_id = ?").run(questionId, topicId).changes > 0
    );
  },

  /** Put a question back on the frontier at the top. */
  prioritiseQuestion(topicId: string, questionId: number): boolean {
    return (
      getKnowledgeDb()
        .prepare("UPDATE research_questions SET status = 'open', priority = 1 WHERE id = ? AND topic_id = ?")
        .run(questionId, topicId).changes > 0
    );
  },

  markQuestionExplored(questionId: number): void {
    getKnowledgeDb()
      .prepare("UPDATE research_questions SET status = 'explored', times_explored = times_explored + 1 WHERE id = ?")
      .run(questionId);
  },

  /**
   * When the frontier runs dry, reopen the least-explored questions at reduced
   * priority. Sources change and search rankings shift, so a question asked
   * weeks ago can surface new material today — this is what lets a topic keep
   * going indefinitely without inventing busywork.
   */
  reopenExploredQuestions(topicId: string, limit: number): number {
    return getKnowledgeDb()
      .prepare(
        `UPDATE research_questions SET status = 'open', priority = MAX(0.05, priority * 0.5)
         WHERE id IN (
           SELECT id FROM research_questions WHERE topic_id = ? AND status = 'explored'
           ORDER BY times_explored ASC, id ASC LIMIT ?
         )`
      )
      .run(topicId, limit).changes;
  },

  // --- sources -----------------------------------------------------------

  hasSource(topicId: string, url: string): boolean {
    return Boolean(getKnowledgeDb().prepare("SELECT 1 FROM research_sources WHERE topic_id = ? AND url = ?").get(topicId, url));
  },

  hasContentHash(topicId: string, contentHash: string): boolean {
    return Boolean(
      getKnowledgeDb().prepare("SELECT 1 FROM research_sources WHERE topic_id = ? AND content_hash = ?").get(topicId, contentHash)
    );
  },

  addSource(
    topicId: string,
    input: { url: string; title: string; provider: string; contentHash: string | null; excerpt: string | null },
    cycle: number
  ): ResearchSource | null {
    const db = getKnowledgeDb();
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO research_sources (topic_id, url, title, provider, content_hash, excerpt, cycle, fetched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(topicId, input.url, input.title.slice(0, 500), input.provider, input.contentHash, input.excerpt, cycle, nowIso());
    if (result.changes === 0) return null;
    const row = db.prepare("SELECT * FROM research_sources WHERE id = ?").get(Number(result.lastInsertRowid)) as SourceRow;
    return mapSource(row);
  },

  listSources(topicId: string, limit: number): ResearchSource[] {
    const rows = getKnowledgeDb()
      .prepare("SELECT * FROM research_sources WHERE topic_id = ? ORDER BY id DESC LIMIT ?")
      .all(topicId, limit) as SourceRow[];
    return rows.map(mapSource);
  },

  // --- findings ----------------------------------------------------------

  /** Match a claim to an existing finding: exact normalised key first, then near-duplicate wording. */
  findFindingByText(topicId: string, text: string, threshold = NEAR_DUPLICATE_THRESHOLD): ResearchFinding | null {
    const db = getKnowledgeDb();
    const exact = db.prepare(`${FINDING_SELECT} WHERE f.topic_id = ? AND f.claim_key = ?`).get(topicId, toKey(text)) as
      | FindingRow
      | undefined;
    if (exact) return mapFinding(exact);

    const tokens = contentTokens(text);
    const candidates = db
      .prepare(`${FINDING_SELECT} WHERE f.topic_id = ? ORDER BY f.id DESC LIMIT 400`)
      .all(topicId) as FindingRow[];
    let best: FindingRow | null = null;
    let bestScore = 0;
    for (const candidate of candidates) {
      const score = jaccard(tokens, contentTokens(candidate.claim));
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    return best && bestScore >= threshold ? mapFinding(best) : null;
  },

  /**
   * Store a new finding, or reinforce the matching one. Support only counts
   * when it comes from a different source — one page restating itself isn't
   * corroboration.
   */
  addOrReinforceFinding(
    topicId: string,
    input: { claim: string; sourceId: number | null; confidence: number },
    cycle: number
  ): { finding: ResearchFinding; isNew: boolean } {
    const db = getKnowledgeDb();
    const now = nowIso();
    const match = ResearchStore.findFindingByText(topicId, input.claim);

    if (match) {
      if (input.sourceId !== null && match.sourceId !== input.sourceId) {
        const support = match.supportCount + 1;
        const confidence = Math.min(0.98, Math.max(match.confidence, input.confidence) + 0.08);
        const status: FindingStatus = match.status === "contested" ? "contested" : support >= 2 ? "corroborated" : match.status;
        db.prepare("UPDATE research_findings SET support_count = ?, confidence = ?, status = ?, updated_at = ? WHERE id = ?").run(
          support,
          confidence,
          status,
          now,
          match.id
        );
      }
      const refreshed = db.prepare(`${FINDING_SELECT} WHERE f.id = ?`).get(match.id) as FindingRow;
      return { finding: mapFinding(refreshed), isNew: false };
    }

    const result = db
      .prepare(
        `INSERT INTO research_findings (topic_id, cycle, claim, claim_key, source_id, confidence, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(topicId, cycle, input.claim, toKey(input.claim), input.sourceId, input.confidence, now, now);
    const id = Number(result.lastInsertRowid);
    const topic = ResearchStore.getTopic(topicId);
    indexKnowledge("finding", id, topicId, topic?.title ?? "", input.claim);
    const row = db.prepare(`${FINDING_SELECT} WHERE f.id = ?`).get(id) as FindingRow;
    return { finding: mapFinding(row), isNew: true };
  },

  /**
   * A person's verdict on a finding. "confirm" treats it as corroborated at
   * full confidence; "reject" marks it contested at the floor, so documents
   * and the builder stop leaning on it. Only within its own topic.
   */
  judgeFinding(topicId: string, findingId: number, verdict: "confirm" | "reject"): boolean {
    const sql =
      verdict === "confirm"
        ? "UPDATE research_findings SET status = 'corroborated', confidence = 1, updated_at = ? WHERE id = ? AND topic_id = ?"
        : "UPDATE research_findings SET status = 'contested', confidence = 0.05, updated_at = ? WHERE id = ? AND topic_id = ?";
    return getKnowledgeDb().prepare(sql).run(nowIso(), findingId, topicId).changes > 0;
  },

  markContested(findingId: number): void {
    getKnowledgeDb()
      .prepare(
        "UPDATE research_findings SET status = 'contested', confidence = MAX(0.05, confidence - 0.2), updated_at = ? WHERE id = ?"
      )
      .run(nowIso(), findingId);
  },

  listFindings(topicId: string, limit: number, order: "recent" | "strongest"): ResearchFinding[] {
    const orderBy =
      order === "strongest"
        ? "ORDER BY (f.status = 'contested') ASC, f.support_count DESC, f.confidence DESC, f.id DESC"
        : "ORDER BY f.id DESC";
    const rows = getKnowledgeDb()
      .prepare(`${FINDING_SELECT} WHERE f.topic_id = ? ${orderBy} LIMIT ?`)
      .all(topicId, limit) as FindingRow[];
    return rows.map(mapFinding);
  },

  strongestClaims(topicId: string, limit: number): string[] {
    return ResearchStore.listFindings(topicId, limit, "strongest").map((finding) => finding.claim);
  },

  // --- documents ---------------------------------------------------------

  saveDocument(topicId: string, kind: DocumentKind, title: string, markdown: string, findingCount: number): ResearchDocument {
    const db = getKnowledgeDb();
    let saved: DocumentRow | undefined;
    db.transaction(() => {
      const version =
        (
          db
            .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM research_documents WHERE topic_id = ? AND kind = ?")
            .get(topicId, kind) as { v: number }
        ).v + 1;
      const result = db
        .prepare(
          `INSERT INTO research_documents (topic_id, kind, version, title, markdown, finding_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(topicId, kind, version, title, markdown, findingCount, nowIso());
      // Only the latest version of each document kind is searchable.
      db.prepare("DELETE FROM knowledge_fts WHERE kind = ? AND topic_id = ?").run(`document:${kind}`, topicId);
      indexKnowledge(`document:${kind}`, Number(result.lastInsertRowid), topicId, title, markdown);
      saved = db.prepare("SELECT * FROM research_documents WHERE id = ?").get(Number(result.lastInsertRowid)) as DocumentRow;
    })();
    return mapDocument(saved as DocumentRow);
  },

  latestDocuments(topicId: string): ResearchDocument[] {
    const rows = getKnowledgeDb()
      .prepare(
        `SELECT d.* FROM research_documents d
         WHERE d.topic_id = ?
           AND d.version = (SELECT MAX(x.version) FROM research_documents x WHERE x.topic_id = d.topic_id AND x.kind = d.kind)
         ORDER BY d.kind`
      )
      .all(topicId) as DocumentRow[];
    return rows.map(mapDocument);
  },

  getDocument(topicId: string, documentId: number): ResearchDocument | null {
    const row = getKnowledgeDb()
      .prepare("SELECT * FROM research_documents WHERE topic_id = ? AND id = ?")
      .get(topicId, documentId) as DocumentRow | undefined;
    return row ? mapDocument(row) : null;
  },

  findingsSinceLatestDocument(topicId: string): number {
    return (
      getKnowledgeDb()
        .prepare(
          `SELECT COUNT(*) AS c FROM research_findings
           WHERE topic_id = ?
             AND created_at > COALESCE((SELECT MAX(created_at) FROM research_documents WHERE topic_id = ? AND kind = 'report'), '')`
        )
        .get(topicId, topicId) as { c: number }
    ).c;
  },

  // --- activity & search -------------------------------------------------

  logActivity(topicId: string, cycle: number, kind: ActivityKind, message: string): void {
    const db = getKnowledgeDb();
    const result = db
      .prepare("INSERT INTO research_activity (topic_id, cycle, kind, message, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(topicId, cycle, kind, message.slice(0, 1000), nowIso());
    if (Number(result.lastInsertRowid) % 50 === 0) {
      db.prepare(
        `DELETE FROM research_activity WHERE topic_id = ? AND id NOT IN (
           SELECT id FROM research_activity WHERE topic_id = ? ORDER BY id DESC LIMIT ?
         )`
      ).run(topicId, topicId, ACTIVITY_ROWS_KEPT);
    }
  },

  recentActivity(topicId: string, limit: number): ActivityEntry[] {
    const rows = getKnowledgeDb()
      .prepare("SELECT * FROM research_activity WHERE topic_id = ? ORDER BY id DESC LIMIT ?")
      .all(topicId, limit) as ActivityRow[];
    return rows.map(mapActivity);
  },

  search(query: string, limit: number): KnowledgeSearchHit[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    const rows = getKnowledgeDb()
      .prepare(
        `SELECT kind, ref_id, topic_id, title, snippet(knowledge_fts, 4, '«', '»', '…', 14) AS snippet, bm25(knowledge_fts) AS score
         FROM knowledge_fts WHERE knowledge_fts MATCH ? ORDER BY score LIMIT ?`
      )
      .all(match, limit) as Array<{ kind: string; ref_id: string; topic_id: string; title: string; snippet: string; score: number }>;
    return rows.map((row) => ({
      kind: row.kind,
      refId: row.ref_id,
      topicId: row.topic_id || null,
      title: row.title,
      snippet: row.snippet,
      score: row.score
    }));
  }
};
