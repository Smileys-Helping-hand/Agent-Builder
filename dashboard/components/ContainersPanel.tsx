import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  approveContainerRun,
  listContainers,
  requestContainerRun,
  type AuthUser,
  type ContainerRecord
} from "../lib/api";

type ContainersPanelProps = {
  currentUser: AuthUser | null;
};

const canApprove = (user: AuthUser | null) => user?.teams.some((team) => team.role === "admin" || team.role === "owner") ?? false;
const canRequest = (user: AuthUser | null) =>
  user?.teams.some((team) => ["developer", "admin", "owner"].includes(team.role)) ?? false;

export const ContainersPanel = ({ currentUser }: ContainersPanelProps) => {
  const [image, setImage] = useState("node:20");
  const [command, setCommand] = useState("npm test");
  const [records, setRecords] = useState<ContainerRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError(null);
    try {
      const { containers } = await listContainers();
      setRecords(containers);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load containers");
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!image.trim() || !canRequest(currentUser)) return;
      setLoading(true);
      setError(null);
      try {
        await requestContainerRun({ image: image.trim(), command: command.trim() || undefined });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Container request failed");
      } finally {
        setLoading(false);
      }
    },
    [image, command, load, currentUser]
  );

  const handleApprove = useCallback(
    async (id: string) => {
      setLoading(true);
      setError(null);
      try {
        await approveContainerRun(id);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Approval failed");
      } finally {
        setLoading(false);
      }
    },
    [load]
  );

  if (!currentUser) {
    return (
      <div className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
        Sign in to request sandboxed container runs.
      </div>
    );
  }

  const requestEnabled = canRequest(currentUser);

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 shadow-lg shadow-black/30">
        <h3 className="text-lg font-semibold text-slate-100">Request Sandbox</h3>
        <p className="mt-1 text-xs text-slate-400">
          Runs require manual approval before execution. {requestEnabled ? "" : "Developers or above may request new runs."}
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Image
            <input
              value={image}
              onChange={(event) => setImage(event.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              placeholder="node:20"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Command
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              placeholder="npm test"
            />
          </label>
        </div>
        <button
          type="submit"
          className="mt-3 inline-flex items-center justify-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          disabled={loading || !requestEnabled}
        >
          Submit Request
        </button>
      </form>
      {error && <p className="text-sm text-rose-400">{error}</p>}
      <section className="space-y-3">
        {records.map((record) => (
          <div key={record.id} className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
              <div>
                <p className="font-semibold text-slate-100">{record.image}</p>
                {record.command && <p className="text-xs text-slate-500">{record.command}</p>}
                <p className="mt-1 text-xs text-slate-500">Requested by {record.requestedBy}</p>
              </div>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs uppercase tracking-wide text-slate-300">
                {record.status.replace("_", " ")}
              </span>
            </div>
            <div className="mt-3 grid gap-3 text-xs text-slate-400 md:grid-cols-3">
              <p>Created: {new Date(record.createdAt).toLocaleString()}</p>
              {record.approvedAt && <p>Approved: {new Date(record.approvedAt).toLocaleString()}</p>}
              {record.finishedAt && <p>Finished: {new Date(record.finishedAt).toLocaleString()}</p>}
            </div>
            {record.logs && record.logs.length > 0 && (
              <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap rounded border border-slate-800 bg-slate-900/70 p-3 text-xs text-slate-300">
                {record.logs.join("\n")}
              </pre>
            )}
            {record.error && <p className="mt-2 text-xs text-rose-400">Error: {record.error}</p>}
            {record.status === "pending" && canApprove(currentUser) && (
              <button
                className="mt-3 rounded-md bg-emerald-500 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-400"
                onClick={() => void handleApprove(record.id)}
                disabled={loading}
              >
                Approve & Run
              </button>
            )}
          </div>
        ))}
        {records.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-800 bg-slate-900/40 p-6 text-center text-sm text-slate-400">
            No container requests yet.
          </p>
        )}
      </section>
    </div>
  );
};
