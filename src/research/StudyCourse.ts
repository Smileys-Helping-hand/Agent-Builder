/**
 * StudyCourse — turns a research topic into a course that teaches it.
 *
 *   plan     the syllabus: 5-8 lessons in learning order, each tied to the
 *            findings it teaches from (academic and reference evidence first)
 *   lesson   written when it is opened (and the next one ahead of time): an
 *            explanation that cites real sources, an example, key terms, a
 *            fact check that keeps established science apart from theory,
 *            opinion and fiction, and the sources themselves to read, with
 *            what each one says in its own words
 *   quiz     four questions per lesson with explanations; 75% completes it
 *   cards    flashcards reviewed on a Leitner schedule (1, 3, 7, 16 days)
 *   pack     the whole course as one Markdown document to read, print or keep
 *
 * Writing a lesson takes the local model minutes, so every write runs in the
 * background, one at a time; the app and Jarvis ask again until it is ready.
 * Lessons someone opened go ahead of research on the GPU; ones written ahead
 * of time wait their turn. Each finished lesson is also filed in Second-Brain,
 * Jarvis's knowledge base, so he can teach from it too.
 */
import { getKnowledgeDb, indexKnowledge, nowIso, unindexKnowledge } from "../knowledge/KnowledgeDb.js";
import { SecondBrainClient } from "../integrations/SecondBrainClient.js";
import { JarvisClient } from "../integrations/JarvisClient.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import type { GpuPriority } from "../utils/GpuLock.js";
import { Logger } from "../utils/Logger.js";
import { ResearchStore, type ResearchFinding, type ResearchSource } from "./ResearchStore.js";
import { classifySource, TIER_LABEL, TIER_ORDER, type EvidenceTier } from "./SourceCredibility.js";
import { SharedKnowledge } from "../knowledge/SharedKnowledge.js";
import { Reinforcement } from "../learning/Reinforcement.js";

export type Level = "beginner" | "intermediate" | "advanced";
export type LessonStatus = "planned" | "queued" | "writing" | "ready" | "failed";

export interface SyllabusEntry {
  index: number;
  title: string;
  goal: string;
  keyIdeas: string[];
  findingIds: number[];
}

export interface Course {
  topicId: string;
  title: string;
  level: Level;
  status: "planning" | "ready" | "failed";
  error: string | null;
  syllabus: SyllabusEntry[];
  createdAt: string;
  updatedAt: string;
}

export interface QuizQuestion {
  question: string;
  options: string[];
  answer: number;
  why: string;
}

export interface LessonSource {
  n: number;
  title: string;
  url: string;
  tier: EvidenceTier;
  label: string;
  excerpt: string | null;
}

export interface Lesson {
  topicId: string;
  index: number;
  title: string;
  goal: string;
  status: LessonStatus;
  markdown: string | null;
  quiz: QuizQuestion[];
  sources: LessonSource[];
  error: string | null;
  writtenAt: string | null;
}

export interface LessonProgress {
  index: number;
  openedAt: string | null;
  completedAt: string | null;
  bestScore: number | null;
  attempts: number;
}

