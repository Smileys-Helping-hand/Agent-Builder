import fs from "fs";
import path from "path";
import { openSqlite, type SqliteDatabase } from "../utils/Sqlite.js";
import { v4 as uuidv4 } from "uuid";
import { Logger } from "../utils/Logger.js";
import { VectorMemory } from "./VectorMemory.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import type {
  NarrativeEntity,
  NarrativeEntityType,
  NarrativeRelationship,
  StoryTimelineEvent
} from "../models/NarrativeTypes.js";

const DEFAULT_DB_PATH = process.env.WORLD_MEMORY_DB ?? path.resolve("./data/storyworld/worldmemory.db");

const ensureDirectory = async (target: string) => {
  await fs.promises.mkdir(target, { recursive: true });
};

type EntityRow = {
  id: string;
  label: string;
  type: string;
  metadata: string | null;
  updated_at: string;
};

type EventRow = {
  id: string;
  entity_id: string;
  entity_type: string;
  entity_label: string | null;
  description: string;
  tags: string | null;
  metadata: string | null;
  related_entities: string | null;
  session_id: string | null;
  created_at: string;
};

type LinkRow = {
  id: string;
  from_id: string;
  to_id: string;
  relation: string;
  weight: number | null;
  metadata: string | null;
  created_at: string;
};

const serializeJson = (value?: Record<string, unknown> | null) =>
  value && Object.keys(value).length > 0 ? JSON.stringify(value) : null;

const parseJson = <T>(value: string | null): T | undefined => {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    Logger.warn("Failed to parse WorldMemory JSON payload", error);
    return undefined;
  }
};

export type RecordEventInput = {
  entityId: string;
  entityType: NarrativeEntityType;
  entityLabel?: string;
  description: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  sessionId?: string;
  relatedEntities?: Array<{ entityId: string; relation: string; label?: string }>;
};

export class WorldMemory {
  private static instance: WorldMemory | null = null;
  private db: SqliteDatabase | null = null;
  private initializing: Promise<void> | null = null;

  static getInstance() {
    if (!this.instance) {
      this.instance = new WorldMemory();
    }
    return this.instance;
  }

  async init(dbPath: string = DEFAULT_DB_PATH) {
    if (this.db) return;
    if (this.initializing) {
      await this.initializing;
      return;
    }

    this.initializing = (async () => {
      await ensureDirectory(path.dirname(dbPath));
      this.db = openSqlite(dbPath);

      await this.run(
        `CREATE TABLE IF NOT EXISTS entities (
          id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          type TEXT NOT NULL,
          metadata TEXT,
          updated_at TEXT NOT NULL
        )`
      );

      await this.run(
        `CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          entity_id TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          description TEXT NOT NULL,
          tags TEXT,
          metadata TEXT,
          related_entities TEXT,
          session_id TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(entity_id) REFERENCES entities(id)
        )`
      );

      await this.run(
        `CREATE TABLE IF NOT EXISTS relationships (
          id TEXT PRIMARY KEY,
          from_id TEXT NOT NULL,
          to_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          weight REAL,
          metadata TEXT,
          created_at TEXT NOT NULL,
          FOREIGN KEY(from_id) REFERENCES entities(id),
          FOREIGN KEY(to_id) REFERENCES entities(id)
        )`
      );

      Logger.log("WorldMemory initialized", { dbPath });
    })();

    try {
      await this.initializing;
    } finally {
      this.initializing = null;
    }
  }

