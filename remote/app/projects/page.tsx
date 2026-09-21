"use client";

import { useState } from "react";

import { api, type Project } from "@/lib/api";
import { Banner, Busy, Header, NotConnected, ago, useConnected, useRemote } from "../ui";

type Outcome = { kind: "ok" | "error" | "info"; text: string };

export default function Projects() {
  const connected = useConnected();
  const projects = useRemote(() => api.projects(), 60000);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, Outcome>>({});
  const [context, setContext] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState("");

  if (connected === false) return <NotConnected />;

  const act = async (project: Project, what: "diagnose" | "repair" | "context") => {
    setBusy(`${project.id}:${what}`);
    try {
      if (what === "context") {
        const result = await api.projectContext(project.id);
        setContext((current) => ({ ...current, [project.id]: result.markdown }));
      } else if (what === "diagnose") {
        const result = await api.diagnose(project.id);
        setOutcome((current) => ({
          ...current,
          [project.id]: {
            kind: result.passed ? "ok" : "error",
            text: result.passed
              ? `All checks pass (${result.score}/100).`
              : `Scored ${result.score}/100 — ${result.issues} problem(s) recorded.`
          }
        }));
      } else {
        const result = await api.repair(project.id);
        setOutcome((current) => ({
          ...current,
          [project.id]: {
            kind: result.passed ? "ok" : "info",
            text: result.reason
              ? result.reason
              : `${result.passed ? "Fixed" : "Improved"}: ${result.startScore} → ${result.finalScore}${result.branch ? ` on ${result.branch}` : ""}.`
          }
        }));
      }
    } catch (error) {
      setOutcome((current) => ({
        ...current,
        [project.id]: { kind: "error", text: error instanceof Error ? error.message : String(error) }
      }));
    } finally {
      setBusy(null);
    }
  };

  const rescan = async () => {
    setBusy("scan");
    try {
      await api.scan();
      await projects.refresh();
    } finally {
      setBusy(null);
    }
  };

  const list = (projects.data?.projects ?? []).filter((project) =>
    filter ? `${project.name} ${project.stack.join(" ")} ${project.path}`.toLowerCase().includes(filter.toLowerCase()) : true
  );

  return (
    <>
      <Header title="Projects" sub={projects.data ? `${projects.data.projects.length} on this machine` : "Loading…"} />
      <div className="wrap">
        {projects.error ? <Banner kind="error">{projects.error}</Banner> : null}

        <div className="card">
          <input placeholder="Search projects…" value={filter} onChange={(event) => setFilter(event.target.value)} />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn small" onClick={rescan} disabled={busy === "scan"}>
              {busy === "scan" ? <Busy label="Scanning…" /> : "Rescan machine"}
            </button>
          </div>
        </div>

        {list.map((project) => {
          const isOpen = open === project.id;
          const result = outcome[project.id];
          return (
            <div key={project.id} className="card">
              <div
                style={{ display: "flex", gap: 12, alignItems: "center", cursor: "pointer" }}
                onClick={() => setOpen(isOpen ? null : project.id)}
              >
                <span className={`pill ${project.gitDirty > 0 ? "degraded" : "up"}`} />
                <div className="body" style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 15 }}>{project.name}</strong>
                  <span style={{ color: "var(--muted)", fontSize: 13 }}>
                    {project.gitBranch ?? "no branch"}
                    {project.gitDirty > 0 ? ` · ${project.gitDirty} uncommitted` : ""}
                    {project.gitAhead > 0 ? ` · ${project.gitAhead} unpushed` : ""}
                    {project.lastCommitAt ? ` · ${ago(project.lastCommitAt)}` : ""}
                  </span>
                </div>
                <span style={{ color: "var(--muted)", fontSize: 18 }}>{isOpen ? "−" : "+"}</span>
              </div>

              {isOpen ? (
                <div style={{ marginTop: 14 }}>
                  <p className="hint" style={{ marginBottom: 10 }}>
                    {project.stack.join(" · ") || project.kind}
                    <br />
                    {project.lastCommitSubject ?? "No commits recorded."}
                  </p>

                  <div className="btn-row">
                    <button className="btn small" onClick={() => act(project, "context")} disabled={Boolean(busy)}>
                      {busy === `${project.id}:context` ? <Busy label="Reading…" /> : "Briefing"}
                    </button>
                    <button className="btn small" onClick={() => act(project, "diagnose")} disabled={Boolean(busy)}>
                      {busy === `${project.id}:diagnose` ? <Busy label="Checking…" /> : "Diagnose"}
                    </button>
                    <button className="btn small primary" onClick={() => act(project, "repair")} disabled={Boolean(busy)}>
                      {busy === `${project.id}:repair` ? <Busy label="Repairing…" /> : "Repair"}
                    </button>
                  </div>

                  {busy?.startsWith(project.id) ? (
                    <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                      This runs on your PC and can take several minutes. You can leave the screen.
                    </p>
                  ) : null}

                  {result ? <Banner kind={result.kind}>{result.text}</Banner> : null}
                  {context[project.id] ? <pre className="md">{context[project.id]}</pre> : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {projects.loading ? (
          <div className="empty">
            <Busy label="Loading projects…" />
          </div>
        ) : list.length === 0 ? (
          <div className="empty">No projects match.</div>
        ) : null}
      </div>
    </>
  );
}