export interface Flashcard {
  id: number;
  topicId: string;
  index: number;
  front: string;
  back: string;
  box: number;
  dueAt: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS study_courses (
  topic_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  level TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  syllabus TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS study_lessons (
  topic_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL,
  goal TEXT NOT NULL,
  status TEXT NOT NULL,
  markdown TEXT,
  quiz TEXT NOT NULL DEFAULT '[]',
  sources TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  written_at TEXT,
  PRIMARY KEY (topic_id, idx)
);
CREATE TABLE IF NOT EXISTS study_progress (
  topic_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  opened_at TEXT,
  completed_at TEXT,
  best_score REAL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (topic_id, idx)
);
CREATE TABLE IF NOT EXISTS study_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  box INTEGER NOT NULL DEFAULT 1,
  due_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_study_cards_due ON study_cards(topic_id, due_at);
`;

let ready = false;
const db = () => {
  const database = getKnowledgeDb();
  if (!ready) {
    database.exec(SCHEMA);
    // A write cut off by a restart is written again when next opened.
    database.prepare("UPDATE study_lessons SET status = 'planned' WHERE status IN ('queued', 'writing')").run();
    database.prepare("UPDATE study_courses SET status = 'failed', error = 'Agent Builder restarted while planning; plan it again.' WHERE status = 'planning'").run();
    ready = true;
  }
  return database;
};

const parse = <T>(text: string | null | undefined, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
};

const extractJson = <T>(raw: string): T | null => {
  const cleaned = raw.replace(/```(?:json)?/gi, "");
  const start = cleaned.search(/[[{]/);
  const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
};

const generateJson = async <T>(prompt: string, priority: GpuPriority): Promise<T | null> => {
  const first = extractJson<T>(await ModelRouter.generate(prompt, { priority }));
  if (first) return first;
  return extractJson<T>(await ModelRouter.generate(`${prompt}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON, nothing else.`, { priority }));
};

type CourseRow = { topic_id: string; title: string; level: string; status: string; error: string | null; syllabus: string; created_at: string; updated_at: string };
type LessonRow = { topic_id: string; idx: number; title: string; goal: string; status: string; markdown: string | null; quiz: string; sources: string; error: string | null; written_at: string | null };
type ProgressRow = { idx: number; opened_at: string | null; completed_at: string | null; best_score: number | null; attempts: number };
type CardRow = { id: number; topic_id: string; idx: number; front: string; back: string; box: number; due_at: string };

const toCourse = (row: CourseRow): Course => ({
  topicId: row.topic_id,
  title: row.title,
  level: (["beginner", "intermediate", "advanced"].includes(row.level) ? row.level : "beginner") as Level,
  status: row.status as Course["status"],
  error: row.error,
  syllabus: parse<SyllabusEntry[]>(row.syllabus, []),
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const toLesson = (row: LessonRow): Lesson => ({
  topicId: row.topic_id,
  index: row.idx,
  title: row.title,
  goal: row.goal,
  status: row.status as LessonStatus,
  markdown: row.markdown,
  quiz: parse<QuizQuestion[]>(row.quiz, []),
  sources: parse<LessonSource[]>(row.sources, []),
  error: row.error,
  writtenAt: row.written_at
});

const toCard = (row: CardRow): Flashcard => ({ id: row.id, topicId: row.topic_id, index: row.idx, front: row.front, back: row.back, box: row.box, dueAt: row.due_at });

/** Days until a card in each Leitner box is due again. */
const BOX_DAYS = [0, 1, 3, 7, 16, 35];

const tierOf = (finding: ResearchFinding): EvidenceTier => classifySource(finding.sourceUrl, finding.sourceTitle).tier;
const tierRank = (tier: EvidenceTier) => TIER_ORDER.indexOf(tier);

/** Strongest evidence first, then support and confidence. */
const byEvidence = (a: ResearchFinding, b: ResearchFinding) =>
  tierRank(tierOf(a)) - tierRank(tierOf(b)) || b.supportCount - a.supportCount || b.confidence - a.confidence;

const words = (text: string) => new Set(text.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);

// ---------------------------------------------------------------- the job queue

type Job = { key: string; priority: GpuPriority; run: () => Promise<void> };
const jobs: Job[] = [];
let working: Job | null = null;

const enqueue = (job: Job) => {
  if (working?.key === job.key || jobs.some((j) => j.key === job.key)) {
    // Asked for again by a person: move it to the front.
    const queued = jobs.find((j) => j.key === job.key);
    if (queued && job.priority === "interactive" && queued.priority !== "interactive") {
      jobs.splice(jobs.indexOf(queued), 1);
      queued.priority = "interactive";
      jobs.unshift(queued);
    }
    return;
  }
  if (job.priority === "interactive") jobs.unshift(job);
  else jobs.push(job);
  void pump();
};

const pump = async () => {
  if (working) return;
  const next = jobs.shift();
  if (!next) return;
  working = next;
  try {
    await next.run();
  } catch (error) {
    Logger.warn("Study job failed", { job: next.key, error: (error as Error)?.message });
  } finally {
    working = null;
    void pump();
  }
};

// ---------------------------------------------------------------- course

const planPrompt = (topic: { title: string; question: string }, findings: ResearchFinding[], level: Level, mixed: boolean) => `You are designing a short course that teaches what this research found.

Topic: ${topic.title}
The learner's question: ${topic.question}
Learner level: ${level}

Findings, strongest evidence first. Each has an id and the kind of source it comes from
(academic, reference, news = real-world evidence; community = practitioners; speculative = unproven claims; fiction = invented worlds):
${findings.map((f) => `#${f.id} [${tierOf(f)}] ${f.claim}`).join("\n")}

Design 5 to 8 lessons in the order someone should learn them: foundations first, then how things work, then
applications and open questions. Each lesson teaches from findings in the list.
${mixed ? `Some findings are speculative or fiction. Teach the real-world material from academic/reference/news findings,
and end with a lesson titled "Fact, theory and fiction" that sorts out what is established, what is theoretical,
and what only exists in stories or unproven claims.\n` : ""}
Answer with JSON only:
{"lessons": [{"title": "<short lesson title>", "goal": "<what the learner can do or explain after it, one sentence>",
"keyIdeas": ["<idea>", "<idea>", "<idea>"], "findingIds": [<4 to 10 ids from the list>]}]}`;

const lessonPrompt = (
  topic: { title: string },
  course: Course,
  entry: SyllabusEntry,
  findings: Array<ResearchFinding & { n: number | null }>,
  level: Level,
  owner = "",
  style = ""
) => `You are a patient, precise teacher writing lesson ${entry.index + 1} of ${course.syllabus.length} in a course on "${topic.title}".
Learner level: ${level}.
${owner}${style}
Lesson: ${entry.title}
Goal: ${entry.goal}
Key ideas: ${entry.keyIdeas.join("; ")}
Other lessons in the course (do not teach these here): ${course.syllabus.filter((s) => s.index !== entry.index).map((s) => s.title).join("; ")}

Teach ONLY from these findings. Each ends with its source number and the kind of source:
${findings.map((f) => `- ${f.claim} ${f.n ? `[${f.n}]` : ""} (${tierOf(f)}${f.status === "corroborated" ? ", confirmed by several sources" : ""})`).join("\n")}

Kinds of source: academic, reference and news are evidence about the real world; community is practitioners'
experience; speculative is unproven; fiction is invented (games, novels, worldbuilding) and must never be taught
as how the real world works.

Write the lesson in Markdown with exactly these sections:
## In short
Three bullet points: the most important things this lesson teaches.
## The idea
The explanation, built up step by step in plain language, 300-500 words. Cite source numbers like [2] after each claim you take from a finding.
## An example
One concrete, worked example or analogy that makes the idea click.
## Key terms
4 to 8 terms as "**Term** — definition".
## Fact check
What here is well established, what is still theoretical or debated, and (only if any findings are speculative or fiction) what comes from fiction or unproven claims. Be direct.
## Recap
Two or three sentences tying it back to the goal.

Rules: no title heading above the sections; never invent facts, numbers or sources; keep source numbers exactly as given.`;

const quizPrompt = (lessonMarkdown: string) => `Here is a lesson:

${lessonMarkdown.slice(0, 9000)}

Write a quiz and flashcards that test understanding of THIS lesson only. Answer with JSON only:
{"quiz": [{"question": "<question>", "options": ["<a>", "<b>", "<c>", "<d>"], "answer": <index 0-3 of the right option>, "why": "<one sentence explaining the right answer>"}],
 "flashcards": [{"front": "<a question or term>", "back": "<the answer, one or two sentences>"}]}
Make exactly 4 quiz questions (one right option each, the others plausible) and 6 flashcards.`;

export const StudyCourse = {
  get(topicId: string): Course | null {
    const row = db().prepare("SELECT * FROM study_courses WHERE topic_id = ?").get(topicId) as CourseRow | undefined;
    return row ? toCourse(row) : null;
  },

  list(): Array<Course & { completed: number; total: number }> {
    const rows = db().prepare("SELECT * FROM study_courses ORDER BY updated_at DESC").all() as CourseRow[];
    return rows.map((row) => {
      const course = toCourse(row);
      const completed = (db().prepare("SELECT COUNT(*) AS n FROM study_progress WHERE topic_id = ? AND completed_at IS NOT NULL").get(row.topic_id) as { n: number }).n;
      return { ...course, completed, total: course.syllabus.length };
    });
  },

  /** The course with its lessons (without their text), progress and due cards. */
  overview(topicId: string) {
    const course = StudyCourse.get(topicId);
    if (!course) return null;
    const lessons = (db().prepare("SELECT * FROM study_lessons WHERE topic_id = ? ORDER BY idx").all(topicId) as LessonRow[]).map(toLesson);
    const progress = (db().prepare("SELECT idx, opened_at, completed_at, best_score, attempts FROM study_progress WHERE topic_id = ?").all(topicId) as ProgressRow[]).map(
      (row): LessonProgress => ({ index: row.idx, openedAt: row.opened_at, completedAt: row.completed_at, bestScore: row.best_score, attempts: row.attempts })
    );
    const due = (db().prepare("SELECT COUNT(*) AS n FROM study_cards WHERE topic_id = ? AND due_at <= ?").get(topicId, nowIso()) as { n: number }).n;
    const cards = (db().prepare("SELECT COUNT(*) AS n FROM study_cards WHERE topic_id = ?").get(topicId) as { n: number }).n;
    return {
      course,
      lessons: lessons.map(({ markdown: _markdown, quiz, ...rest }) => ({ ...rest, quizSize: quiz.length })),
      progress,
      cards: { total: cards, due },
      writing: working?.key.startsWith(`${topicId}:`) ? working.key : null
    };
  },

  /** Plans (or re-plans) the course in the background. */
  plan(topicId: string, level: Level = "beginner"): Course {
    const topic = ResearchStore.getTopic(topicId);
    if (!topic) throw new Error("Research topic not found.");
    const findings = ResearchStore.listFindings(topicId, 400, "strongest").filter((f) => f.status !== "contested");
    if (findings.length < 5) throw new Error("This topic has fewer than 5 findings yet — let it research a little longer first.");
    const existing = StudyCourse.get(topicId);
    if (existing?.status === "planning") return existing;

    const now = nowIso();
    db()
      .prepare(
        `INSERT INTO study_courses (topic_id, title, level, status, error, syllabus, created_at, updated_at) VALUES (?, ?, ?, 'planning', NULL, '[]', ?, ?)
         ON CONFLICT(topic_id) DO UPDATE SET level = excluded.level, status = 'planning', error = NULL, updated_at = excluded.updated_at`
      )
      .run(topicId, topic.title, level, now, now);

    enqueue({
      key: `${topicId}:plan`,
      priority: "interactive",
      run: async () => {
        const sorted = [...findings].sort(byEvidence).slice(0, 70);
        const mixed = sorted.filter((f) => ["speculative", "fiction"].includes(tierOf(f))).length >= 3;
        const known = new Set(sorted.map((f) => f.id));
        try {
          const answer = await generateJson<{ lessons?: Array<Partial<SyllabusEntry>> }>(planPrompt(topic, sorted, level, mixed), "interactive");
          const lessons = (answer?.lessons ?? [])
            .filter((l) => typeof l.title === "string" && l.title.trim())
            .slice(0, 8)
            .map(
              (l, index): SyllabusEntry => ({
                index,
                title: String(l.title).trim().slice(0, 90),
                goal: typeof l.goal === "string" ? l.goal.trim().slice(0, 240) : "",
                keyIdeas: (Array.isArray(l.keyIdeas) ? l.keyIdeas : []).filter((k): k is string => typeof k === "string").slice(0, 6),
                findingIds: (Array.isArray(l.findingIds) ? l.findingIds : []).map(Number).filter((id) => known.has(id)).slice(0, 12)
              })
            );
          if (lessons.length < 3) throw new Error("The model did not return a usable syllabus.");
          const tx = db().transaction(() => {
            db().prepare("DELETE FROM study_lessons WHERE topic_id = ?").run(topicId);
            db().prepare("DELETE FROM study_cards WHERE topic_id = ?").run(topicId);
            db().prepare("DELETE FROM study_progress WHERE topic_id = ?").run(topicId);
            for (const lesson of lessons) {
              db()
                .prepare("INSERT INTO study_lessons (topic_id, idx, title, goal, status) VALUES (?, ?, ?, ?, 'planned')")
                .run(topicId, lesson.index, lesson.title, lesson.goal);
            }
            db()
              .prepare("UPDATE study_courses SET status = 'ready', syllabus = ?, error = NULL, updated_at = ? WHERE topic_id = ?")
              .run(JSON.stringify(lessons), nowIso(), topicId);
          });
          tx();
          ResearchStore.logActivity(topicId, topic.cycles, "document", `Planned a ${lessons.length}-lesson course`);
          // The first lesson is written straight away: it is what gets opened next.
          StudyCourse.requestLesson(topicId, 0, "background");
        } catch (error) {
          db()
            .prepare("UPDATE study_courses SET status = 'failed', error = ?, updated_at = ? WHERE topic_id = ?")
            .run((error as Error)?.message ?? String(error), nowIso(), topicId);
        }
      }
    });
    return StudyCourse.get(topicId)!;
  },

  lesson(topicId: string, index: number): Lesson | null {
    const row = db().prepare("SELECT * FROM study_lessons WHERE topic_id = ? AND idx = ?").get(topicId, index) as LessonRow | undefined;
    return row ? toLesson(row) : null;
  },

  /**
   * Opens a lesson: returns it when written, otherwise starts writing it (ahead
   * of other work when a person asked) and returns it with its status.
   */
  open(topicId: string, index: number): Lesson {
    const lesson = StudyCourse.lesson(topicId, index);
    if (!lesson) throw new Error("No such lesson — plan the course first.");
    db()
      .prepare(
        `INSERT INTO study_progress (topic_id, idx, opened_at, attempts) VALUES (?, ?, ?, 0)
         ON CONFLICT(topic_id, idx) DO UPDATE SET opened_at = COALESCE(study_progress.opened_at, excluded.opened_at)`
      )
      .run(topicId, index, nowIso());
    if (lesson.status !== "ready") StudyCourse.requestLesson(topicId, index, "interactive");
    // Write the next one while this one is read.
    else if (StudyCourse.lesson(topicId, index + 1)?.status === "planned") StudyCourse.requestLesson(topicId, index + 1, "background");
    return StudyCourse.lesson(topicId, index)!;
  },

  /** The lesson being studied: the most recently opened one not yet completed. */
  currentLesson(topicId: string): number | null {
    const row = db()
      .prepare("SELECT idx FROM study_progress WHERE topic_id = ? AND completed_at IS NULL AND opened_at IS NOT NULL ORDER BY opened_at DESC LIMIT 1")
      .get(topicId) as { idx: number } | undefined;
    return row ? row.idx : null;
  },

  /** The first lesson not yet completed. */
  next(topicId: string): Lesson | null {
    const course = StudyCourse.get(topicId);
    if (!course || course.status !== "ready") return null;
    const done = new Set(
      (db().prepare("SELECT idx FROM study_progress WHERE topic_id = ? AND completed_at IS NOT NULL").all(topicId) as Array<{ idx: number }>).map((r) => r.idx)
    );
    const index = course.syllabus.find((s) => !done.has(s.index))?.index;
    return index === undefined ? null : StudyCourse.open(topicId, index);
  },

  requestLesson(topicId: string, index: number, priority: GpuPriority) {
    const lesson = StudyCourse.lesson(topicId, index);
    if (!lesson || lesson.status === "ready") return;
    if (lesson.status === "planned" || lesson.status === "failed") {
      db().prepare("UPDATE study_lessons SET status = 'queued', error = NULL WHERE topic_id = ? AND idx = ?").run(topicId, index);
    }
    enqueue({ key: `${topicId}:lesson:${index}`, priority, run: () => StudyCourse.write(topicId, index, priority) });
  },

  async write(topicId: string, index: number, priority: GpuPriority): Promise<void> {
    const topic = ResearchStore.getTopic(topicId);
    const course = StudyCourse.get(topicId);
    const entry = course?.syllabus.find((s) => s.index === index);
    if (!topic || !course || !entry) return;
    db().prepare("UPDATE study_lessons SET status = 'writing' WHERE topic_id = ? AND idx = ?").run(topicId, index);

    try {
      const all = ResearchStore.listFindings(topicId, 400, "strongest").filter((f) => f.status !== "contested");
      const chosen = all.filter((f) => entry.findingIds.includes(f.id));
      // Top up with findings that share the lesson's words, strongest evidence first.
      const lessonWords = words(`${entry.title} ${entry.goal} ${entry.keyIdeas.join(" ")}`);
      const related = all
        .filter((f) => !entry.findingIds.includes(f.id))
        .map((f) => ({ f, overlap: [...words(f.claim)].filter((w) => lessonWords.has(w)).length }))
        .filter((x) => x.overlap >= 2)
        .sort((a, b) => b.overlap - a.overlap || byEvidence(a.f, b.f))
        .slice(0, Math.max(0, 14 - chosen.length))
        .map((x) => x.f);
      const findings = [...chosen, ...related].sort(byEvidence);
      if (findings.length === 0) throw new Error("No findings match this lesson; re-plan the course.");

      // Number the sources this lesson uses, and keep what each one actually says.
      const sourcesById = new Map<number, ResearchSource>(ResearchStore.listSources(topicId, 1000).map((s) => [s.id, s]));
      const numbers = new Map<number, number>();
      const sources: LessonSource[] = [];
      const numbered = findings.map((f) => {
        if (f.sourceId === null || !f.sourceUrl) return { ...f, n: null };
        if (!numbers.has(f.sourceId)) {
          const c = classifySource(f.sourceUrl, f.sourceTitle);
          const source = sourcesById.get(f.sourceId);
          numbers.set(f.sourceId, sources.length + 1);
          sources.push({
            n: sources.length + 1,
            title: f.sourceTitle ?? f.sourceUrl,
            url: f.sourceUrl,
            tier: c.tier,
            label: c.label,
            excerpt: source?.excerpt ? source.excerpt.replace(/\s+/g, " ").trim().slice(0, 420) : null
          });
        }
        return { ...f, n: numbers.get(f.sourceId)! };
      });

      const owner = await SharedKnowledge.ownerContext(`${topic.title} ${entry.title} learning`);
      const base = lessonPrompt(topic, course, entry, numbered, course.level, owner);
      // How to teach it is the lesson policy's choice, per learner level; the learner's first quiz score rewards it.
      const choice = Reinforcement.choose("lesson.style", { bucket: course.level, agent: "study-course", ref: `lesson:${topicId}:${index}`, prompt: base });
      const body = (await ModelRouter.generate(lessonPrompt(topic, course, entry, numbered, course.level, owner, `${choice.arm.instruction}\n`), { priority }))
        .trim()
        .replace(/^#\s+[^\n]*\n+/, "");
      if (body.length < 300 || !/##\s/.test(body)) {
        Reinforcement.reward(choice.episodeId, 0, "unusable", "too short or no sections");
        throw new Error("The model's lesson was too short to use.");
      }
      Reinforcement.recordResponse(choice.episodeId, body);

      const reading = TIER_ORDER.filter((tier) => sources.some((s) => s.tier === tier))
        .map((tier) => {
          const list = sources.filter((s) => s.tier === tier);
          return `### ${TIER_LABEL[tier]}\n\n${list
            .map((s) => `${s.n}. [${s.title}](${s.url})${s.excerpt ? `\n   > ${s.excerpt}${s.excerpt.length >= 420 ? "…" : ""}` : ""}`)
            .join("\n")}`;
        })
        .join("\n\n");
      const markdown = `# Lesson ${index + 1}: ${entry.title}\n\n_Goal: ${entry.goal}_\n\n${body}\n\n## Read the sources\n\nEvery numbered citation above is one of these. The quote under each is what the source itself says — read the originals to go deeper.\n\n${reading}\n`;

      let quiz: QuizQuestion[] = [];
      let cards: Array<{ front: string; back: string }> = [];
      const extra = await generateJson<{ quiz?: QuizQuestion[]; flashcards?: Array<{ front: string; back: string }> }>(quizPrompt(markdown), priority).catch(() => null);
      quiz = (extra?.quiz ?? [])
        .filter((q) => q && typeof q.question === "string" && Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length)
        .slice(0, 6)
        .map((q) => ({ question: q.question.trim(), options: q.options.map(String).slice(0, 5), answer: q.answer, why: typeof q.why === "string" ? q.why : "" }));
      cards = (extra?.flashcards ?? []).filter((c) => c && typeof c.front === "string" && typeof c.back === "string" && c.front.trim() && c.back.trim()).slice(0, 10);

      const now = nowIso();
      const tx = db().transaction(() => {
        db()
          .prepare("UPDATE study_lessons SET status = 'ready', markdown = ?, quiz = ?, sources = ?, error = NULL, written_at = ? WHERE topic_id = ? AND idx = ?")
          .run(markdown, JSON.stringify(quiz), JSON.stringify(sources), now, topicId, index);
        db().prepare("DELETE FROM study_cards WHERE topic_id = ? AND idx = ?").run(topicId, index);
        for (const card of cards) {
          db().prepare("INSERT INTO study_cards (topic_id, idx, front, back, box, due_at) VALUES (?, ?, ?, ?, 1, ?)").run(topicId, index, card.front.trim(), card.back.trim(), now);
        }
      });
      tx();
      ResearchStore.logActivity(topicId, topic.cycles, "document", `Wrote lesson ${index + 1}: ${entry.title}`);
      // Searchable with everything else it knows (and through it, by Jarvis).
      unindexKnowledge("lesson", `${topicId}:${index}`);
      indexKnowledge("lesson", `${topicId}:${index}`, topicId, `${topic.title} — Lesson ${index + 1}: ${entry.title}`, markdown.split("\n## Read the sources")[0]);
      // Jarvis teaches from his knowledge base: every lesson goes there.
      SecondBrainClient.enqueueDocument(`study:${topicId}:${index}`, `${topic.title} — Lesson ${index + 1}: ${entry.title}`, markdown);
      void SecondBrainClient.processQueue().catch(() => undefined);
    } catch (error) {
      db()
        .prepare("UPDATE study_lessons SET status = 'failed', error = ? WHERE topic_id = ? AND idx = ?")
        .run((error as Error)?.message ?? String(error), topicId, index);
    }
  },

