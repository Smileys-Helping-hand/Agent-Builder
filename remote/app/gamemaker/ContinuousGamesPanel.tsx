"use client";

/**
 * Games that keep being built: a prompt starts a continuous build of an
 * original game (design, core loop, content, art, animation, sound,
 * multiplayer when asked for, polish, then upgrades for as long as it runs),
 * and every finished milestone is released as a version you can play.
 * Follow-up instructions change its direction while it runs.
 */
import { useEffect, useState } from "react";
import Link from "next/link";

import { api, onMachine, type GameRelease, type ImproveSession } from "@/lib/api";
import { Busy, Icon, useToast } from "../ui";

const MULTIPLAYER = /\b(multi-?player|online|co-?op|pvp|versus|lobby|play with friends)\b/i;

const ago = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} days ago`;
};

function GameSession({ session, onChange }: { session: ImproveSession; onChange: () => void }) {
  const toast = useToast();
  const [releases, setReleases] = useState<GameRelease[]>([]);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [playing, setPlaying] = useState<GameRelease | null>(null);

  useEffect(() => {
    api
      .gameReleases(session.id, session.projectName)
      .then((data) => {
        setReleases(data.releases);
        setReleaseError(data.lastError?.error ?? null);
      })
      .catch(() => undefined);
  }, [session.id, session.projectName, session.lastRelease?.version]);

  const act = async (what: string, call: () => Promise<unknown>, done: string) => {
    setBusy(what);
    try {
      await call();
      toast(done, "ok");
      onChange();
    } catch (error: any) {
      toast(error?.message || "That did not work", "error");
    } finally {
      setBusy(null);
    }
  };

  const done = session.plan.filter((m) => m.status === "done").length;
  const current = session.plan.find((m) => m.status === "doing") ?? session.plan.find((m) => m.status === "todo");
  const latest = releases.find((r) => r.url);

  return (
    <div className="game-card">
      <div className="game-header">
        <div className="game-title">
          <span>🎮</span> {session.projectName}
        </div>
        <span className={`tag ${session.state === "stopped" ? "warn" : "ok"}`}>{session.state === "stopped" ? "Stopped" : "Building"}</span>
      </div>
      <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
        {session.phase}
        {current && session.state !== "stopped" ? <> · next: {current.title}</> : null}
      </div>
      <div style={{ fontSize: 12.5, marginTop: 6 }}>
        {done} of {session.plan.length} milestones · {releases.length ? `${releases.length} version${releases.length === 1 ? "" : "s"}` : "no version yet"}
        {session.progress?.recentSuccess != null ? ` · steps succeeding ${Math.round(session.progress.recentSuccess * 100)}%` : ""}
      </div>
      {releaseError && !latest ? <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 4 }}>The last version did not build: {releaseError.slice(0, 200)}</div> : null}

      {latest ? (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
          <button className="btn small primary" onClick={() => setPlaying(latest)}>
            ▶ Play v{latest.version} here
          </button>
          <a className="btn small" href={onMachine(latest.url!)} target="_blank" rel="noreferrer">
            Open in a tab
          </a>
          {latest.download ? (
            <a className="btn small" href={onMachine(latest.download)}>
              Download
            </a>
          ) : null}
          {latest.windowsDownload ? (
            <a className="btn small" href={onMachine(latest.windowsDownload)}>
              Windows app ({latest.windows?.sizeMb} MB)
            </a>
          ) : latest.windows?.state === "building" ? (
            <span style={{ fontSize: 12, color: "var(--muted)" }}>Making the Windows app…</span>
          ) : (
            <button className="btn small" onClick={() => act("windows", () => api.gameWindowsBuild(session.id, latest.version, session.projectName), "Making the Windows app. It takes a few minutes.")}>
              {latest.windows?.state === "failed" ? "Try the Windows app again" : "Make a Windows app"}
            </button>
          )}
          {latest.qa ? <span className={`tag ${latest.qa.passed ? "ok" : "bad"}`} title={latest.qa.errors.join("\n")}>{latest.qa.passed ? "QA passed" : "QA failed"}</span> : null}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>
            {latest.title} · {ago(latest.at)}
            {latest.multiplayer ? " · online multiplayer" : ""}
          </span>
        </div>
      ) : null}

      {latest?.qa?.screenshot && latest.url ? (
        <img alt={`${session.projectName} v${latest.version}`} src={onMachine(`${latest.url}${latest.qa.screenshot}`)} style={{ width: "100%", maxWidth: 420, borderRadius: 8, marginTop: 8, cursor: "pointer" }} onClick={() => setPlaying(latest)} />
      ) : null}
      {latest?.qa && !latest.qa.passed && latest.qa.errors.length ? <div style={{ fontSize: 12, color: "#fbbf24", marginTop: 4 }}>QA: {latest.qa.errors.slice(0, 2).join(" · ").slice(0, 300)}</div> : null}

      {releases.length > 1 ? (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: 12, cursor: "pointer" }}>Every version</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
            {releases.map((release) => (
              <div key={release.version} style={{ fontSize: 12 }}>
                {release.url ? (
                  <a
                    href={onMachine(release.url)}
                    onClick={(e) => {
                      e.preventDefault();
                      setPlaying(release);
                    }}
                  >
                    v{release.version}
                  </a>
                ) : (
                  <span style={{ color: "var(--muted)" }}>v{release.version}</span>
                )}{" "}
                — {release.title} <span style={{ color: "var(--muted)" }}>({ago(release.at)}, {release.sizeKb} KB)</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {playing?.url ? (
        <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 1000, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", color: "#fff", fontSize: 13 }}>
            <strong>{session.projectName}</strong> <span style={{ opacity: 0.7 }}>v{playing.version} · {playing.title}</span>
            <button className="btn small ghost" style={{ marginLeft: "auto" }} onClick={() => setPlaying(null)}>
              Close
            </button>
          </div>
          <iframe title={session.projectName} src={onMachine(playing.url)} allow="autoplay; fullscreen; gamepad; pointer-lock" sandbox="allow-scripts allow-pointer-lock allow-forms" style={{ flex: 1, border: 0, width: "100%" }} />
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="Tell it what to change or add next…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && note.trim() && act("note", () => api.continuousInstruct(session.id, note).then(() => setNote("")), "Noted: the roadmap is being revised.")}
        />
        <button
          className="btn small"
          disabled={!note.trim() || busy === "note"}
          onClick={() => act("note", () => api.continuousInstruct(session.id, note).then(() => setNote("")), "Noted: the roadmap is being revised.")}
        >
          {busy === "note" ? <Busy label="Sending" /> : "Send"}
        </button>
        {session.state === "stopped" ? (
          <button className="btn small" disabled={busy === "restart"} onClick={() => act("restart", () => api.continuousRestart(session.id), "Carrying on from where it got to.")}>
            Carry on
          </button>
        ) : (
          <button className="btn small ghost" disabled={busy === "stop"} onClick={() => act("stop", () => api.continuousStop(session.id), "Stopped.")}>
            Stop
          </button>
        )}
        <Link className="btn small ghost" href="/agent/?tab=continuous">
          Roadmap &amp; approvals
        </Link>
      </div>
    </div>
  );
}

export default function ContinuousGamesPanel() {
  const toast = useToast();
  const [sessions, setSessions] = useState<ImproveSession[]>([]);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [multiplayer, setMultiplayer] = useState<boolean | null>(null);
  const [forever, setForever] = useState(true);
  const [starting, setStarting] = useState(false);

  const load = () =>
    api
      .continuous()
      .then((data) => setSessions(data.sessions.filter((s) => s.kind === "game")))
      .catch(() => undefined);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, []);

  const wantsMultiplayer = multiplayer ?? MULTIPLAYER.test(prompt);

  const start = async () => {
    setStarting(true);
    try {
      await api.continuousStart({ newProject: name.trim(), goal: prompt.trim(), mode: forever ? "forever" : "complete", kind: "game", multiplayer: wantsMultiplayer });
      toast("Your game is under way. A playable version appears here at every milestone.", "ok");
      setName("");
      setPrompt("");
      setMultiplayer(null);
      await load();
    } catch (error: any) {
      toast(`The game did not start: ${error?.message || "the builder did not answer"}`, "error");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>♾️ Keep building a game</div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 12px" }}>
        Describe a game and it keeps building it for hours or days on a real engine (Phaser, or three.js for 3D): an
        original design, then the core loop, content, art drawn on this PC, animation, sound and (when you want it) online
        multiplayer, then upgrades for as long as it runs. Every finished milestone becomes a version you can play here,
        download, or play from SaveState's Mini Games. Send it notes at any time.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <input className="input" placeholder="Name (e.g. Ember Hollow)" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea
          className="input"
          rows={3}
          placeholder="e.g. A co-op dungeon crawler for up to 4 friends online: hand-drawn caves, lanterns that push back the dark, loot that changes how you fight…"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={wantsMultiplayer} onChange={(e) => setMultiplayer(e.target.checked)} /> Online multiplayer
          </label>
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={forever} onChange={(e) => setForever(e.target.checked)} /> Keep upgrading after it is complete
          </label>
          <button className="btn primary" style={{ marginLeft: "auto" }} disabled={starting || name.trim().length < 2 || prompt.trim().length < 10} onClick={start}>
            {starting ? <Busy label="Starting…" /> : <>{Icon.game} Start building</>}
          </button>
        </div>
      </div>

      {sessions.length ? (
        <div className="game-studio-grid" style={{ marginTop: 14 }}>
          {sessions.map((session) => (
            <GameSession key={session.id} session={session} onChange={load} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
