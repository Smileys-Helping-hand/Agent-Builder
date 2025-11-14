import { FormEvent, useMemo, useState } from "react";
import useSWR from "swr";
import {
  controlPlayerSimulation,
  createGlobalGoal,
  fetchPlayerSimulation,
  spawnPlayerAgent,
  type GoalSnapshot,
  type PlayerSimulationState,
  type ServerEvent,
  type SimulationEvent
} from "../lib/api";
import heroImages from "../theme/heroImages";
import HeroSection from "./ui/HeroSection";

const goalTypes = ["conquest", "discovery", "diplomacy", "artifact", "exploration"];

const PlayerBadge = ({ player }: { player: PlayerSimulationState }) => (
  <div className="flex items-center gap-3">
    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600/30 text-sm font-semibold text-indigo-200">
      {player.name.slice(0, 2).toUpperCase()}
    </div>
    <div>
      <p className="text-sm font-semibold text-indigo-100">{player.name}</p>
      <p className="text-xs text-slate-400">
        {player.disposition} · {player.traits.join(", ")}
      </p>
    </div>
  </div>
);

const ProgressBar = ({ value, color }: { value: number; color?: string }) => (
  <div className="mt-2 h-2 w-full rounded bg-slate-800">
    <div
      className={`h-2 rounded ${color ?? "bg-indigo-400"}`}
      style={{ width: `${Math.min(100, Math.max(0, Math.round(value)))}%` }}
    />
  </div>
);

const isPlayerEvent = (event: ServerEvent): event is { type: "simulation"; payload: SimulationEvent } =>
  event.type === "simulation" && ["player", "goal"].includes(event.payload.category);

type PlayerPanelProps = {
  events: ServerEvent[];
};

