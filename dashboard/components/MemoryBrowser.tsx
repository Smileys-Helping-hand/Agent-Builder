import { FormEvent, useCallback, useEffect, useState } from "react";
import { fetchRecentMemory, searchMemory, type VectorRecord } from "../lib/api";

type MemoryBrowserProps = {
  canSearch: boolean;
};

export const MemoryBrowser = ({ canSearch }: MemoryBrowserProps) => {
  const [records, setRecords] = useState<VectorRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { records: recent } = await fetchRecentMemory();
        setRecords(recent);
      } catch (err) {
        console.error("Failed to load memory", err);
      }
    };
    void load();
  }, []);

  const handleSearch = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSearch) {
        setError("Login required for semantic search.");
        return;
      }

      if (!query.trim()) {
        setError("Enter a query to search vector memory.");
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const { records: results } = await searchMemory(query.trim());
        setRecords(results);
        if (results.length === 0) {
          setError("No similar memory entries found.");
        }
      } catch (err) {
        console.error("Vector search failed", err);
        setError(err instanceof Error ? err.message : "Unable to search memory");
      } finally {
        setLoading(false);
      }
    },
    [query, canSearch]
  );

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/40">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Memory Browser</h2>
        <span className="text-xs uppercase tracking-wide text-slate-500">Vector snapshots</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Explore the most recent task embeddings or search for similar outputs using pgvector.
      </p>
      <form onSubmit={handleSearch} className="mt-3 flex gap-2">
        <input
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search memory for: onboarding flow"
          className="flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-md bg-sky-500 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
        >
          {loading ? "Searching" : "Search"}
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      <ul className="mt-4 grid gap-3 text-sm text-slate-200">
        {records.map((record) => (
          <li key={record.id} className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
            <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
              <span>{record.agentType}</span>
              <span>{new Date(record.createdAt).toLocaleString()}</span>
            </div>
            <p className="mt-2 text-slate-100">{record.description}</p>
            {record.score !== undefined && (
              <p className="mt-1 text-xs text-slate-400">Similarity score: {(record.score * 100).toFixed(1)}%</p>
            )}
          </li>
        ))}
        {records.length === 0 && !error && (
          <li className="rounded-md border border-dashed border-slate-800 bg-slate-950/40 p-4 text-center text-xs text-slate-500">
            No memory records available yet.
          </li>
        )}
      </ul>
    </div>
  );
};
