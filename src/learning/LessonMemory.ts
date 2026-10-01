/**
 * LessonMemory - the build pipeline's memory of its own mistakes.
 *
 * When a repair turns a failing check green, the failure's signature and a
 * one-sentence generalised lesson are stored. Later builds retrieve relevant
 * lessons into their prompts and report back whether the check then passed,
 * so every lesson carries a track record. Lessons that keep not helping sink
 * out of retrieval; lessons that work rise. That feedback loop — not a
 * hardcoded list of hints — is what makes the builder improve over time.
 */
import {
  contentTokens,
  getKnowledgeDb,
  indexKnowledge,
  nowIso,
  toFtsQuery,
  toKey,
  unindexKnowledge
} from "../knowledge/KnowledgeDb.js";

export type LessonScope = "build" | "research";

export interface Lesson {
  id: number;
  scope: LessonScope;
  signature: string;
  lesson: string;
  example: string | null;
  timesApplied: number;
  timesHelped: number;
  timesFailed: number;
  /** Laplace-smoothed success rate: (helped + 1) / (applied + 2). */
  utility: number;
  createdAt: string;
  updatedAt: string;
  lastAppliedAt: string | null;
}

type LessonRow = {
  id: number;
  scope: LessonScope;
  signature: string;
  lesson: string;
  example: string | null;
  times_applied: number;
  times_helped: number;
  times_failed: number;
  created_at: string;
  updated_at: string;
  last_applied_at: string | null;
};

const mapLesson = (row: LessonRow): Lesson => ({
  id: row.id,
  scope: row.scope,
  signature: row.signature,
  lesson: row.lesson,
  example: row.example,
  timesApplied: row.times_applied,
  timesHelped: row.times_helped,
  timesFailed: row.times_failed,
  utility: (row.times_helped + 1) / (row.times_applied + 2),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastAppliedAt: row.last_applied_at
});

/** Once a lesson has been tried this often, a low success rate means it's not worth prompt space. */
const RETIRE_AFTER_APPLICATIONS = 4;
const RETIRE_BELOW_UTILITY = 0.25;

/**
 * Words present in nearly every failing check, plus file-name fragments. Matching
 * on them retrieved every lesson for every test failure — and a lesson retrieved
 * into a repair gets credit when that repair works, so unrelated lessons were
 * being rewarded for fixes they had nothing to do with.
 */
const GENERIC_TOKENS = new Set([
  "test", "tests", "testing", "failed", "fail", "fails", "failure", "error", "errors", "run", "runs", "running",
  "check", "checks", "npm", "file", "files", "module", "modules", "found", "cannot", "expected", "received",
  "exit", "code", "command", "script", "line", "lines", "path", "index", "src", "lib", "dist", "app", "spec",
  "node", "json", "duration", "passed", "pass", "anonymous", "object"
]);

/** Light stemming so "functions" matches "function" and "imported" matches "import". */
const stem = (token: string): string => (token.length > 4 ? token.replace(/(ing|ed|es|s)$/, "") : token);

const specificTokens = (text: string): Set<string> =>
  new Set(contentTokens(text).filter((token) => !GENERIC_TOKENS.has(token)).map(stem));

// Failures observed in this project's own live runs, seeded so a fresh install
// starts with what has already been learned the hard way.
const SEED_LESSONS: Array<{ signature: string; lesson: string }> = [
  {
    signature: "test: process.exit called — module runs its CLI when imported by a test",
    lesson:
      "Guard CLI entry-point execution (argument parsing, process.exit) so importing the module in a test does not run the program: " +
      "`if (require.main === module)` in CommonJS, `if (import.meta.url === \`file://${process.argv[1]}\`)` in ES modules, and export the functions separately."
  },
  {
    signature: "test: require is not defined in ES module scope",
    lesson:
      "Do not use require, module.exports or require.main in a file that uses import/export or in a package with \"type\": \"module\" — use the ES module equivalents."
  },
  {
    signature: "test: No test files found",
    lesson: "Name test files *.test.js or *.spec.js, or put them in a __tests__/ directory, so the test runner discovers them."
  },
  {
    signature: "test: ERR_MODULE_NOT_FOUND cannot find module relative import without extension",
    lesson: "In ES modules, relative imports must include the file extension: import { add } from './index.js', not './index'."
  },
  {
    signature: "test: importing describe/it/expect from 'jest' in a vitest project",
    lesson: "Do not import describe/it/expect from 'jest'. With vitest globals enabled they need no import; otherwise import them from 'vitest'."
  }
];