  /** Marks a quiz: which answers were right, why, and the score. 75% or better completes the lesson. */
  grade(topicId: string, index: number, answers: number[]) {
    const lesson = StudyCourse.lesson(topicId, index);
    if (!lesson || lesson.status !== "ready") throw new Error("That lesson is not written yet.");
    if (lesson.quiz.length === 0) throw new Error("This lesson has no quiz; mark it done instead.");
    const results = lesson.quiz.map((q, i) => ({
      question: q.question,
      yourAnswer: Number.isInteger(answers[i]) ? q.options[answers[i]] ?? null : null,
      rightAnswer: q.options[q.answer],
      correct: answers[i] === q.answer,
      why: q.why
    }));
    const score = results.filter((r) => r.correct).length / results.length;
    const passed = score >= 0.75;
    // The first attempt is the honest measure of how well the lesson taught: it rewards the lesson's teaching approach.
    const before = db().prepare("SELECT attempts FROM study_progress WHERE topic_id = ? AND idx = ?").get(topicId, index) as { attempts: number } | undefined;
    if (!before?.attempts) {
      const episode = Reinforcement.episodeFor("lesson.style", `lesson:${topicId}:${index}`);
      if (episode) Reinforcement.reward(episode.id, score, "quiz");
    }
    db()
      .prepare(
        `INSERT INTO study_progress (topic_id, idx, opened_at, completed_at, best_score, attempts) VALUES (?, ?, ?, ?, ?, 1)
         ON CONFLICT(topic_id, idx) DO UPDATE SET attempts = study_progress.attempts + 1,
           best_score = MAX(COALESCE(study_progress.best_score, 0), excluded.best_score),
           completed_at = COALESCE(study_progress.completed_at, excluded.completed_at)`
      )
      .run(topicId, index, nowIso(), passed ? nowIso() : null, score);
    return { score, passed, results, next: passed ? StudyCourse.get(topicId)?.syllabus.find((s) => s.index === index + 1) ?? null : null };
  },

