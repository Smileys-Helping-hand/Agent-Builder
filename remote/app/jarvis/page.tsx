"use client";

import { useEffect, useState } from "react";

import { api, type JarvisActivity, type JarvisOverview } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";
import { JarvisAbilities } from "./abilities";

/**
 * Jarvis: whether he is reachable, whether he is actually watching this
 * machine, the keys that connect the two, and a log of both directions.
 *
 * "Connected" and "watching" are different things and shown separately:
 *   Builder → Jarvis  messages reach him (his server answers, deliveries land)
 *   Jarvis → Builder  he is using his key here, within the last few minutes
 */

type Mood = "watching" | "idle" | "offline" | "unset";

const moodOf = (data: JarvisOverview): Mood => {
  const configured = data.config.apiKeySet || data.inbound.hasAccess;
  if (!configured) return "unset";
  const online = data.outbound.reachability?.reachable ?? data.outbound.last?.ok ?? false;
  if (data.inbound.monitoring) return "watching";
  return online ? "idle" : "offline";
};

const MOOD_TEXT: Record<Mood, { title: string; tone: "up" | "warn" | "down" | "busy" }> = {
  watching: { title: "Jarvis is watching", tone: "up" },
  idle: { title: "Connected, not watching", tone: "warn" },
  offline: { title: "Jarvis is offline", tone: "down" },
  unset: { title: "Not set up yet", tone: "warn" }
};

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = () => setReduced(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return reduced;
};

/** The live picture: Builder and Jarvis, with traffic flowing each way when it really is. */
function LinkDiagram({ mood, outboundOk, inboundActive }: { mood: Mood; outboundOk: boolean; inboundActive: boolean }) {
  const reduced = useReducedMotion();
  const colour = mood === "watching" ? "var(--good)" : mood === "idle" ? "var(--warn)" : mood === "offline" ? "var(--bad)" : "var(--faint)";
  const out = "M 96 92 C 170 40, 250 40, 324 92";
  const back = "M 324 108 C 250 160, 170 160, 96 108";

  return (
    <svg viewBox="0 0 420 200" className={`jarvis-link mood-${mood}`} role="img" aria-label={MOOD_TEXT[mood].title}>
      {/* the two wires */}
      <path d={out} className={`wire ${outboundOk ? "wire-live" : ""}`} />
      <path d={back} className={`wire ${inboundActive ? "wire-live" : ""}`} />

      {/* messages from the builder to Jarvis */}
      {outboundOk && !reduced
        ? [0, 1, 2].map((i) => (
            <circle key={`o${i}`} r="4" fill="var(--accent)">
              <animateMotion dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" path={out} />
            </circle>
          ))
        : null}
      {/* Jarvis reaching into the builder */}
      {inboundActive && !reduced
        ? [0, 1, 2].map((i) => (
            <circle key={`i${i}`} r="4" fill="var(--good)">
              <animateMotion dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" path={back} />
            </circle>
          ))
        : null}

      {/* the builder */}
      <g transform="translate(60 100)">
        <circle r="36" className="node" />
        <text y="5" textAnchor="middle" className="node-glyph">AB</text>
        <text y="58" textAnchor="middle" className="node-label">Builder</text>
      </g>

      {/* Jarvis */}
      <g transform="translate(360 100)">
        {mood === "watching" && !reduced ? (
          <>
            <circle r="36" className="pulse-ring" style={{ stroke: colour }} />
            <circle r="36" className="pulse-ring pulse-ring-late" style={{ stroke: colour }} />
          </>
        ) : null}
        <circle r="36" className="node node-jarvis" style={{ stroke: colour, filter: mood === "unset" ? undefined : `drop-shadow(0 0 12px ${colour})` }} />
        <circle r="13" fill={colour} className={mood === "idle" && !reduced ? "core-breathe" : ""} opacity={mood === "offline" ? 0.45 : 1} />
        {/* the scanning eye, circling while he watches */}
        {mood === "watching" && !reduced ? (
          <g className="orbit">
            <circle cx="0" cy="-48" r="4" fill={colour} />
          </g>
        ) : null}
        <text y="58" textAnchor="middle" className="node-label">Jarvis</text>
      </g>
    </svg>
  );
}

