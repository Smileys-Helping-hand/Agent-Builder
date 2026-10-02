"use client";

/**
 * Game mode in the app: one switch that frees the PC's graphics card for
 * games (builds and research pause, the model server shuts down) and gives it
 * back. The state is polled for every screen, a strip under the header says
 * when it is on, and Home has the switch.
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

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 20_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const set = useCallback(
    async (on: boolean) => {
      setBusy(true);
      setError(null);
      try {
        await api.setGameMode(on);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  return <GameModeContext.Provider value={{ status, unsupported, busy, error, set }}>{children}</GameModeContext.Provider>;
};

/** One line under every header while game mode is on. */
export const GameModeStrip = () => {
  const { status, busy, set } = useGameMode();
  if (!status?.on) return null;
  return (
    <div className="game-strip" role="status">
      <span aria-hidden="true">🎮</span>
      <span className="game-strip-text">Game mode: your graphics card is free. Builds and research are paused.</span>
      <button className="btn small primary" disabled={busy} onClick={() => void set(false)}>
        {busy ? "Starting…" : "Back to work"}
      </button>
    </div>
  );
};

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

  return (
    <section className={`card game-card ${on ? "on" : ""}`}>
      <div className="game-card-head">
        <span className="game-icon" aria-hidden="true">
          🎮
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>Game mode</strong>
          <small>
            {on
              ? `On since ${since(status?.since ?? null)}. ${paused ? `${paused} paused (${status?.pausedBuilds.length ?? 0} builds, ${status?.pausedTopics.length ?? 0} research). ` : ""}Model server ${status?.modelServer === "down" ? "off" : "still stopping"}.`
              : "Pause every build and research topic and switch the model server off, so the graphics card is all yours. New orders wait in the queue."}
          </small>
        </div>
      </div>
      <button className={`power ${on ? "all-good" : "game-go"}`} disabled={busy || !status} onClick={() => void set(!on)}>
        {busy ? (on ? "Starting everything again…" : "Pausing and freeing the GPU… (up to a minute)") : on ? "Back to work: resume everything" : "Pause everything for gaming"}
      </button>
      {error ? <p className="card-error">{error}</p> : null}
    </section>
  );
};
