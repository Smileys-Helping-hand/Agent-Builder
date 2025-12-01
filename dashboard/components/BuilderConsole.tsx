import { useEffect, useMemo, useState } from "react";
import { getBuilderOutput, subscribeToBuilderStream, type BuilderEvent } from "../lib/api";

const levelColor: Record<string, string> = {
  info: "text-blue-300",
  warn: "text-amber-300",
  error: "text-rose-300"
};

export const BuilderConsole = () => {
  const [events, setEvents] = useState<BuilderEvent[]>([]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [downloadMessage, setDownloadMessage] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = subscribeToBuilderStream((event) => {
      setEvents((prev) => [event, ...prev].slice(0, 200));
    });
    return unsubscribe;
  }, []);

  const filtered = useMemo(() => {
    return events.filter((event) => {
      const level = ((event as any).payload?.level as string) ?? "info";
      const message = ((event as any).payload?.message as string) ?? "";
      const matchesLevel = filter === "all" || level === filter;
      const matchesSearch = search ? message.toLowerCase().includes(search.toLowerCase()) : true;
      return matchesLevel && matchesSearch;
    });
  }, [events, filter, search]);

  const status = useMemo(() => {
    const latest = events.find((event) => event.type === "builder");
    if (!latest) return { text: "Idle", tone: "bg-slate-800" };
    const level = (latest.payload.level as string) ?? "info";
    if (level === "error") return { text: "Failed", tone: "bg-rose-900/40" };
    return { text: "Running", tone: "bg-blue-900/30" };
  }, [events]);

  const completion = useMemo(() => {
    const total = events.length || 1;
    const progressEvents = events.filter((e) => (e as any).payload?.level !== "error");
    const value = Math.min(100, Math.round((progressEvents.length / total) * 100));
    return value;
  }, [events]);

  const handleDownload = async () => {
    const response = await getBuilderOutput();
    setDownloadMessage(`${response.message} (${response.path})`);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-4 shadow-lg shadow-blue-900/20">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Builder Stream</p>
          <p className="text-lg font-semibold text-white">Live output</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold text-slate-200 ${status.tone}`}>
          {status.text}
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search logs"
          className="col-span-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        />
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
        >
          <option value="all">All</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <label className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> Auto-scroll
        </label>
      </div>

      <div className="mb-2 h-2 w-full rounded-full bg-slate-800">
        <div className="h-2 rounded-full bg-blue-500 transition-all" style={{ width: `${completion}%` }} />
      </div>

      <div className="h-64 overflow-y-auto rounded-xl bg-slate-950/70 p-3 ring-1 ring-slate-800">
        {filtered.length === 0 && <p className="text-sm text-slate-500">Waiting for builder activity...</p>}
        {filtered.map((event, index) => {
          const timestamp = (event as any).payload?.timestamp as string | undefined;
          const label = (event as any).payload?.message ?? event.type;
          const level = ((event as any).payload?.level as string) ?? "info";
          return (
            <div
              key={`${event.type}-${index}`}
              className="mb-2 rounded-lg border border-slate-800/80 bg-slate-900/60 px-3 py-2 backdrop-blur"
            >
              <div className="flex items-center justify-between">
                <p className={`text-xs font-semibold uppercase tracking-wide ${levelColor[level] ?? "text-blue-200"}`}>
                  {level}
                </p>
                {timestamp && <p className="text-[10px] text-slate-500">{new Date(timestamp).toLocaleTimeString()}</p>}
              </div>
              <p className="text-sm text-slate-100">{label}</p>
            </div>
          );
        })}
        {autoScroll && filtered.length > 0 && (
          <div className="pt-1" id="scroll-anchor" />
        )}
      </div>
      <div className="mt-3 flex flex-col gap-2 text-sm text-slate-300 md:flex-row md:items-center md:justify-between">
        <div>Streaming from ws://localhost:8090/builder-stream</div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleDownload}
            className="rounded-lg bg-blue-600 px-3 py-1 text-sm font-semibold text-white shadow hover:bg-blue-500"
          >
            Download Results
          </button>
          <button
            onClick={handleDownload}
            className="rounded-lg border border-blue-500/60 px-3 py-1 text-sm font-semibold text-blue-100 shadow hover:bg-blue-900/40"
          >
            Open Output Folder
          </button>
        </div>
      </div>
      {downloadMessage && <p className="mt-2 text-xs text-emerald-300">{downloadMessage}</p>}
    </div>
  );
};
