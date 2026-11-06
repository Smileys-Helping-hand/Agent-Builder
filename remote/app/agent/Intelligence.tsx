"use client";

/**
 * The Simulation Lab, Activity, the Knowledge Graph and Iterations across every
 * session: the connected views over the evidence ledger.
 */
import { useEffect, useMemo, useState } from "react";

import { api, type EvidenceGraph, type EvidenceRecord, type ImproveSession, type LabExperiment, type ProjectTwinRecord } from "@/lib/api";
import { Busy, Skeleton, ago, useRemote, useToast } from "../ui";
import IterationExplorer from "./IterationExplorer";

/** What a reference points at, for moving between records. */
const linkOf = (ref: string): string | null => {
  const [kind, id, n] = ref.split(":");
  if (kind === "vmrun") return `/lab/?run=${id}`;
  if (kind === "vm") return "/lab/";
  if (kind === "investigation" || kind === "topic") return "/research/";
  if (kind === "lesson") return "/agent/?tab=learning";
  if (kind === "experiment") return "/agent/?tab=simulation";
  if (kind === "session" || (kind === "step" && n)) return "/agent/?tab=iterations";
  return null;
};

function Trace({ target, onOpen }: { target: string; onOpen: (ref: string) => void }) {
  const [trace, setTrace] = useState<Awaited<ReturnType<typeof api.evidenceTrace>> | null>(null);
  useEffect(() => {
    api.evidenceTrace(target).then(setTrace).catch(() => undefined);
  }, [target]);
  if (!trace) return <Skeleton rows={1} />;
  const page = linkOf(target);
  return (
    <div className="small" style={{ margin: "4px 0 8px 14px" }}>
      {page ? <a href={page}>Open it</a> : null}
      {trace.records.map((r) => r.data ? <pre key={r.id} style={{ whiteSpace: "pre-wrap", fontSize: 11, maxHeight: 160, overflow: "auto" }}>{JSON.stringify(r.data, null, 1)}</pre> : null)}
      {trace.outgoing.map((l, i) => (
        <div key={`o${i}`}>
          → <span className="muted">{l.relation}</span> <a href="#" onClick={(e) => { e.preventDefault(); onOpen(l.to); }}>{l.to}</a>
        </div>
      ))}
      {trace.incoming.map((l, i) => (
        <div key={`i${i}`}>
          ← <span className="muted">{l.relation}</span> <a href="#" onClick={(e) => { e.preventDefault(); onOpen(l.from); }}>{l.from}</a>
        </div>
      ))}
    </div>
  );
}

export function Activity() {
  const data = useRemote(() => api.evidence(100), 15000, "agent-activity");
  const [kind, setKind] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  if (!data.data) return <Skeleton rows={4} />;
  const records: EvidenceRecord[] = kind === "all" ? data.data.records : data.data.records.filter((r) => r.kind === kind);
  return (
    <>
      <p className="small" style={{ marginTop: 0 }}>Everything the agents have done that matters later, newest first. Open one to follow where it came from and what it led to, in both directions.</p>
      <div className="btn-row" style={{ flexWrap: "wrap", marginBottom: 8 }}>
        <button className={`btn small ${kind === "all" ? "primary" : "ghost"}`} onClick={() => setKind("all")}>All</button>
        {Object.entries(data.data.counts).map(([name, count]) => (
          <button key={name} className={`btn small ${kind === name ? "primary" : "ghost"}`} onClick={() => setKind(name)}>{name} · {count}</button>
        ))}
      </div>
      {records.map((record) => (
        <div key={record.id}>
          <div className="small" style={{ padding: "3px 0", cursor: "pointer" }} onClick={() => setOpen(open === record.ref ? null : record.ref)}>
            <span className="tag">{record.kind}</span> {record.title} <span className="muted">· {record.agent ?? ""} · {ago(record.createdAt)}{record.outcome ? ` · ${record.outcome}` : ""}</span>
          </div>
          {open === record.ref ? <Trace target={record.ref} onOpen={setOpen} /> : null}
        </div>
      ))}
    </>
  );
}

