interface Props {
  valid: boolean;
  status: string | null;
  onValidate: () => void;
}

export default function KeyValidator({ valid, status, onValidate }: Props) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm text-slate-200">
      <div className="flex items-center gap-2">
        <span className={`h-3 w-3 rounded-full ${valid ? "bg-emerald-400" : "bg-amber-400"}`} />
        <div>{status || "Awaiting validation"}</div>
      </div>
      <button
        onClick={onValidate}
        className="rounded-lg border border-blue-400/60 px-3 py-1 text-xs font-semibold text-blue-100 transition hover:-translate-y-px hover:bg-blue-900/40"
      >
        Test Connection
      </button>
    </div>
  );
}
