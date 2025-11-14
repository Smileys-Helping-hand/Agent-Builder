"use client";

import { FormEvent, useCallback, useState } from "react";
import { generateTerrain } from "../lib/api";
import heroImages from "../theme/heroImages";
import HeroSection from "./ui/HeroSection";

const biomes = [
  { id: "mountains", label: "Mountains" },
  { id: "desert", label: "Desert" },
  { id: "volcanic", label: "Volcanic" }
];

export function TerrainPanel() {
  const [prompt, setPrompt] = useState("Generate mountains with caves and rivers.");
  const [seed, setSeed] = useState<string>("");
  const [selectedBiome, setSelectedBiome] = useState<string>(biomes[0].id);
  const [result, setResult] = useState<{ filePath: string; seed: number; summary: string } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!prompt.trim()) return;
      setIsGenerating(true);
      setError(null);
      try {
        const mergedPrompt = `${prompt.trim()} Include ${selectedBiome} biome.`;
        const numericSeed = seed ? Number(seed) : undefined;
        const { terrain } = await generateTerrain(mergedPrompt, numericSeed);
        setResult(terrain);
      } catch (err) {
        console.error(err);
        setError(err instanceof Error ? err.message : "Failed to generate terrain");
      } finally {
        setIsGenerating(false);
      }
    },
    [prompt, seed, selectedBiome]
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
      <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl shadow-black/40">
        <HeroSection
          image={heroImages.terrain}
          title="Procedural Terrain"
          subtitle="Powered by Hustle Studio"
          className="rounded-t-xl border-b border-slate-800 overflow-hidden"
        />

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Prompt</label>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Biome Preset</label>
              <div className="mt-2 flex gap-2">
                {biomes.map((biome) => (
                  <button
                  type="button"
                  key={biome.id}
                  onClick={() => setSelectedBiome(biome.id)}
                  className={`rounded-md border px-3 py-2 text-xs font-semibold transition ${
                    biome.id === selectedBiome
                      ? "border-amber-400 bg-amber-500/20 text-amber-100"
                      : "border-slate-800 bg-slate-900/60 text-slate-300"
                  }`}
                >
                  {biome.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Seed (optional)</label>
            <input
              value={seed}
              onChange={(event) => setSeed(event.target.value.replace(/[^0-9]/g, ""))}
              placeholder="123456"
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
            />
          </div>
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isGenerating}
              className="rounded-md bg-sky-600/80 px-4 py-2 text-sm font-semibold text-sky-50 disabled:opacity-50"
            >
              Build Terrain
            </button>
            {error && <p className="text-sm text-rose-400">{error}</p>}
          </div>
        </form>
      </section>

      <aside className="rounded-xl border border-slate-800 bg-slate-900/40 p-6">
        <h3 className="text-sm font-semibold text-slate-100">Output</h3>
        {result ? (
          <div className="mt-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Seed {result.seed} · {result.summary}
            </p>
            <p className="text-xs text-slate-500">Saved to {result.filePath}</p>
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-500">Generate terrain to view the saved script path.</p>
        )}
      </aside>
    </div>
  );
}
