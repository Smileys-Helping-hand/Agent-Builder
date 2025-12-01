import { useState, useEffect } from "react";
import { BuilderSettings, fetchSettings, saveSettings, validateSettings } from "../lib/api";
import KeyValidator from "./KeyValidator";
import HealthCard from "./HealthCard";

const defaults: BuilderSettings = {
  provider: "openai",
  openaiApiKey: "",
  model: "gpt-4o-mini",
  codingModel: "gpt-4o-mini",
  visionModel: "gpt-4o-mini",
  ollamaEnabled: false,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1",
  vectorDbEnabled: false,
  voiceEnabled: false,
};

export default function SettingsPanel() {
  const [settings, setSettings] = useState<BuilderSettings>(defaults);
  const [status, setStatus] = useState<string | null>(null);
  const [valid, setValid] = useState(false);

  useEffect(() => {
    fetchSettings().then((remote) => setSettings({ ...defaults, ...remote }));
  }, []);

  const update = <K extends keyof BuilderSettings>(key: K, value: BuilderSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const save = async () => {
    setStatus(null);
    const updated = await saveSettings(settings);
    setSettings(updated);
    setStatus("Saved and applied to backend");
  };

  const validate = async () => {
    const res = await validateSettings(settings);
    setValid(res.ok);
    setStatus(res.ok ? "Keys validated" : res.errors.join(" "));
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm text-slate-300">
          <span>OpenAI API Key</span>
          <input
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            value={settings.openaiApiKey}
            onChange={(e) => update("openaiApiKey", e.target.value)}
            placeholder="sk-..."
          />
        </label>
        <label className="space-y-2 text-sm text-slate-300">
          <span>OpenAI Model</span>
          <input
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
            value={settings.model}
            onChange={(e) => update("model", e.target.value)}
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="flex items-center space-x-3 text-slate-200">
          <input
            type="checkbox"
            checked={settings.ollamaEnabled}
            onChange={(e) => update("ollamaEnabled", e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900"
          />
          <span>Enable Ollama</span>
        </label>
        <label className="flex items-center space-x-3 text-slate-200">
          <input
            type="checkbox"
            checked={settings.vectorDbEnabled}
            onChange={(e) => update("vectorDbEnabled", e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900"
          />
          <span>Enable VectorDB</span>
        </label>
        <label className="flex items-center space-x-3 text-slate-200">
          <input
            type="checkbox"
            checked={settings.voiceEnabled}
            onChange={(e) => update("voiceEnabled", e.target.checked)}
            className="h-4 w-4 rounded border-slate-700 bg-slate-900"
          />
          <span>Enable Voice</span>
        </label>
      </div>

      {settings.ollamaEnabled && (
        <div className="grid gap-4 md:grid-cols-2">
          <label className="space-y-2 text-sm text-slate-300">
            <span>Ollama Endpoint</span>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              value={settings.ollamaBaseUrl}
              onChange={(e) => update("ollamaBaseUrl", e.target.value)}
            />
          </label>
          <label className="space-y-2 text-sm text-slate-300">
            <span>Ollama Model</span>
            <input
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-white"
              value={settings.ollamaModel}
              onChange={(e) => update("ollamaModel", e.target.value)}
            />
          </label>
        </div>
      )}

      <KeyValidator onValidate={validate} valid={valid} status={status} />

      <div className="flex justify-between">
        <div className="text-sm text-slate-400">Settings persist locally and refresh the backend automatically.</div>
        <div className="flex gap-2">
          <button
            onClick={validate}
            className="rounded-xl border border-blue-500/60 px-4 py-2 text-sm font-semibold text-blue-100 shadow-md shadow-blue-900/30 transition hover:-translate-y-[1px] hover:bg-blue-900/30"
          >
            Validate
          </button>
          <button
            onClick={save}
            className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md shadow-blue-900/30 transition hover:-translate-y-[1px] hover:bg-blue-500"
          >
            Save Settings
          </button>
        </div>
      </div>

      <HealthCard valid={valid} status={status} />
    </div>
  );
}
