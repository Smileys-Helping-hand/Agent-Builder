"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  exportRobloxGame,
  fetchRobloxTemplates,
  generateRobloxGame,
  subscribeToEvents,
  syncRobloxProject,
  triggerRobloxPlaytest,
  type RobloxGame,
  type RobloxTemplate,
  type ServerEvent
} from "../lib/api";

type RobloxSyncStatus = "disconnected" | "connecting" | "connected" | "sync" | "playtest" | "error";

type SyncLog = {
  id: string;
  status: RobloxSyncStatus;
  message: string;
  path?: string;
  timestamp: string;
};

const buildTree = (assets: RobloxGame["assets"]) => {
  type Node = { name: string; children: Node[] };
  const root: Node = { name: "Game", children: [] };

  for (const asset of assets) {
    const segments = asset.path.split("/");
    let current = root;
    for (const segment of segments) {
      let child = current.children.find((node) => node.name === segment);
      if (!child) {
        child = { name: segment, children: [] };
        current.children.push(child);
      }
      current = child;
    }
  }

  return root.children;
};

const TreeNode = ({ node }: { node: { name: string; children: any[] } }) => (
  <li>
    <span className="font-medium text-slate-200">{node.name}</span>
    {node.children.length > 0 && (
      <ul className="ml-4 mt-1 space-y-1 border-l border-slate-800 pl-3 text-sm text-slate-400">
        {node.children.map((child) => (
          <TreeNode key={child.name} node={child} />
        ))}
      </ul>
    )}
  </li>
);

