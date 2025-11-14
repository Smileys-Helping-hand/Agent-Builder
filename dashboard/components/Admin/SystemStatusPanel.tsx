"use client";

import useSWR from "swr";
import HeroSection from "../ui/HeroSection";
import heroImages from "../../theme/heroImages";
import { fetchSystemStatus, type SystemStatus } from "../../lib/api";

const formatBytes = (value: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"] as const;
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

const uptimeLabel = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const MemoryBreakdown = ({ memoryUsage }: { memoryUsage: Record<string, number> }) => (
  <dl className="grid grid-cols-2 gap-3 text-xs text-slate-400">
    {Object.entries(memoryUsage).map(([key, value]) => (
      <div key={key} className="rounded-md border border-slate-800 bg-slate-950/60 p-3">
        <dt className="font-semibold uppercase tracking-wide text-slate-500">{key}</dt>
        <dd className="mt-1 text-slate-200">{formatBytes(value)}</dd>
      </div>
    ))}
  </dl>
);

type SystemStatusPanelProps = {
  canView: boolean;
};

export const SystemStatusPanel = ({ canView }: SystemStatusPanelProps) => {
  const { data, isLoading, error } = useSWR<SystemStatus | null>(
    canView ? "system-status" : null,
    fetchSystemStatus,
    { revalidateOnFocus: false }
  );

  return (
    <section className="mx-auto mt-10 max-w-5xl space-y-6 px-6">
      <HeroSection
        image={heroImages.build}
        title="System Status"
        subtitle="Real-time operational metrics"
      />

      {!canView && (
        <p className="rounded-xl border border-slate-800 bg-slate-900/70 p-6 text-sm text-slate-400">
          Administrator permissions are required to view system telemetry.
        </p>
      )}

      {canView && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-black/30 lg:col-span-2">
            {isLoading && <p className="text-sm text-slate-400">Loading system metrics...</p>}
            {error && <p className="text-sm text-rose-400">{error.message}</p>}
            {data && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Platform</p>
                    <p className="text-lg font-semibold text-slate-100">
                      {data.system.platform} {data.system.release}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Uptime</p>
                    <p className="text-lg font-semibold text-slate-100">
                      {uptimeLabel(data.system.uptimeSeconds)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-wide text-slate-500">CPU Load (1m)</p>
                    <p className="mt-2 text-xl font-semibold text-slate-100">{data.system.cpuLoad.toFixed(2)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Total Memory</p>
                    <p className="mt-2 text-xl font-semibold text-slate-100">{formatBytes(data.system.totalMem)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                    <p className="text-xs uppercase tracking-wide text-slate-500">Free Memory</p>
                    <p className="mt-2 text-xl font-semibold text-slate-100">{formatBytes(data.system.freeMem)}</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <h4 className="text-sm font-semibold text-slate-200">Memory Breakdown</h4>
                  <MemoryBreakdown memoryUsage={data.system.memoryUsage} />
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-300">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Queue Provider</p>
                  <p className="mt-2 text-lg font-semibold text-slate-100">
                    {data.system.queue.provider} — depth {data.system.queue.queueDepth}
                  </p>
                  {!data.system.queue.connected && (
                    <p className="mt-1 text-xs text-rose-400">Queue service not connected.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-black/30">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Recent Builds</h3>
              <ul className="mt-3 space-y-3 text-xs text-slate-300">
                {data?.builds.slice(0, 5).map((build) => (
                  <li key={build.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <p className="font-semibold text-slate-100">{build.prompt}</p>
                    <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-500">{build.status}</p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Updated {new Date(build.updatedAt).toLocaleTimeString()}
                    </p>
                  </li>
                ))}
                {data && data.builds.length === 0 && <li>No builds recorded yet.</li>}
              </ul>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default SystemStatusPanel;
