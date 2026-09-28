"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { ApiError, loadConnection, saveConnection, servedByBuilder } from "@/lib/api";
import { machineScope, readJson, writeJson } from "@/lib/store";

/* ---------------- time ---------------- */

/** "4 min ago" — shorter than a timestamp, and what you actually want at a glance. */
export const ago = (iso: string): string => {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = seconds / 60;
  if (minutes < 60) return `${Math.round(minutes)} min ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = hours / 24;
  if (days < 30) return `${Math.round(days)}d ago`;
  return new Date(iso).toLocaleDateString();
};

/** "3m 20s", "1h 04m" — how long something took or has been going. */
export const duration = (fromIso: string, toIso?: string | null): string => {
  const ms = Math.max(0, (toIso ? new Date(toIso).getTime() : Date.now()) - new Date(fromIso).getTime());
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

export const dayLabel = (iso: string): string => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (sameDay(date, today)) return "Today";
  if (sameDay(date, yesterday)) return "Yesterday";
  return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
};

/* ---------------- icons ---------------- */

const svg = (path: React.ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

export const Icon = {
  power: svg(<><path d="M12 3v9" /><path d="M6.6 6.6a8 8 0 1 0 10.8 0" /></>),
  pause: svg(<><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></>),
  wrench: svg(<path d="M14.5 6.5a4 4 0 0 0 5 5l-9 9a2.8 2.8 0 0 1-4-4z" />),
  refresh: svg(<><path d="M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2" /><path d="M18 3v4h-4M6 21v-4h4" /></>),
  search: svg(<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.4-3.4" /></>),
  scan: svg(<><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" /><path d="M4 12h16" /></>),
  check: svg(<path d="m5 13 4 4L19 7" />),
  alert: svg(<><path d="M12 8v5" /><circle cx="12" cy="16.5" r="0.6" fill="currentColor" /><path d="M10.3 3.9 2.6 17.4A1.9 1.9 0 0 0 4.3 20h15.4a1.9 1.9 0 0 0 1.7-2.6L13.7 3.9a1.9 1.9 0 0 0-3.4 0z" /></>),
  folder: svg(<path d="M3 7h6l2 2h10v10H3z" />),
  flask: svg(<><path d="M10 3v6.2L4.6 18A2 2 0 0 0 6.3 21h11.4a2 2 0 0 0 1.7-3L14 9.2V3" /><path d="M9 3h6" /></>),
  list: svg(<><path d="M4 6h16M4 12h16M4 18h10" /></>),
  gear: svg(<><circle cx="12" cy="12" r="3.1" /><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.4 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.4-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z" /></>),
  stethoscope: svg(<><path d="M6 3v5a5 5 0 0 0 10 0V3" /><path d="M6 3H4.5M16 3h1.5" /><path d="M11 13v2a5 5 0 0 0 9 1.5" /><circle cx="19" cy="15" r="2" /></>),
  sparkle: svg(<path d="m12 3 2.1 5.4L19.5 10l-5.4 2.1L12 17.5l-2.1-5.4L4.5 10l5.4-1.6z" />),
  book: svg(<><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v15H5.5A1.5 1.5 0 0 0 4 20.5z" /><path d="M4 17.5h15" /></>),
  back: svg(<path d="M15 5l-7 7 7 7" />),
  stop: svg(<rect x="6" y="6" width="12" height="12" rx="2" />),
  play: svg(<path d="M8 5.5v13l10.5-6.5z" />),
  file: svg(<><path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" /><path d="M14 3v5h5" /></>),
  code: svg(<><path d="m8 7-5 5 5 5" /><path d="m16 7 5 5-5 5" /></>),
  copy: svg(<><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" /></>),
  trash: svg(<><path d="M4 7h16" /><path d="M9 7V4.5h6V7" /><path d="M6.5 7l1 13h9l1-13" /></>),
  plug: svg(<><path d="M9 3v5M15 3v5" /><path d="M6 8h12v3a6 6 0 0 1-12 0z" /><path d="M12 17v4" /></>),
  clock: svg(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>)
};

/* ---------------- toasts ---------------- */

type Toast = { id: number; text: string; tone: "ok" | "error" | "info" };
const ToastContext = createContext<(text: string, tone?: Toast["tone"]) => void>(() => {});

export const useToast = () => useContext(ToastContext);

export const ToastHost = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, text, tone }]);
    // Long enough to read a sentence, short enough not to linger.
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4600);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.tone}`}>
            <span style={{ color: toast.tone === "error" ? "var(--bad)" : toast.tone === "ok" ? "var(--good)" : "var(--accent)" }}>
              {toast.tone === "error" ? Icon.alert : toast.tone === "ok" ? Icon.check : Icon.sparkle}
            </span>
            {toast.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

/* ---------------- header ---------------- */

const STATE_LABEL = { up: "all good", busy: "working", warn: "needs a look", down: "offline" } as const;

export const Header = ({
  title,
  sub,
  state,
  back
}: {
  title: string;
  sub?: string;
  state?: keyof typeof STATE_LABEL;
  /** Show a back arrow that runs this instead of the logo. */
  back?: () => void;
}) => (
  <header className="top">
    <div className="top-inner">
      {back ? (
        <button className="mark back" onClick={back} aria-label="Back">
          {Icon.back}
        </button>
      ) : (
        <div className="mark">A</div>
      )}
      <div style={{ minWidth: 0 }}>
        <h1>{title}</h1>
        {sub ? <p className="sub">{sub}</p> : null}
      </div>
      {state ? (
        <Link href="/settings" className={`dot ${state === "warn" ? "busy" : state}`} title="Connection and settings">
          <i />
          {STATE_LABEL[state]}
        </Link>
      ) : null}
    </div>
  </header>
);

export const NotConnected = () => {
  // When a builder is serving this page (opened at http://127.0.0.1:4000, the
  // tunnel or the tailnet address), that builder is the machine to connect to.
  const [here, setHere] = useState<string | null>(null);
  useEffect(() => {
    void servedByBuilder().then(setHere);
  }, []);

  return (
    <>
      <Header title="Agent Builder" sub="Let's connect to your PC" />
      <div className="wrap">
        <div className="hero">
          <div className="hero-label">Connect</div>
          <div className="hero-title">Connect your machine</div>
          <p className="hero-sub">
            On the PC, double-click <strong>Start Agent Builder</strong> and scan its QR code — that connects this
            device in one step. On the PC itself, <strong>Open Agent Builder</strong> connects without anything to type.
          </p>
          <div className="quick" style={{ marginTop: 14 }}>
            {here ? (
              <Link href={`/settings/?address=${encodeURIComponent(here)}`}>
                <button className="primary" style={{ fontWeight: 700, borderColor: "var(--accent)", width: "100%" }}>
                  {Icon.plug} Connect to this builder
                </button>
              </Link>
            ) : (
              <Link href={`/settings/?address=${encodeURIComponent("https://agent.savestate.co.za")}`}>
                <button className="primary" style={{ fontWeight: 700, borderColor: "var(--accent)", width: "100%" }}>
                  {Icon.plug} agent.savestate.co.za
                </button>
              </Link>
            )}
            <Link href="/settings">
              <button style={{ width: "100%" }}>{Icon.gear} Paste a link or key</button>
            </Link>
          </div>
        </div>
        <div className="card">
          <h2>{here ? `This page is served by your builder` : "Where to connect"}</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            {here ? (
              <>
                It answers at <code>{here}</code>. You still need its key once — scan the QR code, or paste the key from{" "}
                <code>data\phone-key.txt</code> on the PC.
              </>
            ) : (
              <>
                From anywhere: <code>https://agent.savestate.co.za</code> (when the named tunnel runs), or the Tailscale
                address <code>http://100.x.y.z:4000</code> in the installed app. On the PC: <code>http://127.0.0.1:4000</code>.
              </>
            )}
          </p>
        </div>
      </div>
    </>
  );
};

/* ---------------- data loading ---------------- */

/**
 * Load from the machine with the states a phone needs: loading, a readable
 * error, and manual refresh. Polls only while the tab is visible, so a screen
 * left open stays fresh without draining the battery, and refreshes the moment
 * you come back to it.
 *
 * With a cacheKey the last answer is kept on this device, so a refresh (or
 * opening the app with no signal) shows what was there immediately instead of
 * an empty screen, marked as not yet refreshed until the machine answers.
 */
export function useRemote<T>(loader: () => Promise<T>, pollMs = 0, cacheKey?: string) {
  const storageKey = cacheKey ? `cache.${cacheKey}` : null;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [fresh, setFresh] = useState(false);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await loaderRef.current();
      setData(result);
      setError(null);
      setFresh(true);
      const at = Date.now();
      setUpdatedAt(at);
      if (storageKey) writeJson(`${storageKey}.${machineScope()}`, { at, data: result });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : String(caught));
      setFresh(false);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [storageKey]);

  useEffect(() => {
    if (storageKey) {
      const cached = readJson<{ at: number; data: T }>(`${storageKey}.${machineScope()}`);
      if (cached?.data) {
        setData(cached.data);
        setUpdatedAt(cached.at);
        setLoading(false);
      }
    }
    void refresh();

    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    const timer = pollMs
      ? setInterval(() => {
          if (document.visibilityState === "visible") void refresh();
        }, pollMs)
      : null;
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      if (timer) clearInterval(timer);
    };
  }, [refresh, pollMs, storageKey]);

  const update = useCallback(
    (next: T | null) => {
      setData(next);
      if (storageKey && next) writeJson(`${storageKey}.${machineScope()}`, { at: Date.now(), data: next });
    },
    [storageKey]
  );

  return { data, error, loading, refresh, setData: update, updatedAt, fresh };
}

