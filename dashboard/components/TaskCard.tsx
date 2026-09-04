import clsx from "clsx";
import type { Task } from "../lib/api";

const statusStyles: Record<Task["status"], string> = {
  pending: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/40",
  in_progress: "bg-sky-500/10 text-sky-300 border border-sky-500/40",
  done: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/40",
  failed: "bg-rose-500/10 text-rose-400 border border-rose-500/40"
};

const statusLabel: Record<Task["status"], string> = {
  pending: "Pending",
  in_progress: "In Progress",
  done: "Completed",
  failed: "Failed"
};

type TaskCardProps = {
  task: Task;
};

export const TaskCard = ({ task }: TaskCardProps) => {
  const updatedAt = new Date(task.updatedAt);

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-lg font-semibold text-slate-100">{task.agentType}</h3>
          <p className="text-sm text-slate-400">{task.description}</p>
        </div>
        <span className={clsx("rounded-full px-3 py-1 text-xs font-semibold", statusStyles[task.status])}>
          {statusLabel[task.status]}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-sm text-slate-300">
        <div className="grid grid-cols-3 gap-2">
          <dt className="text-slate-400">Created</dt>
          <dd className="col-span-2">{new Date(task.createdAt).toLocaleString()}</dd>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <dt className="text-slate-400">Updated</dt>
          <dd className="col-span-2">{updatedAt.toLocaleString()}</dd>
        </div>
      </dl>

      {task.error && (
        <div className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 p-3 text-sm text-rose-200">
          <p className="font-semibold">Error</p>
          <p>{task.error}</p>
        </div>
      )}

      {task.result && (
        <details className="mt-3 rounded-md border border-slate-700 bg-slate-800/70">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-200">
            View Output
          </summary>
          <pre className="max-h-64 overflow-auto bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
            {typeof task.result === "string" ? task.result : JSON.stringify(task.result, null, 2)}
          </pre>
        </details>
      )}

    </div>
  );
};
