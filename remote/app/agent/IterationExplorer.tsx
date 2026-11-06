"use client";

/**
 * The Iteration Explorer: every step of a continuous build, click to open,
 * while it runs and after. What changed (files, functions, real diffs), why,
 * what was learned, what was tested, and your feedback on it. Pick two to
 * compare them.
 */
import { useEffect, useState } from "react";

import { api, onMachine, type IterationCompare, type IterationDetail, type IterationEntry } from "@/lib/api";
import { Busy, Skeleton, ago, useToast } from "../ui";

const statusTag: Record<IterationEntry["status"], string> = {
  "in-progress": "info",
  completed: "ok",
  "no-change": "",
  failed: "bad",
  "rolled-back": "bad",
  stopped: "warn"
};
const statusLabel: Record<IterationEntry["status"], string> = {
  "in-progress": "in progress",
  completed: "completed",
  "no-change": "no change",
  failed: "failed",
  "rolled-back": "rolled back",
  stopped: "stopped"
};

function Patch({ text, cut }: { text: string; cut?: boolean }) {
  if (!text) return <p className="small muted">No differences in the code.</p>;
  return (
    <pre className="agent-diff" style={{ maxHeight: 420, overflow: "auto", fontSize: 11.5 }}>
      {text.split("\n").map((line, i) => (
        <div key={i} style={{ color: line.startsWith("+") && !line.startsWith("+++") ? "#4ade80" : line.startsWith("-") && !line.startsWith("---") ? "#f87171" : line.startsWith("@@") ? "#38bdf8" : undefined }}>
          {line || " "}
        </div>
      ))}
      {cut ? <div className="muted">… (cut here; open a file for its whole diff)</div> : null}
    </pre>
  );
}

