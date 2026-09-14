import crypto from "crypto";
import fs from "fs";
import path from "path";
import { openSqlite } from "../utils/Sqlite.js";

const DB_PATH = path.resolve("data/users.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = openSqlite(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS refresh_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    user_agent TEXT,
    ip_address TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

const TOKEN_BYTES = Number(process.env.REFRESH_TOKEN_BYTES ?? 48);
const DEFAULT_EXPIRY_MINUTES = Number(process.env.REFRESH_TOKEN_TTL_MINUTES ?? 60 * 24 * 7);

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export const RefreshTokenModel = {
  issueToken(params: { userId: number; userAgent?: string | null; ipAddress?: string | null; expiresAt?: Date }) {
    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const expiresAt = params.expiresAt ?? new Date(Date.now() + DEFAULT_EXPIRY_MINUTES * 60 * 1000);
    const stmt = db.prepare(
      "INSERT OR REPLACE INTO refresh_tokens (token_hash, user_id, user_agent, ip_address, expires_at) VALUES (?, ?, ?, ?, ?)"
    );
    stmt.run(
      hashToken(rawToken),
      params.userId,
      params.userAgent ?? null,
      params.ipAddress ?? null,
      expiresAt.toISOString()
    );
    return rawToken;
  },

  verifyToken(token: string) {
    const stmt = db.prepare(
      "SELECT user_id as userId, expires_at as expiresAt FROM refresh_tokens WHERE token_hash = ?"
    );
    const record = stmt.get(hashToken(token)) as { userId: number; expiresAt: string } | undefined;
    if (!record) {
      return null;
    }
    if (new Date(record.expiresAt).getTime() < Date.now()) {
      this.revokeToken(token);
      return null;
    }
    return record.userId;
  },

  revokeToken(token: string) {
    const stmt = db.prepare("DELETE FROM refresh_tokens WHERE token_hash = ?");
    stmt.run(hashToken(token));
  },

  revokeAllForUser(userId: number) {
    const stmt = db.prepare("DELETE FROM refresh_tokens WHERE user_id = ?");
    stmt.run(userId);
  },

  purgeExpired() {
    const stmt = db.prepare("DELETE FROM refresh_tokens WHERE expires_at < ?");
    stmt.run(new Date().toISOString());
  }
};

export default RefreshTokenModel;