export const LessonMemory = {
  /** Insert the seed lessons that don't exist yet. Safe to call on every boot. */
  seed(): number {
    const db = getKnowledgeDb();
    let inserted = 0;
    const now = nowIso();
    for (const seed of SEED_LESSONS) {
      const result = db
        .prepare(
          `INSERT OR IGNORE INTO lessons (scope, signature, signature_key, lesson, created_at, updated_at)
           VALUES ('build', ?, ?, ?, ?, ?)`
        )
        .run(seed.signature, toKey(seed.signature), seed.lesson, now, now);
      if (result.changes > 0) {
        indexKnowledge("lesson", Number(result.lastInsertRowid), null, seed.signature, `${seed.signature}\n${seed.lesson}`);
        inserted += 1;
      }
    }
    return inserted;
  },

  /**
   * Reduce raw check output to a stable failure signature: the first concrete
   * error lines, with paths, durations, numbers and colour codes normalised
   * away, so the same mistake in a different project maps to the same lesson.
   */
  errorSignature(checkName: string, output: string): string {
    const lines = output
      .replace(/\u001b?\[[0-9;]*m/g, "")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^[❯›×✗✘●→\s-]+/u, "").trim())
      .filter(Boolean)
      // Runner chrome rather than errors: stack frames, npm notices, "console.error"
      // labels, and per-file summaries like "app/index.test.js (2 tests | 1 failed) 9ms".
      .filter(
        (line) =>
          !/^at\s/.test(line) &&
          !/^npm (warn|notice)/i.test(line) &&
          !/^console\.(error|warn|log|info)$/i.test(line) &&
          !/\(\s*\d+\s+tests?\b/i.test(line) &&
          !/^(Test Files|Tests|Duration|Start at|Snapshots|RUN)\b/.test(line)
      );
    // A concrete error message says what went wrong; words like "failed" only say that something did.
    const strong = lines.filter((line) =>
      /(is not a function|is not defined|not found|cannot|unexpected|expected|exception|process\.exit|no test files|syntaxerror|typeerror|referenceerror|error:|ERR_[A-Z_]+|TS\d{4})/i.test(
        line
      )
    );
    const weak = lines.filter((line) => /(error|failed)/i.test(line));
    const picked = (strong.length > 0 ? strong : weak.length > 0 ? weak : lines).slice(0, 2).join(" | ");
    const normalized = picked
      .replace(/[a-zA-Z]:[\\/][^\s'"`)]+/g, "<path>")
      .replace(/(?:file:\/\/)?\/(?:[\w.@-]+\/)+[\w.@-]+/g, "<path>")
      .replace(/(?:\.{1,2}\/)(?:[\w.@-]+\/)*[\w.@-]+/g, "<file>")
      .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/g, "<duration>")
      .replace(/\b\d+(?::\d+)*\b/g, "<n>")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 220);
    return `${checkName}: ${normalized || "failed with no output"}`;
  },

  /** Record a confirmed fix. A repeat of a known failure reinforces its lesson instead of duplicating it. */
  recordFix(scope: LessonScope, signature: string, lesson: string, example: string | null): Lesson {
    const db = getKnowledgeDb();
    const key = toKey(signature);
    const now = nowIso();
    const existing = db.prepare("SELECT * FROM lessons WHERE scope = ? AND signature_key = ?").get(scope, key) as
      | LessonRow
      | undefined;

    if (existing) {
      const current = mapLesson(existing);
      // Keep whichever wording has the better record: replace only a lesson that has been underperforming.
      const replaceText = current.utility < 0.5 && lesson.trim().length > 0;
      db.prepare(
        `UPDATE lessons SET times_helped = times_helped + 1, times_applied = times_applied + 1,
           lesson = ?, example = COALESCE(?, example), updated_at = ?
         WHERE id = ?`
      ).run(replaceText ? lesson : existing.lesson, example, now, existing.id);
      if (replaceText) {
        unindexKnowledge("lesson", existing.id);
        indexKnowledge("lesson", existing.id, null, existing.signature, `${existing.signature}\n${lesson}`);
      }
      return mapLesson(db.prepare("SELECT * FROM lessons WHERE id = ?").get(existing.id) as LessonRow);
    }

    // A confirmed fix counts as one successful application.
    const result = db
      .prepare(
        `INSERT INTO lessons (scope, signature, signature_key, lesson, example, times_applied, times_helped, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)`
      )
      .run(scope, signature, key, lesson, example, now, now);
    const id = Number(result.lastInsertRowid);
    indexKnowledge("lesson", id, null, signature, `${signature}\n${lesson}`);
    return mapLesson(db.prepare("SELECT * FROM lessons WHERE id = ?").get(id) as LessonRow);
  },

  /**
   * A rule taught from research rather than learned from a fix: it starts with
   * no track record (utility 0.5) and earns one only from the builds it is
   * given to. Teaching the same rule again changes nothing.
   */
  recordTaught(scope: LessonScope, signature: string, lesson: string, example: string | null): { lesson: Lesson; created: boolean } {
    const db = getKnowledgeDb();
    const key = toKey(signature);
    const existing = db.prepare("SELECT * FROM lessons WHERE scope = ? AND signature_key = ?").get(scope, key) as LessonRow | undefined;
    if (existing) return { lesson: mapLesson(existing), created: false };
    const now = nowIso();
    const result = db
      .prepare(
        `INSERT INTO lessons (scope, signature, signature_key, lesson, example, times_applied, times_helped, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)`
      )
      .run(scope, signature, key, lesson, example, now, now);
    const id = Number(result.lastInsertRowid);
    indexKnowledge("lesson", id, null, signature, `${signature}\n${lesson}`);
    return { lesson: mapLesson(db.prepare("SELECT * FROM lessons WHERE id = ?").get(id) as LessonRow), created: true };
  },

  /**
   * Lessons relevant to a failure or task description, best match first. BM25
   * ranks; a precision gate then requires a real match — a specific word shared
   * with the lesson's signature, or two shared with its advice — so a lesson is
   * only retrieved (and only credited) when it plausibly concerns this failure.
   * Retired lessons are excluded.
   */
  relevant(scope: LessonScope, query: string, limit = 4): Lesson[] {
    const match = toFtsQuery(query);
    if (!match) return [];
    const rows = getKnowledgeDb()
      .prepare(
        `SELECT l.*, bm25(knowledge_fts) AS score
         FROM knowledge_fts
         JOIN lessons l ON l.id = CAST(knowledge_fts.ref_id AS INTEGER)
         WHERE knowledge_fts MATCH ? AND knowledge_fts.kind = 'lesson' AND l.scope = ?
         ORDER BY score
         LIMIT 20`
      )
      .all(match, scope) as Array<LessonRow & { score: number }>;

    // Paths in raw check output ("E:/Projects/...") contribute words that have nothing
    // to do with the failure — a lesson once matched "project" from a directory name.
    const queryTokens = specificTokens(
      query.replace(/[a-zA-Z]:[\\/][^\s'"`)]+/g, " ").replace(/(?:file:\/\/)?\/(?:[\w.@-]+\/)+[\w.@-]+/g, " ")
    );
    const sharedWith = (text: string): number => [...specificTokens(text)].filter((token) => queryTokens.has(token)).length;

    return rows
      .map(mapLesson)
      .filter((lesson) => !(lesson.timesApplied >= RETIRE_AFTER_APPLICATIONS && lesson.utility < RETIRE_BELOW_UTILITY))
      .filter((lesson) => sharedWith(lesson.signature) >= 1 || sharedWith(lesson.lesson) >= 2)
      .slice(0, limit);
  },

  markApplied(ids: number[]): void {
    if (ids.length === 0) return;
    const db = getKnowledgeDb();
    const statement = db.prepare("UPDATE lessons SET times_applied = times_applied + 1, last_applied_at = ? WHERE id = ?");
    const now = nowIso();
    db.transaction(() => ids.forEach((id) => statement.run(now, id)))();
  },

  recordOutcome(ids: number[], helped: boolean): void {
    if (ids.length === 0) return;
    const db = getKnowledgeDb();
    const column = helped ? "times_helped" : "times_failed";
    const statement = db.prepare(`UPDATE lessons SET ${column} = ${column} + 1, updated_at = ? WHERE id = ?`);
    const now = nowIso();
    db.transaction(() => ids.forEach((id) => statement.run(now, id)))();
  },

  list(scope?: LessonScope, limit = 200): Lesson[] {
    const db = getKnowledgeDb();
    const rows = (
      scope
        ? db.prepare("SELECT * FROM lessons WHERE scope = ? ORDER BY updated_at DESC LIMIT ?").all(scope, limit)
        : db.prepare("SELECT * FROM lessons ORDER BY updated_at DESC LIMIT ?").all(limit)
    ) as LessonRow[];
    return rows.map(mapLesson).sort((a, b) => b.utility - a.utility);
  },

  remove(id: number): boolean {
    const removed = getKnowledgeDb().prepare("DELETE FROM lessons WHERE id = ?").run(id).changes > 0;
    if (removed) unindexKnowledge("lesson", id);
    return removed;
  },

  formatForPrompt(lessons: Lesson[]): string {
    return lessons
      .map((lesson, index) => `${index + 1}. ${lesson.lesson} (worked ${lesson.timesHelped} of ${lesson.timesApplied} times)`)
      .join("\n");
  }
};