function Detail({ sessionId, n, onChanged }: { sessionId: string; n: number | "current"; onChanged: () => void }) {
  const toast = useToast();
  const [data, setData] = useState<IterationDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"changes" | "why" | "learned" | "tests" | "feedback">("changes");
  const [file, setFile] = useState<{ path: string; diff: string } | null>(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState("comment");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () =>
      api
        .iteration(sessionId, n)
        .then((d) => {
          if (live) setData(d);
        })
        .catch((e) => {
          if (live) setError(e instanceof Error ? e.message : String(e));
        });
    void load();
    // The one in progress keeps moving.
    const timer = n === "current" ? setInterval(load, 8000) : null;
    return () => {
      live = false;
      if (timer) clearInterval(timer);
    };
  }, [sessionId, n]);

  if (error) return <p className="small" style={{ color: "var(--bad)" }}>{error}</p>;
  if (!data) return <Skeleton rows={2} />;
  const { changes, build, learning, testing } = data;
  const added = changes.files.reduce((sum, f) => sum + f.added, 0);
  const removed = changes.files.reduce((sum, f) => sum + f.removed, 0);

  return (
    <div style={{ margin: "6px 0 10px 10px", paddingLeft: 10, borderLeft: "2px solid var(--line, rgba(255,255,255,.12))" }}>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        {(
          [
            ["changes", `Changes · ${changes.files.length}`],
            ["why", "Why"],
            ["learned", `Learned · ${learning.lessons.length}`],
            ["tests", "Tests"],
            ["feedback", `Feedback · ${data.feedback.length}`]
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`btn small ${tab === id ? "primary" : "ghost"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "changes" ? (
        <>
          {changes.gone ? <p className="small muted">{changes.gone}</p> : null}
          <div className="small muted">
            {changes.files.length} file{changes.files.length === 1 ? "" : "s"}, +{added} −{removed} lines
            {changes.to ? ` · ${changes.from?.slice(0, 7)}..${changes.to.slice(0, 7)}` : changes.from ? ` · since ${changes.from.slice(0, 7)}, including what is being written now` : ""}
          </div>
          {changes.commits.length ? <div className="small muted" style={{ marginTop: 4 }}>{changes.commits.slice(0, 6).join(" · ")}</div> : null}
          {changes.symbols.length ? <div className="small" style={{ marginTop: 4 }}><strong>Functions and components:</strong> {changes.symbols.slice(0, 30).join(", ")}</div> : null}
          {changes.dependencies.length ? <div className="small"><strong>Dependencies:</strong> {changes.dependencies.join(", ")}</div> : null}
          {changes.config.length ? <div className="small"><strong>Configuration:</strong> {changes.config.join(", ")}</div> : null}
          <div style={{ margin: "6px 0" }}>
            {changes.files.slice(0, 80).map((f) => (
              <div key={f.path} className="small">
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (n === "current") return;
                    void api.iterationFileDiff(sessionId, n, f.path).then((d) => setFile({ path: f.path, diff: d.diff }));
                  }}
                >
                  {f.path}
                </a>{" "}
                <span className="muted">{f.change} +{f.added} −{f.removed}</span>
              </div>
            ))}
          </div>
          {file ? (
            <>
              <div className="small"><strong>{file.path}</strong> <button className="btn small ghost" onClick={() => setFile(null)}>All files</button></div>
              <Patch text={file.diff} />
            </>
          ) : (
            <Patch text={changes.patch} cut={changes.patchCut} />
          )}
        </>
      ) : null}

      {tab === "why" ? (
        <div className="small">
          <div><strong>Objective:</strong> {data.objective}</div>
          {data.milestone?.detail ? <div style={{ marginTop: 4 }}><strong>Milestone:</strong> {data.milestone.detail}</div> : null}
          {data.milestone?.diagnosis ? <div style={{ marginTop: 4 }}><strong>Diagnosis:</strong> {data.milestone.diagnosis}</div> : null}
          {data.entry?.note ? <div style={{ marginTop: 4 }}><strong>Result:</strong> {data.entry.note}</div> : null}
          {build ? (
            <>
              <div className="section-title">The build's passes</div>
              {build.passes.map((pass) => (
                <div key={pass.iteration} style={{ marginBottom: 6 }}>
                  <span className={`tag ${pass.passed ? "ok" : "warn"}`}>pass {pass.iteration}: {pass.qualityScore}</span> <span className="muted">{ago(pass.at)}</span>
                  {pass.improvements.length ? <ul style={{ margin: "2px 0", paddingLeft: 18 }}>{pass.improvements.map((item, i) => <li key={i}>{item}</li>)}</ul> : null}
                  {pass.blocker ? <div className="muted">Blocked by {pass.blocker.name}</div> : null}
                </div>
              ))}
              {build.events.length ? (
                <>
                  <div className="section-title">Decisions and repairs</div>
                  {build.events.map((event, i) => (
                    <div key={i}>
                      <span className="tag">{event.kind}</span> {event.message}
                    </div>
                  ))}
                </>
              ) : null}
            </>
          ) : (
            <p className="muted">No build is recorded for this step (it was planning or checking, or it ran before steps recorded their build).</p>
          )}
        </div>
      ) : null}

      {tab === "learned" ? (
        <div className="small">
          {learning.lessons.length ? (
            learning.lessons.map((lesson) => (
              <div key={lesson.id} style={{ marginBottom: 6 }}>
                {lesson.lesson} <span className="muted">· applied {lesson.timesApplied}, helped {lesson.timesHelped}</span>
              </div>
            ))
          ) : (
            <p className="muted">No new lessons were recorded during this iteration.</p>
          )}
          {learning.evidence.length ? (
            <>
              <div className="section-title">What the ledger recorded</div>
              {learning.evidence.slice(-20).map((record) => (
                <div key={record.id}>
                  <span className="tag">{record.kind}</span> {record.title} <span className="muted">{record.outcome ?? ""}</span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "tests" ? (
        <div className="small">
          {testing.check ? (
            <div>
              <span className={`tag ${testing.check.passed ? "ok" : "bad"}`}>{testing.check.passed ? "checks passed" : "checks failed"}</span> {testing.check.failing.join(", ")}
              {!testing.check.verified ? <span className="muted"> (nothing applied to check)</span> : null}
            </div>
          ) : (
            <p className="muted">No check result is kept for this step (it ran before steps recorded theirs).</p>
          )}
          {build?.passes.length ? (
            <div style={{ marginTop: 6 }}>
              {build.passes.slice(-1)[0].checks.filter((c) => c.applicable).map((c) => (
                <span key={c.name} className={`tag ${c.passed ? "ok" : "bad"}`} style={{ marginRight: 4 }}>{c.name}</span>
              ))}
            </div>
          ) : null}
          {testing.vmRuns.map((run) => (
            <div key={run.id} style={{ marginTop: 6 }}>
              <a href={`/lab/?run=${run.id}`}>VM test {run.build.iso ?? ""}</a> <span className={`tag ${run.state === "passed" ? "ok" : "bad"}`}>{run.state}</span> <span className="muted">{run.counts.passed} passed, {run.counts.failed} failed</span>
            </div>
          ))}
          {build?.buildId ? <div style={{ marginTop: 6 }}><a href={onMachine(`/build/?id=${encodeURIComponent(build.buildId)}`)}>Open the build</a></div> : null}
        </div>
      ) : null}

      {tab === "feedback" ? (
        <div className="small">
          {data.feedback.map((record) => (
            <div key={record.id} style={{ marginBottom: 4 }}>
              {record.title} <span className="muted">· {ago(record.createdAt)} · {record.outcome}</span>
            </div>
          ))}
          {n === "current" ? (
            <p className="muted">Comment on a finished iteration, or send the session an instruction from its card.</p>
          ) : (
            <div className="learn-plan" style={{ flexWrap: "wrap" }}>
              <select className="input" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kind of feedback">
                <option value="comment">Comment</option>
                <option value="criticism">Technical criticism</option>
                <option value="visual">Visual critique</option>
                <option value="feature">Feature request</option>
                <option value="bug">Bug report</option>
                <option value="suggestion">Improvement</option>
              </select>
              <input className="input" style={{ flex: 1, minWidth: 200 }} placeholder="What should change?" value={text} onChange={(e) => setText(e.target.value)} />
              <button
                className="btn small"
                disabled={sending || !text.trim()}
                onClick={() => {
                  setSending(true);
                  api
                    .iterationFeedback(sessionId, n, text.trim(), kind)
                    .then((r) => {
                      toast(r.followUp, "ok");
                      setText("");
                      return api.iteration(sessionId, n).then(setData);
                    })
                    .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
                    .finally(() => {
                      setSending(false);
                      onChanged();
                    });
                }}
              >
                {sending ? <Busy label="Sending" /> : "Send"}
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function Compare({ sessionId, a, b, onClose }: { sessionId: string; a: number; b: number; onClose: () => void }) {
  const [data, setData] = useState<IterationCompare | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.iterationCompare(sessionId, a, b).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [sessionId, a, b]);
  if (error) return <p className="small" style={{ color: "var(--bad)" }}>{error}</p>;
  if (!data) return <Skeleton rows={2} />;
  const row = (label: string, left: React.ReactNode, right: React.ReactNode) => (
    <tr>
      <td className="muted">{label}</td>
      <td>{left}</td>
      <td>{right}</td>
    </tr>
  );
  const checks = (side: IterationCompare["a"]) => (side.checksPassed === null ? "not recorded" : side.checksPassed ? "passed" : `failed: ${side.failing.join(", ")}`);
  const vm = (side: IterationCompare["a"]) => (side.vmRun ? `${side.vmRun.state} (${side.vmRun.counts.passed} passed, ${side.vmRun.counts.failed} failed)` : "none");
  return (
    <div className="card" style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong>Comparing iterations {data.a.n} and {data.b.n}</strong>
        <button className="btn small ghost" onClick={onClose}>Close</button>
      </div>
      <table className="small" style={{ width: "100%", marginTop: 6, borderCollapse: "collapse" }}>
        <tbody>
          {row("Iteration", data.a.title, data.b.title)}
          {row("Status", data.a.status, data.b.status)}
          {row("Checks", checks(data.a), checks(data.b))}
          {row("Build score", data.a.buildScore ?? "not recorded", data.b.buildScore ?? "not recorded")}
          {row("Latest VM test", vm(data.a), vm(data.b))}
        </tbody>
      </table>
      <div className="small" style={{ marginTop: 6 }}>
        Between them: {data.stepsBetween} step{data.stepsBetween === 1 ? "" : "s"}, {data.files.length} files, +{data.added} −{data.removed} lines, {data.lessonsBetween.length} lessons learned.
      </div>
      {data.symbols.length ? <div className="small"><strong>Functions and components:</strong> {data.symbols.slice(0, 30).join(", ")}</div> : null}
      <Patch text={data.patch} cut={data.patchCut} />
    </div>
  );
}

export default function IterationExplorer({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<{ current: IterationEntry | null; iterations: IterationEntry[] } | null>(null);
  const [open, setOpen] = useState<number | "current" | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [comparing, setComparing] = useState<[number, number] | null>(null);
  const [limit, setLimit] = useState(15);

  const load = () => api.iterations(sessionId).then(setData).catch(() => undefined);
  useEffect(() => {
    void load();
    const timer = setInterval(load, 15000);
    return () => clearInterval(timer);
  }, [sessionId]);

  if (!data) return <Skeleton rows={2} />;
  const row = (it: IterationEntry, key: number | "current") => (
    <div key={String(key)}>
      <div className="small" style={{ display: "flex", gap: 6, alignItems: "baseline", padding: "3px 0", cursor: "pointer", flexWrap: "wrap" }} onClick={() => setOpen(open === key ? null : key)}>
        {key !== "current" ? (
          <input
            type="checkbox"
            title="Pick two to compare"
            checked={picked.includes(key)}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setPicked((list) => (e.target.checked ? [...list, key].slice(-2) : list.filter((x) => x !== key)))}
          />
        ) : null}
        <span className="muted">#{it.n}</span>
        <span className={`tag ${statusTag[it.status]}`}>{statusLabel[it.status]}</span>
        <span>{it.title}</span>
        <span className="muted">
          {ago(it.status === "in-progress" ? it.startedAt ?? it.at : it.at)}
          {it.checksPassed !== null ? ` · checks ${it.checksPassed ? "passed" : "failed"}` : ""}
          {it.commit ? ` · ${it.commit.slice(0, 7)}` : ""}
          {it.note ? ` · ${it.note.slice(0, 80)}` : ""}
        </span>
      </div>
      {open === key ? <Detail sessionId={sessionId} n={key} onChanged={load} /> : null}
    </div>
  );
  return (
    <div>
      <div className="muted small" style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
        Iterations · {data.iterations.length}. Click one to see what changed, why, what was learned and what was tested.
        {picked.length === 2 ? <button className="btn small" onClick={() => setComparing([picked[0], picked[1]])}>Compare #{Math.min(...picked)} and #{Math.max(...picked)}</button> : null}
      </div>
      {comparing ? <Compare sessionId={sessionId} a={comparing[0]} b={comparing[1]} onClose={() => setComparing(null)} /> : null}
      {data.current ? row(data.current, "current") : null}
      {data.iterations.slice(0, limit).map((it) => row(it, it.n))}
      {data.iterations.length > limit ? <button className="btn small ghost" onClick={() => setLimit((v) => v + 30)}>Earlier iterations</button> : null}
    </div>
  );
}
