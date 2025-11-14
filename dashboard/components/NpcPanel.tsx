"use client";

import { FormEvent, useCallback, useState } from "react";
import { generateNpc } from "../lib/api";

const templates = [
  { id: "npc_dialogue", label: "Dialogue" },
  { id: "npc_patrol", label: "Patrol" },
  { id: "npc_shop", label: "Shop" }
];

export function NpcPanel() {
  const [prompt, setPrompt] = useState("Create a friendly greeter who patrols the lobby.");
  const [templateId, setTemplateId] = useState<string>(templates[0].id);
  const [result, setResult] = useState<{ filePath: string; content: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!prompt.trim()) return;
      setIsGenerating(true);
      setError(null);
      try {
        const { npc } = await generateNpc(prompt.trim(), templateId);
        setResult({ filePath: npc.filePath, content: npc.content });
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to generate NPC");
      } finally {
        setIsGenerating(false);
      }
    },
    [prompt, templateId]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div>
          <h2 className="text-lg font-semibold text-slate-100">NPC Intelligence</h2>
          <p className="mt-1 text-sm text-slate-400">
            Describe the behaviour you need. Scripts are stored under <code>games/roblox/npcs/</code> and streamed to Studio when live-sync is enabled.
          </p>
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Prompt</label>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
          />
        </div>

        <div>
          <label className="text-xs uppercase tracking-wide text-slate-400">Template</label>
          <div className="mt-2 flex gap-3">
            {templates.map((template) => (
              <button
                type="button"
                key={template.id}
                onClick={() => setTemplateId(template.id)}
                className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${
                  templateId === template.id
                    ? "border-emerald-400 bg-emerald-500/20 text-emerald-100"
                    : "border-slate-800 bg-slate-900/60 text-slate-300"
                }`}
              >
                {template.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={isGenerating}
            className="rounded-md bg-emerald-600/80 px-4 py-2 text-sm font-semibold text-emerald-50 disabled:opacity-50"
          >
            Generate NPC
          </button>
          {error && <p className="text-sm text-rose-400">{error}</p>}
        </div>
      </form>

      <aside className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h3 className="text-sm font-semibold text-slate-100">Preview</h3>
        {result ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">{result.filePath}</p>
            <pre className="max-h-80 overflow-auto rounded-md border border-slate-800 bg-slate-950/70 p-3 text-[12px] text-slate-300">
              {result.content}
            </pre>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Generate an NPC to preview the script.</p>
        )}
      </aside>
    </div>
  );
}
