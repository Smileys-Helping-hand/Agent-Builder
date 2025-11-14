"use client";

import { FormEvent, useMemo, useState } from "react";
import useSWR from "swr";
import HeroSection from "../ui/HeroSection";
import heroImages from "../../theme/heroImages";
import {
  activateLicense,
  fetchLicenseStatus,
  type LicenseSnapshot
} from "../../lib/api";

type LicenseManagerProps = {
  canManage: boolean;
};

const tierLabels: Record<LicenseSnapshot["tier"], string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise"
};

export const LicenseManager = ({ canManage }: LicenseManagerProps) => {
  const { data, mutate } = useSWR(canManage ? "license-status" : null, fetchLicenseStatus, {
    revalidateOnFocus: false
  });
  const [tier, setTier] = useState<LicenseSnapshot["tier"]>("free");
  const [licenseKey, setLicenseKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeTier = data?.license?.tier ?? "free";
  const activatedAt = data?.license?.activated_at ?? null;

  const tierOptions = useMemo(
    () => ["free", "pro", "enterprise"] as LicenseSnapshot["tier"][],
    []
  );

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canManage) return;
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      await activateLicense({ key: licenseKey.trim(), tier });
      await mutate();
      setMessage("License activated successfully.");
      setLicenseKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to activate license.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mx-auto mt-10 max-w-4xl space-y-6 px-6">
      <HeroSection
        image={heroImages.build}
        title="License Manager"
        subtitle="Powered by Hustle Studio"
      />

      <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-black/30">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">Active License</h3>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Tier: {tierLabels[activeTier]}
            </p>
            {activatedAt && (
              <p className="text-xs text-slate-500">Activated {new Date(activatedAt).toLocaleString()}</p>
            )}
          </div>
          {data?.license?.key && (
            <code className="rounded-md bg-slate-950/70 px-3 py-2 text-xs text-slate-400">
              {data.license.key.slice(0, 4)}••••{data.license.key.slice(-4)}
            </code>
          )}
        </div>
        <p className="mt-3 text-sm text-slate-400">
          Manage enterprise unlocks, premium build credits, and simulation scale controls. Activating a higher tier enables
          continuous deployment automation and collaborative seat expansion.
        </p>
      </div>

      <form
        onSubmit={onSubmit}
        className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/80 p-6 shadow-lg shadow-black/30"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-300">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">License Tier</span>
            <select
              value={tier}
              onChange={(event) => setTier(event.target.value as LicenseSnapshot["tier"])}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              disabled={!canManage || saving}
            >
              {tierOptions.map((option) => (
                <option key={option} value={option}>
                  {tierLabels[option]}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">License Key</span>
            <input
              value={licenseKey}
              onChange={(event) => setLicenseKey(event.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              placeholder="AB-XXXX-XXXX-XXXX"
              disabled={!canManage || saving}
              required
            />
          </label>
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}
        {message && <p className="text-sm text-emerald-400">{message}</p>}

        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={!canManage || saving}
            className="inline-flex items-center rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {saving ? "Activating..." : "Activate License"}
          </button>
        </div>
      </form>
    </section>
  );
};

export default LicenseManager;
