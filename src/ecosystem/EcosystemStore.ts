/**
 * EcosystemStore — what the builder knows about every project on this machine.
 *
 * Lives in the same SQLite file as research and lessons (data/knowledge.db), so
 * one database holds everything the app has learned: the projects themselves,
 * the issues found in them, and a rolling activity log used to brief an agent
 * that is picking the work up cold.
 */
import { getKnowledgeDb, indexKnowledge, nowIso, toKey, unindexKnowledge } from "../knowledge/KnowledgeDb.js";

export type IssueSource = "jarvis" | "maintenance" | "user" | "build";
export type IssueSeverity = "info" | "warning" | "error";
export type IssueStatus = "open" | "fixing" | "resolved" | "dismissed";

export interface EcosystemProject {
  id: string;
  name: string;
  path: string;
  root: string;
  kind: string;
  description: string | null;
  stack: string[];
  scripts: Record<string, string>;
  gitBranch: string | null;
  gitRemote: string | null;
  gitDirty: number;
  gitAhead: number;
  gitBehind: number;
  lastCommitAt: string | null;
  lastCommitSubject: string | null;
  hasClaudeMd: boolean;
  readmeExcerpt: string | null;
  scannedAt: string;
}

export interface EcosystemIssue {
  id: number;
  projectId: string | null;
  source: IssueSource;
  severity: IssueSeverity;
  title: string;
  detail: string | null;
  status: IssueStatus;
  buildId: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EcosystemEvent {
  id: number;
  projectId: string | null;
  kind: string;
  message: string;
  createdAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS eco_projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  path TEXT NOT NULL UNIQUE,
  root TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'unknown',
  description TEXT,
  stack TEXT NOT NULL DEFAULT '[]',
  scripts TEXT NOT NULL DEFAULT '{}',
  git_branch TEXT,
  git_remote TEXT,
  git_dirty INTEGER NOT NULL DEFAULT 0,
  git_ahead INTEGER NOT NULL DEFAULT 0,
  git_behind INTEGER NOT NULL DEFAULT 0,
  last_commit_at TEXT,
  last_commit_subject TEXT,
  has_claude_md INTEGER NOT NULL DEFAULT 0,
  readme_excerpt TEXT,
  scanned_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eco_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT REFERENCES eco_projects(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error',
  title TEXT NOT NULL,
  detail TEXT,
  signature_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  build_id TEXT,
  resolution TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, signature_key)
);
CREATE INDEX IF NOT EXISTS idx_eco_issues_status ON eco_issues(status, severity);

CREATE TABLE IF NOT EXISTS eco_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_eco_events_time ON eco_events(id DESC);
`;

const EVENTS_KEPT = 1000;

let ready = false;
const db = () => {
  const database = getKnowledgeDb();
  if (!ready) {
    database.exec(SCHEMA);
    ready = true;
  }
  return database;
};

type ProjectRow = {
  id: string;
  name: string;
  path: string;
  root: string;
  kind: string;
  description: string | null;
  stack: string;
  scripts: string;
  git_branch: string | null;
  git_remote: string | null;
  git_dirty: number;
  git_ahead: number;
  git_behind: number;
  last_commit_at: string | null;
  last_commit_subject: string | null;
  has_claude_md: number;
  readme_excerpt: string | null;
  scanned_at: string;
};

type IssueRow = {
  id: number;
  project_id: string | null;
  source: IssueSource;
  severity: IssueSeverity;
  title: string;
  detail: string | null;
  status: IssueStatus;
  build_id: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
};

const parseJson = <T>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const mapProject = (row: ProjectRow): EcosystemProject => ({
  id: row.id,
  name: row.name,
  path: row.path,
  root: row.root,
  kind: row.kind,
  description: row.description,
  stack: parseJson<string[]>(row.stack, []),
  scripts: parseJson<Record<string, string>>(row.scripts, {}),
  gitBranch: row.git_branch,
  gitRemote: row.git_remote,
  gitDirty: row.git_dirty,
  gitAhead: row.git_ahead,
  gitBehind: row.git_behind,
  lastCommitAt: row.last_commit_at,
  lastCommitSubject: row.last_commit_subject,
  hasClaudeMd: row.has_claude_md === 1,
  readmeExcerpt: row.readme_excerpt,
  scannedAt: row.scanned_at
});

const mapIssue = (row: IssueRow): EcosystemIssue => ({
  id: row.id,
  projectId: row.project_id,
  source: row.source,
  severity: row.severity,
  title: row.title,
  detail: row.detail,
  status: row.status,
  buildId: row.build_id,
  resolution: row.resolution,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export const EcosystemStore = {
  upsertProject(project: Omit<EcosystemProject, "scannedAt">): EcosystemProject {
    const now = nowIso();
    db()
      .prepare(
        `INSERT INTO eco_projects (
           id, name, path, root, kind, description, stack, scripts, git_branch, git_remote,
           git_dirty, git_ahead, git_behind, last_commit_at, last_commit_subject,
           has_claude_md, readme_excerpt, scanned_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, path = excluded.path, root = excluded.root, kind = excluded.kind,
           description = excluded.description, stack = excluded.stack, scripts = excluded.scripts,
           git_branch = excluded.git_branch, git_remote = excluded.git_remote,
           git_dirty = excluded.git_dirty, git_ahead = excluded.git_ahead, git_behind = excluded.git_behind,
           last_commit_at = excluded.last_commit_at, last_commit_subject = excluded.last_commit_subject,
           has_claude_md = excluded.has_claude_md, readme_excerpt = excluded.readme_excerpt,
           scanned_at = excluded.scanned_at, updated_at = excluded.updated_at`
      )
      .run(
        project.id,
        project.name,
        project.path,
        project.root,
        project.kind,
        project.description,
        JSON.stringify(project.stack),
        JSON.stringify(project.scripts),
        project.gitBranch,
        project.gitRemote,
        project.gitDirty,
        project.gitAhead,
        project.gitBehind,
        project.lastCommitAt,
        project.lastCommitSubject,
        project.hasClaudeMd ? 1 : 0,
        project.readmeExcerpt,
        now,
        now,
        now
      );

    // Make the project findable through the same search as research and lessons.
    unindexKnowledge("project", project.id);
    indexKnowledge(
      "project",
      project.id,
      null,
      project.name,
      [project.description ?? "", project.stack.join(" "), project.readmeExcerpt ?? "", project.path].join("\n")
    );

    return this.getProject(project.id) as EcosystemProject;
  },

  getProject(id: string): EcosystemProject | null {
    const row = db().prepare("SELECT * FROM eco_projects WHERE id = ?").get(id) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  },

  findProjectByPath(path: string): EcosystemProject | null {
    const row = db().prepare("SELECT * FROM eco_projects WHERE path = ?").get(path) as ProjectRow | undefined;
    return row ? mapProject(row) : null;
  },

  listProjects(): EcosystemProject[] {
    const rows = db()
      .prepare("SELECT * FROM eco_projects ORDER BY (last_commit_at IS NULL), last_commit_at DESC")
      .all() as ProjectRow[];
    return rows.map(mapProject);
  },

  /**
   * Drop projects that were expected under the given roots but are no longer
   * there. Scoped to those roots on purpose: scanning one root must not evict
   * projects registered under another.
   */
  removeMissingProjects(keepPaths: string[], scannedRoots: string[]): number {
    if (scannedRoots.length === 0) return 0;
    const rootPlaceholders = scannedRoots.map(() => "?").join(", ");
    // With nothing found under these roots every registered project there is
    // gone: "path NOT IN (NULL)" is NULL, i.e. matches nothing, so spell that
    // case out rather than silently keeping stale rows.
    const pathClause =
      keepPaths.length > 0 ? `AND path NOT IN (${keepPaths.map(() => "?").join(", ")})` : "";
    const where = `root IN (${rootPlaceholders}) ${pathClause}`;
    const gone = db()
      .prepare(`SELECT id FROM eco_projects WHERE ${where}`)
      .all(...scannedRoots, ...keepPaths) as Array<{ id: string }>;
    for (const row of gone) unindexKnowledge("project", row.id);
    db().prepare(`DELETE FROM eco_projects WHERE ${where}`).run(...scannedRoots, ...keepPaths);
    return gone.length;
  },

  /**
   * Record an issue. Deduplicated per project on a normalised signature, so the
   * same failure reported on every sweep (or repeatedly by Jarvis) stays one row
   * instead of burying the list.
   */
  recordIssue(input: {
    projectId: string | null;
    source: IssueSource;
    severity?: IssueSeverity;
    title: string;
    detail?: string | null;
    signature?: string;
  }): EcosystemIssue {
    const now = nowIso();
    const signatureKey = toKey(input.signature ?? input.title);
    db()
      .prepare(
        `INSERT INTO eco_issues (project_id, source, severity, title, detail, signature_key, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
         ON CONFLICT(project_id, signature_key) DO UPDATE SET
           detail = excluded.detail,
           severity = excluded.severity,
           updated_at = excluded.updated_at,
           status = CASE WHEN eco_issues.status IN ('resolved', 'dismissed') THEN 'open' ELSE eco_issues.status END`
      )
      .run(
        input.projectId,
        input.source,
        input.severity ?? "error",
        input.title,
        input.detail ?? null,
        signatureKey,
        now,
        now
      );

    const row = db()
      .prepare("SELECT * FROM eco_issues WHERE project_id IS ? AND signature_key = ?")
      .get(input.projectId, signatureKey) as IssueRow;
    return mapIssue(row);
  },

  getIssue(id: number): EcosystemIssue | null {
    const row = db().prepare("SELECT * FROM eco_issues WHERE id = ?").get(id) as IssueRow | undefined;
    return row ? mapIssue(row) : null;
  },

  listIssues(filter: { status?: IssueStatus; projectId?: string; limit?: number } = {}): EcosystemIssue[] {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = db()
      .prepare(
        `SELECT * FROM eco_issues ${where}
         ORDER BY CASE severity WHEN 'error' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, updated_at DESC
         LIMIT ?`
      )
      .all(...params, filter.limit ?? 100) as IssueRow[];
    return rows.map(mapIssue);
  },

  updateIssue(
    id: number,
    patch: { status?: IssueStatus; buildId?: string | null; resolution?: string | null }
  ): EcosystemIssue | null {
    const existing = this.getIssue(id);
    if (!existing) return null;
    db()
      .prepare("UPDATE eco_issues SET status = ?, build_id = ?, resolution = ?, updated_at = ? WHERE id = ?")
      .run(
        patch.status ?? existing.status,
        patch.buildId === undefined ? existing.buildId : patch.buildId,
        patch.resolution === undefined ? existing.resolution : patch.resolution,
        nowIso(),
        id
      );
    return this.getIssue(id);
  },

  recordEvent(projectId: string | null, kind: string, message: string): void {
    db()
      .prepare("INSERT INTO eco_events (project_id, kind, message, created_at) VALUES (?, ?, ?, ?)")
      .run(projectId, kind, message.slice(0, 2000), nowIso());
    db()
      .prepare(`DELETE FROM eco_events WHERE id <= (SELECT MAX(id) - ${EVENTS_KEPT} FROM eco_events)`)
      .run();
  },

  listEvents(limit = 50, projectId?: string): EcosystemEvent[] {
    const rows = projectId
      ? db().prepare("SELECT * FROM eco_events WHERE project_id = ? ORDER BY id DESC LIMIT ?").all(projectId, limit)
      : db().prepare("SELECT * FROM eco_events ORDER BY id DESC LIMIT ?").all(limit);
    return (
      rows as Array<{ id: number; project_id: string | null; kind: string; message: string; created_at: string }>
    ).map((row) => ({
      id: row.id,
      projectId: row.project_id,
      kind: row.kind,
      message: row.message,
      createdAt: row.created_at
    }));
  },

  counts(): { projects: number; openIssues: number; errors: number } {
    const projects = (db().prepare("SELECT COUNT(*) AS c FROM eco_projects").get() as { c: number }).c;
    const openIssues = (
      db().prepare("SELECT COUNT(*) AS c FROM eco_issues WHERE status IN ('open','fixing')").get() as { c: number }
    ).c;
    const errors = (
      db()
        .prepare("SELECT COUNT(*) AS c FROM eco_issues WHERE status IN ('open','fixing') AND severity = 'error'")
        .get() as { c: number }
    ).c;
    return { projects, openIssues, errors };
  }
};
