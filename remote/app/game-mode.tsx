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

import { ApiError, api, loadConnection, type ModeState, type WatcherState } from "@/lib/api";

interface GameModeContextValue {
  status: ModeState | null;
  /** Game detection: what is running and its question, if any. */
  watcher: WatcherState | null;
  /** The builder on the PC is too old to know about game mode. */
  unsupported: boolean;
  busy: boolean;
  error: string | null;
  set: (on: boolean) => Promise<void>;
  answer: (yes: boolean) => Promise<void>;
}

const GameModeContext = createContext<GameModeContextValue>({ status: null, watcher: null, unsupported: false, busy: false, error: null, set: async () => {}, answer: async () => {} });

export const useGameMode = () => useContext(GameModeContext);

export const GameModeProvider = ({ children }: { children: React.ReactNode }) => {
  const [status, setStatus] = useState<ModeState | null>(null);
  const [watcher, setWatcher] = useState<WatcherState | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!loadConnection()) return;
    try {
      setStatus((await api.gameMode()) as ModeState);
      setUnsupported(false);
      setWatcher(await api.gamingState().catch(() => null));
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
        setStatus((await api.setGameMode(on)) as ModeState);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const answer = useCallback(
    async (yes: boolean) => {
      setBusy(true);
      try {
        await api.gamingAnswer(yes);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  const value = { status, watcher, unsupported, busy: busy || switching, error: error ?? status?.error ?? null, set, answer };
  return <GameModeContext.Provider value={value}>{children}</GameModeContext.Provider>;
};

/** One line under every header while Gaming Mode is on, or while game detection has a question. */
export const GameModeStrip = () => {
  const { status, watcher, busy, set, answer } = useGameMode();
  const prompt = watcher?.prompt ?? null;
  if (prompt && !(prompt.kind === "activate" && status?.on)) {
    return (
      <div className="game-strip" role="status">
        <span aria-hidden="true">🎮</span>
        <span className="game-strip-text">{prompt.kind === "activate" ? `${prompt.game} is running. Gaming Mode on?` : `${prompt.game} has closed. Resume Agent Builder's work?`}</span>
        <button className="btn small primary" disabled={busy} onClick={() => void answer(true)}>
          {prompt.kind === "activate" ? "Gaming Mode on" : "Resume All"}
        </button>
        <button className="btn small ghost" disabled={busy} onClick={() => void answer(false)}>
          Not now
        </button>
      </div>
    );
  }
  if (!status?.on) return null;
  return (
    <div className="game-strip" role="status">
      <span aria-hidden="true">🎮</span>
      <span className="game-strip-text">Gaming Mode: Agent Builder's work is paused{status.game ? ` for ${status.game.name}` : ""}.</span>
      <button className="btn small primary" disabled={busy} onClick={() => void set(false)}>
        {busy ? "Resuming…" : "Resume All"}
      </button>
    </div>
  );
};

const since = (iso: string | null): string => {
  if (!iso) return "";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} h ${minutes % 60} min ago`;
};

/** The switch, for Home. */
export const GameModeCard = () => {
  const { status, unsupported, busy, error, set } = useGameMode();
  if (unsupported) return null;
  const on = Boolean(status?.on);
  const actions = status?.report?.actions ?? [];
  const paused = actions.filter((a) => ["paused", "stopped", "lowered"].includes(a.outcome)).map((a) => a.label);
  const left = actions.filter((a) => a.outcome === "running" || a.outcome === "failed").map((a) => a.label);
  const goingTo = status?.switching?.to ?? null;

  return (
    <section className={`card game-card ${on ? "on" : ""}`}>
      <div className="game-card-head">
        <span className="game-icon" aria-hidden="true">
          🎮
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>Gaming Mode</strong>
          <small>
            {on
              ? `On since ${since(status?.since ?? null)}${status?.game ? ` for ${status.game.name}` : ""}. ${paused.length ? `Paused or stopped: ${paused.join(", ")}.` : ""}${left.length ? ` Still running: ${left.join(", ")}.` : ""} ${status?.freed ?? ""}`
              : "One tap gives the PC to your game: Agent Builder's builds, research and sessions pause at a safe point, the AI model leaves video memory, and downloads drop in priority. Resume All puts everything back, one by one. Profiles and details are on Control."}
          </small>
        </div>
      </div>
      <button className={`power ${on ? "all-good" : "game-go"}`} disabled={busy || !status} onClick={() => void set(!on)}>
        {busy ? (goingTo === "off" || (!goingTo && on) ? "Resuming, one by one…" : "Switching Gaming Mode on… (a minute)") : on ? "▶ Resume All" : "🎮 Gaming Mode"}
      </button>
      {error ? <p className="card-error">{error}</p> : null}
    </section>
  );
};
