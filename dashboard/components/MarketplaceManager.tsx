import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveMarketplaceRequest,
  fetchMarketplaceCatalog,
  fetchMarketplaceRequests,
  requestMarketplaceInstall,
  type AuthUser,
  type MarketplacePlugin,
  type MarketplaceRequest
} from "../lib/api";

type MarketplaceManagerProps = {
  currentUser: AuthUser | null;
};

const roleAllowsApprovals = (user: AuthUser | null) => {
  if (!user) return false;
  return user.teams.some((team) => team.role === "admin" || team.role === "owner");
};

export const MarketplaceManager = ({ currentUser }: MarketplaceManagerProps) => {
  const [catalog, setCatalog] = useState<MarketplacePlugin[]>([]);
  const [requests, setRequests] = useState<MarketplaceRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const { catalog: available } = await fetchMarketplaceCatalog();
      setCatalog(available);

      const canViewRequests = currentUser.teams.some((team) => team.role === "editor" || team.role === "admin" || team.role === "owner");
      if (canViewRequests) {
        const { requests: existing } = await fetchMarketplaceRequests();
        setRequests(existing);
      } else {
        setRequests([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load marketplace");
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleInstall = useCallback(
    async (pluginId: string) => {
      setError(null);
      try {
        await requestMarketplaceInstall(pluginId);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Installation request failed");
      }
    },
    [load]
  );

  const handleApprove = useCallback(
    async (requestId: string) => {
      setError(null);
      try {
        await approveMarketplaceRequest(requestId);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Approval failed");
      }
    },
    [load]
  );

  const pendingApprovals = useMemo(() => requests.filter((request) => request.status === "pending"), [requests]);
  const installedPluginIds = useMemo(() => new Set(requests.filter((r) => r.status === "installed").map((r) => r.pluginId)), [requests]);

  if (!currentUser) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        Sign in to browse and install marketplace plugins.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-slate-100">Plugin Marketplace</h2>
          <p className="text-sm text-slate-400">Install additional agents and tools for the orchestrator.</p>
        </div>
        <button
          onClick={() => void load()}
          className="inline-flex items-center rounded-md border border-slate-700 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:bg-slate-800"
          disabled={loading}
        >
          Refresh
        </button>
      </header>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      {!roleAllowsApprovals(currentUser) && (
        <p className="text-xs text-slate-500">
          Installation requests will queue for an administrator to approve.
        </p>
      )}
      <section className="grid gap-4 lg:grid-cols-2">
        {catalog.map((plugin) => {
          const installed = installedPluginIds.has(plugin.id);
          return (
            <div key={plugin.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-black/30">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-slate-100">{plugin.name}</h3>
                  <p className="text-sm text-slate-400">{plugin.description}</p>
                  <p className="mt-2 text-xs text-slate-500">
                    v{plugin.version} · {plugin.author}
                  </p>
                </div>
                {plugin.requiresApproval && (
                  <span className="rounded-full bg-amber-500/20 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                    Needs Approval
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-400">
                <span>Agent: {plugin.agentType}</span>
                {plugin.homepage && (
                  <a href={plugin.homepage} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">
                    Docs
                  </a>
                )}
              </div>
              <button
                className="mt-4 w-full rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
                onClick={() => void handleInstall(plugin.id)}
                disabled={loading || installed}
              >
                {installed ? "Installed" : plugin.requiresApproval ? "Request Install" : "Install"}
              </button>
            </div>
          );
        })}
      </section>
      {pendingApprovals.length > 0 && (
        <section className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <h3 className="text-lg font-semibold text-slate-100">Pending Approvals</h3>
          <ul className="mt-3 space-y-3 text-sm text-slate-300">
            {pendingApprovals.map((request) => {
              const plugin = catalog.find((item) => item.id === request.pluginId);
              return (
                <li key={request.id} className="rounded border border-slate-800 bg-slate-900/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-100">{plugin?.name ?? request.pluginId}</p>
                      <p className="text-xs text-slate-500">Requested by {request.requestedBy}</p>
                    </div>
                    {roleAllowsApprovals(currentUser) && (
                      <button
                        className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-400"
                        onClick={() => void handleApprove(request.id)}
                        disabled={loading}
                      >
                        Approve
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
};
