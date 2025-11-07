import { useEffect, useState } from "react";
import { fetchPlugins, type PluginMetadata } from "../lib/api";

type PluginGalleryProps = {
  className?: string;
};

export const PluginGallery = ({ className }: PluginGalleryProps) => {
  const [plugins, setPlugins] = useState<PluginMetadata[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const { plugins: loaded } = await fetchPlugins();
        setPlugins(loaded);
      } catch (error) {
        console.error("Failed to load plugins", error);
      }
    };
    void load();
  }, []);

  return (
    <div className={`rounded-xl border border-slate-800 bg-slate-900/80 p-4 shadow-lg shadow-black/40 ${className ?? ""}`}>
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Plugin Gallery</h2>
        <span className="text-xs uppercase tracking-wide text-slate-500">Dynamic agents</span>
      </div>
      {plugins.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400">
          No plugins registered yet. Drop agent modules into <code className="rounded bg-slate-800 px-1">agent.config.json</code> to extend
          the orchestrator.
        </p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {plugins.map((plugin) => (
            <li key={plugin.agentType} className="rounded-md border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex items-center justify-between text-xs uppercase tracking-wide text-slate-500">
                <span>{plugin.agentType}</span>
                {plugin.version && <span>v{plugin.version}</span>}
              </div>
              <p className="mt-2 text-sm text-slate-100">{plugin.description ?? "No description provided."}</p>
              <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-400">
                {plugin.author && <span>Author: {plugin.author}</span>}
                {plugin.defaultTask && <span>Default task: {plugin.defaultTask}</span>}
                {plugin.homepage && (
                  <a href={plugin.homepage} target="_blank" rel="noreferrer" className="text-sky-400 hover:text-sky-300">
                    Docs
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
