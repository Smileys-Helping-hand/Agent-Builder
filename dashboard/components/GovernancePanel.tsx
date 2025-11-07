import { FormEvent, useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  createConsent,
  fetchAuditTrail,
  fetchConsents,
  type AuditRecord,
  type ConsentRecord
} from "../lib/api";

const renderMetadata = (metadata?: Record<string, unknown>) => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "—";
  }
  return JSON.stringify(metadata, null, 2);
};

export const GovernancePanel = () => {
  const { data: auditData, mutate: refreshAudit } = useSWR<{ records: AuditRecord[] }>(
    "governance-audit",
    () => fetchAuditTrail()
  );
  const { data: consentData, mutate: refreshConsent } = useSWR<{ records: ConsentRecord[] }>(
    "governance-consent",
    () => fetchConsents()
  );
  const [subject, setSubject] = useState("");
  const [scope, setScope] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const audits = useMemo(() => auditData?.records ?? [], [auditData]);
  const consents = useMemo(() => consentData?.records ?? [], [consentData]);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!subject.trim() || !scope.trim()) {
        return;
      }
      setIsSubmitting(true);
      try {
        await createConsent({ subject: subject.trim(), scope: scope.trim(), grantedBy: "dashboard", expiresAt });
        setSubject("");
        setScope("");
        setExpiresAt("");
        await Promise.all([refreshConsent(), refreshAudit()]);
      } finally {
        setIsSubmitting(false);
      }
    },
    [subject, scope, expiresAt, refreshConsent, refreshAudit]
  );

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
        <h3 className="text-lg font-semibold text-slate-100">Consent Ledger</h3>
        <p className="mt-2 text-sm text-slate-400">
          Record consents for sensitive actions and review their scope before agents execute high-impact tasks.
        </p>
        <form onSubmit={onSubmit} className="mt-4 grid gap-3 md:grid-cols-4">
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Subject
            <input
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </label>
          <label className="text-xs uppercase tracking-wide text-slate-400 md:col-span-2">
            Scope
            <input
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={scope}
              onChange={(event) => setScope(event.target.value)}
            />
          </label>
          <label className="text-xs uppercase tracking-wide text-slate-400">
            Expires
            <input
              type="datetime-local"
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.target.value)}
            />
          </label>
          <div className="md:col-span-4">
            <button
              type="submit"
              disabled={isSubmitting}
              className="mt-2 inline-flex rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {isSubmitting ? "Recording consent..." : "Record Consent"}
            </button>
          </div>
        </form>
        <div className="mt-6 space-y-3">
          {consents.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
              No consent records yet.
            </p>
          )}
          {consents.map((record) => (
            <div key={record.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{record.subject}</p>
                  <p className="text-xs text-slate-500">Scope: {record.scope}</p>
                </div>
                <div className="text-right text-xs text-slate-500">
                  <p>Granted by {record.grantedBy}</p>
                  <p>{new Date(record.timestamp).toLocaleString()}</p>
                  {record.expiresAt && <p>Expires {new Date(record.expiresAt).toLocaleString()}</p>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-6">
        <h3 className="text-lg font-semibold text-slate-100">Audit Feed</h3>
        <p className="mt-2 text-sm text-slate-400">
          Review the latest governance events generated by agents, manual overrides, or compliance workflows.
        </p>
        <div className="mt-4 space-y-3">
          {audits.length === 0 && (
            <p className="rounded-lg border border-dashed border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
              No audit events recorded yet.
            </p>
          )}
          {audits.map((record) => (
            <article key={record.id} className="rounded-lg border border-slate-800 bg-slate-950/60 p-4">
              <header className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-100">{record.action}</p>
                  <p className="text-xs text-slate-500">Actor: {record.actor}</p>
                </div>
                <p className="text-xs text-slate-500">{new Date(record.timestamp).toLocaleString()}</p>
              </header>
              <p className="mt-2 text-xs text-slate-400">Target: {record.target}</p>
              <pre className="mt-3 overflow-auto rounded bg-slate-950/60 p-3 text-xs text-slate-300">
                {renderMetadata(record.metadata as Record<string, unknown> | undefined)}
              </pre>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
};
