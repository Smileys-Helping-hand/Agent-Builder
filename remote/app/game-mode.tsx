"use client";

/**
 * Game mode in the app: one switch that pauses everything on the PC for games
 * (builds, research, continuous improvement and practice pause; the model
 * server, Jarvis's copy on the PC, the image engine and SaveState hosting
 * stop) and starts it all again. Agent Builder stays on, idle, so this switch
 * can reach it. The switch runs on the PC in the background; while it does,
 * the state is polled every few seconds. A strip under the header says when it
 * is on, and Home and Control have the switch.
 *
 * Kept free of ./ui imports so the shared Header can show the strip.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { ApiError, api, loadConnection, type GameModeStatus } from "@/lib/api";

interface GameModeContextValue {
  status: GameModeStatus | null;
  /** The builder on the PC is too old to know about game mode. */
  unsupported: boolean;
  busy: boolean;
  error: string | null;
  set: (on: boolean) => Promise<void>;
}

const GameModeContext = createContext<GameModeContextValue>({ status: null, unsupported: false, busy: false, error: null, set: async () => {} });

export const useGameMode = () => useContext(GameModeContext);

export const GameModeProvider = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<GameModeStatus | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!loadConnection()) return;
    try {
      setStatus(await api.gameMode());
      setUnsupported(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) setUnsupported(true);
    }
  }, []);

  // Every 20 s, and every 3 s while a switch is under way on the PC.
  const switching = Boolean(status?.switching);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), switching ? 3_000 : 20_000);
    return () => clearInterval(timer);
  }, [refresh, switching]);

  const set = useCallback(
    async (on: boolean) => {
      setBusy(true);
      setError(null);
      try {
        setStatus(await api.setGameMode(on));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const value = { status, unsupported, busy: busy || switching, error: error ?? status?.error ?? null, set };
  return <GameModeContext.Provider value={value}>{children}</GameModeContext.Provider>;
};

/** One line under every header while game mode is on. */
export const GameModeStrip = () => {
  const { status, busy, set } = useGameMode();
  if (!status?.on) return null;
  return (
    <div className="game-strip" role="status">
      <span aria-hidden="true">🎮</span>
      <span className="game-strip-text">Everything is paused: the PC is yours.</span>
      <button className="btn small primary" disabled={busy} onClick={() => void set(false)}>
        {busy ? "Starting…" : "Back to work"}
      </button>
    </div>
  );
};

const SERVICE_NAMES: Record<string, string> = { jarvis: "Jarvis on the PC", "image-engine": "the image engine", savestate: "SaveState hosting" };

const since = (iso: string | null): string => {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
};

/** The switch, for Home and Control. */
export const GameModeCard = () => {
  const { status, unsupported, busy, error, set } = useGameMode();
  if (unsupported) return null;
  const on = Boolean(status?.on);
  const paused = (status?.pausedBuilds.length ?? 0) + (status?.pausedTopics.length ?? 0);
  const stopped = (status?.stoppedServices ?? []).map((id) => SERVICE_NAMES[id] ?? id);
  const goingTo = status?.switching?.to ?? null;

  return (
    <section className={`card game-card ${on ? "on" : ""}`}>
      <div className="game-card-head">
        <span className="game-icon" aria-hidden="true">
          🎮
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>Pause everything</strong>
          <small>
            {on
              ? `Paused since ${since(status?.since ?? null)}. ${paused ? `${paused} paused (${status?.pausedBuilds.length ?? 0} builds, ${status?.pausedTopics.length ?? 0} research). ` : ""}Model server ${status?.modelServer === "down" ? "off" : "still stopping"}${stopped.length ? `; stopped ${stopped.join(", ")}` : ""}.`
              : "Frees the PC for games: builds, research, continuous improvement and practice pause, and the model server, Jarvis on the PC, the image engine and SaveState hosting stop. Agent Builder stays on quietly so you can resume from here. New orders wait in the queue."}
          </small>
        </div>
      </div>
      <button className={`power ${on ? "all-good" : "game-go"}`} disabled={busy || !status} onClick={() => void set(!on)}>
        {busy
          ? goingTo === "off" || (!goingTo && on)
            ? "Starting everything again…"
            : "Pausing everything… (a minute or two)"
          : on
            ? "Back to work: resume everything"
            : "Pause everything"}
      </button>
      {error ? <p className="card-error">{error}</p> : null}
    </section>
  );
};
