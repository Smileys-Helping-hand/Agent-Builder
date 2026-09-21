"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, loadConnection } from "@/lib/api";

/** "4 min ago" — briefer than a timestamp on a phone screen. */
export const ago = (iso: string): string => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)} h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)} d ago`;
  return new Date(iso).toLocaleDateString();
};

const STATE_LABEL = {
  up: "all good",
  busy: "working",
  warn: "needs attention",
  down: "offline"
} as const;

export const Header = ({ title, sub, state }: { title: string; sub?: string; state?: keyof typeof STATE_LABEL }) => (
  <header className="top">
    <div className="top-inner">
      <div className="mark">A</div>
      <div>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {state ? (
        <div className={`dot ${state === "warn" ? "busy" : state}`}>
          <i />
          {STATE_LABEL[state]}
        </div>
      ) : null}
    </div>
  </header>
);

export const NotConnected = () => (
  <>
    <Header title="Agent Builder" sub="Not connected yet" />
    <div className="wrap">
      <div className="card">
        <h2>Connect to your machine</h2>
        <p className="hint">
          This app talks straight to the Agent Builder running on your PC. Add its address and your key once, and this
          device remembers it.
        </p>
        <Link href="/settings">
          <button className="power">Set up the connection</button>
        </Link>
      </div>
    </div>
  </>
);

/**
 * Load something from the machine, with the states a phone actually needs:
 * loading, an error you can read, and a manual refresh. Polls while the tab is
 * visible so a screen left open stays current without draining the battery.
 */
export function useRemote<T>(loader: () => Promise<T>, pollMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const refresh = useCallback(async () => {
    try {
      const result = await loaderRef.current();
      setData(result);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    if (!pollMs) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  return { data, error, loading, refresh, setData };
}

/** Whether this device has been set up yet (null until we have checked). */
export const useConnected = (): boolean | null => {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => setConnected(Boolean(loadConnection())), []);
  return connected;
};

export const Banner = ({ kind, children }: { kind: "error" | "ok" | "info"; children: React.ReactNode }) => (
  <div className={`banner ${kind}`}>{children}</div>
);

export const Busy = ({ label }: { label: string }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <span className="spin" /> {label}
  </span>
);
