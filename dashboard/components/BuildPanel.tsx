import { FormEvent, useMemo, useState } from "react";
import useSWR from "swr";
import {
  cancelBuildPipeline,
  exportProjects,
  fetchBuildHistory,
  fetchBuildStatus,
  listCollaborationSessions,
  mergeRepositories,
  startBuildPipeline,
  type BuildJob,
  type ServerEvent
} from "../lib/api";
import heroImages from "../theme/heroImages";
import HeroSection from "./ui/HeroSection";

const buildModes: BuildJob["mode"][] = ["app", "game", "simulation", "fusion"];
const autonomyModes: BuildJob["autonomy"][] = ["manual", "semi", "full"];

type BuildPanelProps = {
  events: ServerEvent[];
};

const statusAccent: Record<BuildJob["status"], string> = {
  queued: "bg-slate-800 text-slate-200",
  planning: "bg-indigo-900 text-indigo-100",
  running: "bg-sky-900 text-sky-100",
  merging: "bg-amber-900 text-amber-100",
  testing: "bg-emerald-900 text-emerald-100",
  deploying: "bg-purple-900 text-purple-100",
  completed: "bg-emerald-800 text-emerald-50",
  failed: "bg-rose-900 text-rose-100",
  canceled: "bg-slate-900 text-slate-400"
};

const stepAccent: Record<BuildJob["steps"][number]["status"], string> = {
  pending: "bg-slate-900 text-slate-300",
  running: "bg-sky-900 text-sky-100",
  done: "bg-emerald-900 text-emerald-100",
  failed: "bg-rose-900 text-rose-100",
  skipped: "bg-slate-800 text-slate-400"
};

