"use client";

/**
 * What the builder has learned. Every repair that turns a failing check green
 * is generalised into one sentence and kept; the next build that hits the same
 * kind of failure starts with it in its prompt. Each lesson is scored by how
 * often it actually helped when it was used, and lessons that stop helping sink
 * out of use. Research findings are not kept here: builds look those up fresh.
 */
import { useState } from "react";

import { api, type Lesson } from "@/lib/api";
import { Banner, Busy, Icon, Skeleton, ago, useRemote, useToast } from "../ui";

const pct = (value: number) => `${Math.round(value * 100)}%`;

export const LearningPanel = () => {
  const toast = useToast();
  const lessons = useRemote(() => api.lessons(), 60_000, "lessons");
  const [scope, setScope] = useState<"all" | "build" | "research">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  const list = (lessons.data?.lessons ?? []).filter((lesson) => scope === "all" || lesson.scope === scope);
  const all = lessons.data?.lessons ?? [];
  const applied = all.reduce((sum, lesson) => sum + lesson.timesApplied, 0);
  const helped = all.reduce((sum, lesson) => sum + lesson.timesHelped, 0);

  const retire = async (lesson: Lesson) => {
    if (!window.confirm(`Stop using this lesson?\n\n${lesson.lesson}`)) return;
    setBusy(lesson.id);
    try {
      await api.retireLesson(lesson.id);
      toast("Retired. Builds no longer use it.", "ok");
      await lessons.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <p className="hint" style={{ marginTop: 0 }}>
        Every fix that turns a failing check green becomes a one-line lesson, and the next build that hits the same kind of
        failure starts with it. Each is scored by how often it actually helped. Builds also look up research findings that
        match what they were asked for (confirmed, or backed by several sources) and say so in their thinking.
      </p>

      <div className="stats" style={{ marginTop: 0 }}>
        <div className="stat">
          <b>{all.length}</b>
          <span>Lessons</span>
        </div>
        <div className="stat">
          <b>{applied}</b>
          <span>Times used</span>
        </div>
        <div className="stat">
          <b>{applied ? pct(helped / applied) : "—"}</b>
          <span>Helped</span>
        </div>
      </div>

      <div className="filters">
        {(["all", "build", "research"] as const).map((id) => (
          <button key={id} className={scope === id ? "on" : ""} onClick={() => setScope(id)}>
            {id === "all" ? "All" : id === "build" ? "From builds" : "From research"}
          </button>
        ))}
      </div>

      {lessons.error ? <Banner kind="error">{lessons.error}</Banner> : null}
      {lessons.loading && !lessons.data ? <Skeleton rows={2} /> : null}
      {!lessons.loading && list.length === 0 ? (
        <div className="empty">Nothing learned here yet. It learns from each build that fixes a failing check.</div>
      ) : null}

      <div className="lessons">
        {list.map((lesson) => (
          <div key={lesson.id} className="lesson">
            <button className="lesson-head" onClick={() => setOpen(open === lesson.id ? null : lesson.id)} aria-expanded={open === lesson.id}>
              <span className={`lesson-score ${lesson.utility >= 0.6 ? "good" : lesson.utility >= 0.4 ? "warn" : "bad"}`}>{pct(lesson.utility)}</span>
              <span className="lesson-text">
                {lesson.lesson}
                <small>
                  {lesson.scope} · used {lesson.timesApplied}× · helped {lesson.timesHelped}×
                  {lesson.timesFailed ? ` · did not help ${lesson.timesFailed}×` : ""} · learned {ago(lesson.createdAt)}
                </small>
              </span>
            </button>
            {open === lesson.id ? (
              <div className="lesson-body fade-in">
                <p className="muted small" style={{ margin: "0 0 6px" }}>
                  The failure it is for: <code>{lesson.signature}</code>
                </p>
                {lesson.example ? <pre className="log small">{lesson.example}</pre> : null}
                <button className="btn small ghost" onClick={() => retire(lesson)} disabled={busy === lesson.id} style={{ marginTop: 8 }}>
                  {busy === lesson.id ? <Busy label="Retiring" /> : <>{Icon.trash} Stop using this lesson</>}
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};
