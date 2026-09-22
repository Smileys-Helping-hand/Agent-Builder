"use client";

import { useState } from "react";

import { api, type Project } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";

type Filter = "all" | "attention" | "dirty" | "unpushed";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "attention", label: "Needs a look" },
  { id: "dirty", label: "Uncommitted" },
  { id: "unpushed", label: "Unpushed" }
];

const initials = (name: string): string =>
  name
    .replace(/[^a-zA-Z0-9 -]/g, "")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "?";

export default function Projects() {
  const connected = useConnected();
  const toast = useToast();
  const projects = useRemote(() => api.projects(), 60000);
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Record<string, { kind: "ok" | "error" | "info"; text: string }>>({});
  const [context, setContext] = useState<Record<string, string>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  if (connected === false) return <NotConnected />;

  const act = async (project: Project, what: "diagnose" | "repair" | "context") => {
    setBusy(`${project.id}:${what}`);
    try {
      if (what === "context") {
        const result = await api.projectContext(project.id);
        setContext((current) => ({ ...current, [project.id]: result.markdown }));
      } else if (what === "diagnose") {
        const result = await api.diagnose(project.id);
        const text = result.passed
          ? `All checks pass (${result.score}/100).`
          : `Scored ${result.score}/100 - ${result.issues} problem(s) recorded.`;
        setOutcome((current) => ({ ...current, [project.id]: { kind: result.passed ? "ok" : "error", text } }));
        toast(`${project.name}: ${text}`, result.passed ? "ok" : "info");
      } else {
        const result = await api.repair(project.id);
        const text = result.reason
          ? result.reason
          : `${result.passed ? "Fixed" : "Improved"}: ${result.startScore} → ${result.finalScore}${result.branch ? ` on ${result.branch}` : ""}.`;
        setOutcome((current) => ({ ...current, [project.id]: { kind: result.passed ? "ok" : "info", text } }));
        toast(`${project.name}: ${text}`, result.passed ? "ok" : "info");
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      setOutcome((current) => ({ ...current, [project.id]: { kind: "error", text } }));
      toast(text, "error");
    } finally {
      setBusy(null);
    }
  };

  const rescan = async () => {
    setBusy("scan");
    try {
      const result = await api.scan();
      await projects.refresh();
      toast(`Scanned ${result.scanned} project(s)`, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const all = projects.data?.projects ?? [];
  const list = all
    .filter((project) => {
      if (filter === "dirty") return project.gitDirty > 0;
      if (filter === "unpushed") return project.gitAhead > 0;
      if (filter === "attention") return project.gitDirty > 0 || project.gitAhead > 0 || project.gitBehind > 0;
      return true;
    })
    .filter((project) =>
      query ? `${project.name} ${project.stack.join(" ")} ${project.path}`.toLowerCase().includes(query.toLowerCase()) : true
    );

  return (
    <>
      <Header title="Projects" sub={all.length ? `${all.length} on this machine` : "Loading…"} state={projects.error ? "down" : "up"} />

      <div className="wrap">
        {projects.error ? <Banner kind="error">{projects.error}</Banner> : null}

        <div className="card">
          <input placeholder="Search projects…" value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="filters">
            {FILTERS.map((option) => (
              <button key={option.id} className={filter === option.id ? "on" : ""} onClick={() => setFilter(option.id)}>
                {option.label}
              </button>
            ))}
          </div>
          <div className="btn-row" style={{ marginTop: 11 }}>
            <button className="btn small" onClick={rescan} disabled={busy === "scan"}>
              {busy === "scan" ? <Busy label="Scanning…" /> : <>{Icon.refresh} Rescan machine</>}
            </button>
          </div>
        </div>

        {projects.loading ? <Skeleton rows={5} /> : null}

        {list.map((project) => {
          const isOpen = open === project.id;
          const result = outcome[project.id];
          return (
            <div key={project.id} className="card">
              <div className="project" onClick={() => setOpen(isOpen ? null : project.id)}>
                <div className="project-icon">{initials(project.name)}</div>
                <div className="body">
                  <strong style={{ fontSize: 15 }}>{project.name}</strong>
                  <span>
                    {project.gitBranch ?? "no branch"}
                    {project.lastCommitAt ? ` · ${ago(project.lastCommitAt)}` : ""}
                  </span>
                  <div className="chips">
                    {project.stack.slice(0, 2).map((item) => (
                      <span key={item} className="chip">
                        {item}
                      </span>
                    ))}
                    {project.gitDirty > 0 ? <span className="chip warn">{project.gitDirty} uncommitted</span> : null}
                    {project.gitAhead > 0 ? <span className="chip accent">{project.gitAhead} unpushed</span> : null}
                  </div>
                </div>
                <span style={{ color: "var(--faint)", fontSize: 20, lineHeight: 1 }}>{isOpen ? "−" : "+"}</span>
              </div>

              {isOpen ? (
                <div className="fade-in" style={{ marginTop: 14 }}>
                  <p className="hint" style={{ marginBottom: 11 }}>
                    {project.lastCommitSubject ?? "No commits recorded."}
                  </p>

                  <div className="btn-row">
                    <button className="btn small" onClick={() => act(project, "context")} disabled={Boolean(busy)}>
                      {busy === `${project.id}:context` ? <Busy label="Reading" /> : <>{Icon.book} Briefing</>}
                    </button>
                    <button className="btn small" onClick={() => act(project, "diagnose")} disabled={Boolean(busy)}>
                      {busy === `${project.id}:diagnose` ? <Busy label="Checking" /> : <>{Icon.stethoscope} Diagnose</>}
                    </button>
                    <button className="btn small primary" onClick={() => act(project, "repair")} disabled={Boolean(busy)}>
                      {busy === `${project.id}:repair` ? <Busy label="Repairing" /> : <>{Icon.wrench} Repair</>}
                    </button>
                  </div>

                  {busy?.startsWith(project.id) ? (
                    <p className="hint" style={{ marginTop: 10, marginBottom: 0 }}>
                      This runs on your PC and can take several minutes. You can leave this screen.
                    </p>
                  ) : null}

                  {result ? <Banner kind={result.kind}>{result.text}</Banner> : null}
                  {context[project.id] ? <pre className="md">{context[project.id]}</pre> : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {!projects.loading && list.length === 0 ? (
          <div className="card">
            <div className="empty">Nothing matches that.</div>
          </div>
        ) : null}
      </div>
    </>
  );
}
