interface Props {
  valid: boolean;
  status: string | null;
}

export default function HealthCard({ valid, status }: Props) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">System Health</p>
          <p className="text-lg font-semibold text-white">{valid ? "Ready" : "Needs attention"}</p>
        </div>
        <span className={`h-3 w-3 rounded-full ${valid ? "bg-emerald-400" : "bg-amber-400"}`} />
      </div>
      {status && <p className="mt-2 text-slate-300">{status}</p>}
    </div>
  );
}
