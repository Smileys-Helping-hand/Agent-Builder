import clsx from "clsx";
import type { Task } from "../lib/api";
import { fetchDownloadLink } from "../lib/api";

type TaskCardProps = {
  task: Task;
  onUpdate: (task: Task) => void;
};

const statusStyles: Record<Task["status"], string> = {
  pending: "bg-amber-500/10 text-amber-200 ring-1 ring-amber-400/50",
  in_progress: "bg-sky-500/10 text-sky-200 ring-1 ring-sky-400/50",
  done: "bg-emerald-500/10 text-emerald-200 ring-1 ring-emerald-400/50",
  failed: "bg-rose-500/10 text-rose-200 ring-1 ring-rose-400/50"
};

const statusLabel: Record<Task["status"], string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Completed",
  failed: "Failed"
};

export const TaskCard = ({ task, onUpdate }: TaskCardProps) => {
  const updatedAt = task.updatedAt ? new Date(task.updatedAt) : new Date();
  const createdAt = task.createdAt ? new Date(task.createdAt) : updatedAt;
  const result = typeof task.result === "object" && task.result !== null ? (task.result as any) : undefined;
  const downloadUrl = result?.downloadUrl as string | undefined;
  const version = result?.version as string | undefined;
  const artifacts = Array.isArray(result?.artifacts) ? (result?.artifacts as string[]) : undefined;
  const primaryArtifact = result?.primaryArtifact as string | undefined;
  const resultError = typeof result?.error === "string" ? (result?.error as string) : undefined;
  const notes = typeof result?.notes === "string" ? (result?.notes as string) : undefined;

  const hasArtifacts = Boolean(artifacts?.length);
  const hasDownload = Boolean(downloadUrl && hasArtifacts && task.status === "done" && !task.error);
  const cacheBuster = version ?? task.completedAt ?? task.updatedAt ?? Date.now().toString();
  const downloadHref = hasDownload ? fetchDownloadLink(task.id, primaryArtifact ?? artifacts?.[0], cacheBuster) : undefined;

  return (
    <div className="rounded-xl border border-slate-800/80 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-slate-100">{task.agentType}</h3>
            {version && task.status === "done" && (
              <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-200">
                v{version}
              </span>
            )}
          </div>
          <p className="text-sm text-slate-400">{task.description}</p>
        </div>
        <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold", statusStyles[task.status])}>
          {statusLabel[task.status]}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-300">
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Created</dt>
          <dd className="mt-1 font-medium text-slate-200">{createdAt.toLocaleString()}</dd>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <dt className="text-xs uppercase tracking-wide text-slate-500">Updated</dt>
          <dd className="mt-1 font-medium text-slate-200">{updatedAt.toLocaleString()}</dd>
        </div>
      </dl>

      {task.error && (
        <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          <p className="font-semibold">Error</p>
          <p>{task.error}</p>
        </div>
      )}

      {hasDownload && downloadHref && (
        <div className="mt-3 rounded-lg border border-emerald-500/50 bg-emerald-500/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-emerald-200">Packaged Build Ready</p>
              {version && <p className="text-xs text-emerald-300/90">Version {version}</p>}
              {primaryArtifact && <p className="text-xs text-emerald-300/80">Primary: {primaryArtifact}</p>}
              {artifacts?.length ? (
                <p className="text-xs text-emerald-300/70">Artifacts: {artifacts.join(", ")}</p>
              ) : null}
              {notes && <p className="text-xs text-emerald-200/80">{notes}</p>}
            </div>
            <button
              className="inline-flex items-center justify-center rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400"
              onClick={() => window.open(downloadHref, "_blank", "noopener,noreferrer")}
            >
              Download Build
            </button>
          </div>
        </div>
      )}

      {(resultError || (notes && !hasDownload)) && (
        <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
          <p className="font-semibold">Build Notes</p>
          {resultError && <p>{resultError}</p>}
          {notes && <p>{notes}</p>}
        </div>
      )}

      {!hasDownload && task.status === "done" && !task.error && (
        <p className="mt-3 rounded-md border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-300">
          No downloadable artifact was attached to this run.
        </p>
      )}

      {task.result && (
        <details className="mt-3 rounded-md border border-slate-800 bg-slate-900/70">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-200">
            View Output
          </summary>
          <pre className="max-h-64 overflow-auto bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
            {typeof task.result === "string" ? task.result : JSON.stringify(task.result, null, 2)}
          </pre>
        </details>
      )}

      <button
        className={
          "mt-4 inline-flex items-center justify-center rounded-md bg-sky-500 px-3 py-1.5 text-sm font-semibold text-white " +
          "shadow-sm transition hover:bg-sky-400"
        }
        onClick={() => onUpdate(task)}
      >
        Request Adjustment
      </button>
    </div>
  );
};