/** Keep a value in this device's storage, so a draft or a choice survives a refresh. */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T | ((current: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    const saved = readJson<T>(`ui.${key}`);
    if (saved !== null) setValue(saved);
    loaded.current = true;
  }, [key]);
  const set = useCallback(
    (next: T | ((current: T) => T)) => {
      setValue((current) => {
        const resolved = typeof next === "function" ? (next as (current: T) => T)(current) : next;
        if (loaded.current) writeJson(`ui.${key}`, resolved);
        return resolved;
      });
    },
    [key]
  );
  return [value, set];
}

export const useConnected = (): boolean | null => {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const address = params.get("address");
      const key = params.get("key");
      if (address && key) {
        saveConnection({ address, key });
        window.history.replaceState({}, "", window.location.pathname);
        setConnected(true);
        return;
      }
    }
    setConnected(Boolean(loadConnection()));
  }, []);
  return connected;
};

/* ---------------- small pieces ---------------- */

export const Banner = ({ kind, children }: { kind: "error" | "ok" | "info"; children: React.ReactNode }) => (
  <div className={`banner ${kind}`}>
    <span style={{ width: 17, height: 17, flex: "none", color: kind === "error" ? "var(--bad)" : kind === "ok" ? "var(--good)" : "var(--accent)" }}>
      {kind === "error" ? Icon.alert : kind === "ok" ? Icon.check : Icon.sparkle}
    </span>
    <span>{children}</span>
  </div>
);

