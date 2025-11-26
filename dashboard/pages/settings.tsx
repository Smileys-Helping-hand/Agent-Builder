import Head from "next/head";
import SettingsPanel from "../components/SettingsPanel";

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      <Head>
        <title>Settings • AutoDev Forge</title>
      </Head>
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-bold text-blue-200">Settings</h1>
        <p className="mt-2 text-slate-400">Manage your API keys, provider toggles, and environment generation.</p>
        <div className="mt-8 rounded-2xl border border-slate-800 bg-slate-950/80 p-6 shadow-lg shadow-blue-900/20">
          <SettingsPanel />
        </div>
      </div>
    </div>
  );
}