export const PlayerPanel = ({ events }: PlayerPanelProps) => {
  const [newName, setNewName] = useState("");
  const [goalType, setGoalType] = useState<string>(goalTypes[0]);
  const [goalCatalyst, setGoalCatalyst] = useState("");
  const [pending, setPending] = useState(false);
  const [goalPending, setGoalPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, mutate, isValidating } = useSWR("storyworld/players", fetchPlayerSimulation, {
    refreshInterval: 20000
  });

  const players = data?.players ?? [];
  const goals = data?.goals ?? ({ goals: [], completed: [] } as GoalSnapshot);
  const running = Boolean(data?.running);

  const playerEvents = useMemo(
    () => events.filter(isPlayerEvent).map((event) => event.payload),
    [events]
  );

  const spawn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await spawnPlayerAgent({ name: newName.trim() || undefined });
      setNewName("");
      await mutate();
    } catch (err: any) {
      setError(err?.message ?? "Failed to spawn AI player");
    } finally {
      setPending(false);
    }
  };

  const toggleSimulation = async () => {
    setPending(true);
    setError(null);
    try {
      await controlPlayerSimulation(running ? "pause" : "resume");
      await mutate();
    } catch (err: any) {
      setError(err?.message ?? "Failed to update simulation");
    } finally {
      setPending(false);
    }
  };

  const assignGoal = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (goalPending) return;
    setGoalPending(true);
    setError(null);
    try {
      await createGlobalGoal({ type: goalType, catalyst: goalCatalyst.trim() || undefined });
      setGoalCatalyst("");
      await mutate();
    } catch (err: any) {
      setError(err?.message ?? "Failed to create global goal");
    } finally {
      setGoalPending(false);
    }
  };

  const heroStatus = isValidating ? "Refreshing…" : running ? "Simulation Live" : "Simulation Paused";
  const heroActions = (
    <span className="inline-flex items-center rounded-full border border-indigo-400/60 bg-indigo-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-200">
      {heroStatus}
    </span>
  );

  return (
    <section className="mx-auto mt-10 max-w-6xl overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60 shadow-2xl shadow-black/40">
      <HeroSection
        image={heroImages.player}
        title="AI Player Command"
        subtitle="Powered by Hustle Studio"
        className="rounded-t-xl border-b border-slate-800 overflow-hidden"
        actions={heroActions}
      />

      <div className="grid gap-8 px-6 pb-6 pt-2 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-xl border border-indigo-900/50 bg-slate-950/85 p-6 shadow-lg shadow-indigo-900/20">
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-indigo-100">Autonomous AI Players</h2>
              <p className="mt-1 text-sm text-slate-400">
                Manage simulated players that pursue world goals, trade with factions, and influence the evolving story.
              </p>
            </div>
            <span className="text-xs uppercase tracking-wide text-slate-500">
              {isValidating ? "Refreshing…" : running ? "Live" : "Paused"}
            </span>
          </header>

          <form onSubmit={spawn} className="mt-4 flex flex-wrap gap-3">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="AI Player name"
              className="flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
            />
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center justify-center rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {pending ? "Spawning…" : "Add New AI Player"}
            </button>
            <button
              type="button"
              onClick={toggleSimulation}
              disabled={pending}
              className="inline-flex items-center justify-center rounded-md border border-indigo-500/60 px-4 py-2 text-sm font-semibold text-indigo-200 hover:bg-indigo-500/10 disabled:cursor-not-allowed disabled:border-slate-700 disabled:text-slate-400"
            >
              {running ? "Pause Simulation" : "Resume Simulation"}
            </button>
          </form>
          {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}

          <div className="mt-6 space-y-4">
            {players.map((player) => (
              <article key={player.id} className="rounded-lg border border-indigo-900/50 bg-indigo-950/20 p-4">
                <PlayerBadge player={player} />
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Morale</p>
                    <ProgressBar value={player.morale} color="bg-indigo-400" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Energy</p>
                    <ProgressBar value={player.energy} color="bg-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Influence</p>
                    <ProgressBar value={player.influence} color="bg-emerald-400" />
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500">Reputation</p>
                    <ProgressBar value={player.reputation} color="bg-sky-400" />
                  </div>
                </div>
                {player.lastAction && (
                  <p className="mt-3 text-sm text-slate-300">{player.lastAction}</p>
                )}
                <div className="mt-3 space-y-2">
                  {(player.goals ?? []).slice(0, 2).map((goal) => (
                    <div key={goal.id} className="rounded border border-indigo-900/40 bg-slate-950/40 p-3 text-xs text-slate-300">
                      <p className="font-semibold text-indigo-200">{goal.label}</p>
                      <p className="mt-1 text-slate-400">Status: {goal.status}</p>
                      <ProgressBar value={goal.progress} color="bg-indigo-300" />
                    </div>
                  ))}
                  {(player.goals?.length ?? 0) === 0 && (
                    <p className="rounded border border-dashed border-indigo-900/40 bg-slate-950/30 p-3 text-xs text-slate-500">
                      No goals assigned yet.
                    </p>
                  )}
                </div>
              </article>
            ))}
            {players.length === 0 && (
              <p className="rounded-lg border border-dashed border-indigo-900/40 bg-slate-950/40 p-6 text-center text-sm text-slate-400">
                No AI players active. Spawn one to begin the simulation.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-indigo-900/50 bg-slate-950/85 p-6 shadow-lg shadow-indigo-900/20">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">Recent Player & Goal Events</h3>
          <div className="mt-4 space-y-3">
            {playerEvents.slice(0, 8).map((event) => (
              <article key={event.id} className="rounded-lg border border-indigo-900/40 bg-indigo-950/20 p-4">
                <header className="flex items-center justify-between text-xs uppercase tracking-wide text-indigo-300">
                  <span>{event.label ?? event.category.toUpperCase()}</span>
                  <time>{new Date(event.timestamp).toLocaleTimeString()}</time>
                </header>
                <p className="mt-2 text-sm text-indigo-100">{event.description}</p>
              </article>
            ))}
            {playerEvents.length === 0 && (
              <p className="rounded-lg border border-dashed border-indigo-900/40 bg-slate-950/40 p-6 text-center text-sm text-slate-400">
                No player activity captured yet.
              </p>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="rounded-xl border border-indigo-900/50 bg-slate-950/85 p-6 shadow-lg shadow-indigo-900/20">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">Global Goals</h3>
          <form onSubmit={assignGoal} className="mt-4 space-y-3">
            <div className="grid gap-3">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Goal Type</label>
              <select
                value={goalType}
                onChange={(event) => setGoalType(event.target.value)}
                className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              >
                {goalTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <textarea
                value={goalCatalyst}
                onChange={(event) => setGoalCatalyst(event.target.value)}
                placeholder="Catalyst or narrative prompt"
                className="h-20 rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>
            <button
              type="submit"
              disabled={goalPending}
              className="w-full rounded-md bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {goalPending ? "Assigning…" : "Assign Global Goal"}
            </button>
          </form>

          <div className="mt-6 space-y-3">
            {(goals.goals ?? []).map((goal) => (
              <article key={goal.id} className="rounded-lg border border-indigo-900/40 bg-slate-950/40 p-4 text-sm text-slate-300">
                <header className="flex items-center justify-between text-xs uppercase tracking-wide text-indigo-300">
                  <span>{goal.label}</span>
                  <span>{goal.status}</span>
                </header>
                <p className="mt-2 text-slate-400">{goal.description}</p>
                <ProgressBar value={goal.progress} color="bg-indigo-400" />
              </article>
            ))}
            {(goals.goals?.length ?? 0) === 0 && (
              <p className="rounded-lg border border-dashed border-indigo-900/40 bg-slate-950/40 p-4 text-center text-xs text-slate-400">
                No active global goals. Assign one above to guide the simulation.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-indigo-900/40 bg-slate-950/80 p-6 shadow-lg shadow-indigo-900/20">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">Resolved Goals</h3>
          <ul className="mt-4 space-y-3 text-xs text-slate-400">
            {(goals.completed ?? []).slice(0, 6).map((goal) => (
              <li key={goal.id} className="rounded border border-indigo-900/30 bg-slate-950/30 p-3">
                <p className="font-semibold text-indigo-200">{goal.label}</p>
                <p className="mt-1">Status: {goal.status}</p>
                <p className="mt-1 text-slate-500">Updated {new Date(goal.updatedAt).toLocaleString()}</p>
              </li>
            ))}
            {(goals.completed?.length ?? 0) === 0 && (
              <li className="rounded border border-dashed border-indigo-900/30 bg-slate-950/30 p-4 text-center">
                No completed goals yet.
              </li>
            )}
          </ul>
        </div>
      </aside>
      </div>
    </section>
  );
};
