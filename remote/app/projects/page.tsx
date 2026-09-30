"use client";

import { useEffect, useState } from "react";

import { api, type AiSession, type Commit, type Project, type ProjectEntry } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";
import { CloneCard, GitPanel, ProjectBuildList } from "./carry-on";

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
  const [history, setHistory] = useState<Record<string, { commits: Commit[]; sessions: AiSession[] }>>({});
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  // Advanced project management & code editing state
  const [activeTab, setActiveTab] = useState<Record<string, "overview" | "instruct" | "files" | "git">>({});
  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [projectTrees, setProjectTrees] = useState<Record<string, ProjectEntry[]>>({});
  const [openFiles, setOpenFiles] = useState<Record<string, { path: string; content: string }>>({});
  const [commitMessages, setCommitMessages] = useState<Record<string, string>>({});

  // New project creation state
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  // Home's "Clone from GitHub" tile lands here with ?clone=1: open the form.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("clone") === "1") setIsCloning(true);
  }, []);
  // Bumped when a build starts, so the build list under the instruction box refreshes at once.
  const [buildsKey, setBuildsKey] = useState(0);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [newProjectRoot, setNewProjectRoot] = useState("E:/Projects");
  const [newProjectTemplate, setNewProjectTemplate] = useState("node");

  if (connected === false) return <NotConnected />;

  const openProject = async (project: Project) => {
    const next = open === project.id ? null : project.id;
    setOpen(next);
    if (!next) return;

    if (!activeTab[project.id]) {
      setActiveTab((prev) => ({ ...prev, [project.id]: "overview" }));
    }

    if (!history[project.id]) {
      try {
        const [commitData, sessionData] = await Promise.all([api.commits(project.id), api.aiSessions(project.id)]);
        setHistory((current) => ({
          ...current,
          [project.id]: { commits: commitData.commits, sessions: sessionData.sessions }
        }));
      } catch {
        // history optional
      }
    }
  };

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

  const handleSendInstruction = async (project: Project) => {
    const text = instructions[project.id]?.trim();
    if (!text) {
      toast("Please enter an instruction.", "error");
      return;
    }
    setBusy(`${project.id}:instruct`);
    try {
      const res = await api.instructProject(project.id, text);
      toast(res.message, "ok");
      setInstructions((prev) => ({ ...prev, [project.id]: "" }));
      setBuildsKey((key) => key + 1);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const handleLoadTree = async (project: Project) => {
    setBusy(`${project.id}:tree`);
    try {
      const res = await api.projectTree(project.id);
      setProjectTrees((prev) => ({ ...prev, [project.id]: res.entries }));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const handleOpenFile = async (project: Project, path: string) => {
    setBusy(`${project.id}:file:${path}`);
    try {
      const res = await api.projectFile(project.id, path);
      setOpenFiles((prev) => ({ ...prev, [project.id]: { path: res.path, content: res.content } }));
      toast(`Opened ${res.path}`, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const handleSaveFile = async (project: Project) => {
    const file = openFiles[project.id];
    if (!file) return;
    setBusy(`${project.id}:save`);
    try {
      await api.editFile(project.id, file.path, file.content);
      toast(`Saved ${file.path} successfully.`, "ok");
      await projects.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const handleGitCommit = async (project: Project) => {
    const msg = commitMessages[project.id]?.trim();
    if (!msg) {
      toast("Please enter a commit message.", "error");
      return;
    }
    setBusy(`${project.id}:commit`);
    try {
      const res = await api.gitCommit(project.id, msg);
      toast(res.message, "ok");
      setCommitMessages((prev) => ({ ...prev, [project.id]: "" }));
      await projects.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
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

  const handleCreateProject = async () => {
    if (!newProjectName.trim()) {
      toast("Please enter a project name.", "error");
      return;
    }
    setBusy("create-project");
    try {
      const res = await api.createProject({
        name: newProjectName.trim(),
        description: newProjectDesc.trim(),
        root: newProjectRoot,
        template: newProjectTemplate
      });
      toast(`Project created: ${res.name}`, "ok");
      setIsCreatingProject(false);
      setNewProjectName("");
      setNewProjectDesc("");
      await projects.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const handleOpenOnPc = async (project: Project, target: "editor" | "folder") => {
    setBusy(`${project.id}:open:${target}`);
    try {
      const res = await api.openProject(project.id, target);
      toast(res.message, "ok");
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
      <Header title="Projects" sub={all.length ? `${all.length} on this machine · GitHub connected` : "Loading…"} state={projects.error ? "down" : "up"} />

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
            <button className="btn small accent" onClick={() => setIsCreatingProject(!isCreatingProject)}>
              {isCreatingProject ? "Cancel" : "✨ New Project"}
            </button>
            <button className="btn small" onClick={() => setIsCloning(!isCloning)}>
              {isCloning ? "Cancel" : "Clone from GitHub"}
            </button>
            <button className="btn small" onClick={rescan} disabled={busy === "scan"}>
              {busy === "scan" ? <Busy label="Scanning…" /> : <>{Icon.refresh} Rescan machine</>}
            </button>
          </div>
        </div>

        {isCloning ? <CloneCard onClose={() => setIsCloning(false)} onCloned={() => projects.refresh()} /> : null}

        {isCreatingProject ? (
          <div className="card" style={{ borderColor: "var(--accent)", backgroundColor: "rgba(99, 102, 241, 0.05)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong style={{ fontSize: 16 }}>✨ Create New Project on PC</strong>
              <button className="btn small" onClick={() => setIsCreatingProject(false)}>✕</button>
            </div>
            <p className="hint" style={{ marginTop: 4 }}>
              Scaffolds a new project directory on your PC, generates initial project files and Git repository, and makes it available instantly in your ecosystem.
            </p>
            <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
              <input
                placeholder="Project name (e.g. MyMobileApp, NextSaas, TradingBot)"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
              />
              <input
                placeholder="Description or primary goal (optional)"
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
              />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <select
                  value={newProjectRoot}
                  onChange={(e) => setNewProjectRoot(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 160,
                    padding: "8px 12px",
                    background: "var(--surface)",
                    color: "inherit",
                    border: "1px solid var(--line)",
                    borderRadius: 8
                  }}
                >
                  <option value="E:/Projects">Root: E:/Projects</option>
                  <option value="H:/ts">Root: H:/ts</option>
                </select>
                <select
                  value={newProjectTemplate}
                  onChange={(e) => setNewProjectTemplate(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 160,
                    padding: "8px 12px",
                    background: "var(--surface)",
                    color: "inherit",
                    border: "1px solid var(--line)",
                    borderRadius: 8
                  }}
                >
                  <option value="node">Template: Node.js / Fullstack</option>
                  <option value="python">Template: Python</option>
                  <option value="blank">Template: Minimal Blank</option>
                </select>
              </div>
              <div className="btn-row" style={{ marginTop: 4 }}>
                <button
                  className="btn primary"
                  onClick={handleCreateProject}
                  disabled={busy === "create-project" || !newProjectName.trim()}
                >
                  {busy === "create-project" ? <Busy label="Creating project…" /> : "Create & Initialize Project"}
                </button>
                <button className="btn" onClick={() => setIsCreatingProject(false)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {projects.loading ? <Skeleton rows={5} /> : null}

        {list.map((project) => {
          const isOpen = open === project.id;
          const result = outcome[project.id];
          const tab = activeTab[project.id] ?? "overview";
          const currentFile = openFiles[project.id];

          return (
            <div key={project.id} className="card">
              <div className="project" onClick={() => void openProject(project)}>
                <div className="project-icon">{initials(project.name)}</div>
                <div className="body">
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{project.name}</strong>
                    <span className="chip small">{project.kind}</span>
                  </div>
                  <span>
                    {project.gitBranch ? `Branch: ${project.gitBranch}` : "no git branch"}
                    {project.lastCommitAt ? ` · ${ago(project.lastCommitAt)}` : ""}
                  </span>
                  <div className="chips">
                    {project.stack.slice(0, 3).map((item) => (
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

                  {/* Navigation Tabs for Project */}
                  <div className="filters" style={{ marginBottom: 12 }}>
                    <button
                      className={tab === "overview" ? "on" : ""}
                      onClick={() => setActiveTab((p) => ({ ...p, [project.id]: "overview" }))}
                    >
                      Overview &amp; Checks
                    </button>
                    <button
                      className={tab === "instruct" ? "on" : ""}
                      onClick={() => setActiveTab((p) => ({ ...p, [project.id]: "instruct" }))}
                    >
                      AI Coder &amp; Build
                    </button>
                    <button
                      className={tab === "files" ? "on" : ""}
                      onClick={() => {
                        setActiveTab((p) => ({ ...p, [project.id]: "files" }));
                        if (!projectTrees[project.id]) void handleLoadTree(project);
                      }}
                    >
                      Browse &amp; Edit Files
                    </button>
                    <button
                      className={tab === "git" ? "on" : ""}
                      onClick={() => setActiveTab((p) => ({ ...p, [project.id]: "git" }))}
                    >
                      Git &amp; GitHub
                    </button>
                  </div>

                  {/* TAB 1: OVERVIEW */}
                  {tab === "overview" ? (
                    <div>
                      <div className="btn-row">
                        <button className="btn small" onClick={() => act(project, "context")} disabled={Boolean(busy)}>
                          {busy === `${project.id}:context` ? <Busy label="Reading" /> : <>{Icon.book} Briefing</>}
                        </button>
                        <button className="btn small" onClick={() => act(project, "diagnose")} disabled={Boolean(busy)}>
                          {busy === `${project.id}:diagnose` ? <Busy label="Checking" /> : <>{Icon.stethoscope} Diagnose</>}
                        </button>
                        <button className="btn small primary" onClick={() => act(project, "repair")} disabled={Boolean(busy)}>
                          {busy === `${project.id}:repair` ? <Busy label="Repairing" /> : <>{Icon.wrench} Auto Repair</>}
                        </button>
                        <button className="btn small" onClick={() => handleOpenOnPc(project, "editor")} disabled={Boolean(busy)}>
                          🖥️ Open in VS Code
                        </button>
                        <button className="btn small" onClick={() => handleOpenOnPc(project, "folder")} disabled={Boolean(busy)}>
                          📂 Open Folder
                        </button>
                      </div>

                      {history[project.id]?.commits.length ? (
                        <div style={{ marginTop: 14 }}>
                          <div className="section-title" style={{ margin: "0 0 4px" }}>
                            Recent commits
                          </div>
                          {history[project.id].commits.slice(0, 4).map((commit) => (
                            <div key={commit.hash} className="feed-item">
                              <span className="tag good">{commit.hash}</span>
                              <div className="text">
                                <p>{commit.subject}</p>
                                <time>
                                  {commit.relative} · {commit.author}
                                </time>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {history[project.id]?.sessions.length ? (
                        <div style={{ marginTop: 14 }}>
                          <div className="section-title" style={{ margin: "0 0 4px" }}>
                            Claude &amp; Gemini here
                          </div>
                          {history[project.id].sessions.slice(0, 3).map((session) => (
                            <div key={session.id} className="feed-item">
                              <span className={`tag ${session.source === "claude" ? "" : "warn"}`}>{session.source}</span>
                              <div className="text">
                                <p>{session.title}</p>
                                <time>{ago(session.updatedAt)}</time>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* TAB 2: INSTRUCT & AI CODER */}
                  {tab === "instruct" ? (
                    <div>
                      <p className="hint">
                        Tell it what to do next: a feature, a fix, a refactor. It works on a copy, so nothing in the project
                        changes until you look at what it did and apply it.
                      </p>
                      <textarea
                        rows={3}
                        style={{ width: "100%", padding: 10, borderRadius: 10, background: "rgba(0,0,0,0.3)", color: "inherit", border: "1px solid var(--line)" }}
                        placeholder="e.g. Add dark mode toggle, write tests for auth module, or optimize image loading..."
                        value={instructions[project.id] ?? ""}
                        onChange={(e) => setInstructions((p) => ({ ...p, [project.id]: e.target.value }))}
                      />
                      <div className="btn-row" style={{ marginTop: 8 }}>
                        <button
                          className="btn primary"
                          disabled={Boolean(busy) || !instructions[project.id]?.trim()}
                          onClick={() => handleSendInstruction(project)}
                        >
                          {busy === `${project.id}:instruct` ? <Busy label="Copying the project…" /> : <>{Icon.sparkle} Carry on</>}
                        </button>
                      </div>
                      <ProjectBuildList projectId={project.id} refreshKey={buildsKey} />
                    </div>
                  ) : null}

                  {/* TAB 3: BROWSE & EDIT FILES */}
                  {tab === "files" ? (
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ fontSize: 14 }}>Project Files</strong>
                        <button className="btn small" onClick={() => handleLoadTree(project)} disabled={busy === `${project.id}:tree`}>
                          {busy === `${project.id}:tree` ? <Busy label="Refreshing…" /> : <>{Icon.refresh} Refresh Tree</>}
                        </button>
                      </div>

                      {/* File List */}
                      {projectTrees[project.id]?.length ? (
                        <div style={{ maxHeight: 180, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 8, padding: 6, marginBottom: 10 }}>
                          {projectTrees[project.id].map((entry) => (
                            <div
                              key={entry.path}
                              onClick={() => entry.type === "file" && handleOpenFile(project, entry.path)}
                              style={{
                                padding: "4px 8px",
                                cursor: entry.type === "file" ? "pointer" : "default",
                                fontSize: 13,
                                color: entry.type === "directory" ? "var(--accent)" : "inherit",
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                background: currentFile?.path === entry.path ? "rgba(76, 196, 255, 0.15)" : "transparent"
                              }}
                            >
                              <span>{entry.type === "directory" ? "📁" : "📄"}</span>
                              <span>{entry.path}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <small style={{ color: "var(--muted)", display: "block", marginBottom: 8 }}>Loading file structure…</small>
                      )}

                      {/* Code Editor */}
                      {currentFile ? (
                        <div style={{ marginTop: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                            <strong style={{ fontSize: 13, color: "var(--accent)" }}>Editing: {currentFile.path}</strong>
                            <button className="btn small primary" onClick={() => handleSaveFile(project)} disabled={busy === `${project.id}:save`}>
                              {busy === `${project.id}:save` ? <Busy label="Saving…" /> : <>Save Changes</>}
                            </button>
                          </div>
                          <textarea
                            rows={12}
                            style={{
                              width: "100%",
                              fontFamily: "monospace",
                              fontSize: 12,
                              padding: 10,
                              borderRadius: 8,
                              background: "#050811",
                              color: "#e2e8f0",
                              border: "1px solid var(--line-strong)"
                            }}
                            value={currentFile.content}
                            onChange={(e) =>
                              setOpenFiles((prev) => ({
                                ...prev,
                                [project.id]: { path: currentFile.path, content: e.target.value }
                              }))
                            }
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* TAB 4: GIT & GITHUB */}
                  {tab === "git" ? (
                    <div>
                      <p className="hint">
                        Test that this PC can push, pull, and push with a look at exactly what will go. After a push the app asks
                        GitHub where the branch is, so a tick means it is really there.
                      </p>
                      <GitPanel projectId={project.id} onChanged={() => projects.refresh()} />

                      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                        <small style={{ color: "var(--muted)", display: "block", marginBottom: 4 }}>Commit every change in the project (all files, including your own edits):</small>
                        <input
                          placeholder="Commit message..."
                          value={commitMessages[project.id] ?? ""}
                          onChange={(e) => setCommitMessages((p) => ({ ...p, [project.id]: e.target.value }))}
                          style={{ marginBottom: 8 }}
                        />
                        <button
                          className="btn small primary"
                          disabled={Boolean(busy) || !commitMessages[project.id]?.trim()}
                          onClick={() => handleGitCommit(project)}
                        >
                          {busy === `${project.id}:commit` ? <Busy label="Committing…" /> : <>Commit All Changes</>}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {result ? (
                    <div style={{ marginTop: 10 }}>
                      <Banner kind={result.kind}>{result.text}</Banner>
                    </div>
                  ) : null}
                  {context[project.id] ? <pre className="md" style={{ marginTop: 10 }}>{context[project.id]}</pre> : null}
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