export function GamePanel() {
  const [templates, setTemplates] = useState<RobloxTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [prompt, setPrompt] = useState("Build a Roblox racing game with checkpoints and leaderboard");
  const [game, setGame] = useState<RobloxGame | null>(null);
  const [activeAssetPath, setActiveAssetPath] = useState<string>("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [exportLink, setExportLink] = useState<string | null>(null);
  const [liveSyncEnabled, setLiveSyncEnabled] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<RobloxSyncStatus>("disconnected");
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPlaytesting, setIsPlaytesting] = useState(false);

  useEffect(() => {
    fetchRobloxTemplates()
      .then((result) => {
        setTemplates(result.templates);
        if (result.templates.length > 0) {
          setSelectedTemplate(result.templates[0].id);
        }
      })
      .catch((error) => {
        console.error("Failed to load templates", error);
      });
  }, []);

  useEffect(() => {
    if (!game || !game.assets.length) {
      setActiveAssetPath("");
      return;
    }
    setActiveAssetPath(game.assets[0].path);
  }, [game]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let subscription: { close: () => void } | null = null;
    try {
      subscription = subscribeToEvents((event: ServerEvent) => {
        if (event.type !== "roblox_sync") {
          return;
        }

        const payload = event.payload;
        setConnectionStatus(payload.status);
        if (payload.status === "connected") {
          setLiveSyncEnabled(true);
        } else if (payload.status === "disconnected") {
          setLiveSyncEnabled(false);
        }

        setSyncLogs((previous) => {
          const entry: SyncLog = {
            id: `${payload.timestamp}-${payload.message}`,
            status: payload.status,
            message: payload.message,
            path: payload.path,
            timestamp: payload.timestamp
          };
          const next = [entry, ...previous];
          return next.slice(0, 50);
        });
      });
    } catch (error) {
      console.error("Failed to subscribe to live sync events", error);
    }

    return () => {
      subscription?.close();
    };
  }, []);

  const tree = useMemo(() => (game ? buildTree(game.assets) : []), [game]);

  const previewAsset = game?.assets.find((asset) => asset.path === activeAssetPath);

  const connectionActive = useMemo(
    () => connectionStatus === "connected" || connectionStatus === "sync" || connectionStatus === "playtest",
    [connectionStatus]
  );

  const statusLabel = useMemo(() => {
    switch (connectionStatus) {
      case "connected":
        return "Connected to Roblox Studio";
      case "connecting":
        return "Connecting to Roblox Studio";
      case "sync":
        return "Synchronizing assets";
      case "playtest":
        return "Playtesting in Studio";
      case "error":
        return "Connection error";
      default:
        return "Live-Sync idle";
    }
  }, [connectionStatus]);

  const indicatorClass = useMemo(() => {
    const base = "inline-flex h-2.5 w-2.5 rounded-full";
    if (connectionActive) {
      return `${base} bg-emerald-400 sync-indicator-active`;
    }
    if (connectionStatus === "error") {
      return `${base} bg-rose-500`;
    }
    if (connectionStatus === "connecting") {
      return `${base} bg-amber-400 sync-indicator-active`;
    }
    return `${base} bg-slate-500`;
  }, [connectionActive, connectionStatus]);

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      });
    } catch (error) {
      console.error("Failed to format timestamp", error);
      return timestamp;
    }
  };

  const onToggleLiveSync = useCallback(async () => {
    if (!liveSyncEnabled) {
      setConnectionStatus("connecting");
      setIsSyncing(true);
      try {
        await syncRobloxProject();
        setLiveSyncEnabled(true);
      } catch (error) {
        console.error("Failed to start Roblox live sync", error);
        setConnectionStatus("error");
        setSyncLogs((previous) => {
          const entry: SyncLog = {
            id: `${Date.now()}-sync-error`,
            status: "error",
            message: "Failed to initiate live sync. Check the server logs for details.",
            timestamp: new Date().toISOString()
          };
          return [entry, ...previous].slice(0, 50);
        });
      } finally {
        setIsSyncing(false);
      }
      return;
    }

    setLiveSyncEnabled(false);
    setConnectionStatus("disconnected");
    setSyncLogs((previous) => {
      const entry: SyncLog = {
        id: `${Date.now()}-sync-paused`,
        status: "disconnected",
        message: "Live-Sync paused from dashboard.",
        timestamp: new Date().toISOString()
      };
      return [entry, ...previous].slice(0, 50);
    });
  }, [liveSyncEnabled]);

  const onPlaytest = useCallback(async () => {
    setIsPlaytesting(true);
    try {
      await triggerRobloxPlaytest();
    } catch (error) {
      console.error("Failed to trigger Roblox playtest", error);
      setSyncLogs((previous) => {
        const entry: SyncLog = {
          id: `${Date.now()}-playtest-error`,
          status: "error",
          message: "Playtest command failed. Ensure Studio is connected.",
          timestamp: new Date().toISOString()
        };
        return [entry, ...previous].slice(0, 50);
      });
    } finally {
      setIsPlaytesting(false);
    }
  }, []);

  const onGenerate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setIsGenerating(true);
      try {
        const result = await generateRobloxGame({ templateId: selectedTemplate, prompt });
        setGame(result.game);
        setExportLink(null);
      } catch (error) {
        console.error("Failed to generate game", error);
      } finally {
        setIsGenerating(false);
      }
    },
    [prompt, selectedTemplate]
  );

  const onExport = useCallback(async () => {
    if (!game) return;
    try {
      const exportResult = await exportRobloxGame({ title: game.title, assets: game.assets });
      const binary = typeof window !== "undefined" ? window.atob(exportResult.content) : "";
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      setExportLink(url);
    } catch (error) {
      console.error("Failed to export Roblox experience", error);
    }
  }, [game]);

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-xl shadow-black/40">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Roblox Game Builder</h2>
          <p className="text-sm text-slate-400">Generate Lua scripts, inspect the asset tree, and export a ready-to-open RBXLX.</p>
      </div>
      {exportLink && (
        <a
          href={exportLink}
          download={game?.title ? `${game.title}.rbxlx` : "roblox-experience.rbxlx"}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400"
          >
            Download Export
          </a>
        )}
      </div>

      <div className="mt-4 space-y-3 rounded-lg border border-slate-800 bg-slate-950/70 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Studio Live-Sync</h3>
            <p className="text-xs text-slate-400">Toggle the Roblox Studio bridge, review recent sync events, and trigger live playtests.</p>
          </div>
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={onToggleLiveSync}
              disabled={isSyncing}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-semibold text-slate-200 shadow-sm transition hover:border-sky-500 hover:text-white disabled:cursor-not-allowed disabled:border-slate-800 disabled:text-slate-500"
            >
              <span className={indicatorClass} aria-hidden="true" />
              {liveSyncEnabled ? "Live-Sync 🟢" : "Enable Live-Sync"}
              {isSyncing && <span className="ml-1 animate-pulse text-xs text-slate-400">(starting)</span>}
            </button>
            <button
              type="button"
              onClick={onPlaytest}
              disabled={!connectionActive || isPlaytesting}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {isPlaytesting ? "Playtesting..." : "Playtest in Studio"}
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs text-slate-400">
          <span className="flex items-center gap-2 text-slate-300">
            <span className={indicatorClass} aria-hidden="true" />
            {statusLabel}
          </span>
          <span>{syncLogs.length > 0 ? `${syncLogs.length} event${syncLogs.length === 1 ? "" : "s"} captured` : "No sync activity"}</span>
        </div>
        <div className="max-h-48 overflow-auto rounded-md border border-slate-800 bg-slate-950/60 p-3 text-xs">
          {syncLogs.length === 0 ? (
            <p className="text-slate-500">Awaiting the first sync event from Roblox Studio.</p>
          ) : (
            <ul className="space-y-2">
              {syncLogs.map((log) => (
                <li key={log.id} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between text-slate-200">
                    <span>{log.message}</span>
                    <span className="text-[10px] uppercase tracking-wide text-slate-500">{formatTimestamp(log.timestamp)}</span>
                  </div>
                  {log.path && <span className="text-[10px] text-slate-500">{log.path}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <form onSubmit={onGenerate} className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">Experience prompt</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            className="h-24 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        </div>
        <div className="space-y-2">
          <label className="text-xs uppercase tracking-wide text-slate-400">Template</label>
          <select
            value={selectedTemplate}
            onChange={(event) => setSelectedTemplate(event.target.value)}
            className="w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isGenerating}
            className="w-full rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
          >
            {isGenerating ? "Generating..." : "Generate"}
          </button>
        </div>
      </form>

      {game ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <aside className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Asset Tree</h3>
            <ul className="mt-3 space-y-2 text-sm">
              {tree.map((node) => (
                <TreeNode key={node.name} node={node} />
              ))}
            </ul>
          </aside>

          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-4">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Overview</h3>
              <ReactMarkdown className="prose prose-invert mt-2 max-w-none text-sm" remarkPlugins={[remarkGfm]}>
                {game.summary}
              </ReactMarkdown>
            </div>

            <div className="rounded-lg border border-slate-800 bg-slate-950/70">
              <header className="flex items-center justify-between border-b border-slate-800 px-4 py-3 text-xs uppercase tracking-wide text-slate-400">
                <span>Asset Preview</span>
                <select
                  value={activeAssetPath}
                  onChange={(event) => setActiveAssetPath(event.target.value)}
                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                >
                  {game.assets.map((asset) => (
                    <option key={asset.path} value={asset.path}>
                      {asset.path}
                    </option>
                  ))}
                </select>
              </header>
              <pre className="max-h-96 overflow-auto bg-slate-950 p-4 text-[12px] text-slate-200">
                {previewAsset?.content ?? "Select an asset to preview its contents."}
              </pre>
              <div className="border-t border-slate-800 px-4 py-3 text-right">
                <button
                  onClick={onExport}
                  className="rounded-md bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-400"
                  type="button"
                >
                  Export RBXLX
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-6 text-sm text-slate-500">Generate a Roblox experience to see the game tree and scripts.</p>
      )}
    </section>
  );
}
