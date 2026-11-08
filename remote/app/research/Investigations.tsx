"use client";

/**
 * Deep investigations: give it an objective and it decomposes it into
 * specialists, researches, runs what can be computed, flags contradictions and
 * writes findings that cite their evidence. Every layer opens.
 */
import { useState } from "react";

import { api, type InvestigationFull } from "@/lib/api";
import { Banner, Busy, Skeleton, ago, useRemote, useToast } from "../ui";

const stateTag = (state: string) => (state === "done" ? "ok" : state === "failed" ? "bad" : state === "stopped" ? "warn" : "info");

function Report({ id }: { id: string }) {
  const toast = useToast();
  const data = useRemote(() => api.investigation(id), 20000, `investigation-${id}`);
  const [text, setText] = useState("");
  const item: InvestigationFull | undefined = data.data?.investigation;
  if (!item) return <Skeleton rows={3} />;
  const report = item.report;
  const list = (title: string, rows: string[]) =>
    rows.length ? (
      <>
        <div className="section-title">{title}</div>
        <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
          {rows.map((row, i) => (
            <li key={i}>{row}</li>
          ))}
        </ul>
      </>
    ) : null;
  return (
    <div style={{ marginTop: 8 }}>
      {item.error ? <Banner kind="error">{item.error}</Banner> : null}
      <div className="small muted">
        {item.counts.findings} findings · {item.counts.sources} sources · {item.counts.experimentsRun} experiments run{item.counts.experimentsFailed ? `, ${item.counts.experimentsFailed} failed` : ""} · {item.counts.physicalTests} physical tests needed · {item.counts.contradictions} contradictions · round {item.round}
      </div>

      {item.plan ? (
        <details>
          <summary className="small" style={{ cursor: "pointer" }}>The plan: {item.plan.domain}</summary>
          <div className="small" style={{ margin: "4px 0 4px 12px" }}>
            <div><strong>Scope:</strong> {item.plan.scope}</div>
            <div><strong>Success:</strong> {item.plan.success}</div>
            {item.plan.hypotheses.length ? <div><strong>Hypotheses:</strong> {item.plan.hypotheses.join(" · ")}</div> : null}
            {item.plan.variables.length ? <div><strong>Variables:</strong> {item.plan.variables.map((v) => `${v.name} (${v.range} ${v.unit})`).join(" · ")}</div> : null}
          </div>
        </details>
      ) : null}

      {item.insufficient ? (
        <Banner kind="error">Not enough evidence was found to answer this, so nothing is concluded. The questions it could not answer are listed below; try rewording or narrowing the objective.</Banner>
      ) : null}

      {item.answers?.length ? (
        <>
          <div className="section-title">What it figured out</div>
          {item.answers.map((a, i) => (
            <details key={i} open={a.verdict !== "not answered" && i < 3}>
              <summary className="small" style={{ cursor: "pointer" }}>
                <span className={`tag ${a.verdict === "supported" || a.verdict === "answered" ? "ok" : a.verdict === "not answered" ? "" : "warn"}`}>{a.verdict}</span>{" "}
                {a.confidence !== "none" ? <span className={`tag ${a.confidence === "high" ? "ok" : a.confidence === "low" ? "bad" : "warn"}`}>{a.confidence}</span> : null} {a.kind === "hypothesis" ? "Hypothesis: " : ""}
                {a.question}
              </summary>
              <div className="small" style={{ margin: "4px 0 6px 12px" }}>
                <div>{a.answer}</div>
                <div className="muted">
                  {a.supporting.length ? `Supported by F${a.supporting.join(", F")}` : "No finding supports it"}
                  {a.refuting.length ? ` · contradicted by F${a.refuting.join(", F")}` : ""} · {a.strength.peerReviewed} peer-reviewed
                </div>
              </div>
            </details>
          ))}
        </>
      ) : null}

      {report ? (
        <>
          <div className="section-title">Summary</div>
          <p className="small" style={{ marginTop: 0 }}>{report.executiveSummary}</p>
          <p className="small muted">{report.methodology}</p>
          <div className="section-title">Recommendations and their evidence</div>
          {item.evidenceMatrix.map((row, i) => (
            <details key={i} open={i === 0}>
              <summary className="small" style={{ cursor: "pointer" }}>
                <span className={`tag ${row.confidence === "high" ? "ok" : row.confidence === "low" ? "bad" : "warn"}`}>{row.confidence}</span> {row.recommendation} {row.uncited ? <span className="tag bad">no evidence cited</span> : null}
              </summary>
              <div className="small" style={{ marginLeft: 12 }}>
                <div>{report.recommendations[i]?.detail}</div>
                {row.findings.map((f) => (
                  <div key={f.id} className="muted">
                    F{f.id}: {f.claim} {f.url ? <a href={f.url} target="_blank" rel="noreferrer">{f.source ?? "source"}</a> : null} <span className="tag">{f.status}</span>
                  </div>
                ))}
              </div>
            </details>
          ))}
          {list("Procedure", report.procedure)}
          {list("Limitations", report.limitations)}
          {list("Still needs a person and the real world", report.physicalTestsNeeded)}
          {list("Still open", report.unresolved)}
          {report.confidenceNotes ? <p className="small muted">{report.confidenceNotes}</p> : null}
        </>
      ) : null}

      {item.experiments.length ? (
        <>
          <div className="section-title">Experiments</div>
          {item.experiments.map((e) => (
            <details key={e.id}>
              <summary className="small" style={{ cursor: "pointer" }}>
                <span className={`tag ${e.state === "done" ? "ok" : e.state === "failed" ? "bad" : "warn"}`}>{e.state}</span> {e.title} {e.kind === "physical" ? <span className="tag">physical</span> : null}
              </summary>
              <div className="small" style={{ marginLeft: 12 }}>
                <div><strong>Hypothesis:</strong> {e.hypothesis}</div>
                {e.method ? <div><strong>Method:</strong> {e.method}</div> : null}
                {e.assumptions.length ? <div><strong>Assumptions:</strong> {e.assumptions.join(" · ")}</div> : null}
                {e.physicalProtocol ? <div><strong>What a person must do:</strong> {e.physicalProtocol}</div> : null}
                {e.error ? <div style={{ color: "var(--bad)" }}>{e.error}</div> : null}
                {e.result ? (
                  <>
                    <div>
                      Computed {e.result.evaluated} combinations{e.result.repeatable ? ", and the best reproduced exactly" : ", NOT reproducible"}. This is what the model computes under those assumptions, not a measurement.
                    </div>
                    <div><strong>Best:</strong> {JSON.stringify(e.result.best.params)} → {JSON.stringify(e.result.best.metrics)}</div>
                    {e.result.baseline ? <div><strong>Baseline:</strong> {JSON.stringify(e.result.baseline.params)} → {JSON.stringify(e.result.baseline.metrics)}</div> : null}
                    <div><strong>What matters most:</strong> {e.result.sensitivity.map((s) => `${s.variable} (${Math.round(s.share * 100)}%)`).join(", ")}</div>
                    {e.conclusion ? <div><strong>Conclusion:</strong> {e.conclusion}</div> : null}
                    {e.code ? <details><summary className="muted" style={{ cursor: "pointer" }}>The model, as code</summary><pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{e.code}</pre></details> : null}
                  </>
                ) : null}
              </div>
            </details>
          ))}
        </>
      ) : null}

      {item.contradictions.length ? (
        <>
          <div className="section-title">Contradictions</div>
          {item.contradictions.map((c, i) => (
            <div key={i} className="small" style={{ marginBottom: 6 }}>
              <strong>{c.about}</strong>
              <div>A: {c.sideA.claim} <span className="muted">(F{c.sideA.findings.join(", F")})</span></div>
              <div>B: {c.sideB.claim} <span className="muted">(F{c.sideB.findings.join(", F")})</span></div>
              <div className="muted">{c.assessment}</div>
            </div>
          ))}
        </>
      ) : null}

      <div className="section-title">Specialists</div>
      {item.specialistsDetail.map((s) => (
        <details key={s.id}>
          <summary className="small" style={{ cursor: "pointer" }}>
            <span className={`tag ${s.status === "done" ? "ok" : s.status === "researching" ? "info" : ""}`}>{s.status}</span> {s.name} <span className="muted">· {s.summary?.findingCount ?? 0} findings from {s.summary?.sourceCount ?? 0} sources{s.doneWhy ? ` · ${s.doneWhy}` : ""}</span>
          </summary>
          <div className="small" style={{ marginLeft: 12 }}>
            <div className="muted">{s.objective}</div>
            {s.findings.map((f) => (
              <div key={f.id}>
                F{f.id}: {f.claim} <span className="muted">{Math.round(f.confidence * 100)}%</span> {f.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noreferrer">{f.sourceTitle ?? "source"}</a> : null}
              </div>
            ))}
          </div>
        </details>
      ))}

      {item.sourceRegister.length ? (
        <details style={{ marginTop: 6 }}>
          <summary className="small" style={{ cursor: "pointer" }}>Source register · {item.sourceRegister.length}</summary>
          {item.sourceRegister.map((s) => (
            <div key={s.id} className="small" style={{ marginLeft: 12 }}>
              <a href={s.url} target="_blank" rel="noreferrer">{s.title || s.url}</a> <span className="muted">· {s.credibility} · {s.area}</span>
            </div>
          ))}
        </details>
      ) : null}

      <div className="section-title">Your feedback</div>
      {item.feedback.map((f, i) => (
        <div key={i} className="small">{f.text} <span className="muted">· {ago(f.at)}{f.followUp ? ` · ${f.followUp}` : ""}</span></div>
      ))}
      <div className="learn-plan">
        <input className="input" style={{ flex: 1 }} placeholder="A correction, or what to look into next…" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn small" disabled={!text.trim()} onClick={() => void api.investigationFeedback(id, text.trim()).then(() => { setText(""); toast("It becomes a question the specialists must answer.", "ok"); return data.refresh(); }).catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))}>Send</button>
      </div>
    </div>
  );
}

export default function Investigations() {
  const toast = useToast();
  const list = useRemote(() => api.investigations(), 15000, "investigations");
  const [objective, setObjective] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const items = list.data?.investigations ?? [];
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="section-title" style={{ marginTop: 0 }}>Deep investigation</div>
      <p className="small" style={{ margin: "4px 0 8px" }}>
        Give it an objective, like how to make the best-tasting coffee. It plans the investigation for that subject, sends specialists to research every aspect from sources, computes what can be computed, names what only the real world can answer, flags contradictions, and writes findings that cite their evidence.
      </p>
      <div className="learn-plan">
        <input className="input" style={{ flex: 1 }} placeholder="What do you want found out?" value={objective} onChange={(e) => setObjective(e.target.value)} />
        <button
          className="btn primary"
          disabled={busy || objective.trim().length < 8}
          onClick={() => {
            setBusy(true);
            api
              .startInvestigation(objective.trim())
              .then((d) => {
                setObjective("");
                setOpen(d.investigation.id);
                toast("Under way. This takes hours: it reads real sources.", "ok");
                return list.refresh();
              })
              .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Busy label="Starting…" /> : "Investigate"}
        </button>
      </div>
      {items.map((item) => (
        <div key={item.id} style={{ marginTop: 8, borderTop: "1px solid var(--line, rgba(255,255,255,.08))", paddingTop: 6 }}>
          <div className="small" style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap", cursor: "pointer" }} onClick={() => setOpen(open === item.id ? null : item.id)}>
            <span className={`tag ${stateTag(item.state)}`}>{item.state}</span> <strong>{item.objective}</strong>
            <span className="muted">
              {item.phase} · {item.specialistsDone}/{item.specialists} specialists · {ago(item.createdAt)}
            </span>
            {["done", "failed", "stopped"].includes(item.state) ? (
              item.state !== "done" ? <button className="btn small ghost" onClick={(e) => { e.stopPropagation(); void api.investigationAction(item.id, "resume").then(() => list.refresh()); }}>Carry on</button> : null
            ) : (
              <button className="btn small ghost" onClick={(e) => { e.stopPropagation(); void api.investigationAction(item.id, "stop").then(() => list.refresh()); }}>Stop</button>
            )}
          </div>
          {open === item.id ? <Report id={item.id} /> : null}
        </div>
      ))}
    </div>
  );
}
