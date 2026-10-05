/**
 * ExemplarMemory — the builder's memory of what it got right.
 *
 * LessonMemory remembers mistakes: a failing check and the fix that cleared
 * it. That teaches a build to avoid errors, never what a good answer looks
 * like. A small local model asked for "a fun game with progression" writes a
 * counter, because nothing shows it a game engine with levels, scoring and
 * winning and losing in a few hundred lines it could follow.
 *
 * So every new app that passes every check — completeness included — is kept
 * here: what was asked for, the shape of what was built, and its core code.
 * The next build with a similar brief gets the closest one as a worked
 * example. Each use is scored by whether that build then passed, and an
 * example that keeps not helping stops being shown. The catalogue templates'
 * self-contained engines (game.ts, cart.ts, slots.ts…) seed it, so it helps
 * from the first build.
 */
import fs from "fs";
import path from "path";

import { contentTokens, getKnowledgeDb, indexKnowledge, nowIso, toKey, unindexKnowledge } from "../knowledge/KnowledgeDb.js";

export interface Exemplar {
  id: number;
  /** "seed:<template>" for a catalogue engine, "build" for an app this builder made. */
  origin: string;
  title: string;
  brief: string;
  /** Files and what each exports. */
  outline: string;
  /** The core code, already cut to fit a prompt. */
  sample: string;
  score: number;
  timesUsed: number;
  timesPassed: number;
  createdAt: string;
}

type Row = {
  id: number;
  origin: string;
  title: string;
  brief: string;
  brief_key: string;
  outline: string;
  sample: string;
  score: number;
  times_used: number;
  times_passed: number;
  created_at: string;
  updated_at: string;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS build_exemplars (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin TEXT NOT NULL,
  title TEXT NOT NULL,
  brief TEXT NOT NULL,
  brief_key TEXT NOT NULL UNIQUE,
  outline TEXT NOT NULL,
  sample TEXT NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,
  times_used INTEGER NOT NULL DEFAULT 0,
  times_passed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`;

/** Prompt room an example may take: about 2k tokens, so the project and the answer still fit a 16k window. */
const MAX_SAMPLE_CHARS = 6_500;
/** Below this score (one rare word in the brief's opening, or two elsewhere) an app is not similar enough to help. */
const MIN_SIMILARITY = 2.5;
/** After this many uses, an example whose builds mostly failed is not shown again. */
const RETIRE_AFTER_USES = 4;
const RETIRE_BELOW_RATE = 0.25;

const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|lib)(\/|$)/;
const APP_FILE = /\.(t|j)sx?$/;
const TEST_FILE = /\.(test|spec)\.(t|j)sx?$/;

let ready = false;
const db = () => {
  const database = getKnowledgeDb();
  if (!ready) {
    database.exec(SCHEMA);
    ready = true;
  }
  return database;
};

const fromRow = (row: Row): Exemplar => ({
  id: row.id,
  origin: row.origin,
  title: row.title,
  brief: row.brief,
  outline: row.outline,
  sample: row.sample,
  score: row.score,
  timesUsed: row.times_used,
  timesPassed: row.times_passed,
  createdAt: row.created_at
});

/** The part of a brief that says what to build: no research notes, no boilerplate rules. */
const briefCore = (brief: string): string =>
  brief
    .split(/\n(?:What our research confirmed|This is going to a real customer|Rules that keep)/i)[0]
    .trim()
    .slice(0, 1_500);

/** Words that say nothing about what kind of app it is. */
const FILLER = new Set([
  "build", "website", "web", "webapp", "app", "apps", "nice", "easy", "fun", "simple", "make", "want", "need", "like",
  "page", "pages", "site", "browser", "online", "customer", "customers", "user", "users", "mobile", "phone", "work",
  "anywhere", "anytime", "people", "everything", "thing", "things", "first", "fast", "clear", "state", "states"
]);

/**
 * The opening of a brief — its title line and "What it is for" — which says
 * what kind of app it is. A word there counts double: "game" in "a fun phone
 * game" means more than "Menu" in a list of screens.
 */
const briefHead = (brief: string): string =>
  briefCore(brief)
    .split(/\n\s*\n/)
    .filter((part) => !/^(who uses it|pages|it must have|look and feel|data and|quality bar|do not)\b/i.test(part.trim()))
    .slice(0, 2)
    .join("\n");

/** Content words, lightly stemmed so "scores" meets "score" and "levels" meets "level". */
const stems = (text: string): Set<string> =>
  new Set(
    contentTokens(text)
      .filter((token) => !FILLER.has(token))
      .map((token) => {
        // Twice, so "bookings" reaches "book" like "booking" does.
        let stem = token;
        for (let i = 0; i < 2 && stem.length > 4; i += 1) stem = stem.replace(/(ing|ed|es|s)$/, "");
        return stem;
      })
  );

/**
 * How alike a brief and an example are: the words they share, each weighted by
 * how rare it is among all the examples (a word only one example has says far
 * more than one most share), and doubled when it is in the brief's opening.
 * Plain overlap ratios failed here: a real brief runs to fifty words of look,
 * feel and quality bar, which drowned the one word ("game") that mattered.
 */
const similarity = (brief: Set<string>, head: Set<string>, example: Set<string>, documentFrequency: Map<string, number>, total: number): number => {
  let score = 0;
  for (const token of brief) {
    if (!example.has(token)) continue;
    const idf = Math.log((total + 1) / ((documentFrequency.get(token) ?? 0) + 0.5));
    score += idf * (head.has(token) ? 2 : 1);
  }
  return score;
};

const exportsOf = (text: string): string[] =>
  Array.from(text.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|class|interface|type|enum)\s+(\w+)/g))
    .map((m) => m[1])
    .slice(0, 10);

/** The app's own source files (no tests, no kit), path → content. */
const sourceFiles = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (SKIP_DIR.test(rel)) continue;
      if (entry.isDirectory()) walk(full);
      else if (APP_FILE.test(entry.name) && !TEST_FILE.test(entry.name) && !entry.name.endsWith(".d.ts") && rel !== "src/main.tsx") {
        out[rel] = fs.readFileSync(full, "utf8");
      }
    }
  };
  walk(path.join(root, "src"));
  return out;
};

/**
 * The code worth showing, within budget: the logic modules first (plain .ts —
 * the rules, which is what a small model leaves out), then App.tsx.
 */
const sampleOf = (files: Record<string, string>): string => {
  const order = Object.keys(files).sort((a, b) => {
    const rank = (file: string) => (file.endsWith(".ts") ? 0 : file.endsWith("App.tsx") ? 1 : 2);
    return rank(a) - rank(b) || files[b].length - files[a].length;
  });
  let used = 0;
  const parts: string[] = [];
  for (const file of order) {
    if (used >= MAX_SAMPLE_CHARS) break;
    const room = MAX_SAMPLE_CHARS - used;
    if (room < 600) break;
    const body = files[file].length > room ? `${files[file].slice(0, room)}\n// …(cut)` : files[file];
    parts.push(`FILE: ${file}\n\`\`\`\n${body}\n\`\`\``);
    used += body.length;
  }
  return parts.join("\n\n");
};