  /** 👍 / 👎 on a lesson: a reward for its teaching approach, beside the quiz score. */
  feedback(topicId: string, index: number, good: boolean, source = "app"): { ok: boolean } {
    const episode = Reinforcement.episodeFor("lesson.style", `lesson:${topicId}:${index}`);
    if (!episode) throw new Error("That lesson has not been written yet.");
    Reinforcement.reward(episode.id, good ? 1 : 0, `${source}-rating`);
    return { ok: true };
  },

  complete(topicId: string, index: number) {
    db()
      .prepare(
        `INSERT INTO study_progress (topic_id, idx, opened_at, completed_at, attempts) VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(topic_id, idx) DO UPDATE SET completed_at = COALESCE(study_progress.completed_at, excluded.completed_at)`
      )
      .run(topicId, index, nowIso(), nowIso());
  },

  dueCards(topicId?: string, limit = 20): Flashcard[] {
    const rows = topicId
      ? (db().prepare("SELECT * FROM study_cards WHERE topic_id = ? AND due_at <= ? ORDER BY due_at LIMIT ?").all(topicId, nowIso(), limit) as CardRow[])
      : (db().prepare("SELECT * FROM study_cards WHERE due_at <= ? ORDER BY due_at LIMIT ?").all(nowIso(), limit) as CardRow[]);
    return rows.map(toCard);
  },

