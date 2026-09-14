import fs from "fs";
import path from "path";
import { openSqlite } from "../utils/Sqlite.js";

export type AuditLogEntry = {
  id: number;
  event_type: string;
  actor_id: number | null;
  actor_email: string | null;
  message: string | null;
  metadata: string | null;
  created_at: string;
};

export type AuditLogRecord = {
  id: number;
  eventType: string;
  actorId: number | null;
  actorEmail: string | null;
  message: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
};

export type AuditLogFilter = {
  limit?: number;
  eventType?: string;
};

const DB_PATH = path.resolve("data/audit.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = openSqlite(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    actor_id INTEGER,
    actor_email TEXT,
    message TEXT,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

export const AuditLogModel = {
  record(entry: {
    eventType: string;
    actorId?: number | null;
    actorEmail?: string | null;
    message?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    const stmt = db.prepare(
      "INSERT INTO audit_log (event_type, actor_id, actor_email, message, metadata) VALUES (?, ?, ?, ?, ?)"
    );

    const metadataPayload = entry.metadata ? JSON.stringify(entry.metadata) : null;

    stmt.run(
      entry.eventType,
      entry.actorId ?? null,
      entry.actorEmail ?? null,
      entry.message ?? null,
      metadataPayload
    );
  },

  list(filter: AuditLogFilter = {}): AuditLogRecord[] {
    const limit = Math.max(1, Math.min(filter.limit ?? 100, 500));

    if (filter.eventType) {
      const stmt = db.prepare(
        "SELECT * FROM audit_log WHERE event_type = ? ORDER BY created_at DESC LIMIT ?"
      );
      const rows = stmt.all(filter.eventType, limit) as AuditLogEntry[];
      return rows.map(convertRow);
    }

    const stmt = db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?");
    const rows = stmt.all(limit) as AuditLogEntry[];
    return rows.map(convertRow);
  }
};

const convertRow = (row: AuditLogEntry): AuditLogRecord => ({
  id: row.id,
  eventType: row.event_type,
  actorId: row.actor_id,
  actorEmail: row.actor_email,
  message: row.message,
  metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
  createdAt: row.created_at
});

export default AuditLogModel;
