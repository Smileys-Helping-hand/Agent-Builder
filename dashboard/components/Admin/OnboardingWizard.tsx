"use client";

import { FormEvent, useState } from "react";
import useSWR from "swr";
import {
  completeOnboardingSetup,
  fetchOnboardingStatus,
  type OnboardingStatus
} from "../../lib/api";

const providers = [
  { id: "ollama", label: "Ollama (local, default)" },
  { id: "openai", label: "OpenAI" }
];

type OnboardingWizardProps = {
  onConfigured?: (status: OnboardingStatus) => void;
};

export const OnboardingWizard = ({ onConfigured }: OnboardingWizardProps) => {
  const { data, mutate } = useSWR("onboarding-status", fetchOnboardingStatus, {
    revalidateOnFocus: false,
    // Keep asking until the API answers. This component renders nothing until it
    // has a status, so a single failed request (the desktop app's API is still
    // starting) used to hide first-run setup entirely until a manual reload.
    refreshInterval: (latest) => (latest ? 0 : 2000)
  });
  const [workspaceName, setWorkspaceName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [aiProvider, setAiProvider] = useState("ollama");
  const [providerKey, setProviderKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!data || data.configured) {
    return null;
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      await completeOnboardingSetup({
        workspaceName,
        adminEmail,
        adminPassword,
        aiProvider,
        providerKey: providerKey || undefined
      });
      const status = await mutate();
      if (status?.configured && onConfigured) {
        onConfigured(status);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 px-6">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-900/95 p-8 shadow-2xl shadow-sky-900/40">
        <div className="space-y-2 text-center">
          <h2 className="text-2xl font-semibold text-slate-100">Welcome to Agent Builder</h2>
          <p className="text-sm text-slate-400">
            Configure your workspace to unlock full autonomous build and simulation features.
          </p>
        </div>

        <form onSubmit={submit} className="mt-6 space-y-4 text-left">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-300">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Workspace Name
              </span>
              <input
                value={workspaceName}
                onChange={(event) => setWorkspaceName(event.target.value)}
                className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="Neo Frontier"
                required
              />
            </label>
            <label className="space-y-2 text-sm text-slate-300">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Admin Email</span>
              <input
                type="email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="founder@hustlestudio.ai"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-2 text-sm text-slate-300">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Admin Password</span>
              <input
                type="password"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                placeholder="••••••••"
                minLength={8}
                required
              />
            </label>
            <label className="space-y-2 text-sm text-slate-300">
              <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">AI Provider</span>
              <select
                value={aiProvider}
                onChange={(event) => setAiProvider(event.target.value)}
                className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              >
                {providers.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="space-y-2 text-sm text-slate-300">
            <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
              API Key (only for cloud providers)
            </span>
            <input
              value={providerKey}
              onChange={(event) => setProviderKey(event.target.value)}
              className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
              placeholder="sk-..."
            />
          </label>

          {error && <p className="text-sm text-rose-400">{error}</p>}

          <div className="flex items-center justify-end gap-3">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {saving ? "Configuring..." : "Complete Setup"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OnboardingWizard;
