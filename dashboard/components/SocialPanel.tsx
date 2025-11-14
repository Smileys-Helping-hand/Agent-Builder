import { useMemo } from "react";
import useSWR from "swr";
import {
  fetchSocialState,
  type ServerEvent,
  type SimulationEvent,
  type SocialState
} from "../lib/api";
import {
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip
} from "recharts";
import heroImages from "../theme/heroImages";
import HeroSection from "./ui/HeroSection";

type SocialPanelProps = {
  events: ServerEvent[];
};

const isSocialEvent = (event: ServerEvent): event is { type: "simulation"; payload: SimulationEvent } => {
  if (event.type !== "simulation") return false;
  return ["social", "diplomacy", "economy"].includes(event.payload.category);
};

const RelationshipTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const [{ payload: node }] = payload;
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/90 p-3 text-xs text-slate-200 shadow-lg">
      <p className="font-semibold text-sky-300">{node.label ?? node.id}</p>
      {node.role && <p className="text-slate-400">{node.role}</p>}
      <p className="mt-1 text-slate-300">Connections: {node.links}</p>
    </div>
  );
};

const buildGraphData = (state?: SocialState) => {
  if (!state?.graph?.nodes?.length) return [];
  const nodes = state.graph.nodes;
  const edges = state.graph.edges;
  return nodes.map((node, index) => {
    const angle = (index / nodes.length) * Math.PI * 2;
    const radius = 45 + (edges.length > 0 ? (index % 5) * 12 : 20);
    const linkCount = edges.filter((edge) => edge.source === node.id || edge.target === node.id).length;
    return {
      id: node.id,
      label: node.label ?? node.id,
      role: node.role,
      x: Math.cos(angle) * radius + 60,
      y: Math.sin(angle) * radius + 60,
      z: Math.max(12, linkCount * 6),
      links: linkCount
    };
  });
};