const StepPill = ({ step }: { step: BuildJob["steps"][number] }) => (
  <div className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
    <header className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-400">
      <span>{step.label}</span>
      <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${stepAccent[step.status]}`}>
        {step.status}
      </span>
    </header>
    {step.description && <p className="mt-2 text-xs text-slate-300">{step.description}</p>}
    {step.log && <p className="mt-2 text-[11px] text-indigo-300/80">{step.log}</p>}
  </div>
);

export function BuildPanel({ events }: BuildPanelProps) {
  const { data, mutate, isValidating } = useSWR<{ jobs: BuildJob[] }>("build/history", fetchBuildHistory, {
    refreshInterval: 20000
  });
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<BuildJob["mode"]>(() => (process.env.NEXT_PUBLIC_BUILD_MODE as BuildJob["mode"]) ?? "app");
  const [autonomy, setAutonomy] = useState<BuildJob["autonomy"]>(() => "semi");
  const [repositories, setRepositories] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectPaths, setProjectPaths] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);

  const jobs = useMemo(() => data?.jobs ?? [], [data]);
  const selected = useMemo(() => jobs.find((job) => job.id === selectedId) ?? jobs[0] ?? null, [jobs, selectedId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!prompt.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const repoList = repositories
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const response = await startBuildPipeline({ prompt: prompt.trim(), mode, autonomy, repositories: repoList, sessionId: sessionId.trim() || undefined });
      setSelectedId(response.job.id);
      setPrompt("");
      await mutate();
    } catch (err: any) {
      setError(err?.message ?? "Failed to start build");
    } finally {
      setSubmitting(false);
    }
  };

  const refreshStatus = async (jobId: string) => {
    try {
      const result = await fetchBuildStatus(jobId);
      await mutate((prev) => {
        if (!prev) return prev;
        const next = prev.jobs.map((job) => (job.id === jobId ? result.job : job));
        return { jobs: next };
      }, false);
    } catch (err) {
      console.error("Failed to refresh build status", err);
    }
  };

  const cancel = async (jobId: string) => {
    try {
      await cancelBuildPipeline(jobId);
      await mutate();
    } catch (err: any) {
      setError(err?.message ?? "Failed to cancel build");
    }
  };

  const loadProjects = async () => {
    try {
      const result = await exportProjects();
      setProjectPaths(result.projects);
    } catch (err) {
      console.error("Failed to export projects", err);
    }
  };

  const runMerge = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const [a, b] = repositories
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!a || !b) {
      setError("Provide two repository paths to merge");
      return;
    }
    setMerging(true);
    setError(null);
    try {
      await mergeRepositories({ sourceA: a, sourceB: b });
      await loadProjects();
    } catch (err: any) {
      setError(err?.message ?? "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  return (
    <section className="mx-auto mt-10 grid max-w-6xl gap-8 px-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-6">
        <form onSubmit={handleSubmit} className="rounded-xl border border-slate-800 bg-slate-950/80 p-6 shadow-lg shadow-black/40">
          <HeroSection
            image={heroImages.build}
            title="Unified Build Engine"
            subtitle="Powered by Hustle Studio"
            className="-mx-6 -mt-6 overflow-hidden rounded-t-xl border-b border-slate-800"
          />
          <header className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-xl text-sm text-slate-400">
              Coordinate Builder, QA, Ops, and Roblox agents from a single launch command. Voice requests flow through the Build Engine for end-to-end automation.
            </p>
            <span className="text-xs uppercase tracking-wide text-slate-500">{isValidating ? "Refreshing…" : "Live"}</span>
          </header>

          <label className="mt-4 block text-xs uppercase tracking-wide text-slate-400">Build Prompt</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Build a SaaS dashboard with payments and auth"
            className="mt-2 h-28 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />

          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Mode</label>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as BuildJob["mode"])}
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {buildModes.map((value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Autonomy</label>
              <select
                value={autonomy}
                onChange={(event) => setAutonomy(event.target.value as BuildJob["autonomy"])}
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              >
                {autonomyModes.map((value) => (
                  <option key={value} value={value}>
                    {value.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Collab Session</label>
              <input
                value={sessionId}
                onChange={(event) => setSessionId(event.target.value)}
                placeholder="default-abc123"
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              />
            </div>
          </div>

          <label className="mt-4 block text-xs uppercase tracking-wide text-slate-400">Repositories (comma separated)</label>
          <input
            value={repositories}
            onChange={(event) => setRepositories(event.target.value)}
            placeholder="./apps/web, ./apps/api"
            className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
          />

          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {submitting ? "Launching…" : "Start Build"}
            </button>
            <button
              type="button"
              onClick={() => {
                void listCollaborationSessions().then((response) => {
                  const latest = response.sessions[0];
                  if (latest) {
                    setSessionId(latest.id);
                  }
                });
              }}
              className="rounded-md border border-indigo-500/60 bg-indigo-600/20 px-4 py-2 text-sm font-semibold text-indigo-100"
            >
              Attach Latest Session
            </button>
            <button
              type="button"
              onClick={loadProjects}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800/60"
            >
              Refresh Exports
            </button>
          </div>
        </form>

        {selected && (
          <article className="rounded-xl border border-slate-800 bg-slate-950/70 p-6">
            <header className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-slate-100">Build {selected.id}</h3>
                <p className="text-xs text-slate-400">{new Date(selected.createdAt).toLocaleString()}</p>
              </div>
              <span className={`rounded-md px-3 py-1 text-xs font-semibold uppercase ${statusAccent[selected.status]}`}>
                {selected.status}
              </span>
            </header>

            <p className="mt-4 text-sm text-slate-300">Prompt: {selected.prompt}</p>
            {selected.plan && selected.plan.length > 0 && (
              <p className="mt-2 text-xs text-slate-500">Plan: {selected.plan.join(" → ")}</p>
            )}

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {selected.steps.map((step) => (
                <StepPill key={step.id} step={step} />
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <button
                onClick={() => refreshStatus(selected.id)}
                className="rounded-md border border-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800/70"
              >
                Refresh Status
              </button>
              <button
                onClick={() => cancel(selected.id)}
                className="rounded-md border border-rose-500/60 px-4 py-2 text-xs font-semibold text-rose-200 hover:bg-rose-500/10"
              >
                Cancel Build
              </button>
            </div>

            <div className="mt-6 rounded-md border border-slate-800 bg-slate-950/60 p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Recent Logs</p>
              <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[11px] text-slate-300">
                {selected.logs.slice(-8).map((log, index) => (
                  <li key={`${index}-${log}`}>{log}</li>
                ))}
              </ul>
            </div>
          </article>
        )}

        <section className="rounded-xl border border-slate-800 bg-slate-950/60 p-6">
          <header className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Exported Projects</h3>
            <button
              onClick={loadProjects}
              className="rounded-md border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:bg-slate-800/60"
            >
              Refresh
            </button>
          </header>
          <ul className="mt-3 space-y-1 text-xs text-slate-400">
            {projectPaths.length === 0 && <li>No exports recorded yet.</li>}
            {projectPaths.map((project) => (
              <li key={project}>{project}</li>
            ))}
          </ul>

          <form onSubmit={runMerge} className="mt-4 space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">Merge Hustle Studio Repos</p>
            <p className="text-[11px] text-slate-500">
              Provide two directories to merge automatically. Semantic merge keeps conflicts with <code>.incoming</code> suffix.
            </p>
            <button
              type="submit"
              disabled={merging}
              className="rounded-md bg-emerald-600/80 px-4 py-2 text-xs font-semibold text-emerald-50 hover:bg-emerald-500/80 disabled:cursor-not-allowed"
            >
              {merging ? "Merging…" : "Merge Repositories"}
            </button>
          </form>
        </section>
      </div>

      <aside className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/40 p-5">
        <h3 className="text-sm font-semibold text-slate-100">Recent Builds</h3>
        <ul className="space-y-3">
          {jobs.map((job) => (
            <li
              key={job.id}
              className={`cursor-pointer rounded-md border border-slate-800 bg-slate-950/70 p-3 transition hover:border-sky-700 ${selected?.id === job.id ? "ring-1 ring-sky-500" : ""}`}
              onClick={() => setSelectedId(job.id)}
            >
              <p className="text-sm font-semibold text-slate-100">{job.prompt}</p>
              <p className="text-xs text-slate-500">
                {new Date(job.updatedAt).toLocaleTimeString()} · {job.mode.toUpperCase()}
              </p>
            </li>
          ))}
        </ul>

        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Live Events</p>
          <ul className="mt-2 space-y-2 text-[11px] text-slate-300">
            {events
              .filter((event): event is { type: "build"; payload: { job: BuildJob } } => event.type === "build")
              .slice(0, 6)
              .map((event, index) => (
                <li key={index} className="rounded border border-slate-800 bg-slate-900/60 p-2">
                  {event.payload.job.status.toUpperCase()} · {event.payload.job.prompt}
                </li>
              ))}
          </ul>
        </div>
      </aside>
    </section>
  );
}
