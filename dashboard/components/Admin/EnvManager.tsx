"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  fetchEnvironmentConfig,
  updateEnvironmentConfig,
  type AuthUser
} from "../../lib/api";
import heroImages from "../../theme/heroImages";
import HeroSection from "../ui/HeroSection";

type EnvConfig = Record<string, string>;

type EnvManagerProps = {
  currentUser: AuthUser | null;
};

const sortEntries = (env: EnvConfig) =>
  Object.entries(env).sort(([a], [b]) => a.localeCompare(b));

export const EnvManager = ({ currentUser }: EnvManagerProps) => {
  const [envValues, setEnvValues] = useState<EnvConfig>({});
  const [pendingKey, setPendingKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canEdit = useMemo(
    () =>
      Boolean(
        currentUser?.teams?.some((team) => ["admin", "owner"].includes(team.role))
      ),
    [currentUser]
  );

  const { isLoading, mutate } = useSWR(
    canEdit ? "env-config" : null,
    async () => {
      const { env } = await fetchEnvironmentConfig();
      setEnvValues(env);
      return env;
    },
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (!canEdit) {
      setEnvValues({});
    }
  }, [canEdit]);

  const handleChange = (key: string, value: string) => {
    setEnvValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleRemove = (key: string) => {
    setEnvValues((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleAddKey = () => {
    const key = pendingKey.trim();
    if (!key || envValues[key]) {
      return;
    }
    setEnvValues((prev) => ({ ...prev, [key]: "" }));
    setPendingKey("");
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    setError(null);

    try {
      const { env } = await updateEnvironmentConfig(envValues);
      setEnvValues(env);
      await mutate(env, false);
      setMessage("Environment updated successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update environment");
    } finally {
      setSaving(false);
    }
  };

  if (!currentUser) {
    return (
      <section className="mx-auto mt-10 max-w-4xl space-y-6 px-6">
        <HeroSection
          image={heroImages.build}
          title="Environment Manager"
          subtitle="Powered by Hustle Studio"
        />
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
          Sign in with an administrator account to configure runtime environment variables.
        </div>
      </section>
    );
  }

  if (!canEdit) {
    return (
      <section className="mx-auto mt-10 max-w-4xl space-y-6 px-6">
        <HeroSection
          image={heroImages.build}
          title="Environment Manager"
          subtitle="Powered by Hustle Studio"
        />
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 text-sm text-slate-400">
          You need administrator access to view or edit environment variables.
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto mt-10 max-w-4xl space-y-6 px-6">
      <HeroSection
        image={heroImages.build}
        title="Environment Manager"
        subtitle="Powered by Hustle Studio"
      />
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-lg shadow-black/30">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-100">Runtime Variables</h3>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Stored in .env.dynamic
              </p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={pendingKey}
                onChange={(event) => setPendingKey(event.target.value)}
                placeholder="NEW_KEY"
                className="w-40 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                disabled={saving}
              />
              <button
                type="button"
                onClick={handleAddKey}
                className="rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={saving || !pendingKey.trim() || Boolean(envValues[pendingKey.trim()])}
              >
                Add Key
              </button>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            {isLoading && (
              <div className="rounded-md border border-dashed border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
                Loading environment configuration...
              </div>
            )}
            {!isLoading && sortEntries(envValues).length === 0 && (
              <div className="rounded-md border border-dashed border-slate-800 bg-slate-950/60 p-4 text-sm text-slate-400">
                No variables configured yet. Add a key to get started.
              </div>
            )}
            {sortEntries(envValues).map(([key, value]) => (
              <div
                key={key}
                className="flex flex-wrap items-center gap-3 rounded-md border border-slate-800 bg-slate-950/80 p-4"
              >
                <div className="flex min-w-[10rem] flex-1 flex-col gap-2 sm:flex-row sm:items-center">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:w-40">
                    {key}
                  </label>
                  <input
                    type="text"
                    value={value}
                    onChange={(event) => handleChange(key, event.target.value)}
                    className="w-full flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                    disabled={saving}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => handleRemove(key)}
                  className="ml-auto inline-flex items-center rounded-md border border-slate-700 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/10"
                  disabled={saving}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-rose-400">{error}</p>}
        {message && <p className="text-sm text-emerald-400">{message}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {saving ? "Saving..." : "Save Environment"}
          </button>
          <button
            type="button"
            onClick={async () => {
              setError(null);
              setMessage(null);
              try {
                const { env } = await fetchEnvironmentConfig();
                setEnvValues(env);
                await mutate(env, false);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to refresh environment");
              }
            }}
            className="inline-flex items-center rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
            disabled={saving}
          >
            Refresh
          </button>
        </div>
      </form>
    </section>
  );
};

export default EnvManager;
