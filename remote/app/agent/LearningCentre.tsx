"use client";

/**
 * The Learning Centre, the overview and the evaluations: what it knows and
 * whether that knowledge is earning its place, measured.
 */
import { useState } from "react";

import { api, type EvaluationCompare, type LearningLesson } from "@/lib/api";
import { Busy, Skeleton, ago, useRemote, useToast } from "../ui";

const pct = (value: number | null | undefined) => (value === null || value === undefined ? "—" : `${Math.round(value * 100)}%`);
const statusTag: Record<string, string> = { verified: "ok", candidate: "info", deprecated: "warn", rejected: "bad" };

export function Overview() {
  const data = useRemote(() => api.agentOverview(), 15000, "agent-overview");
  const o = data.data;
  if (!o) return <Skeleton rows={4} />;
  const stat = (label: string, value: string | number, hint?: string) => (
    <div className="card" style={{ flex: "1 1 130px", margin: 0, padding: 12 }}>
      <div style={{ fontSize: 22, fontWeight: 700 }}>{value}</div>
      <div className="small muted">{label}</div>
      {hint ? <div className="small muted">{hint}</div> : null}
    </div>
  );
  return (
    <>
      {o.disk?.low ? (
        <div className="card" style={{ borderColor: "var(--bad)", marginBottom: 8 }}>
          <strong style={{ color: "var(--bad)" }}>The disk is nearly full ({o.disk.freeGb} GB free).</strong>{" "}
          <span className="small">Builds and the continuous builder are waiting until there are at least 3 GB, rather than failing half-way.</span>
        </div>
      ) : null}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {stat("Agents working", o.agents.length)}
        {stat("VMs running", o.vms.running.length, `${o.vms.total} in all`)}
        {stat("Investigations", o.research.length)}
        {stat("Lessons", o.lessons.total)}
        {stat("Waiting for you", o.approvals.deliveries.length)}
        {stat("Latest evaluation", o.evaluation?.score === null || !o.evaluation ? "—" : pct(o.evaluation.score), o.evaluation ? o.evaluation.label : "none yet")}
      </div>

      <div className="section-title">Working now</div>
      {o.agents.length === 0 ? <p className="small muted">Nothing is running.</p> : null}
      {o.agents.map((a) => (
        <div key={a.id} className="small" style={{ marginBottom: 4 }}>
          <strong>{a.project}</strong> <span className="tag">{a.stage}</span> {a.phase} <span className="muted">· {a.milestones} milestones · {a.cycles} cycles</span>
          {a.lastError ? <div style={{ color: "var(--bad)" }}>{a.lastError.slice(0, 200)}</div> : null}
        </div>
      ))}
      {o.research.map((r) => (
        <div key={r.id} className="small" style={{ marginBottom: 4 }}>
          <strong>Investigating:</strong> {r.objective.slice(0, 120)} <span className="muted">· {r.phase}</span>
        </div>
      ))}
      {o.vms.running.map((v) => (
        <div key={v.id} className="small" style={{ marginBottom: 4 }}>
          <strong>VM:</strong> <a href="/lab/">{v.name}</a> <span className="tag ok">{v.state}</span>
        </div>
      ))}

      <div className="section-title">Latest iterations</div>
      {o.iterations.map((it, i) => (
        <div key={i} className="small">
          <span className={`tag ${it.outcome === "kept" ? "ok" : it.outcome === "failed" || it.outcome === "rolled-back" ? "bad" : ""}`}>{it.outcome}</span> <strong>{it.project}</strong> {it.title} <span className="muted">· {ago(it.at)}</span>
        </div>
      ))}

      {o.tests.length ? (
        <>
          <div className="section-title">VM tests</div>
          {o.tests.map((t) => (
            <div key={t.id} className="small">
              <a href={`/lab/?run=${t.id}`}>{t.vm}</a> <span className={`tag ${t.state === "passed" ? "ok" : t.state === "failed" ? "bad" : "info"}`}>{t.state}</span> <span className="muted">{t.counts.passed} passed, {t.counts.failed} failed · {ago(t.at)}</span>
            </div>
          ))}
        </>
      ) : null}

      <div className="section-title">Recently learned</div>
      {o.lessons.recent.map((l) => (
        <div key={l.id} className="small">
          <span className={`tag ${statusTag[l.status] ?? ""}`}>{l.status}</span> {l.lesson} <span className="muted">· {ago(l.at)}</span>
        </div>
      ))}
      {o.discoveries.map((d, i) => (
        <div key={i} className="small">
          <span className="tag">{d.kind}</span> {d.title} <span className="muted">· {ago(d.at)}</span>
        </div>
      ))}

      {o.failures.length ? (
        <>
          <div className="section-title">Problems</div>
          {o.failures.map((f, i) => (
            <div key={i} className="small" style={{ color: "var(--bad)" }}>
              <strong>{f.project}:</strong> {f.error?.slice(0, 200)}
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}

export function LearningCentre() {
  const toast = useToast();
  const learning = useRemote(() => api.learning(), 30000, "agent-learning");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState<number | null>(null);
  const data = learning.data;
  if (!data) return <Skeleton rows={4} />;
  const lessons: LearningLesson[] = filter === "all" ? data.lessons : data.lessons.filter((l) => l.status === filter || l.category === filter || l.source === filter);
  const decide = async (id: number, decision: "verified" | "rejected" | null) => {
    setBusy(id);
    try {
      await api.decideLesson(id, decision);
      await learning.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };
  const table = (title: string, rows: Array<{ name: string; count: number; applied: number; helped: number }>) => (
    <div className="card" style={{ flex: "1 1 240px", margin: 0 }}>
      <strong className="small">{title}</strong>
      {rows.map((row) => (
        <div key={row.name} className="small" style={{ display: "flex", justifyContent: "space-between", gap: 8, cursor: "pointer" }} onClick={() => setFilter(row.name)}>
          <span>{row.name}</span>
          <span className="muted">
            {row.count} · used {row.applied}, helped {row.helped}
          </span>
        </div>
      ))}
    </div>
  );
  return (
    <>
      <p className="small">
        Everything it has learned, from fixes, rebuilds, research and experiments. A lesson stays a <strong>candidate</strong> until its use proves it, becomes <strong>verified</strong> after helping repeatedly, and is <strong>deprecated</strong> (no longer given to builds, still searchable) if it stops helping. Your decision overrides that. This changes what builds are told; it does not change the model's weights.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {table("By status", data.byStatus)}
        {table("By kind", data.byCategory)}
        {table("Where it came from", data.bySource)}
      </div>
      {data.contributions.length ? (
        <>
          <div className="section-title">Who has used what was learned</div>
          {data.contributions.slice(0, 15).map((row, i) => (
            <div key={i} className="small">
              <strong>{row.usedBy}</strong> used {row.lessons} lesson{row.lessons === 1 ? "" : "s"} from <strong>{row.source}</strong> <span className="muted">· {row.uses} time{row.uses === 1 ? "" : "s"}</span>
            </div>
          ))}
        </>
      ) : null}
      {data.loop.asked.length ? (
        <>
          <div className="section-title">What it is researching about its own failures</div>
          {data.loop.asked.slice(0, 6).map((q, i) => (
            <div key={i} className="small">{q}</div>
          ))}
          <div className="small muted">{data.loop.reconstructed} projects rebuilt by the learning loop{data.loop.lastTickAt ? ` · last ran ${ago(data.loop.lastTickAt)}` : ""}</div>
        </>
      ) : null}
      <div className="section-title" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        Knowledge · {lessons.length}{filter !== "all" ? <button className="btn small ghost" onClick={() => setFilter("all")}>Show all</button> : null}
      </div>
      {lessons.slice(0, 80).map((lesson) => (
        <div key={lesson.id} className="small" style={{ padding: "4px 0", borderTop: "1px solid var(--line, rgba(255,255,255,.08))" }}>
          <span className={`tag ${statusTag[lesson.status] ?? ""}`}>{lesson.status}</span> <span className="tag">{lesson.category}</span> {lesson.lesson}
          <div className="muted" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            from {lesson.source} · used {lesson.timesApplied}, helped {lesson.timesHelped}, failed {lesson.timesFailed} · {ago(lesson.createdAt)}
            {busy === lesson.id ? <Busy label="" /> : (
              <>
                <button className="btn small ghost" onClick={() => void decide(lesson.id, "verified")}>Verify</button>
                <button className="btn small ghost" onClick={() => void decide(lesson.id, "rejected")}>Reject</button>
                <button className="btn small ghost" onClick={() => void decide(lesson.id, null)}>Let its use decide</button>
              </>
            )}
          </div>
        </div>
      ))}
    </>
  );
}

export function EvaluationsPanel() {
  const toast = useToast();
  const data = useRemote(() => api.evaluations(), 15000, "agent-evaluations");
  const [trials, setTrials] = useState(1);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [compared, setCompared] = useState<EvaluationCompare | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  if (!data.data) return <Skeleton rows={3} />;
  const { runs, running, challenges } = data.data;
  const start = async (withKnowledge: boolean) => {
    setBusy(true);
    try {
      await api.runEvaluation({ withKnowledge, trials, label: withKnowledge ? "With what it has learned" : "Without what it has learned (baseline)" });
      toast("Running. Each challenge takes a model call or more.", "ok");
      await data.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <p className="small">
        {challenges.length} fixed challenges with graders that are code, not opinion: hidden tests run what it writes, and answers must say what is true and not invent what is not. Run it without and with what it has learned to measure what the learning is worth on the same model, and compare any two runs for improvements and regressions.
      </p>
      <div className="learn-plan" style={{ alignItems: "center", flexWrap: "wrap" }}>
        <label className="small">
          Trials each <input className="input" style={{ width: 60 }} type="number" min={1} max={5} value={trials} onChange={(e) => setTrials(Number(e.target.value))} />
        </label>
        <button className="btn small primary" disabled={busy || Boolean(running)} onClick={() => void start(true)}>Run with what it has learned</button>
        <button className="btn small" disabled={busy || Boolean(running)} onClick={() => void start(false)}>Run without (baseline)</button>
        {running ? <span className="small muted"><Busy label="A run is under way" /></span> : null}
        {picked.length === 2 ? <button className="btn small" onClick={() => void api.compareEvaluations(picked[0], picked[1]).then(setCompared)}>Compare the two</button> : null}
      </div>

      {compared ? (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="small">
            <strong>{compared.a.label}</strong> {pct(compared.a.score)} → <strong>{compared.b.label}</strong> {pct(compared.b.score)}{" "}
            <span className={`tag ${(compared.difference ?? 0) > 0 ? "ok" : (compared.difference ?? 0) < 0 ? "bad" : ""}`}>{compared.difference === null ? "not comparable" : `${compared.difference > 0 ? "+" : ""}${Math.round(compared.difference * 100)} points`}</span>
          </div>
          <div className="small muted">{compared.coverage}{compared.note ? ` · ${compared.note}` : ""}</div>
          {compared.regressions.length ? <div className="small" style={{ color: "var(--bad)" }}>Regressions: {compared.regressions.join(", ")}</div> : null}
          {compared.improved.length ? <div className="small" style={{ color: "var(--good)" }}>Improved: {compared.improved.join(", ")}</div> : null}
          <table className="small" style={{ width: "100%", marginTop: 6 }}>
            <tbody>
              {compared.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.title}</td>
                  <td>{pct(row.a)}</td>
                  <td>{pct(row.b)}</td>
                  <td>{row.knowledgeUsed.length ? `${row.knowledgeUsed.length} used` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="section-title">Runs · {runs.length}</div>
      {runs.length === 0 ? <p className="small muted">None yet.</p> : null}
      {runs.map((run) => (
        <div key={run.id} style={{ marginBottom: 4 }}>
          <div className="small" style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", cursor: "pointer" }} onClick={() => setOpen(open === run.id ? null : run.id)}>
            <input type="checkbox" checked={picked.includes(run.id)} onClick={(e) => e.stopPropagation()} onChange={(e) => setPicked((list) => (e.target.checked ? [...list, run.id].slice(-2) : list.filter((x) => x !== run.id)))} />
            <span className={`tag ${run.state === "done" ? "ok" : run.state === "running" ? "info" : "bad"}`}>{run.state}</span>
            <strong>{run.score === null ? `${run.results.length} done so far` : pct(run.score)}</strong> {run.label} <span className="muted">· {run.trials} trial{run.trials === 1 ? "" : "s"} · {ago(run.startedAt)}</span>
          </div>
          {open === run.id ? (
            <div style={{ marginLeft: 22 }}>
              {run.error ? <div className="small" style={{ color: "var(--bad)" }}>{run.error}</div> : null}
              {run.results.map((result) => (
                <details key={result.id}>
                  <summary className="small" style={{ cursor: "pointer" }}>
                    <span className={`tag ${result.passRate === 1 ? "ok" : result.passRate === 0 ? "bad" : "warn"}`}>{pct(result.passRate)}</span> <span className="muted">[{result.category}]</span> {result.title}
                  </summary>
                  {result.trials.map((trial, i) => (
                    <div key={i} className="small" style={{ marginLeft: 12 }}>
                      {trial.passed ? "Passed" : "Failed"}: {trial.detail} <span className="muted">· {Math.round(trial.durationMs / 1000)} s</span>
                      <pre style={{ whiteSpace: "pre-wrap", maxHeight: 140, overflow: "auto", fontSize: 11 }}>{trial.output}</pre>
                    </div>
                  ))}
                </details>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}