const KIND_COLOURS: Record<string, string> = { step: "#38bdf8", session: "#0ea5e9", "vm-test": "#f97316", vmrun: "#f97316", vm: "#fb923c", research: "#a78bfa", investigation: "#a78bfa", topic: "#c4b5fd", finding: "#c084fc", experiment: "#34d399", lesson: "#facc15", knowledge: "#facc15", feedback: "#f87171", evaluation: "#2dd4bf" };

/** A simple force layout, run a fixed number of steps so it settles. */
const layout = (graph: EvidenceGraph, width: number, height: number) => {
  const points = graph.nodes.map((node, i) => {
    const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
    return { ref: node.ref, x: width / 2 + Math.cos(angle) * width * 0.35, y: height / 2 + Math.sin(angle) * height * 0.35 };
  });
  const at = new Map(points.map((p, i) => [p.ref, i]));
  for (let step = 0; step < 220; step++) {
    const force = points.map(() => ({ x: 0, y: 0 }));
    for (let a = 0; a < points.length; a++) {
      for (let b = a + 1; b < points.length; b++) {
        const dx = points[a].x - points[b].x;
        const dy = points[a].y - points[b].y;
        const d2 = Math.max(60, dx * dx + dy * dy);
        const push = 2200 / d2;
        force[a].x += dx * push;
        force[a].y += dy * push;
        force[b].x -= dx * push;
        force[b].y -= dy * push;
      }
    }
    for (const edge of graph.edges) {
      const a = at.get(edge.from);
      const b = at.get(edge.to);
      if (a === undefined || b === undefined) continue;
      const dx = points[b].x - points[a].x;
      const dy = points[b].y - points[a].y;
      force[a].x += dx * 0.02;
      force[a].y += dy * 0.02;
      force[b].x -= dx * 0.02;
      force[b].y -= dy * 0.02;
    }
    points.forEach((p, i) => {
      p.x = Math.min(width - 12, Math.max(12, p.x + Math.max(-14, Math.min(14, force[i].x + (width / 2 - p.x) * 0.004))));
      p.y = Math.min(height - 12, Math.max(12, p.y + Math.max(-14, Math.min(14, force[i].y + (height / 2 - p.y) * 0.004))));
    });
  }
  return new Map(points.map((p) => [p.ref, p]));
};

export function KnowledgeGraph() {
  const [center, setCenter] = useState<string | null>(null);
  const [graph, setGraph] = useState<EvidenceGraph | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  useEffect(() => {
    api.evidenceGraph(center ?? undefined).then(setGraph).catch(() => undefined);
  }, [center]);
  const width = 900;
  const height = 560;
  const positions = useMemo(() => (graph ? layout(graph, width, height) : new Map()), [graph]);
  if (!graph) return <Skeleton rows={5} />;
  const focused = graph.nodes.find((n) => n.ref === (hover ?? center));
  return (
    <>
      <p className="small" style={{ marginTop: 0 }}>
        How the records connect: an investigation to its specialists, a step to the VM test that tested it, feedback to what it was about. Click a point to centre on it. {graph.nodes.length} records, {graph.edges.length} links.
      </p>
      {center ? <button className="btn small ghost" onClick={() => setCenter(null)}>Back to everything recent</button> : null}
      {graph.nodes.length === 0 ? <p className="small muted">No links yet.</p> : (
        <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", background: "rgba(0,0,0,.25)", borderRadius: 10, marginTop: 6 }}>
          {graph.edges.map((edge, i) => {
            const a = positions.get(edge.from);
            const b = positions.get(edge.to);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="rgba(255,255,255,.22)" strokeWidth={1} />;
          })}
          {graph.nodes.map((node) => {
            const p = positions.get(node.ref);
            if (!p) return null;
            return (
              <g key={node.ref} style={{ cursor: "pointer" }} onClick={() => setCenter(node.ref)} onMouseEnter={() => setHover(node.ref)} onMouseLeave={() => setHover(null)}>
                <circle cx={p.x} cy={p.y} r={node.ref === center ? 10 : 6} fill={KIND_COLOURS[node.kind] ?? "#94a3b8"} />
              </g>
            );
          })}
        </svg>
      )}
      <div className="small" style={{ minHeight: 40, marginTop: 6 }}>
        {focused ? (
          <>
            <span className="tag">{focused.kind}</span> {focused.title} {focused.outcome ? <span className="muted">· {focused.outcome}</span> : null} {linkOf(focused.ref) ? <a href={linkOf(focused.ref)!}>Open</a> : null}
          </>
        ) : (
          <span className="muted">Point at a record to read it.</span>
        )}
      </div>
    </>
  );
}