export const SocialPanel = ({ events }: SocialPanelProps) => {
  const { data, isValidating } = useSWR("storyworld/social/state", fetchSocialState, {
    refreshInterval: 15000
  });

  const state = data?.state;
  const socialEvents = useMemo(() => events.filter(isSocialEvent).map((event) => event.payload), [events]);
  const graphData = useMemo(() => buildGraphData(state), [state]);

  return (
    <section className="mx-auto mt-10 max-w-6xl overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60 shadow-2xl shadow-black/40">
      <HeroSection
        image={heroImages.social}
        title="Social Simulation"
        subtitle="Powered by Hustle Studio"
        className="rounded-t-xl border-b border-slate-800 overflow-hidden"
      />

      <div className="grid gap-8 px-6 pb-6 pt-2 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-xl border border-sky-900/40 bg-slate-950/80 p-6 shadow-lg shadow-sky-900/30">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-sky-100">NPC Social Graph</h2>
              <p className="mt-1 text-sm text-slate-400">
                Visualize how NPCs relate to each other. Node size reflects relationship counts. Updates every few ticks.
              </p>
            </div>
            <span className="text-xs uppercase tracking-wide text-slate-500">{isValidating ? "Refreshing…" : "Live"}</span>
          </header>
          <div className="mt-6 h-64 w-full overflow-hidden rounded-lg border border-slate-900/70 bg-slate-950/90">
            {graphData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <XAxis type="number" dataKey="x" hide domain={[0, 120]} />
                  <YAxis type="number" dataKey="y" hide domain={[0, 120]} />
                  <Tooltip content={<RelationshipTooltip />} cursor={{ stroke: "#38bdf8", strokeOpacity: 0.3 }} />
                  <Scatter data={graphData} fill="#38bdf8" />
                </ScatterChart>
              </ResponsiveContainer>
            ) : (
              <p className="flex h-full items-center justify-center text-sm text-slate-500">
                No NPC relationships recorded yet.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-sky-900/40 bg-slate-950/80 p-6 shadow-lg shadow-sky-900/30">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-sky-200">Recent Dialogue & Social Events</h3>
          <div className="mt-4 space-y-3">
            {state?.dialogue?.recent?.slice(0, 6).map((entry) => (
              <article key={entry.id} className="rounded-lg border border-sky-900/40 bg-sky-950/20 p-4">
                <header className="flex flex-wrap items-center justify-between gap-2 text-xs uppercase tracking-wide text-sky-300">
                  <span>{entry.participants.join(" × ")}</span>
                  <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                </header>
                <p className="mt-2 whitespace-pre-line text-sm text-sky-100">{entry.summary}</p>
                {entry.sentiment && (
                  <p className="mt-1 text-[11px] uppercase tracking-wide text-sky-300/80">Mood: {entry.sentiment}</p>
                )}
              </article>
            ))}
            {socialEvents.slice(0, 4).map((event) => (
              <article key={event.id} className="rounded-lg border border-emerald-900/40 bg-emerald-950/20 p-4">
                <header className="flex items-center justify-between text-xs uppercase tracking-wide text-emerald-300">
                  <span>{event.label ?? event.category.toUpperCase()}</span>
                  <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                </header>
                <p className="mt-2 text-sm text-emerald-100">{event.description}</p>
              </article>
            ))}
            {(!state?.dialogue?.recent?.length && socialEvents.length === 0) && (
              <p className="rounded-lg border border-dashed border-slate-800/80 bg-slate-950/60 p-5 text-center text-sm text-slate-400">
                No social interactions captured yet. Let the simulation run to populate this feed.
              </p>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="rounded-xl border border-sky-900/40 bg-slate-950/80 p-6 shadow-lg shadow-sky-900/30">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-sky-200">Faction Influence</h3>
          <ul className="mt-4 space-y-3">
            {(state?.graph?.factions ?? []).map((faction) => (
              <li key={faction.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-sm font-semibold text-sky-100">{faction.name ?? faction.id}</p>
                <div className="mt-2 h-2 w-full rounded bg-slate-800">
                  <div
                    className="h-2 rounded bg-sky-400"
                    style={{ width: `${Math.min(100, faction.influence)}%` }}
                  />
                </div>
                <p className="mt-1 text-[11px] uppercase tracking-wide text-slate-400">
                  Influence: {Math.round(faction.influence)}
                </p>
                {faction.resources && (
                  <p className="text-[11px] text-slate-500">
                    Food {faction.resources.food ?? "—"} · Gold {faction.resources.gold ?? "—"} · Materials {faction.resources.materials ?? "—"}
                  </p>
                )}
              </li>
            ))}
            {(state?.graph?.factions?.length ?? 0) === 0 && (
              <li className="rounded-lg border border-dashed border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-400">
                No factions tracked yet.
              </li>
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-sky-900/40 bg-slate-950/80 p-6 shadow-lg shadow-sky-900/30">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-sky-200">Diplomacy Status</h3>
          <ul className="mt-4 space-y-3">
            {(state?.diplomacy?.relations ?? []).slice(0, 6).map((relation) => (
              <li key={relation.id} className="rounded-lg border border-slate-800 bg-slate-950/70 p-3">
                <p className="text-sm font-semibold text-sky-100">
                  {relation.factionA} ↔ {relation.factionB}
                </p>
                <p className="text-[11px] uppercase tracking-wide text-slate-400">
                  Status: {relation.status} · Tension {relation.tension}
                </p>
                {relation.summary && <p className="mt-1 text-xs text-slate-400">{relation.summary}</p>}
              </li>
            ))}
            {(state?.diplomacy?.relations?.length ?? 0) === 0 && (
              <li className="rounded-lg border border-dashed border-slate-800 bg-slate-900/60 p-4 text-center text-xs text-slate-400">
                Diplomacy events will appear as factions interact.
              </li>
            )}
          </ul>
        </div>
      </aside>
      </div>
    </section>
  );
};
