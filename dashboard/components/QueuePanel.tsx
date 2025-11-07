import { FormEvent, useMemo, useState } from "react";
import useSWR from "swr";
import { fetchQueueMetrics, publishQueueMessage, type QueueClusterInfo, type QueueMetrics } from "../lib/api";

type QueuePanelProps = {
  canPublish: boolean;
};

export const QueuePanel = ({ canPublish }: QueuePanelProps) => {
  const { data, mutate } = useSWR<{ metrics: QueueMetrics; cluster: QueueClusterInfo }>(
    "queue-metrics",
    fetchQueueMetrics,
    {
      refreshInterval: 10000
    }
  );
  const [queueName, setQueueName] = useState("tasks");
  const [payload, setPayload] = useState("{\n  \"type\": \"heartbeat\"\n}");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metrics = data?.metrics;
  const cluster = data?.cluster;
  const nodes = useMemo(() => cluster?.nodes ?? [], [cluster]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canPublish) return;
    try {
      setIsSubmitting(true);
      setError(null);
      await publishQueueMessage(queueName, JSON.parse(payload));
      await mutate();
    } catch (error) {
      console.error("Failed to publish queue message", error);
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-inner shadow-black/30">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Queue Metrics</h2>
          <p className="text-xs text-slate-400">Monitor orchestrator message broker status</p>
        </div>
        <button
          onClick={() => mutate()}
          className="rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
        >
          Refresh
        </button>
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm text-slate-300">
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Provider</dt>
          <dd className="mt-1 font-semibold text-slate-100">{metrics?.provider ?? "loading"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Connected</dt>
          <dd className="mt-1 font-semibold text-slate-100">{metrics?.connected ? "Yes" : "No"}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Queue Depth</dt>
          <dd className="mt-1 font-semibold text-slate-100">{metrics?.queueDepth ?? 0}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-slate-500">Details</dt>
          <dd className="mt-1 font-mono text-xs text-slate-400">
            {metrics?.details ? JSON.stringify(metrics.details) : "—"}
          </dd>
        </div>
      </dl>

      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
        <h3 className="text-sm font-semibold text-slate-100">Cluster Topology</h3>
        <p className="mt-1 text-xs text-slate-400">Multi-node queue adapters registered with the orchestrator</p>
        {nodes.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">No distributed nodes registered.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-xs text-slate-300">
            {nodes.map((node) => (
              <li key={node.id} className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/60 p-3">
                <div>
                  <p className="font-semibold text-slate-100">{node.id}</p>
                  <p className="text-slate-500">{node.host}</p>
                </div>
                <div className="text-right text-slate-500">
                  <p className="uppercase tracking-wide">{node.role}</p>
                  <p>{new Date(node.connectedAt).toLocaleTimeString()}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        {cluster?.leader && (
          <p className="mt-3 text-xs text-emerald-400">
            Leader node: {cluster.leader.id} @ {cluster.leader.host}
          </p>
        )}
      </div>

      {canPublish ? (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid gap-2">
            <label htmlFor="queue" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Queue Name
            </label>
            <input
              id="queue"
              value={queueName}
              onChange={(event) => setQueueName(event.target.value)}
              className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="payload" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Payload (JSON)
            </label>
            <textarea
              id="payload"
              value={payload}
              onChange={(event) => setPayload(event.target.value)}
              className="h-32 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
            />
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center justify-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {isSubmitting ? "Publishing..." : "Publish Message"}
          </button>
          {error ? (
            <p className="text-xs text-rose-400">{error}</p>
          ) : null}
        </form>
      ) : (
        <p className="rounded-md border border-dashed border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-500">
          Sign in as an editor to publish test messages.
        </p>
      )}
    </div>
  );
};