function ExperimentCard({ item, onChange }: { item: LabExperiment; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const last = item.runs[item.runs.length - 1]?.result ?? null;
  const act = (what: string, call: () => Promise<unknown>) => {
    setBusy(what);
    call()
      .then(onChange)
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
      .finally(() => setBusy(null));
  };
  return (
    <details className="card" style={{ marginTop: 8 }}>
      <summary className="small" style={{ cursor: "pointer" }}>
        <span className={`tag ${item.state === "done" ? "ok" : item.state === "failed" ? "bad" : "info"}`}>{item.state}</span> <strong>{item.title}</strong>{" "}
        {last ? <span className="muted">best {item.objective} = {last.best.metrics[item.objective]} · {item.runs.length} runs</span> : null}
      </summary>
      <div className="small" style={{ marginTop: 6 }}>
        {item.hypothesis ? <div><strong>Hypothesis:</strong> {item.hypothesis}</div> : null}
        {item.assumptions.length ? <div><strong>Assumptions:</strong> {item.assumptions.join(" · ")}</div> : null}
        {item.error ? <div style={{ color: "var(--bad)" }}>{item.error}</div> : null}
        {last ? (
          <>
            <div style={{ marginTop: 4 }}>Computed {last.evaluated} combinations{last.repeatable ? ", and the best reproduced exactly" : ", NOT reproducible"}. This is what the code computes under those assumptions, not a measurement.</div>
            <div><strong>Best:</strong> {JSON.stringify(last.best.params)} → {JSON.stringify(last.best.metrics)}</div>
            {last.baseline ? <div><strong>Baseline:</strong> {JSON.stringify(last.baseline.metrics)}</div> : null}
            <div><strong>What matters most:</strong> {last.sensitivity.map((s) => `${s.variable} (${Math.round(s.share * 100)}%)`).join(", ")}</div>
          </>
        ) : null}
        {item.optimised.length ? (
          <div style={{ marginTop: 4 }}>
            <strong>The optimiser:</strong>
            {item.optimised.map((o) => (
              <div key={o.round} className="muted">Round {o.round}: looked closer at {o.focused.join(", ") || "nothing new"} → {o.best} at {JSON.stringify(o.params)}</div>
            ))}
          </div>
        ) : null}
        <div className="btn-row" style={{ marginTop: 6 }}>
          <button className="btn small" disabled={busy !== null} onClick={() => act("run", () => api.runExperiment(item.id))}>{busy === "run" ? <Busy label="Running" /> : "Run with another seed"}</button>
          <button className="btn small" disabled={busy !== null} onClick={() => act("opt", () => api.optimiseExperiment(item.id, 3))}>{busy === "opt" ? <Busy label="Searching" /> : "Optimise (3 rounds)"}</button>
        </div>
        <details style={{ marginTop: 6 }}>
          <summary className="muted" style={{ cursor: "pointer" }}>The code</summary>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11 }}>{item.code}</pre>
        </details>
      </div>
    </details>
  );
}

