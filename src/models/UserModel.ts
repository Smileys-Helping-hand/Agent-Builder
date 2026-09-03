import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DB_PATH = path.resolve("data/users.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password_hash TEXT,
    role TEXT DEFAULT 'viewer',
    status TEXT DEFAULT 'active',
    last_login_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

const ensureColumn = (column: string, definition: string) => {
  try {
    db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
  } catch (error) {
    if (!(error instanceof Error) || !/duplicate column/i.test(error.message)) {
      throw error;
    }
  }
};

ensureColumn("status", "TEXT DEFAULT 'active'");
ensureColumn("last_login_at", "DATETIME");

export type UserRecord = {
  id: number;
  email: string;
  password_hash: string;
  role: string;
  status: string;
  last_login_at: string | null;
  created_at: string;
};

const normalizeRole = (role: string): string => {
  switch (role) {
    case "owner":
    case "admin":
    case "developer":
    case "viewer":
      return role;
    case "editor":
      return "developer";
    case "user":
    default:
      return "viewer";
  }
};

export const UserModel = {
  create(email: string, passwordHash: string, role: string = "viewer") {
    const stmt = db.prepare("INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)");
    return stmt.run(email, passwordHash, normalizeRole(role));
  },

  findByEmail(email: string) {
    const trimmed = email.trim().toLowerCase();
    const stmt = db.prepare("SELECT * FROM users WHERE LOWER(email) = ?");
    const record = stmt.get(trimmed) as UserRecord | undefined;
    return record
      ? {
          ...record,
          role: normalizeRole(record.role)
        }
      : undefined;
  },

  findById(id: number) {
    const stmt = db.prepare("SELECT * FROM users WHERE id = ?");
    const record = stmt.get(id) as UserRecord | undefined;
    return record
      ? {
          ...record,
          role: normalizeRole(record.role)
        }
      : undefined;
  },

  getAll() {
    const stmt = db.prepare("SELECT * FROM users ORDER BY id DESC");
    return (stmt.all() as UserRecord[]).map((record) => ({
      ...record,
      role: normalizeRole(record.role)
    }));
  },

  count(): number {
    const stmt = db.prepare("SELECT COUNT(*) as count FROM users");
    return (stmt.get() as { count: number }).count;
  },

  updateCredentials(id: number, updates: { passwordHash?: string; role?: string }) {
    const fields: string[] = [];
    const values: Array<string | number> = [];

    if (updates.passwordHash) {
      fields.push("password_hash = ?");
      values.push(updates.passwordHash);
    }

    if (updates.role) {
      fields.push("role = ?");
      values.push(normalizeRole(updates.role));
    }

    if (fields.length === 0) {
      return;
    }

    values.push(id);
    const stmt = db.prepare(`UPDATE users SET ${fields.join(", ")} WHERE id = ?`);
    stmt.run(...values);
  },

  updateLastLogin(id: number) {
    const stmt = db.prepare("UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?");
    stmt.run(id);
  },

  updateStatus(id: number, status: "active" | "suspended") {
    const stmt = db.prepare("UPDATE users SET status = ? WHERE id = ?");
    stmt.run(status, id);
  }
};
