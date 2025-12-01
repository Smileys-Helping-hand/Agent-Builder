import Head from "next/head";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchSettings, saveSettings, startBackend, validateSettings, runDiagnostics } from "../lib/api";

type Step = 1 | 2 | 3 | 4;

export default function WizardPage() {
  const [step, setStep] = useState<Step>(1);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    fetchSettings().then((settings) => {
      if (settings.openaiApiKey) {
        setApiKey(settings.openaiApiKey);
      }
      setModel(settings.model);
    });
  }, []);

  const begin = () => setStep(2);

  const validate = async () => {
    const response = await validateSettings({ openaiApiKey: apiKey, model });
    setValidationMessage(response.ok ? "✓ Key looks good" : response.errors.join(" "));
    if (response.ok) setStep(3);
  };

  const runCheck = async () => {
    const response = await runDiagnostics();
    setDiagnostics(response.diagnostics);
    setStep(4);
  };

  const finalize = async () => {
    await saveSettings({ openaiApiKey: apiKey, model });
    window.localStorage.setItem("wizardComplete", "true");
    await startBackend();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Head>
        <title>First-time Setup • AutoDev Forge</title>
      </Head>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-blue-200">AutoDev Forge</p>
            <h1 className="text-3xl font-bold text-white">First-time Setup Wizard</h1>
          </div>
          <Link href="/" className="text-sm text-blue-300 underline">
            Back to dashboard
          </Link>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950/80 p-6 shadow-xl shadow-blue-900/30">
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">Welcome</h2>
              <p className="text-slate-300">We will capture your API key, run a system check, and auto-start the backend.</p>
              <button
                onClick={begin}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500"
              >
                Begin Setup
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">Enter API Key</h2>
              <label className="space-y-2">
                <span className="text-sm text-slate-300">OpenAI API Key</span>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </label>
              <label className="space-y-2">
                <span className="text-sm text-slate-300">Model</span>
                <input
                  className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                />
              </label>
              <button
                onClick={validate}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500"
              >
                Validate Key
              </button>
              {validationMessage && <p className="text-sm text-emerald-400">{validationMessage}</p>}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">System Check</h2>
              <p className="text-slate-300">We will verify disk, ports, and connectivity.</p>
              <button
                onClick={runCheck}
                className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-500"
              >
                Run Check
              </button>
              {diagnostics && <pre className="whitespace-pre-wrap rounded-lg bg-slate-900 p-3 text-xs text-slate-200">{JSON.stringify(diagnostics, null, 2)}</pre>}
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h2 className="text-2xl font-semibold text-white">Finalize</h2>
              <p className="text-slate-300">We will create .env, start the backend, and launch the dashboard.</p>
              <button
                onClick={finalize}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-emerald-500"
              >
                Launch Dashboard
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
