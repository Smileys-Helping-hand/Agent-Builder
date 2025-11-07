import { useCallback, useEffect, useState } from "react";
import { fetchAnalytics, type AnalyticsSummary } from "../lib/api";

type AnalyticsPanelProps = {
  enabled: boolean;
};

const formatDuration = (value: number | null) => {
  if (!value || value <= 0) return "–";
  if (value < 1000) return `${value}ms`;
  return `${Math.round(value / 1000)}s`;
};

export const AnalyticsPanel = ({ enabled }: AnalyticsPanelProps) => {
  const [data, setData] = useState<AnalyticsSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const summary = await fetchAnalytics();
      setData(summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load analytics");
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        Sign in to view analytics.
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-6 text-center text-sm text-slate-300">
        Loading analytics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-6 text-sm text-rose-200">
        {error}
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Usage Analytics</h2>
          <p className="text-sm text-slate-400">Track orchestration throughput, feedback health, and memory usage.</p>
        </div>
        <button
          onClick={() => void load()}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:bg-slate-800"
        >
          Refresh
        </button>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Task Volume</h3>
          <p className="mt-2 text-3xl font-bold text-slate-100">{data.tasks.total}</p>
          <div className="mt-4 space-y-1 text-sm text-slate-300">
            {Object.entries(data.tasks.byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="capitalize text-slate-400">{status.replace("_", " ")}</span>
                <span className="font-semibold text-slate-100">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Durations</h3>
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            <li className="flex items-center justify-between">
              <span>Average</span>
              <span className="font-semibold text-slate-100">{formatDuration(data.tasks.averageDuration)}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Fastest</span>
              <span className="font-semibold text-slate-100">{formatDuration(data.tasks.shortestDuration)}</span>
            </li>
            <li className="flex items-center justify-between">
              <span>Slowest</span>
              <span className="font-semibold text-slate-100">{formatDuration(data.tasks.longestDuration)}</span>
            </li>
          </ul>
        </div>
      </section>
      <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Agent Load</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {Object.entries(data.tasks.byAgent).map(([agent, count]) => (
            <div key={agent} className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-slate-300">
              <span>{agent}</span>
              <span className="font-semibold text-slate-100">{count}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Vector Memory</h3>
          <p className="mt-2 text-sm text-slate-300">
            {data.memory.vectorEnabled ? (
              <>
                {data.memory.vectorCount} records indexed for semantic recall.
              </>
            ) : (
              <span>Vector memory disabled. Configure PGVECTOR_URL to enable.</span>
            )}
          </p>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Feedback Insights</h3>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
            {JSON.stringify(data.feedback, null, 2)}
          </pre>
        </div>
      </section>
    </div>
  );
};
