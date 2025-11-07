import { Pool, PoolClient, QueryResult } from "pg";
import { registerType, toSql } from "pgvector/pg";
import { Logger } from "../utils/Logger.js";
import { OpenAIClient } from "../tools/OpenAIClient.js";
import type { Task } from "../orchestrator/types.js";

export type VectorRecord = {
  id: string;
  taskId: string;
  agentType: string;
  description: string;
  result: string;
  metadata: Record<string, unknown>;
  score?: number;
  createdAt: string;
};

const DEFAULT_DIMENSION = 1536;
const DEFAULT_TABLE = process.env.PGVECTOR_TABLE ?? "agent_memory";

const ensureExtensionSql = "CREATE EXTENSION IF NOT EXISTS vector";

const createTableSql = `
CREATE TABLE IF NOT EXISTS ${DEFAULT_TABLE} (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  description TEXT NOT NULL,
  result TEXT,
  embedding vector(${DEFAULT_DIMENSION}) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`;

const insertSql = `
INSERT INTO ${DEFAULT_TABLE} (id, task_id, agent_type, description, result, embedding, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (id) DO UPDATE SET
  agent_type = EXCLUDED.agent_type,
  description = EXCLUDED.description,
  result = EXCLUDED.result,
  embedding = EXCLUDED.embedding,
  metadata = EXCLUDED.metadata`;

const searchSql = (limit: number) =>
  `SELECT id, task_id, agent_type, description, result, metadata, created_at, 1 - (embedding <=> $1) as score
   FROM ${DEFAULT_TABLE}
   ORDER BY embedding <=> $1
   LIMIT ${limit}`;

const listSql = (limit: number) =>
  `SELECT id, task_id, agent_type, description, result, metadata, created_at
   FROM ${DEFAULT_TABLE}
   ORDER BY created_at DESC
   LIMIT ${limit}`;

const countSql = `SELECT COUNT(*) AS count FROM ${DEFAULT_TABLE}`;

type VectorRow = {
  id: string;
  task_id: string;
  agent_type: string;
  description: string;
  result: string;
  metadata: Record<string, unknown> | null;
  created_at: string | Date;
  score?: number;
};

export class VectorMemory {
  private static pool: Pool | null = null;
  private static initialized = false;

  static isEnabled(): boolean {
    return Boolean(process.env.PGVECTOR_URL);
  }

  static async init(): Promise<boolean> {
    if (!this.isEnabled()) {
      return false;
    }

    if (this.initialized) {
      return true;
    }

    const connectionString = process.env.PGVECTOR_URL!;
    this.pool = new Pool({ connectionString });
    registerType(this.pool);

    try {
      await this.pool.query(ensureExtensionSql);
      await this.pool.query(createTableSql);
      this.initialized = true;
      Logger.log("Vector memory ready using pgvector at", connectionString);
      return true;
    } catch (error) {
      Logger.warn("Failed to initialize vector memory:", error);
      await this.teardown();
      return false;
    }
  }

  private static async getClient(): Promise<PoolClient> {
    if (!this.pool) {
      throw new Error("Vector memory pool not initialized. Call VectorMemory.init() first.");
    }
    return this.pool.connect();
  }

  static async teardown() {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }
    this.initialized = false;
  }

  static async storeTask(task: Task): Promise<void> {
    if (!this.initialized) {
      return;
    }

    const textContent = typeof task.result === "string" ? task.result : JSON.stringify(task.result ?? {});

    try {
      const embedding = await OpenAIClient.embed(textContent);
      if (!embedding) {
        Logger.warn("Skipping vector memory write - embedding unavailable");
        return;
      }

      const metadata = {
        description: task.description,
        status: task.status,
        updatedAt: task.updatedAt
      } satisfies Record<string, unknown>;

      const client = await this.getClient();
      try {
        await client.query(insertSql, [
          task.id,
          task.id,
          task.agentType,
          task.description,
          textContent,
          toSql(embedding),
          metadata
        ]);
      } finally {
        client.release();
      }
    } catch (error) {
      Logger.warn("Failed to store task embedding:", error);
    }
  }

  static async searchByText(query: string, limit = 10): Promise<VectorRecord[]> {
    if (!this.initialized) {
      return [];
    }

    try {
      const embedding = await OpenAIClient.embed(query);
      if (!embedding) {
        return [];
      }

      const client = await this.getClient();
      try {
        const result = await client.query<VectorRow>(searchSql(limit), [toSql(embedding)]);
        return this.mapRows(result);
      } finally {
        client.release();
      }
    } catch (error) {
      Logger.warn("Vector search failed:", error);
      return [];
    }
  }

  static async listRecent(limit = 20): Promise<VectorRecord[]> {
    if (!this.initialized) {
      return [];
    }

    const client = await this.getClient();
    try {
      const result = await client.query<VectorRow>(listSql(limit));
      return this.mapRows(result);
    } finally {
      client.release();
    }
  }

  static async count(): Promise<number> {
    if (!this.initialized) {
      return 0;
    }

    const client = await this.getClient();
    try {
      const result = await client.query<{ count: string }>(countSql);
      const row = result.rows[0];
      return row ? Number(row.count) : 0;
    } finally {
      client.release();
    }
  }

  private static mapRows(result: QueryResult<VectorRow>): VectorRecord[] {
    return result.rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      agentType: row.agent_type,
      description: row.description,
      result: row.result,
      metadata: row.metadata ?? {},
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      score: typeof row.score === "number" ? Number(row.score) : undefined
    }));
  }
}