const ROW_LABEL = (entry: JarvisActivity): string =>
  entry.direction === "out"
    ? entry.summary ?? `Sent a ${entry.method} message`
    : entry.summary ?? `${entry.method} ${entry.path}`;

export default function JarvisPage() {
  const connected = useConnected();
  const toast = useToast();
  const overview = useRemote(() => api.jarvisOverview(150), 5000);
  const [busy, setBusy] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [newKey, setNewKey] = useState<{ key: string; builderAddress: string | null } | null>(null);
  const [confirm, setConfirm] = useState<"grant" | "revoke" | null>(null);
  const [filter, setFilter] = useState<"all" | "in" | "out">("all");

  if (connected === false) return <NotConnected />;

  const data = overview.data;
  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    try {
      await work();
      await overview.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const save = () =>
    run("save", async () => {
      await api.saveJarvisConfig({ host: host.trim() || undefined, apiKey: apiKey.trim() || undefined, ownerId: ownerId.trim() || undefined });
      setApiKey("");
      toast("Saved on the PC. Used from the next message on.", "ok");
    });

  const test = () =>
    run("test", async () => {
      const result = await api.testJarvis();
      toast(result.ok ? "Jarvis got the test message." : `Not delivered: ${result.detail}`, result.ok ? "ok" : "error");
    });

  const grant = () =>
    run("grant", async () => {
      const result = await api.grantJarvisAccess();
      setNewKey({ key: result.key, builderAddress: result.builderAddress });
      setConfirm(null);
    });

  const revoke = () =>
    run("revoke", async () => {
      await api.revokeJarvisAccess();
      setConfirm(null);
      toast("Jarvis's access is revoked. His key stops working now.", "ok");
    });

  const copy = (text: string) => {
    void navigator.clipboard.writeText(text).then(
      () => toast("Copied.", "ok"),
      () => toast("Could not copy; select it and copy by hand.", "error")
    );
  };

  const mood = data ? moodOf(data) : "unset";
  const outboundOk = Boolean(data && (data.outbound.reachability?.reachable ?? data.outbound.last?.ok));
  const rows = (data?.activity ?? []).filter((entry) => filter === "all" || entry.direction === filter);

  return (
    <>
      <Header title="Jarvis" sub={data ? MOOD_TEXT[mood].title : "Checking…"} state={data ? MOOD_TEXT[mood].tone : "busy"} />
      <div className="wrap">
        {overview.error ? <Banner kind="error">{overview.error}</Banner> : null}
        {!data && overview.loading ? <Skeleton rows={4} /> : null}

        {data ? (
          <>
            <section className="hero jarvis-hero">
              <LinkDiagram mood={mood} outboundOk={outboundOk} inboundActive={data.inbound.monitoring} />
              <h2 className="hero-title" style={{ textAlign: "center" }}>
                {MOOD_TEXT[mood].title}
              </h2>
              <div className="jarvis-lanes">
                <div className="jarvis-lane">
                  <span className={`pill ${outboundOk ? "up" : data.config.apiKeySet ? "down" : ""}`} />
                  <div>
                    <strong>Builder → Jarvis</strong>
                    <small>
                      {!data.config.apiKeySet
                        ? "No Jarvis key saved yet, so nothing can be sent."
                        : data.outbound.reachability
                          ? data.outbound.reachability.detail
                          : data.outbound.last
                            ? `Last message ${ago(data.outbound.last.at)}: ${data.outbound.last.ok ? "delivered" : data.outbound.last.detail}`
                            : "Nothing sent yet."}
                      {data.outbound.queued ? ` · ${data.outbound.queued} waiting to be sent` : ""}
                    </small>
                  </div>
                </div>
                <div className="jarvis-lane">
                  <span className={`pill ${data.inbound.monitoring ? "up" : data.inbound.hasAccess ? "degraded" : ""}`} />
                  <div>
                    <strong>Jarvis → Builder</strong>
                    <small>
                      {!data.inbound.hasAccess
                        ? "Jarvis has no key into the builder, so he cannot look."
                        : data.inbound.monitoring
                          ? `Watching: ${data.inbound.requestsLastWindow} request(s) in the last ${data.inbound.windowMinutes} min.`
                          : data.inbound.lastSeen
                            ? `Not watching. Last looked ${ago(data.inbound.lastSeen)}.`
                            : "Has a key, but has never used it."}
                    </small>
                  </div>
                </div>
              </div>
              <div className="quick" style={{ marginTop: 14 }}>
                <button onClick={test} disabled={busy !== null || !data.config.apiKeySet}>
                  {busy === "test" ? <Busy label="Sending…" /> : <>{Icon.sparkle} Send a test message</>}
                </button>
                <button onClick={() => void overview.refresh()} disabled={busy !== null}>
                  {Icon.refresh} Check again
                </button>
              </div>
            </section>

            {/* ---------- the key the builder uses to reach Jarvis ---------- */}
            <div className="section-title">Jarvis's API key</div>
            <div className="card">
              <p className="hint">
                The key from Jarvis (it starts with <code>jb_live_sk_</code>) lets the builder send him builds, orders, repairs and issues. It is
                saved on the PC and never shown back in full.
              </p>
              <p style={{ fontSize: 13.5, margin: "0 0 10px" }}>
                Now: {data.config.apiKeySet ? <>key {data.config.apiKeyHint} at {data.config.host ?? "no address"}</> : "no key saved"}
              </p>
              <div style={{ display: "grid", gap: 10 }}>
                <label className="field">
                  <span>Jarvis address</span>
                  <input placeholder={data.config.host ?? "https://jarvis.example.com"} value={host} onChange={(event) => setHost(event.target.value)} autoCapitalize="off" />
                </label>
                <label className="field">
                  <span>Jarvis API key</span>
                  <input
                    type="password"
                    placeholder={data.config.apiKeySet ? `Leave empty to keep ${data.config.apiKeyHint}` : "jb_live_sk_…"}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    autoComplete="off"
                    autoCapitalize="off"
                  />
                </label>
                <label className="field">
                  <span>Owner ID (optional)</span>
                  <input placeholder={data.config.ownerId ?? "Your Jarvis user ID"} value={ownerId} onChange={(event) => setOwnerId(event.target.value)} autoCapitalize="off" />
                </label>
                <div className="btn-row">
                  <button className="btn primary" onClick={save} disabled={busy !== null || !(host.trim() || apiKey.trim() || ownerId.trim())}>
                    {busy === "save" ? <Busy label="Saving…" /> : "Save"}
                  </button>
                </div>
              </div>
            </div>

            {/* ---------- the key Jarvis uses to reach the builder ---------- */}
            <div className="section-title">Jarvis's access to this machine</div>
            <div className="card">
              <p className="hint">
                With full access Jarvis can see every project and file, read commits and Claude and Gemini history, report issues, and run builds,
                repairs and the machine&apos;s services. Everything he does shows up in the log below.
              </p>
              <p style={{ fontSize: 13.5, margin: "0 0 10px" }}>
                {data.inbound.hasAccess ? (
                  <>
                    Access: <strong>{data.inbound.scopes.join(", ")}</strong> · key issued {data.inbound.keyCreatedAt ? ago(data.inbound.keyCreatedAt) : "—"}
                  </>
                ) : (
                  "Jarvis has no access."
                )}
              </p>

              {newKey ? (
                <div className="card" style={{ padding: 12, borderColor: "var(--accent)", marginBottom: 10 }}>
                  <strong>Give Jarvis these two things. The key is shown only now.</strong>
                  <p style={{ margin: "8px 0 4px", fontSize: 13 }}>Agent Builder address</p>
                  <code className="secret">{newKey.builderAddress ?? "Set up a public address first (Settings)."}</code>
                  <p style={{ margin: "8px 0 4px", fontSize: 13 }}>Key (sent as the x-agent-key header)</p>
                  <code className="secret">{newKey.key}</code>
                  <div className="btn-row" style={{ marginTop: 10 }}>
                    <button className="btn small primary" onClick={() => copy(newKey.key)}>
                      Copy key
                    </button>
                    <button className="btn small" onClick={() => setNewKey(null)}>
                      I&apos;ve saved it
                    </button>
                  </div>
                </div>
              ) : null}

              {confirm ? (
                <div className="card" style={{ padding: 12, borderColor: "var(--warn)", marginBottom: 10 }}>
                  <p style={{ margin: "0 0 10px", fontSize: 13.5 }}>
                    {confirm === "grant"
                      ? data.inbound.hasAccess
                        ? "This makes a new key and the one Jarvis has now stops working, until you give him the new one."
                        : "This gives Jarvis full access to the builder on this machine."
                      : "Jarvis's key stops working immediately. He will not be able to see or do anything here until you give him a new one."}
                  </p>
                  <div className="btn-row">
                    <button className="btn small primary" onClick={confirm === "grant" ? grant : revoke} disabled={busy !== null}>
                      {busy === confirm ? <Busy label="Working…" /> : confirm === "grant" ? "Yes, make the key" : "Yes, revoke"}
                    </button>
                    <button className="btn small" onClick={() => setConfirm(null)} disabled={busy !== null}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="btn-row">
                  <button className="btn small primary" onClick={() => setConfirm("grant")} disabled={busy !== null}>
                    {Icon.power} {data.inbound.hasAccess ? "Make a new key for Jarvis" : "Give Jarvis access"}
                  </button>
                  {data.inbound.hasAccess ? (
                    <button className="btn small" onClick={() => setConfirm("revoke")} disabled={busy !== null}>
                      Revoke access
                    </button>
                  ) : null}
                </div>
              )}
            </div>

            {/* ---------- everything he can do here ---------- */}
            <JarvisAbilities scopes={data.inbound.scopes} />

            {/* ---------- the log ---------- */}
            <div className="section-title">What Jarvis did, and what he was told</div>
            <div className="card">
              <div className="chips" style={{ marginBottom: 10 }}>
                {(
                  [
                    ["all", "Everything"],
                    ["in", "Jarvis → Builder"],
                    ["out", "Builder → Jarvis"]
                  ] as const
                ).map(([id, label]) => (
                  <button key={id} className={`chip ${filter === id ? "accent" : ""}`} onClick={() => setFilter(id)} style={{ cursor: "pointer", border: 0, font: "inherit" }}>
                    {label}
                  </button>
                ))}
              </div>
              {rows.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
                  {filter === "in"
                    ? "Jarvis has not done anything here since this log started."
                    : filter === "out"
                      ? "Nothing has been sent to Jarvis since this log started."
                      : "Nothing yet. Every request Jarvis makes and every message sent to him will show here."}
                </p>
              ) : (
                <ol className="jarvis-log">
                  {rows.map((entry) => {
                    const ok = entry.direction === "out" ? entry.status === 200 : entry.status < 400;
                    return (
                      <li key={entry.id} className={ok ? "" : "log-bad"}>
                        <span className="log-dir" aria-label={entry.direction === "in" ? "Jarvis to builder" : "Builder to Jarvis"}>
                          {entry.direction === "in" ? "←" : "→"}
                        </span>
                        <span className="log-body">
                          <span className="log-what">{ROW_LABEL(entry)}</span>
                          <small>
                            {ago(entry.at)}
                            {entry.direction === "in" && entry.status ? ` · ${entry.status}` : ""}
                            {entry.ms !== null ? ` · ${entry.ms} ms` : ""}
                          </small>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}