const outlineOf = (files: Record<string, string>): string =>
  Object.entries(files)
    .map(([file, text]) => {
      const names = exportsOf(text);
      return `- ${file} (${text.split("\n").length} lines${names.length ? `; exports ${names.join(", ")}` : ""})`;
    })
    .join("\n");

const upsert = (origin: string, title: string, brief: string, outline: string, sample: string, score: number): number => {
  const key = toKey(`${origin} ${briefCore(brief)}`);
  const now = nowIso();
  const existing = db().prepare("SELECT id FROM build_exemplars WHERE brief_key = ?").get(key) as { id: number } | undefined;
  if (existing) {
    db()
      .prepare("UPDATE build_exemplars SET title = ?, brief = ?, outline = ?, sample = ?, score = ?, updated_at = ? WHERE id = ?")
      .run(title, briefCore(brief), outline, sample, score, now, existing.id);
    unindexKnowledge("exemplar", existing.id);
    indexKnowledge("exemplar", existing.id, null, title, briefCore(brief));
    return existing.id;
  }
  const result = db()
    .prepare(
      `INSERT INTO build_exemplars (origin, title, brief, brief_key, outline, sample, score, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(origin, title, briefCore(brief), key, outline, sample, score, now, now);
  const id = Number(result.lastInsertRowid);
  indexKnowledge("exemplar", id, null, title, briefCore(brief));
  return id;
};

export const ExemplarMemory = {
  /**
   * Seed from the catalogue: each template's self-contained engine (a src/*.ts
   * module that imports nothing from the template's kit) under the template's
   * own description. Safe to call on every boot; unchanged seeds stay as they are.
   */
  seedFromTemplates(sitesDir: string): number {
    let seeded = 0;
    for (const id of fs.existsSync(sitesDir) ? fs.readdirSync(sitesDir) : []) {
      const metaPath = path.join(sitesDir, id, "template.json");
      if (!fs.existsSync(metaPath)) continue;
      let meta: { name?: string; description?: string; starter?: boolean };
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      } catch {
        continue;
      }
      if (meta.starter || !meta.name) continue;
      const engines: Record<string, string> = {};
      const src = path.join(sitesDir, id, "src");
      for (const name of fs.existsSync(src) ? fs.readdirSync(src) : []) {
        if (!/\.ts$/.test(name) || /\.(test|d)\.ts$/.test(name) || name === "content.ts") continue;
        const text = fs.readFileSync(path.join(src, name), "utf8");
        // Only code that stands alone: an engine that imports the kit would teach the kit's imports.
        if (/from\s+["']\.\/(lib|content)/.test(text) || text.split("\n").length < 25) continue;
        engines[`src/${name}`] = text;
      }
      if (Object.keys(engines).length === 0) continue;
      upsert(`seed:${id}`, meta.name, `${meta.name}. ${meta.description ?? ""}`, outlineOf(engines), sampleOf(engines), 100);
      seeded += 1;
    }
    return seeded;
  },

  /** Keep a new app that passed every check, so the next similar brief can follow it. */
  recordSuccess(root: string, title: string, brief: string, score: number): number | null {
    const files = sourceFiles(root);
    if (Object.keys(files).length === 0) return null;
    return upsert("build", title, brief, outlineOf(files), sampleOf(files), score);
  },

  /** The closest example for a brief, or null when nothing is close enough or worth showing. */
  relevant(brief: string): Exemplar | null {
    const wanted = stems(briefCore(brief));
    const head = stems(briefHead(brief));
    if (wanted.size === 0) return null;
    // Every example is scored: there are tens of them, not millions, and the
    // rarity weights need them all anyway.
    const rows = db().prepare("SELECT * FROM build_exemplars").all() as Row[];
    const words = new Map(rows.map((row) => [row.id, stems(`${row.title} ${row.brief}`)]));
    const documentFrequency = new Map<string, number>();
    for (const set of words.values()) for (const token of set) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    let best: { exemplar: Exemplar; score: number } | null = null;
    for (const row of rows) {
      if (row.times_used >= RETIRE_AFTER_USES && (row.times_passed + 1) / (row.times_used + 2) < RETIRE_BELOW_RATE) continue;
      // A real build of this kind of app beats a catalogue seed at equal similarity.
      const score = similarity(wanted, head, words.get(row.id)!, documentFrequency, rows.length) * (row.origin === "build" ? 1.15 : 1);
      if (score >= MIN_SIMILARITY && (!best || score > best.score)) best = { exemplar: fromRow(row), score };
    }
    return best?.exemplar ?? null;
  },

  /**
   * A catalogue example's engine files, read whole from the template (the
   * prompt sample may be cut): tested code a new app can start from instead of
   * rewriting it from a description. Empty for an app this builder made, whose
   * code fitted its own brief, not this one.
   */
  engineFiles(exemplar: Exemplar, sitesDir: string): Record<string, string> {
    const id = /^seed:(.+)$/.exec(exemplar.origin)?.[1];
    if (!id) return {};
    const out: Record<string, string> = {};
    for (const match of exemplar.outline.matchAll(/^- (src\/[\w./-]+\.ts) \(/gm)) {
      const file = path.join(sitesDir, id, match[1]);
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      // The same rule as seeding: only code that stands alone.
      if (/from\s+["']\.\/(lib|content)/.test(text)) continue;
      out[match[1]] = text;
    }
    return out;
  },

  markUsed(id: number): void {
    db().prepare("UPDATE build_exemplars SET times_used = times_used + 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
  },

  /** Whether the build that was shown this example went on to pass. */
  recordOutcome(id: number, passed: boolean): void {
    if (passed) db().prepare("UPDATE build_exemplars SET times_passed = times_passed + 1, updated_at = ? WHERE id = ?").run(nowIso(), id);
  },

  formatForPrompt(exemplar: Exemplar, adopted: string[] = []): string {
    if (adopted.length > 0) {
      const modules = adopted.map((file) => `./${file.replace(/^src\//, "").replace(/\.ts$/, "")}`).join(", ");
      // A model handed GameSettings tried `new GameSettings()`: say which values are ready to use.
      const defaults = Array.from(new Set(exemplar.outline.match(/\bDEFAULT_[A-Z_]+\b/g) ?? []));
      return `Already in your project, complete, tested and working: ${adopted.join(", ")} (the engine from our
"${exemplar.title}"). Build this app ON it: import from ${modules} and write the screens, navigation,
saving and anything else the brief asks for around it. Change the engine only where the brief needs
something different, and never rewrite it from scratch or import anything it does not export.
Its interfaces and types are types only: never \`new\` them; pass plain objects of that shape.${
        defaults.length ? `\nReady-made values to start from: ${defaults.join(", ")} (e.g. newGame(${defaults[0]})).` : ""
      }
Its files:
${exemplar.outline}
`;
    }
    const kind = exemplar.origin === "build" ? "an app this builder made earlier, which passed every check" : "a working engine from our own catalogue";
    return `A worked example — ${kind}: "${exemplar.title}".
Follow how it is built (logic in plain .ts modules with real rules, state and scoring; small components; tests
for the logic). Do NOT copy its names, content or theme: build what this brief asks for.
Its files:
${exemplar.outline}

${exemplar.sample}
`;
  },

  list(): Exemplar[] {
    return (db().prepare("SELECT * FROM build_exemplars ORDER BY updated_at DESC").all() as Row[]).map(fromRow);
  }
};
