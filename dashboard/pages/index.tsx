import Head from "next/head";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { BuilderConsole } from "../components/BuilderConsole";
import { fetchSettings, fetchStatus, startBackend, startBuilder } from "../lib/api";

export default function Home() {
  const [prompt, setPrompt] = useState("Generate a plug-and-play Agent Builder workspace");
  const [status, setStatus] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    openaiOnline: false,
    diskAccess: false,
    backendRunning: false,
    settingsComplete: false,
    envLoaded: false
  });

  useEffect(() => {
    const load = async () => {
      const [settings, statusResponse] = await Promise.all([fetchSettings(), fetchStatus()]);
      setSettingsReady(Boolean(settings.openaiApiKey));
      setSystemStatus(statusResponse);
    };
    void load();
  }, []);

  const launch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!settingsReady) {
      setShowModal(true);
      return;
    }
    setStatus("Starting builder...");
    try {
      await startBuilder({ prompt });
      setStatus("Builder running. Watch the stream below.");
    } catch (error) {
      setStatus((error as Error).message);
    }
  };

  const launchBackend = async () => {
    const response = await startBackend();
    setStatus((response as any).message ?? "Backend started");
    const refreshed = await fetchStatus();
    setSystemStatus(refreshed);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Head>
        <title>AutoDev Forge</title>
      </Head>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-col gap-4 rounded-3xl border border-slate-800 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-8 shadow-2xl shadow-blue-900/30">
          <p className="text-sm uppercase tracking-[0.2em] text-blue-200">AutoDev Forge</p>
          <h1 className="text-4xl font-bold text-white">One-click Agent Builder</h1>
          <p className="max-w-3xl text-lg text-slate-300">
            Configure models, connect to the backend, and launch a full build run without touching the terminal.
            Clean logs, neon gradients, and production-ready defaults included.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-slate-400">
            <span className="rounded-full border border-blue-500/40 px-3 py-1 text-blue-200">WS console</span>
            <span className="rounded-full border border-blue-500/40 px-3 py-1 text-blue-200">.env auto-sync</span>
            <span className="rounded-full border border-blue-500/40 px-3 py-1 text-blue-200">Template launcher</span>
          </div>
          <form onSubmit={launch} className="flex flex-col gap-3 md:flex-row md:items-center">
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              className="flex-1 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-base text-white shadow-inner shadow-slate-950 focus:border-blue-500 focus:outline-none"
              placeholder="Describe what to build"
            />
            <button
              type="submit"
              className="rounded-2xl bg-blue-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-blue-900/30 transition hover:-translate-y-[1px] hover:bg-blue-500"
            >
              Start Builder
            </button>
          </form>
          {status && <p className="text-sm text-emerald-400">{status}</p>}
          <div className="flex gap-4 text-sm text-slate-400">
            <Link href="/settings" className="underline decoration-blue-400 decoration-2 underline-offset-4">
              Settings dashboard
            </Link>
            <Link href="/new" className="underline decoration-blue-400 decoration-2 underline-offset-4">
              Templates
            </Link>
            <Link href="/wizard" className="underline decoration-blue-400 decoration-2 underline-offset-4">
              First-time wizard
            </Link>
          </div>
        </div>

        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <BuilderConsole />
          <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg shadow-blue-900/20">
            <h3 className="text-xl font-semibold text-white">System status</h3>
            <div className="mt-4 grid gap-2 text-sm text-slate-200">
              <StatusRow label="OpenAI Online" ok={systemStatus.openaiOnline} />
              <StatusRow label="Disk Access" ok={systemStatus.diskAccess} />
              <StatusRow label="Backend Running" ok={systemStatus.backendRunning} action={launchBackend} />
              <StatusRow label="Settings Complete" ok={systemStatus.settingsComplete} />
              <StatusRow label="Env Loaded" ok={systemStatus.envLoaded} />
            </div>
            <div className="mt-4 rounded-xl bg-blue-900/20 p-4 text-sm text-blue-100">
              Need a starting point? Visit the Templates page for curated prompts.
            </div>
            <button
              onClick={launchBackend}
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-blue-500"
            >
              Start Engine
            </button>
          </div>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-blue-900/40">
            <h3 className="text-xl font-semibold text-white">Missing API Key</h3>
            <p className="mt-2 text-sm text-slate-300">
              Add your OpenAI key in Settings to launch the builder. We can pre-fill defaults for you.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-200"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <Link
                href="/settings"
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500"
              >
                Go to Settings
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const StatusRow = ({ label, ok, action }: { label: string; ok: boolean; action?: () => void }) => (
  <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
    <div className="flex items-center gap-2">
      <span className={`text-lg ${ok ? "text-emerald-400" : "text-amber-300"}`}>{ok ? "✓" : "○"}</span>
      <span>{label}</span>
    </div>
    {action && !ok && (
      <button onClick={action} className="text-xs text-blue-300 underline">
        Start
      </button>
    )}
  </div>
);