export function SimulationLabPanel() {
  const toast = useToast();
  const data = useRemote(() => api.experiments(), 20000, "agent-experiments");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  if (!data.data) return <Skeleton rows={3} />;
  return (
    <>
      <p className="small" style={{ marginTop: 0 }}>
        Computed experiments, run in a sandbox: every combination evaluated, ranked, with sensitivity and a reproducibility check. The optimiser picks each next round from the last one, looking closer at what matters most. Results are what the code computes under its assumptions, and say so.
      </p>
      <div className="card">
        <input className="input" style={{ width: "100%" }} placeholder="Name it" value={title} onChange={(e) => setTitle(e.target.value)} />
        <textarea className="input" rows={2} style={{ width: "100%", marginTop: 6 }} placeholder="What to simulate, e.g. how far a thrown ball goes against angle, speed and air resistance" value={description} onChange={(e) => setDescription(e.target.value)} />
        <button
          className="btn small primary"
          style={{ marginTop: 6 }}
          disabled={busy || !title.trim() || description.trim().length < 10}
          onClick={() => {
            setBusy(true);
            api
              .createExperiment({ title: title.trim(), description: description.trim() })
              .then(() => {
                setTitle("");
                setDescription("");
                toast("The model writes it, then it runs. It appears here.", "ok");
                return data.refresh();
              })
              .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
              .finally(() => setBusy(false));
          }}
        >
          {busy ? <Busy label="Writing it…" /> : "Simulate"}
        </button>
      </div>
      {data.data.experiments.map((item) => (
        <ExperimentCard key={item.id} item={item} onChange={() => void data.refresh()} />
      ))}
      {data.data.fromInvestigations.length ? (
        <>
          <div className="section-title">From investigations</div>
          {data.data.fromInvestigations.map((e) => (
            <div key={e.id} className="small" style={{ marginBottom: 4 }}>
              <span className={`tag ${e.state === "done" ? "ok" : e.state === "failed" ? "bad" : "warn"}`}>{e.state}</span> {e.title} <span className="muted">· {e.objective.slice(0, 60)}{e.best ? ` · best ${JSON.stringify(e.best.metrics)}` : ""}</span>
              {e.conclusion ? <div className="muted">{e.conclusion}</div> : null}
              {e.physicalProtocol ? <div className="muted">A person must: {e.physicalProtocol}</div> : null}
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}

function Twin({ projectId }: { projectId: string }) {
  const [twin, setTwin] = useState<ProjectTwinRecord | null>(null);
  useEffect(() => {
    api.projectTwin(projectId).then((d) => setTwin(d.twin)).catch(() => undefined);
  }, [projectId]);
  if (!twin) return <Skeleton rows={1} />;
  return (
    <div className="small" style={{ margin: "4px 0 8px" }}>
      {twin.stack.length ? <div><strong>Built with:</strong> {twin.stack.join(", ")}</div> : null}
      <div><strong>Parts:</strong> {twin.parts.slice(0, 10).map((p) => `${p.folder} (${p.files})`).join(", ")}</div>
      <div><strong>Can do ({twin.capabilities.length}):</strong> {twin.capabilities.slice(-8).join(" · ") || "nothing finished yet"}</div>
      <div><strong>Known defects ({twin.defects.length}):</strong></div>
      {twin.defects.slice(0, 10).map((d, i) => (
        <div key={i} className="muted">[{d.kind}] {d.text}</div>
      ))}
      {twin.mostChanged.length ? <div><strong>Changes most:</strong> {twin.mostChanged.slice(0, 5).map((f) => f.file).join(", ")}</div> : null}
    </div>
  );
}

export function IterationsAll() {
  const data = useRemote(() => api.continuous(), 30000, "agent-iterations");
  const [open, setOpen] = useState<string | null>(null);
  if (!data.data) return <Skeleton rows={3} />;
  const sessions: ImproveSession[] = data.data.sessions;
  return (
    <>
      <p className="small" style={{ marginTop: 0 }}>Every project's iterations. Click a project, then any iteration, running or finished, to see what changed, why, what was learned and what was tested.</p>
      {sessions.map((s) => (
        <div key={s.id} className="card" style={{ marginTop: 8 }}>
          <div className="small" style={{ cursor: "pointer" }} onClick={() => setOpen(open === s.id ? null : s.id)}>
            <span className={`tag ${s.state === "stopped" ? "" : "ok"}`}>{s.state}</span> <strong>{s.projectName}</strong> <span className="muted">{s.stage} · {s.plan.filter((m) => m.status === "done").length}/{s.plan.length} milestones · {s.journal.length} iterations · {s.phase.slice(0, 80)}</span>
          </div>
          {open === s.id ? (
            <>
              <Twin projectId={s.projectId} />
              <IterationExplorer sessionId={s.id} />
            </>
          ) : null}
        </div>
      ))}
    </>
  );
}
