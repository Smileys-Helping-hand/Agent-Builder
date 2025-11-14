import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const DB_PATH = path.resolve("data/licenses.db");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE,
    tier TEXT NOT NULL,
    metadata TEXT,
    activated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

type LicenseRecord = {
  id: number;
  key: string;
  tier: string;
  metadata: string | null;
  activated_at: string;
};

export type LicenseTier = "free" | "pro" | "enterprise";

export type LicenseSnapshot = {
  id: number;
  key: string;
  tier: LicenseTier;
  metadata: Record<string, unknown> | null;
  activated_at: string;
};

const normalizeTier = (tier: string): LicenseTier => {
  switch (tier.toLowerCase()) {
    case "enterprise":
      return "enterprise";
    case "pro":
      return "pro";
    case "free":
    default:
      return "free";
  }
};

export const LicenseModel = {
  activate(key: string, tier: string, metadata?: Record<string, unknown>) {
    const normalizedTier = normalizeTier(tier);
    const payload = metadata ? JSON.stringify(metadata) : null;
    const stmt = db.prepare(
      "INSERT INTO licenses (key, tier, metadata) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET tier = excluded.tier, metadata = excluded.metadata, activated_at = CURRENT_TIMESTAMP"
    );
    stmt.run(key, normalizedTier, payload);
    return this.getActive();
  },

  getActive(): LicenseSnapshot | null {
    const stmt = db.prepare("SELECT * FROM licenses ORDER BY activated_at DESC LIMIT 1");
    const record = stmt.get() as LicenseRecord | undefined;
    if (!record) {
      return null;
    }
    return {
      id: record.id,
      key: record.key,
      tier: normalizeTier(record.tier),
      metadata: record.metadata ? (JSON.parse(record.metadata) as Record<string, unknown>) : null,
      activated_at: record.activated_at
    };
  }
};
