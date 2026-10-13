/**
 * JarvisLibrary: everything Jarvis has asked Agent Builder to make.
 *
 * The bridge records each request that makes something (a build, an app, a
 * picture, a MediaGen image or video, a project, a research topic, a template
 * idea) with what he asked for and the ids the builder answered with. The
 * library route turns those ids into results (score and preview, the
 * pictures themselves, the video), so the owner can see in one place what
 * Jarvis asked for and what came of it.
 *
 * Kept in data/knowledge.db beside the activity log. Art jobs live only in
 * memory, so once a drawing finishes its picture ids are saved here.
 */
import { getKnowledgeDb, nowIso } from "../knowledge/KnowledgeDb.js";

export type LibraryKind = "build" | "app" | "picture" | "media" | "project" | "research" | "template";

export interface LibraryEntry {
  id: number;
  at: string;
  /** The bridge action: "build", "art.draw", "media.generate"… */
  action: string;
  kind: LibraryKind;
  title: string;
  /** What he asked for, in his words. */
  request: string;
  /** What the builder answered with: build ids, job ids, a topic id… */
  refs: string[];
  /** Finished results saved once known: picture ids, a video address. */
  results: string[];
  /** Android or Windows, for an app. */
  platform: string | null;
  /** The builder refused or failed it at once. */
  error: string | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jarvis_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  action TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  request TEXT NOT NULL,
  refs TEXT NOT NULL,
  results TEXT NOT NULL DEFAULT '[]',
  platform TEXT,
  error TEXT
);
`;

/** The bridge actions that make something, and what kind of thing. */
const MAKES: Record<string, LibraryKind> = {
  build: "build",
  build_request: "build",
  "build.continue": "build",
  "project.instruct": "build",
  "order.build": "build",
  "app.make": "app",
  "art.draw": "picture",
  "art.edit": "picture",
  "media.generate": "media",
  "project.create": "project",
  "research.start": "research",
  "research.ask": "research",
  "academy.add": "template"
};

let ready = false;
const db = () => {
  const database = getKnowledgeDb();
  if (!ready) {
    database.exec(SCHEMA);
    ready = true;
  }
  return database;
};

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const asObject = (value: unknown): Record<string, unknown> => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** The ids an answer carries, wherever the route put them. */
export const idsIn = (body: unknown): string[] => {
  const top = asObject(body);
  const ids: string[] = [];
  const add = (value: unknown) => {
    if ((typeof value === "string" && value) || typeof value === "number") ids.push(String(value));
  };
  add(top.buildId);
  add(asObject(top.build).buildId);
  for (const job of Array.isArray(top.jobs) ? top.jobs : []) add(asObject(job).id);
  for (const key of ["job", "idea", "topic", "project", "item"]) add(asObject(top[key]).id);
  if (ids.length === 0) add(top.id);
  return [...new Set(ids)];
};

type Row = Omit<LibraryEntry, "refs" | "results"> & { refs: string; results: string };
const parse = (row: Row): LibraryEntry => ({
  ...row,
  refs: JSON.parse(row.refs || "[]") as string[],
  results: JSON.parse(row.results || "[]") as string[]
});

export const JarvisLibrary = {
  /** Whether an action makes something worth keeping in the library. */
  makes(action: string): boolean {
    return action in MAKES;
  },

  /** Note a request Jarvis made and what the builder answered. Never throws. */
  record(action: string, params: Record<string, unknown>, status: number, body: unknown): LibraryEntry | null {
    const kind = MAKES[action];
    if (!kind) return null;
    try {
      const answer = asObject(body);
      let refs = idsIn(body);
      // Some answers do not repeat the id they were called with.
      for (const key of ["buildId", "topicId", "projectId", "orderId"]) {
        if (refs.length === 0 && text(params[key])) refs = [text(params[key])];
      }
      const request =
        text(params.message) || text(params.instruction) || text(params.subject) || text(params.prompt) || text(params.change) ||
        text(params.brief) || text(params.question) || text(params.text) || text(params.description) || text(params.title) || text(params.name);
      const title = (text(params.title) || text(params.name) || text(answer.projectName) || request || action).slice(0, 120);
      const error = status >= 400 ? (text(answer.error) || `The builder answered ${status}`).slice(0, 300) : null;
      const platform = kind === "app" ? text(params.platform) || null : null;
      const result = db()
        .prepare("INSERT INTO jarvis_library (at, action, kind, title, request, refs, results, platform, error) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?)")
        .run(nowIso(), action, kind, title, request.slice(0, 2000), JSON.stringify(refs), platform, error);
      return JarvisLibrary.get(Number(result.lastInsertRowid));
    } catch {
      // The library must never break the request it describes.
      return null;
    }
  },

  get(id: number): LibraryEntry | null {
    const row = db().prepare("SELECT * FROM jarvis_library WHERE id = ?").get(id) as Row | undefined;
    return row ? parse(row) : null;
  },

  list(options: { kind?: LibraryKind; limit?: number } = {}): LibraryEntry[] {
    const limit = Math.min(Math.max(options.limit ?? 60, 1), 300);
    const rows = (
      options.kind
        ? db().prepare("SELECT * FROM jarvis_library WHERE kind = ? ORDER BY id DESC LIMIT ?").all(options.kind, limit)
        : db().prepare("SELECT * FROM jarvis_library ORDER BY id DESC LIMIT ?").all(limit)
    ) as Row[];
    return rows.map(parse);
  },

  /** The build ids already in the library, so older builds he started are not listed twice. */
  buildRefs(): Set<string> {
    const rows = db().prepare("SELECT refs FROM jarvis_library WHERE kind IN ('build', 'app')").all() as Array<{ refs: string }>;
    return new Set(rows.flatMap((row) => JSON.parse(row.refs || "[]") as string[]));
  },

  /** Save what a request finally made (picture ids, a video address). */
  saveResults(id: number, results: string[]): void {
    db().prepare("UPDATE jarvis_library SET results = ? WHERE id = ?").run(JSON.stringify(results), id);
  },

  remove(id: number): boolean {
    return db().prepare("DELETE FROM jarvis_library WHERE id = ?").run(id).changes > 0;
  }
};
