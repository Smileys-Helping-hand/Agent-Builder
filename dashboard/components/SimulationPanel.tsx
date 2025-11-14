import { useCallback, useMemo, useState } from "react";
import useSWR from "swr";
import {
  controlSimulation,
  fetchSimulationState,
  type ServerEvent,
  type SimulationEvent,
  type SimulationState
} from "../lib/api";
import heroImages from "../theme/heroImages";
import HeroSection from "./ui/HeroSection";

const formatTimestamp = (timestamp: string | null | undefined) =>
  timestamp ? new Date(timestamp).toLocaleTimeString() : "Never";

const dedupeEvents = (primary: SimulationEvent[], secondary: SimulationEvent[] = []) => {
  const map = new Map<string, SimulationEvent>();
  [...primary, ...secondary].forEach((event) => {
    if (!map.has(event.id)) {
      map.set(event.id, event);
    }
  });
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
};

const ActivityBadge = ({ running }: { running: boolean }) => (
  <span
    className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
      running ? "bg-emerald-500/20 text-emerald-200" : "bg-slate-800 text-slate-300"
    }`}
  >
    <span className={`h-2 w-2 rounded-full ${running ? "bg-emerald-400 animate-pulse" : "bg-slate-500"}`} />
    {running ? "Running" : "Paused"}
  </span>
);

type SimulationPanelProps = {
  events: ServerEvent[];
};

export const SimulationPanel = ({ events }: SimulationPanelProps) => {
  const [pending, setPending] = useState(false);
  const { data, mutate, isValidating } = useSWR("storyworld/simulation", fetchSimulationState, {
    refreshInterval: 20000
  });

  const streamEvents = useMemo(
      () =>
        events
          .filter((event): event is Extract<ServerEvent, { type: "simulation" }> => event.type === "simulation")
          .map((event) => event.payload),
    [events]
  );

  const state: SimulationState | undefined = data?.state;
  const combinedEvents = useMemo(() => {
    return dedupeEvents(streamEvents, state?.events ?? data?.log ?? []);
  }, [streamEvents, state?.events, data?.log]);

  const socialState = state?.social;
  const topRelations = useMemo(() => {
    const edges = socialState?.graph?.edges ?? [];
    return [...edges]
      .sort((a, b) => (b.trust ?? 0) - (a.trust ?? 0))
      .slice(0, 5);
  }, [socialState?.graph?.edges]);
  const diplomacyHighlights = useMemo(
    () => socialState?.diplomacy?.relations?.slice(0, 3) ?? [],
    [socialState?.diplomacy?.relations]
  );

  const onAction = useCallback(
    async (payload: { action: string; speed?: number; steps?: number }) => {
      setPending(true);
      try {
        await controlSimulation(payload);
        await mutate();
      } catch (error) {
        console.error("Failed to control simulation", error);
      } finally {
        setPending(false);
      }
    },
    [mutate]
  );

  const nextSpeed = useMemo(() => {
    const current = state?.speedMultiplier ?? 1;
    if (current < 1) return 1;
    if (current < 2) return 2;
    if (current < 4) return 4;
    return 1;
  }, [state?.speedMultiplier]);

  const heroActions = <ActivityBadge running={Boolean(state?.running)} />;

  return (
    <section className="mx-auto mt-10 max-w-6xl overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60 shadow-2xl shadow-black/40">
      <HeroSection
        image={heroImages.simulation}
        title="Simulation Control"
        subtitle="Powered by Hustle Studio"
        className="rounded-t-xl border-b border-slate-800 overflow-hidden"
        actions={heroActions}
      />

      <div className="grid gap-8 px-6 pb-6 pt-2 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-xl border border-amber-900/40 bg-slate-950/80 p-6 shadow-lg shadow-amber-900/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-amber-100">StoryWorld Simulation Engine</h2>
                <p className="mt-1 text-sm text-slate-400">
                  Monitor autonomous NPC cognition, faction influence, and emergent world events. Control the simulation pace to
                  step, pause, or fast-forward the evolving storyline.
                </p>
              </div>
              <ActivityBadge running={Boolean(state?.running)} />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Tick Interval</p>
                <p className="mt-1 text-lg font-semibold text-amber-200">
                  {state ? `${state.intervalSeconds.toFixed(1)}s` : "—"}
                </p>
              </div>
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-500">Speed Multiplier</p>
                <p className="mt-1 text-lg font-semibold text-amber-200">×{state ? state.speedMultiplier.toFixed(2) : "—"}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                onClick={() => onAction({ action: state?.running ? "pause" : "resume" })}
                disabled={pending}
                className="inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-700"
              >
                {state?.running ? "Pause" : "Resume"}
              </button>
              <button
                onClick={() => onAction({ action: "step" })}
                disabled={pending}
                className="inline-flex items-center justify-center rounded-md border border-amber-500/60 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-400"
              >
                Step
              </button>
              <button
                onClick={() => onAction({ action: "fast_forward", steps: 5 })}
                disabled={pending}
                className="inline-flex items-center justify-center rounded-md border border-amber-500/60 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-400"
              >
                Fast-forward ×5
              </button>
              <button
                onClick={() => onAction({ action: "set_speed", speed: nextSpeed })}
                disabled={pending}
                className="inline-flex items-center justify-center rounded-md border border-amber-500/60 px-4 py-2 text-sm font-semibold text-amber-200 hover:bg-amber-500/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-400"
              >
                Set speed → ×{nextSpeed}
              </button>
            </div>
            <p className="mt-3 text-xs text-slate-500">Last tick: {formatTimestamp(state?.lastTick)} · Refreshing {isValidating ? "…" : ""}</p>
          </div>

          <div className="rounded-xl border border-amber-900/40 bg-slate-950/80 p-6 shadow-lg shadow-amber-900/20">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-200">Live Simulation Log</h3>
            <div className="mt-4 space-y-3">
              {combinedEvents.slice(0, 40).map((event) => (
                <article key={event.id} className="rounded-lg border border-amber-900/40 bg-amber-950/20 p-4">
                  <header className="flex items-center justify-between text-xs uppercase tracking-wide text-amber-300">
                    <span>{event.label ?? event.category.toUpperCase()}</span>
                    <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                  </header>
                  <p className="mt-2 text-sm text-amber-100">{event.description}</p>
                  {event.metadata && (
                    <p className="mt-2 text-[11px] text-amber-200/80">
                      {Object.entries(event.metadata)
                        .slice(0, 4)
                        .map(([key, value]) => `${key}: ${typeof value === "number" ? value.toFixed(2) : String(value)}`)
                        .join(" · ")}
                    </p>
                  )}
                </article>
              ))}
              {combinedEvents.length === 0 && (
                <p className="rounded-lg border border-dashed border-amber-900/50 bg-amber-950/10 p-6 text-center text-sm text-amber-200/70">
                  No simulation activity recorded yet. Resume the engine to generate events.
                </p>
              )}
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-xl border border-amber-900/40 bg-slate-950/80 p-6 shadow-lg shadow-amber-900/20">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-200">Factions</h3>
            <ul className="mt-4 space-y-3">
              {(state?.factions ?? []).map((faction) => (
                <li key={faction.id} className="rounded-lg border border-amber-900/30 bg-amber-950/10 p-3">
                  <p className="text-sm font-semibold text-amber-100">{faction.name}</p>
                  <p className="text-xs uppercase tracking-wide text-amber-300">Alignment: {faction.alignment}</p>
                  <p className="text-xs text-amber-200/80">Influence: {faction.influence}</p>
                  {faction.territory && <p className="text-xs text-amber-200/80">Territory: {faction.territory}</p>}
                </li>
              ))}
              {(state?.factions?.length ?? 0) === 0 && (
                <li className="rounded-lg border border-dashed border-amber-900/30 bg-amber-950/10 p-4 text-center text-xs text-amber-200/70">
                  No factions registered yet.
                </li>
              )}
            </ul>
          </div>

          <div className="rounded-xl border border-amber-900/40 bg-slate-950/80 p-6 shadow-lg shadow-amber-900/20">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-200">NPC States</h3>
            <ul className="mt-4 space-y-3">
              {(state?.npcStates ?? []).map((npc) => (
                <li key={npc.id} className="rounded-lg border border-amber-900/30 bg-amber-950/10 p-3">
                  <p className="text-sm font-semibold text-amber-100">{npc.name}</p>
                  <p className="text-xs uppercase tracking-wide text-amber-300">{npc.role ?? "Citizen"}</p>
                  <p className="text-[11px] text-amber-200/80">
                    Mood {npc.mood} · Hunger {npc.hunger} · Energy {npc.energy}
                  </p>
                  {npc.lastAction && <p className="text-xs text-amber-200/70">Last: {npc.lastAction}</p>}
                  <p className="text-[10px] uppercase tracking-wide text-amber-300/80">
                    {npc.isRunning ? "Autonomous" : "Waiting"} · Traits: {npc.traits.join(", ")}
                  </p>
                </li>
              ))}
              {(state?.npcStates?.length ?? 0) === 0 && (
                <li className="rounded-lg border border-dashed border-amber-900/30 bg-amber-950/10 p-4 text-center text-xs text-amber-200/70">
                  No NPC cognition loops registered.
                </li>
              )}
            </ul>
          </div>

          {socialState && (
            <div className="rounded-xl border border-amber-900/40 bg-slate-950/80 p-6 shadow-lg shadow-amber-900/20">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-200">Social Snapshot</h3>
              <div className="mt-4 space-y-4 text-sm text-amber-100">
                <div>
                  <p className="text-xs uppercase tracking-wide text-amber-300">Top Relationships</p>
                  <ul className="mt-2 space-y-2 text-xs text-amber-200/90">
                    {topRelations.map((edge) => (
                      <li key={edge.id} className="rounded-lg border border-amber-900/30 bg-amber-950/10 p-2">
                        <p className="font-semibold text-amber-100">
                          {edge.source} ↔ {edge.target}
                        </p>
                        <p className="text-[11px] text-amber-200/70">
                          Trust {edge.trust} · Rivalry {edge.rivalry} · Trade {edge.trade}
                        </p>
                      </li>
                    ))}
                    {topRelations.length === 0 && (
                      <li className="rounded-lg border border-dashed border-amber-900/30 bg-amber-950/10 p-3 text-center text-[11px] text-amber-200/70">
                        Relationships will populate as NPCs interact.
                      </li>
                    )}
                  </ul>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-amber-300">Diplomacy Highlights</p>
                  <ul className="mt-2 space-y-2 text-xs text-amber-200/90">
                    {diplomacyHighlights.map((relation) => (
                      <li key={relation.id} className="rounded-lg border border-amber-900/30 bg-amber-950/10 p-2">
                        <p className="font-semibold text-amber-100">
                          {relation.factionA} ↔ {relation.factionB}
                        </p>
                        <p className="text-[11px] text-amber-200/70">
                          {relation.status} · Tension {relation.tension}
                        </p>
                      </li>
                    ))}
                    {diplomacyHighlights.length === 0 && (
                      <li className="rounded-lg border border-dashed border-amber-900/30 bg-amber-950/10 p-3 text-center text-[11px] text-amber-200/70">
                        Diplomacy events will appear soon.
                      </li>
                    )}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
};
