import useSWR from "swr";
import { fetchLogs, type LogEntry } from "../lib/api";

type LogsPanelProps = {
  refreshMs?: number;
};

export const LogsPanel = ({ refreshMs = 10000 }: LogsPanelProps) => {
  const { data, mutate } = useSWR<{ entries: LogEntry[] }>("logs", fetchLogs, { refreshInterval: refreshMs });
  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-inner shadow-black/30">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Structured Logs</h2>
          <p className="text-xs text-slate-400">Captured from orchestrator runtime</p>
        </div>
        <button
          onClick={() => mutate()}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>
      <ul className="max-h-80 overflow-auto space-y-2 text-xs">
        {entries.length === 0 ? (
          <li className="rounded-md border border-dashed border-slate-800 bg-slate-950/60 p-3 text-slate-500">No logs yet.</li>
        ) : (
          entries.map((entry, index) => (
            <li
              key={`${entry.timestamp}-${index}`}
              className="rounded-md border border-slate-800 bg-slate-950/60 p-3 font-mono text-[11px] text-slate-300"
            >
              <div className="flex items-center justify-between">
                <span className="uppercase tracking-wide text-slate-400">{entry.level}</span>
                <span className="text-slate-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
              </div>
              <pre className="mt-2 whitespace-pre-wrap text-slate-200">{entry.message}</pre>
              {entry.context ? (
                <pre className="mt-2 overflow-auto text-slate-400">{JSON.stringify(entry.context, null, 2)}</pre>
              ) : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
};