  /** Knew it: the card moves up a box and comes back later. Did not: back to box 1, due tomorrow. */
  review(cardId: number, knew: boolean): Flashcard {
    const row = db().prepare("SELECT * FROM study_cards WHERE id = ?").get(cardId) as CardRow | undefined;
    if (!row) throw new Error("Unknown card.");
    const box = knew ? Math.min(row.box + 1, BOX_DAYS.length - 1) : 1;
    const due = new Date(Date.now() + BOX_DAYS[knew ? box : 1] * 86_400_000).toISOString();
    db().prepare("UPDATE study_cards SET box = ?, due_at = ? WHERE id = ?").run(box, due, cardId);
    return toCard({ ...row, box, due_at: due });
  },

  /** The whole course as one document: syllabus, every written lesson, answers, cards and reading list. */
  pack(topicId: string): string {
    const overview = StudyCourse.overview(topicId);
    if (!overview) throw new Error("There is no course for this topic yet.");
    const { course } = overview;
    const topic = ResearchStore.getTopic(topicId);
    const lessons = course.syllabus.map((s) => StudyCourse.lesson(topicId, s.index)).filter((l): l is Lesson => Boolean(l));
    const written = lessons.filter((l) => l.status === "ready" && l.markdown);
    const cards = (db().prepare("SELECT * FROM study_cards WHERE topic_id = ? ORDER BY idx, id").all(topicId) as CardRow[]).map(toCard);
    const allSources = new Map<string, LessonSource>();
    for (const lesson of written) for (const s of lesson.sources) allSources.set(s.url, s);

    const parts = [
      `# Study pack: ${course.title}`,
      `_${course.level} course · ${course.syllabus.length} lessons (${written.length} written) · from research on "${topic?.question ?? course.title}" · ${new Date().toLocaleDateString()}_`,
      `> Lessons are written by a local AI model from findings it extracted from the sources listed. Every source is labelled with the kind of evidence it is. Check anything important against the original.`,
      `## How to use this pack\n\n1. Read one lesson at a time and say its "In short" points back in your own words.\n2. Do the lesson's questions before looking at the answers at the end.\n3. Review the flashcards over the following days — the gaps they show are what to reread.\n4. Open at least one academic or reference source per lesson.`,
      `## Syllabus\n\n${course.syllabus.map((s) => `${s.index + 1}. **${s.title}** — ${s.goal}`).join("\n")}`,
      ...written.map((l) => `---\n\n${l.markdown}${l.quiz.length ? `\n### Check yourself\n\n${l.quiz.map((q, i) => `${i + 1}. ${q.question}\n${q.options.map((o, j) => `   ${String.fromCharCode(97 + j)}) ${o}`).join("\n")}`).join("\n\n")}\n` : ""}`),
      written.some((l) => l.quiz.length)
        ? `---\n\n## Answers\n\n${written
            .filter((l) => l.quiz.length)
            .map((l) => `**Lesson ${l.index + 1}**\n\n${l.quiz.map((q, i) => `${i + 1}. ${String.fromCharCode(97 + q.answer)}) ${q.options[q.answer]} — ${q.why}`).join("\n")}`)
            .join("\n\n")}`
        : "",
      cards.length ? `## Flashcards\n\n${cards.map((c) => `- **${c.front}** — ${c.back}`).join("\n")}` : "",
      allSources.size
        ? `## Reading list\n\n${TIER_ORDER.filter((tier) => [...allSources.values()].some((s) => s.tier === tier))
            .map((tier) => `### ${TIER_LABEL[tier]}\n\n${[...allSources.values()].filter((s) => s.tier === tier).map((s) => `- [${s.title}](${s.url})`).join("\n")}`)
            .join("\n\n")}`
        : ""
    ];
    return parts.filter(Boolean).join("\n\n") + "\n";
  },

  /** Sends the course (syllabus and written lessons) to Jarvis and his knowledge base. */
  async sendToJarvis(topicId: string): Promise<{ ok: boolean; detail: string }> {
    const markdown = StudyCourse.pack(topicId);
    const course = StudyCourse.get(topicId)!;
    SecondBrainClient.enqueueDocument(`study-pack:${topicId}`, `Study pack: ${course.title}`, markdown);
    void SecondBrainClient.processQueue().catch(() => undefined);
    const sent = await JarvisClient.send({
      type: "research",
      severity: "notice",
      subject: `Course ready to teach: ${course.title}`,
      body: `${markdown.slice(0, 6000)}${markdown.length > 6000 ? "\n\n…(the full study pack is in your knowledge base)" : ""}`,
      metadata: { kind: "study-pack", topicId, lessons: course.syllabus.length }
    });
    return {
      ok: sent.ok,
      detail: sent.ok
        ? sent.acknowledgement ?? "Jarvis has the course."
        : JarvisClient.isConfigured()
          ? `Jarvis did not answer (${sent.detail}); it is retried, and the pack is queued for his knowledge base.`
          : "Jarvis is not set up on this PC (JARVIS_HOST / JARVIS_API_KEY); the pack is queued for Second-Brain."
    };
  }
};
