"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { ApiError, loadConnection, saveConnection, signInFromHub } from "@/lib/api";

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
  book: svg(<><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H19v15H5.5A1.5 1.5 0 0 0 4 20.5z" /><path d="M4 17.5h15" /></>)
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

export const Header = ({ title, sub, state }: { title: string; sub?: string; state?: keyof typeof STATE_LABEL }) => (
  <header className="top">
    <div className="top-inner">
      <div className="mark">A</div>
      <div style={{ minWidth: 0 }}>
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

export const NotConnected = () => {
  return (
    <>
      <Header title="Agent Builder" sub="Let's connect to your PC" />
      <div className="wrap">
        <div className="hero">
          <div className="hero-label">Remote Connection</div>
          <div className="hero-title">Connect your machine</div>
          <p className="hero-sub">
            Connect to your PC directly over Cloudflare HTTPS tunnel or local address.
          </p>
          {hubSignInProblem ? (
            <p className="hero-sub" role="alert" style={{ color: "var(--bad)", marginTop: 10 }}>
              Signing in from the site did not work: {hubSignInProblem}
            </p>
          ) : null}
          <div className="quick" style={{ marginTop: 14 }}>
            {/* Signed in to the site's admin already? It opens this app signed in. */}
            <a href="https://arpcloudsolutions.co.za/admin" style={{ textDecoration: "none" }}>
              <button className="primary" style={{ fontWeight: 700 }}>
                {Icon.power} Sign in from the ARP admin
              </button>
            </a>
            {/* The address is public; the key never is. Scan the QR code from
                Start Agent Builder, or paste the key on the next screen. */}
            <Link href={`/settings/?address=${encodeURIComponent("https://agent.savestate.co.za")}`}>
              <button className="primary" style={{ fontWeight: 700, borderColor: "var(--accent)" }}>
                🚀 Connect to agent.savestate.co.za
              </button>
            </Link>
            <Link href="/settings">
              <button className="power">{Icon.scan} Settings &amp; Custom Key</button>
            </Link>
          </div>
        </div>
        <div className="card">
          <h2>Outside Wi-Fi &amp; Mobile Ready</h2>
          <p className="hint" style={{ marginBottom: 0 }}>
            Configured with SSL on <code>https://agent.savestate.co.za</code>. Never gets blocked by Mixed Content or firewall restrictions.
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
 * left open stays fresh without draining the battery.
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

/** Why the last sign-in from the ordering site failed, for the connect screen to explain. */
let hubSignInProblem: string | null = null;

export const useConnected = (): boolean | null => {
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Opened from the site's admin: "#sso=<token>&address=<pc>". The token is
      // in the fragment so it never reaches a server log; clear it straight away.
      const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const sso = fragment.get("sso");
      const ssoAddress = fragment.get("address");
      if (sso && ssoAddress) {
        window.history.replaceState({}, "", window.location.pathname + window.location.search);
        void signInFromHub(ssoAddress, sso).then((result) => {
          if (result.ok) {
            // Every panel on the page asked for its data before the key
            // existed and got "not connected"; start over, connected.
            window.location.replace(window.location.pathname + window.location.search);
            return;
          }
          hubSignInProblem = result.message;
          setConnected(Boolean(loadConnection()));
        });
        return;
      }

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
