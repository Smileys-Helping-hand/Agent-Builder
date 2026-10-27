"use client";

/**
 * Learn: the research as a course that teaches it. Plan the course, read each
 * lesson (written on the PC from the findings and their real sources, with a
 * fact check that keeps evidence apart from speculation and fiction), take its
 * quiz, review the flashcards, and keep the whole study pack.
 *
 * Planning and writing take the PC's model a few minutes each; this tab polls
 * while anything is being written and opens the lesson when it is ready.
 */
import { useEffect, useState } from "react";

import { api, type CourseOverview, type QuizResult, type StudyCard, type StudyLesson, type StudyLevel, type TopicDetail } from "@/lib/api";
import { Banner, Busy, Icon, useToast } from "../ui";
import { Markdown } from "./workspace";

const STATUS: Record<StudyLesson["status"], string> = {
  planned: "Not written yet",
  queued: "Waiting to be written",
  writing: "Being written…",
  ready: "Ready",
  failed: "Could not be written"
};

export function Learn({ data }: { data: TopicDetail }) {
  const toast = useToast();
  const topicId = data.topic.id;
  const [overview, setOverview] = useState<CourseOverview | null>(null);
  const [missing, setMissing] = useState(false);
  const [level, setLevel] = useState<StudyLevel>("beginner");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const [lesson, setLesson] = useState<StudyLesson | null>(null);
  const [mode, setMode] = useState<"lesson" | "cards" | "pack">("lesson");

  const load = async () => {
    try {
      const next = await api.course(topicId);
      setOverview(next);
      setMissing(false);
      return next;
    } catch {
      setOverview(null);
      setMissing(true);
      return null;
    }
  };

  useEffect(() => {
    setOpen(null);
    setLesson(null);
    setMode("lesson");
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicId]);

  // While the course is planned or a lesson is written, look again every 4 s.
  const course = overview?.course ?? null;
  const pending = course?.status === "planning" || (lesson !== null && lesson.status !== "ready" && lesson.status !== "failed");
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(async () => {
      const next = await load();
      if (open !== null && next?.lessons.find((l) => l.index === open)?.status === "ready") {
        const fresh = await api.lesson(topicId, open).catch(() => null);
        if (fresh) setLesson(fresh.lesson);
      } else if (open !== null && next) {
        const meta = next.lessons.find((l) => l.index === open);
        if (meta && lesson && meta.status !== lesson.status) setLesson({ ...lesson, status: meta.status, error: meta.error });
      }
    }, 4000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, open, topicId]);

  // Open the first unfinished lesson once the course is ready.
  useEffect(() => {
    if (!course || course.status !== "ready" || open !== null || !overview) return;
    const done = new Set(overview.progress.filter((p) => p.completedAt).map((p) => p.index));
    const first = course.syllabus.find((s) => !done.has(s.index))?.index ?? 0;
    void openLesson(first);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.status]);

  const openLesson = async (index: number) => {
    setOpen(index);
    setMode("lesson");
    setLesson(null);
    try {
      const res = await api.lesson(topicId, index);
      setLesson(res.lesson);
      void load();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const plan = async () => {
    setBusy(true);
    try {
      await api.planCourse(topicId, level);
      setOpen(null);
      setLesson(null);
      await load();
      toast("Planning your course — it takes a few minutes on the PC.", "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!overview && !missing) return <Busy label="Loading your course…" />;

  if (missing || !course) {
    const enough = data.findings.length >= 5;
    return (
      <div className="learn-empty card">
        <h3>Learn this topic properly</h3>
        <p>
          Turn what the research found into a short course: lessons in the right order, each explained plainly with an
          example and key terms, a fact check that keeps real evidence apart from speculation and fiction, the original
          sources to read, a quiz, and flashcards to remember it.
        </p>
        <div className="learn-plan">
          <select className="input" value={level} onChange={(event) => setLevel(event.target.value as StudyLevel)} aria-label="Level">
            <option value="beginner">I'm new to this</option>
            <option value="intermediate">I know the basics</option>
            <option value="advanced">Go deep</option>
          </select>
          <button className="btn primary" disabled={busy || !enough} onClick={() => void plan()}>
            {busy ? <Busy label="Starting…" /> : <>{Icon.sparkle} Plan my course</>}
          </button>
        </div>
        {!enough ? <p className="muted small">It needs at least 5 findings first; this topic has {data.findings.length}.</p> : null}
      </div>
    );
  }

  if (course.status === "planning") {
    return (
      <div className="learn-empty card">
        <Busy label="Planning the course from the findings — a few minutes on the PC…" />
        <p className="muted small">The first lesson is written straight after. You can leave this tab; it carries on.</p>
      </div>
    );
  }

  if (course.status === "failed") {
    return (
      <div className="learn-empty card">
        <Banner kind="error">The course could not be planned: {course.error}</Banner>
        <button className="btn" disabled={busy} onClick={() => void plan()}>
          Try again
        </button>
      </div>
    );
  }

  const done = new Map(overview!.progress.map((p) => [p.index, p]));
  const completed = overview!.progress.filter((p) => p.completedAt).length;

  return (
    <div className="learn">
      <aside className="learn-syllabus">
        <div className="learn-progress">
          <strong>{course.title}</strong>
          <span className="muted small">
            {completed}/{course.syllabus.length} lessons · {course.level}
          </span>
          <div className="learn-bar">
            <i style={{ width: `${Math.round((completed / Math.max(course.syllabus.length, 1)) * 100)}%` }} />
          </div>
        </div>
        <ol>
          {course.syllabus.map((entry) => {
            const meta = overview!.lessons.find((l) => l.index === entry.index);
            const progress = done.get(entry.index);
            return (
              <li key={entry.index}>
                <button className={open === entry.index && mode === "lesson" ? "on" : ""} onClick={() => void openLesson(entry.index)}>
                  <span className="learn-n">{progress?.completedAt ? "✓" : entry.index + 1}</span>
                  <span>
                    {entry.title}
                    <small className="muted">
                      {progress?.completedAt
                        ? `Done${progress.bestScore !== null ? ` · ${Math.round(progress.bestScore * 100)}%` : ""}`
                        : meta
                          ? STATUS[meta.status]
                          : ""}
                    </small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="learn-tools">
          <button className={`btn small ${mode === "cards" ? "primary" : ""}`} onClick={() => setMode("cards")} disabled={overview!.cards.total === 0}>
            Flashcards{overview!.cards.due ? ` (${overview!.cards.due} due)` : ""}
          </button>
          <button className={`btn small ${mode === "pack" ? "primary" : ""}`} onClick={() => setMode("pack")}>
            Study pack
          </button>
          <button
            className="btn small ghost"
            onClick={() =>
              void api
                .courseToJarvis(topicId)
                .then((r) => toast(r.detail, r.ok ? "ok" : "error"))
                .catch((error) => toast(error instanceof Error ? error.message : String(error), "error"))
            }
          >
            Send to Jarvis
          </button>
          <button className="btn small ghost" disabled={busy} onClick={() => window.confirm("Plan the course again? Lessons, scores and cards start over.") && void plan()}>
            Re-plan
          </button>
        </div>
      </aside>

      <section className="learn-main">
        {mode === "cards" ? (
          <Flashcards topicId={topicId} onChanged={() => void load()} />
        ) : mode === "pack" ? (
          <StudyPack topicId={topicId} title={course.title} />
        ) : open === null ? (
          <p className="muted">Pick a lesson.</p>
        ) : !lesson ? (
          <Busy label="Opening the lesson…" />
        ) : lesson.status !== "ready" ? (
          <div className="learn-writing">
            {lesson.status === "failed" ? (
              <>
                <Banner kind="error">This lesson could not be written: {lesson.error}</Banner>
                <button className="btn" onClick={() => void openLesson(lesson.index)}>
                  Try again
                </button>
              </>
            ) : (
              <>
                <Busy label={`Writing lesson ${lesson.index + 1}, "${lesson.title}", from your research…`} />
                <p className="muted small">A lesson takes a few minutes on the PC. It opens here by itself when it is ready.</p>
              </>
            )}
          </div>
        ) : (
          <LessonView
            topicId={topicId}
            lesson={lesson}
            onDone={async (next) => {
              await load();
              if (next !== null) void openLesson(next);
            }}
          />
        )}
      </section>
    </div>
  );
}

function LessonView({ topicId, lesson, onDone }: { topicId: string; lesson: StudyLesson; onDone: (next: number | null) => void }) {
  const toast = useToast();
  const [answers, setAnswers] = useState<Array<number | null>>(() => lesson.quiz.map(() => null));
  const [result, setResult] = useState<QuizResult | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setAnswers(lesson.quiz.map(() => null));
    setResult(null);
  }, [lesson.index, lesson.quiz]);

  const check = async () => {
    setChecking(true);
    try {
      setResult(await api.answerQuiz(topicId, lesson.index, answers.map((a) => (a === null ? -1 : a))));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setChecking(false);
    }
  };

  const [rated, setRated] = useState<boolean | null>(null);
  useEffect(() => setRated(null), [lesson.index]);
  const rate = async (good: boolean) => {
    try {
      await api.rateLesson(topicId, lesson.index, good);
      setRated(good);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <article className="learn-lesson md">
      <Markdown text={lesson.markdown ?? ""} />

      <div className="talk-rate" aria-label="Rate this lesson">
        <small className="muted">Was this lesson clear?</small>
        <button className={`chip ${rated === true ? "accent" : ""}`} onClick={() => void rate(true)} title="Lessons learn to teach the way that works for you">
          👍
        </button>
        <button className={`chip ${rated === false ? "accent" : ""}`} onClick={() => void rate(false)}>
          👎
        </button>
      </div>

      {lesson.quiz.length ? (
        <div className="learn-quiz card">
          <h3>Check yourself</h3>
          {lesson.quiz.map((q, i) => {
            const marked = result?.results[i];
            return (
              <fieldset key={i} className={marked ? (marked.correct ? "right" : "wrong") : ""}>
                <legend>
                  {i + 1}. {q.question}
                </legend>
                {q.options.map((option, j) => (
                  <label key={j}>
                    <input
                      type="radio"
                      name={`q${lesson.index}-${i}`}
                      checked={answers[i] === j}
                      disabled={Boolean(result)}
                      onChange={() => setAnswers((current) => current.map((a, k) => (k === i ? j : a)))}
                    />
                    {option}
                  </label>
                ))}
                {marked ? (
                  <p className="small">
                    {marked.correct ? "✓ Right." : `✗ The answer is "${marked.rightAnswer}".`} {marked.why}
                  </p>
                ) : null}
              </fieldset>
            );
          })}
          {result ? (
            <div className="learn-score">
              <strong>{Math.round(result.score * 100)}%</strong> — {result.passed ? "lesson complete." : "reread the lesson and try again."}
              {result.passed ? (
                <button className="btn primary small" onClick={() => onDone(result.next?.index ?? null)}>
                  {result.next ? `Next: ${result.next.title}` : "Finish"}
                </button>
              ) : (
                <button className="btn small" onClick={() => setResult(null)}>
                  Try again
                </button>
              )}
            </div>
          ) : (
            <button className="btn primary" disabled={checking || answers.some((a) => a === null)} onClick={() => void check()}>
              {checking ? <Busy label="Marking…" /> : "Check my answers"}
            </button>
          )}
        </div>
      ) : (
        <button
          className="btn primary"
          onClick={() =>
            void api
              .lessonDone(topicId, lesson.index)
              .then(() => onDone(lesson.index + 1))
              .catch(() => undefined)
          }
        >
          I've studied this
        </button>
      )}
    </article>
  );
}

function Flashcards({ topicId, onChanged }: { topicId: string; onChanged: () => void }) {
  const [cards, setCards] = useState<StudyCard[] | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [reviewed, setReviewed] = useState(0);

  useEffect(() => {
    void api
      .dueCards(topicId)
      .then((res) => setCards(res.cards))
      .catch(() => setCards([]));
  }, [topicId]);

  if (!cards) return <Busy label="Loading cards…" />;
  const card = cards[0];
  if (!card) {
    return (
      <div className="learn-writing">
        <h3>{reviewed ? `Done — ${reviewed} card${reviewed === 1 ? "" : "s"} reviewed.` : "No cards are due."}</h3>
        <p className="muted">Cards you knew come back in a few days; the ones you missed come back tomorrow.</p>
      </div>
    );
  }

  const answer = async (knew: boolean) => {
    await api.reviewCard(card.id, knew).catch(() => undefined);
    setCards((current) => (current ?? []).slice(1));
    setFlipped(false);
    setReviewed((n) => n + 1);
    onChanged();
  };

  return (
    <div className="learn-cards">
      <p className="muted small">
        {cards.length} due · lesson {card.index + 1} · box {card.box}
      </p>
      <button className={`flashcard ${flipped ? "flipped" : ""}`} onClick={() => setFlipped(true)} aria-label={flipped ? "Answer" : "Show the answer"}>
        <span>{flipped ? card.back : card.front}</span>
        {!flipped ? <small className="muted">Tap to see the answer</small> : null}
      </button>
      {flipped ? (
        <div className="learn-plan">
          <button className="btn" onClick={() => void answer(false)}>
            Not yet
          </button>
          <button className="btn primary" onClick={() => void answer(true)}>
            I knew it
          </button>
        </div>
      ) : null}
    </div>
  );
}

function StudyPack({ topicId, title }: { topicId: string; title: string }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .studyPack(topicId)
      .then((res) => setMarkdown(res.markdown))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [topicId]);

  if (error) return <Banner kind="error">{error}</Banner>;
  if (!markdown) return <Busy label="Putting the pack together…" />;

  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 60)}-study-pack.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  return (
    <article className="learn-lesson md">
      <div className="learn-plan">
        <button className="btn primary small" onClick={download}>
          Download (.md)
        </button>
        <button className="btn small" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <Markdown text={markdown} />
    </article>
  );
}
