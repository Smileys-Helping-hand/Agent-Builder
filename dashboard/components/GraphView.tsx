import { useMemo } from "react";
import type { Task } from "../lib/api";

type GraphViewProps = {
  tasks: Task[];
};

const statusColors: Record<Task["status"], string> = {
  pending: "bg-slate-800 text-slate-300",
  in_progress: "bg-sky-500/20 text-sky-300",
  done: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-rose-500/20 text-rose-300"
};

export const GraphView = ({ tasks }: GraphViewProps) => {
  const enriched = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    return tasks.map((task) => {
      const dependencies = (task.dependencies ?? []).map((dep) => byId.get(dep)).filter(Boolean);
      return { task, dependencies };
    });
  }, [tasks]);

  if (tasks.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        No tasks yet. Launch an orchestration to populate the graph.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {enriched.map(({ task, dependencies }) => (
        <div key={task.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-black/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-100">{task.agentType}</h3>
              <p className="text-sm text-slate-400">{task.description}</p>
            </div>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${statusColors[task.status]}`}>
              {task.status.replace("_", " ")}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 text-xs text-slate-300 md:grid-cols-3">
            <div>
              <dt className="uppercase tracking-wide text-slate-500">Created</dt>
              <dd>{new Date(task.createdAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-slate-500">Updated</dt>
              <dd>{new Date(task.updatedAt).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="uppercase tracking-wide text-slate-500">Duration</dt>
              <dd>{typeof task.durationMs === "number" ? `${Math.round(task.durationMs / 1000)}s` : "–"}</dd>
            </div>
          </dl>
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Dependencies</p>
            {dependencies.length === 0 ? (
              <p className="mt-2 text-xs text-slate-500">No upstream dependencies.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm text-slate-300">
                {dependencies.map((dependency) => (
                  <li key={dependency!.id} className="rounded border border-slate-800 bg-slate-900/70 px-3 py-2">
                    <p className="font-semibold text-slate-100">{dependency!.agentType}</p>
                    <p className="text-xs text-slate-400">{dependency!.description}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
};