export const Busy = ({ label }: { label: string }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
    <span className="spin" /> {label}
  </span>
);

/** Shows the shape of what is coming, which reads better than a spinner. */
export const Skeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="card">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} style={{ display: "flex", gap: 12, alignItems: "center", padding: "11px 0" }}>
        <div className="skeleton" style={{ width: 34, height: 34, borderRadius: 11, flex: "none" }} />
        <div style={{ flex: 1 }}>
          <div className="skeleton" style={{ height: 11, width: `${45 + index * 12}%`, marginBottom: 7 }} />
          <div className="skeleton" style={{ height: 9, width: `${70 - index * 8}%` }} />
        </div>
      </div>
    ))}
  </div>
);

/** A score bar: red below 50, amber below 80, green from there. */
export const Meter = ({ value, target }: { value: number; target?: number }) => (
  <div className="meter" role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <div
      className="meter-fill"
      style={{
        width: `${Math.max(2, Math.min(100, value))}%`,
        background: value >= 80 ? "var(--good)" : value >= 50 ? "var(--warn)" : "var(--bad)"
      }}
    />
    {target ? <div className="meter-target" style={{ left: `${Math.min(100, target)}%` }} title={`Target ${target}`} /> : null}
  </div>
);

export const CopyButton = ({ text, label = "Copy" }: { text: string; label?: string }) => {
  const toast = useToast();
  return (
    <button
      className="btn small ghost"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast("Copied", "ok");
        } catch {
          toast("Could not copy on this device", "error");
        }
      }}
    >
      {Icon.copy} {label}
    </button>
  );
};

/** "Updated 12s ago" — or, when the machine has not answered yet, that this is the saved copy. */
export const Freshness = ({ updatedAt, fresh, error }: { updatedAt: number | null; fresh: boolean; error?: string | null }) => {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((value) => value + 1), 5000);
    return () => clearInterval(timer);
  }, []);
  if (!updatedAt) return null;
  const when = ago(new Date(updatedAt).toISOString());
  return (
    <span className={`freshness ${fresh ? "" : "stale"}`}>
      {Icon.clock} {fresh ? `Updated ${when}` : error ? `Offline — showing what was there ${when}` : `Saved copy from ${when}`}
    </span>
  );
};

