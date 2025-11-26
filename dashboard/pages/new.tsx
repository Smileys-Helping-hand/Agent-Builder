import Head from "next/head";
import { useEffect, useState } from "react";
import Link from "next/link";
import { fetchSettings, startBuilder } from "../lib/api";

const templates = [
  { title: "Build a Web App", prompt: "Build a responsive web app with auth, database, and polished UI." },
  { title: "Build a Desktop App", prompt: "Create a desktop application with menus, settings, and auto-update stubs." },
  { title: "Build an API", prompt: "Ship a production-grade REST API with docs, tests, and monitoring." },
  { title: "Create Automation Script", prompt: "Automate a workflow with schedulers, retries, and logging." },
  { title: "General Project Builder", prompt: "Generate a full project scaffold tailored to the user's brief." }
];

export default function NewPage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [settingsReady, setSettingsReady] = useState(true);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchSettings().then((settings) => setSettingsReady(Boolean(settings.openaiApiKey)));
  }, []);

  const start = async (prompt: string) => {
    if (!settingsReady) {
      setShowModal(true);
      return;
    }
    setMessage("Launching builder...");
    await startBuilder({ template: prompt });
    setMessage("Builder started. Check the live console.");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Head>
        <title>New Build • AutoDev Forge</title>
      </Head>
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-blue-200">Create something new</h1>
            <p className="text-slate-400">Pick a template to pre-load the builder prompt.</p>
          </div>
          <Link href="/" className="text-sm text-blue-300 underline">
            Back to dashboard
          </Link>
        </div>

        {message && <p className="mt-4 text-sm text-emerald-400">{message}</p>}

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <button
              key={template.title}
              onClick={() => {
                setSelected(template.title);
                void start(template.prompt);
              }}
              className={`flex h-full flex-col rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-left shadow-lg shadow-blue-900/20 transition hover:-translate-y-[2px] hover:border-blue-500/60 ${
                selected === template.title ? "ring-2 ring-blue-500" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <p className="text-lg font-semibold text-white">{template.title}</p>
                <span className="rounded-full bg-blue-900/50 px-3 py-1 text-xs text-blue-100">Template</span>
              </div>
              <p className="mt-2 text-sm text-slate-400">{template.prompt}</p>
            </button>
          ))}
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl shadow-blue-900/40">
            <h3 className="text-xl font-semibold text-white">Missing API Key</h3>
            <p className="mt-2 text-sm text-slate-300">
              Add your OpenAI key in Settings to use templates.
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