  async recordEvent(input: RecordEventInput): Promise<StoryTimelineEvent> {
    await this.init();

    const timestamp = new Date().toISOString();
    const entityLabel = input.entityLabel ?? this.defaultLabelFor(input.entityId, input.entityType);

    await this.ensureEntity({
      id: input.entityId,
      type: input.entityType,
      label: entityLabel,
      metadata: input.metadata,
      updatedAt: timestamp
    });

    const eventId = uuidv4();
    const tags = input.tags ?? [];

    const related = input.relatedEntities?.map((entry) => ({
      entityId: entry.entityId,
      relation: entry.relation,
      label: entry.label
    }));

    await this.run(
      `INSERT INTO events (id, entity_id, entity_type, description, tags, metadata, related_entities, session_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        eventId,
        input.entityId,
        input.entityType,
        input.description,
        tags.length > 0 ? JSON.stringify(tags) : null,
        serializeJson(input.metadata),
        related && related.length > 0 ? JSON.stringify(related) : null,
        input.sessionId ?? null,
        timestamp
      ]
    );

    if (related && related.length > 0) {
      await Promise.all(
        related.map(async (relation) => {
          await this.ensureEntity({
            id: relation.entityId,
            type: "event",
            label: relation.label ?? relation.entityId,
            updatedAt: timestamp
          });
          await this.run(
            `INSERT INTO relationships (id, from_id, to_id, relation, weight, metadata, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              uuidv4(),
              input.entityId,
              relation.entityId,
              relation.relation,
              null,
              null,
              timestamp
            ]
          );
        })
      );
    }

    if (VectorMemory.isEnabled()) {
      void VectorMemory.storeConversationTurn(input.description, {
        type: "story_event",
        entityId: input.entityId,
        entityType: input.entityType,
        tags
      });
    }

    const event: StoryTimelineEvent = {
      id: eventId,
      entityId: input.entityId,
      entityType: input.entityType,
      entityLabel,
      description: input.description,
      tags,
      metadata: input.metadata,
      relatedEntities: related,
      sessionId: input.sessionId,
      createdAt: timestamp
    };

    return event;
  }

  async listEvents(limit = 100): Promise<StoryTimelineEvent[]> {
    await this.init();
    const rows = await this.all<EventRow>(
      `SELECT e.id,
              e.entity_id,
              e.entity_type,
              ent.label as entity_label,
              e.description,
              e.tags,
              e.metadata,
              e.related_entities,
              e.session_id,
              e.created_at
         FROM events e
         LEFT JOIN entities ent ON ent.id = e.entity_id
         ORDER BY e.created_at DESC
         LIMIT ?`,
      [limit]
    );

    return rows.map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      entityType: row.entity_type as NarrativeEntityType,
      entityLabel: row.entity_label ?? undefined,
      description: row.description,
      tags: parseJson<string[]>(row.tags) ?? [],
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      relatedEntities: parseJson<Array<{ entityId: string; relation: string; label?: string }>>(row.related_entities),
      sessionId: row.session_id ?? undefined,
      createdAt: row.created_at
    }));
  }

  async recall(entityId: string): Promise<{
    entity: NarrativeEntity | null;
    events: StoryTimelineEvent[];
    relationships: NarrativeRelationship[];
  }> {
    await this.init();

    const entityRow = await this.get<EntityRow>(
      `SELECT id, label, type, metadata, updated_at FROM entities WHERE id = ?`,
      [entityId]
    );

    const entity: NarrativeEntity | null = entityRow
      ? {
          id: entityRow.id,
          type: entityRow.type as NarrativeEntityType,
          label: entityRow.label,
          metadata: parseJson<Record<string, unknown>>(entityRow.metadata),
          updatedAt: entityRow.updated_at
        }
      : null;

    const events = await this.listEventsForEntity(entityId);
    const relationships = await this.listRelationships(entityId);

    return { entity, events, relationships };
  }

  async summarizeSession(sessionId?: string): Promise<{ summary: string; events: StoryTimelineEvent[] }> {
    await this.init();
    const events = sessionId
      ? await this.listEventsBySession(sessionId)
      : await this.listEvents(25);

    if (events.length === 0) {
      return { summary: "No story activity recorded yet.", events: [] };
    }

    const context = events
      .slice()
      .reverse()
      .map(
        (event) =>
          `• [${event.entityLabel ?? event.entityId}] ${event.description} (${new Date(event.createdAt).toLocaleString()})`
      )
      .join("\n");

    try {
      const summary = await ModelRouter.generate(
        `You are the StoryWorld chronicler. Summarize the recent events below in 3 sentences, focusing on narrative continuity.\n${context}`
      );
      if (summary.trim()) {
        return { summary: summary.trim(), events };
      }
    } catch (error) {
      Logger.warn("WorldMemory summarization fallback", error);
    }

    const fallback = events
      .slice(0, 5)
      .map((event) => `${event.entityLabel ?? event.entityId}: ${event.description}`)
      .join("\n");
    return { summary: fallback, events };
  }

  private async ensureEntity(entity: NarrativeEntity): Promise<void> {
    await this.init();
    await this.run(
      `INSERT INTO entities (id, label, type, metadata, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         label = excluded.label,
         type = excluded.type,
         metadata = excluded.metadata,
         updated_at = excluded.updated_at`,
      [
        entity.id,
        entity.label,
        entity.type,
        serializeJson(entity.metadata ?? undefined),
        entity.updatedAt
      ]
    );
  }

  private async listEventsForEntity(entityId: string): Promise<StoryTimelineEvent[]> {
    const rows = await this.all<EventRow>(
      `SELECT id, entity_id, entity_type, description, tags, metadata, related_entities, session_id, created_at
         FROM events
        WHERE entity_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [entityId]
    );

    return rows.map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      entityType: row.entity_type as NarrativeEntityType,
      description: row.description,
      tags: parseJson<string[]>(row.tags) ?? [],
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      relatedEntities: parseJson<Array<{ entityId: string; relation: string; label?: string }>>(row.related_entities),
      sessionId: row.session_id ?? undefined,
      createdAt: row.created_at
    }));
  }

  private async listRelationships(entityId: string): Promise<NarrativeRelationship[]> {
    const rows = await this.all<LinkRow>(
      `SELECT id, from_id, to_id, relation, weight, metadata, created_at
         FROM relationships
        WHERE from_id = ? OR to_id = ?
        ORDER BY created_at DESC
        LIMIT 100`,
      [entityId, entityId]
    );

    return rows.map((row) => ({
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      relation: row.relation,
      weight: row.weight,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      createdAt: row.created_at
    }));
  }

  private async listEventsBySession(sessionId: string): Promise<StoryTimelineEvent[]> {
    const rows = await this.all<EventRow>(
      `SELECT e.id,
              e.entity_id,
              e.entity_type,
              ent.label as entity_label,
              e.description,
              e.tags,
              e.metadata,
              e.related_entities,
              e.session_id,
              e.created_at
         FROM events e
         LEFT JOIN entities ent ON ent.id = e.entity_id
        WHERE e.session_id = ?
        ORDER BY e.created_at DESC
        LIMIT 100`,
      [sessionId]
    );

    return rows.map((row) => ({
      id: row.id,
      entityId: row.entity_id,
      entityType: row.entity_type as NarrativeEntityType,
      entityLabel: row.entity_label ?? undefined,
      description: row.description,
      tags: parseJson<string[]>(row.tags) ?? [],
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      relatedEntities: parseJson<Array<{ entityId: string; relation: string; label?: string }>>(row.related_entities),
      sessionId: row.session_id ?? undefined,
      createdAt: row.created_at
    }));
  }

  private defaultLabelFor(entityId: string, entityType: NarrativeEntityType): string {
    const base = entityId.replace(/[-_]/g, " ");
    if (entityType === "scene") {
      return base ? base : "Scene";
    }
    if (entityType === "quest") {
      return base ? base : "Quest";
    }
    if (entityType === "npc") {
      return base ? base : "NPC";
    }
    return base || entityType;
  }

  // node:sqlite is synchronous; these stay async so every existing caller keeps
  // awaiting them unchanged, and a thrown SQLite error still surfaces as a rejection.
  private async run(sql: string, params: unknown[] = []): Promise<void> {
    await this.init();
    this.db?.prepare(sql).run(...params);
  }

  private async all<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    await this.init();
    return (this.db?.prepare(sql).all(...params) ?? []) as T[];
  }

  private async get<T>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    await this.init();
    return this.db?.prepare(sql).get(...params) as T | undefined;
  }
}
