import { FormEvent, useState } from "react";
import useSWR from "swr";
import { fetchPolicies, validatePolicy, type PolicyRule } from "../lib/api";

export const SecurityPanel = () => {
  const { data } = useSWR<{ revision: string; rules: PolicyRule[] }>("policies", fetchPolicies, {
    refreshInterval: 60000
  });
  const [image, setImage] = useState("node:18");
  const [privileged, setPrivileged] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const response = await validatePolicy({ image, privileged });
      setResult(response.allowed ? "Allowed" : "Denied");
    } catch (error) {
      setResult((error as Error).message);
    }
  };

  return (
    <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-inner shadow-black/30">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Policy Overview</h2>
        <p className="text-xs text-slate-400">Review sandbox and queue enforcement rules</p>
      </div>
      <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-3 text-xs text-slate-300">
        <p className="text-[10px] uppercase tracking-wide text-slate-500">Revision</p>
        <p className="text-sm font-semibold text-slate-100">{data?.revision ?? "loading"}</p>
        <ul className="mt-3 space-y-2">
          {data?.rules?.map((rule: PolicyRule) => (
            <li key={rule.id} className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
              <p className="text-[11px] uppercase tracking-wide text-slate-500">{rule.action}</p>
              <p className="text-sm text-slate-100">{rule.description ?? "Policy"}</p>
              {rule.conditions ? (
                <pre className="mt-2 overflow-auto text-[11px] text-slate-400">{JSON.stringify(rule.conditions, null, 2)}</pre>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
      <form onSubmit={onSubmit} className="space-y-3">
        <div className="grid gap-2">
          <label htmlFor="image" className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Container image
          </label>
          <input
            id="image"
            value={image}
            onChange={(event) => setImage(event.target.value)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/30"
          />
        </div>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input type="checkbox" checked={privileged} onChange={(event) => setPrivileged(event.target.checked)} />
          Privileged
        </label>
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md bg-rose-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-400"
        >
          Validate Request
        </button>
      </form>
      {result ? <p className="text-sm text-slate-200">Result: {result}</p> : null}
    </div>
  );
};
