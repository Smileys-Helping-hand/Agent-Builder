/**
 * AgentKeyModel — long-lived keys for machines, not people.
 *
 * Jarvis (and anything else in the ecosystem) authenticates with one of these
 * instead of a user login: user tokens are short-lived by design, which is
 * wrong for a service that must keep working unattended for weeks.
 *
 * Keys are 256-bit random values, so they are stored as a SHA-256 hash rather
 * than a bcrypt hash: bcrypt exists to slow down guessing of low-entropy
 * passwords, and paying that cost on every polling request buys nothing here.
 * The plaintext key is shown once, at creation, and never stored.
 */
import crypto from "crypto";
import path from "path";

import { openSqlite } from "../utils/Sqlite.js";

const DB_PATH = path.resolve("data/users.db");

export type AgentScope = "read" | "write" | "execute";

export interface AgentKey {
  id: number;
  name: string;
  scopes: AgentScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

type AgentKeyRow = {
  id: number;
  name: string;
  key_hash: string;
  scopes: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const db = openSqlite(DB_PATH);
// The key-minting CLI writes this file from a second process while the server
// holds it open; WAL lets a reader and a writer coexist instead of blocking.
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    key_hash TEXT NOT NULL UNIQUE,
    scopes TEXT NOT NULL DEFAULT 'read',
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
  );
`);

const hashKey = (key: string): string => crypto.createHash("sha256").update(key, "utf8").digest("hex");

const mapKey = (row: AgentKeyRow): AgentKey => ({
  id: row.id,
  name: row.name,
  scopes: row.scopes.split(",").filter(Boolean) as AgentScope[],
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
  revokedAt: row.revoked_at
});

export const AgentKeyModel = {
  /**
   * Create (or rotate) a key for a named agent. Returns the plaintext once —
   * it cannot be recovered afterwards, only replaced.
   */
  issue(name: string, scopes: AgentScope[]): { key: AgentKey; secret: string } {
    const secret = `ab_${crypto.randomBytes(32).toString("hex")}`;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO agent_keys (name, key_hash, scopes, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
         key_hash = excluded.key_hash,
         scopes = excluded.scopes,
         created_at = excluded.created_at,
         last_used_at = NULL,
         revoked_at = NULL`
    ).run(name, hashKey(secret), scopes.join(","), now);

    const row = db.prepare("SELECT * FROM agent_keys WHERE name = ?").get(name) as AgentKeyRow;
    return { key: mapKey(row), secret };
  },

  /** Look a key up by its plaintext. Returns null for unknown or revoked keys. */
  verify(secret: string): AgentKey | null {
    if (!secret || !secret.startsWith("ab_")) return null;
    const row = db.prepare("SELECT * FROM agent_keys WHERE key_hash = ?").get(hashKey(secret)) as AgentKeyRow | undefined;
    if (!row || row.revoked_at) return null;
    db.prepare("UPDATE agent_keys SET last_used_at = ? WHERE id = ?").run(new Date().toISOString(), row.id);
    return mapKey(row);
  },

  list(): AgentKey[] {
    const rows = db.prepare("SELECT * FROM agent_keys ORDER BY created_at DESC").all() as AgentKeyRow[];
    return rows.map(mapKey);
  },

  revoke(name: string): boolean {
    const result = db
      .prepare("UPDATE agent_keys SET revoked_at = ? WHERE name = ? AND revoked_at IS NULL")
      .run(new Date().toISOString(), name);
    return result.changes > 0;
  }
};
