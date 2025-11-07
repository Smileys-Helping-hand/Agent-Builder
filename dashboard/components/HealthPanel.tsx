import useSWR from "swr";
import { fetchHealthSnapshot, type HealthSnapshot } from "../lib/api";

type HealthPanelProps = {
  refreshMs?: number;
};

const statusColor: Record<HealthSnapshot["status"], string> = {
  ok: "text-emerald-400",
  degraded: "text-amber-400",
  down: "text-rose-400"
};

export const HealthPanel = ({ refreshMs = 15000 }: HealthPanelProps) => {
  const { data, mutate } = useSWR<HealthSnapshot>("health", fetchHealthSnapshot, {
    refreshInterval: refreshMs
  });
  const snapshot = data;

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-inner shadow-black/30">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">System Health</h2>
          <p className="text-xs text-slate-400">Status across orchestrator subsystems</p>
        </div>
        <button
          onClick={() => mutate()}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>
      {snapshot ? (
        <>
          <p className={`text-sm font-semibold ${statusColor[snapshot.status]}`}>Overall: {snapshot.status.toUpperCase()}</p>
          <dl className="grid gap-4 text-sm text-slate-300 md:grid-cols-2">
            {Object.entries(snapshot.components).map(([name, component]) => (
              <div key={name} className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-500">{name}</p>
                <p className={`mt-1 text-sm font-semibold ${statusColor[component.status]}`}>
                  {component.status.toUpperCase()}
                </p>
                {component.details ? (
                  <pre className="mt-2 max-h-24 overflow-auto rounded bg-slate-900/80 p-2 text-[11px] leading-tight text-slate-400">
                    {JSON.stringify(component.details, null, 2)}
                  </pre>
                ) : null}
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p className="text-sm text-slate-400">Loading health snapshot...</p>
      )}
    </div>
  );
};
