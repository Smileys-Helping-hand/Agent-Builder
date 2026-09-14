/**
 * KnowledgeDb - the local, offline store for everything the app learns.
 *
 * One SQLite file (data/knowledge.db) holds continuous-research state (topics,
 * sources, findings, open questions, generated study documents) and the lesson
 * memory the build pipeline learns from its own failures. Local on purpose:
 * learning keeps working with no network and no Second-Brain, which is only
 * ever a downstream copy.
 */
import fs from "fs";
import path from "path";
import { openSqlite, type SqliteDatabase } from "../utils/Sqlite.js";

const DB_PATH = path.resolve(process.env.KNOWLEDGE_DB_PATH ?? "data/knowledge.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS research_topics (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  cycles INTEGER NOT NULL DEFAULT 0,
  consecutive_empty_cycles INTEGER NOT NULL DEFAULT 0,
  last_cycle_at TEXT,
  last_new_finding_at TEXT,
  next_cycle_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  title TEXT NOT NULL,
  provider TEXT NOT NULL,
  content_hash TEXT,
  excerpt TEXT,
  cycle INTEGER NOT NULL,
  fetched_at TEXT NOT NULL,
  UNIQUE(topic_id, url)
);
CREATE INDEX IF NOT EXISTS idx_sources_hash ON research_sources(topic_id, content_hash);

CREATE TABLE IF NOT EXISTS research_findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
  cycle INTEGER NOT NULL,
  claim TEXT NOT NULL,
  claim_key TEXT NOT NULL,
  source_id INTEGER REFERENCES research_sources(id) ON DELETE SET NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  support_count INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(topic_id, claim_key)
);

CREATE TABLE IF NOT EXISTS research_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  text_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  priority REAL NOT NULL DEFAULT 0.5,
  times_explored INTEGER NOT NULL DEFAULT 0,
  created_cycle INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(topic_id, text_key)
);

CREATE TABLE IF NOT EXISTS research_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  markdown TEXT NOT NULL,
  finding_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(topic_id, kind, version)
);

CREATE TABLE IF NOT EXISTS research_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL REFERENCES research_topics(id) ON DELETE CASCADE,
  cycle INTEGER NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activity_topic ON research_activity(topic_id, id);

CREATE TABLE IF NOT EXISTS lessons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  signature TEXT NOT NULL,
  signature_key TEXT NOT NULL,
  lesson TEXT NOT NULL,
  example TEXT,
  times_applied INTEGER NOT NULL DEFAULT 0,
  times_helped INTEGER NOT NULL DEFAULT 0,
  times_failed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_applied_at TEXT,
  UNIQUE(scope, signature_key)
);

CREATE TABLE IF NOT EXISTS brain_sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  next_attempt_at TEXT NOT NULL,
  synced_at TEXT,
  remote_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
  kind UNINDEXED,
  ref_id UNINDEXED,
  topic_id UNINDEXED,
  title,
  body,
  tokenize = 'porter unicode61'
);
`;

let instance: SqliteDatabase | null = null;

export const getKnowledgeDb = (): SqliteDatabase => {
  if (instance) return instance;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = openSqlite(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  instance = db;
  return db;
};

export const nowIso = (): string => new Date().toISOString();

const STOPWORDS = new Set(
  (
    "a about above after again against all also am an and any are as at be because been before being below between " +
    "both but by can could did do does doing down during each few for from further had has have having he her here " +
    "hers him his how i if in into is it its itself just me more most my no nor not now of off on once only or other " +
    "our out over own same she should so some such than that the their them then there these they this those through " +
    "to too under until up very was we were what when where which while who whom why will with would you your yours " +
    "use used using via one two may might must shall"
  ).split(/\s+/)
);

/** Lower-cased content words (3+ chars, stopwords removed) — the unit for overlap and relevance checks. */
export const contentTokens = (text: string): string[] =>
  (text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((token) => !STOPWORDS.has(token));

/** Jaccard similarity of two token collections. */
export const jaccard = (a: Iterable<string>, b: Iterable<string>): number => {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) {
    if (right.has(token)) shared += 1;
  }
  return shared / (left.size + right.size - shared);
};

/** Normalise free text into a dedupe key: case-, accent-, punctuation- and whitespace-insensitive. */
export const toKey = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);

/**
 * Turn arbitrary text into a safe FTS5 MATCH expression. Raw input can contain
 * FTS operators or unbalanced quotes that throw; quoting each token and OR-ing
 * them keeps recall broad (BM25 does the ranking) and the query always valid.
 */
export const toFtsQuery = (text: string): string | null => {
  const tokens = [...new Set(contentTokens(text))].slice(0, 24);
  if (tokens.length === 0) return null;
  return tokens.map((token) => `"${token}"`).join(" OR ");
};

export const indexKnowledge = (kind: string, refId: number | string, topicId: string | null, title: string, body: string): void => {
  getKnowledgeDb()
    .prepare("INSERT INTO knowledge_fts (kind, ref_id, topic_id, title, body) VALUES (?, ?, ?, ?, ?)")
    .run(kind, String(refId), topicId ?? "", title, body);
};

export const unindexKnowledge = (kind: string, refId: number | string): void => {
  getKnowledgeDb().prepare("DELETE FROM knowledge_fts WHERE kind = ? AND ref_id = ?").run(kind, String(refId));
};
