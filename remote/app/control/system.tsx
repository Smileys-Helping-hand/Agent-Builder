"use client";

/**
 * The PC as one system: Gaming Mode and Resume All up front, then what the PC
 * is doing (measured), why it is slow, what Agent Builder runs, every drive
 * and what belongs where, game detection, and who switched what.
 *
 * Everything here reads /api/system/* and acts only through its named
 * operations; moving data is only ever recommended, never done from here.
 */
import { useCallback, useEffect, useState } from "react";

import { api, type StorageReport, type SystemStatus, type WorkloadAction } from "@/lib/api";
import { Banner, Busy, useToast } from "../ui";

const OUTCOME: Record<WorkloadAction["outcome"], { label: string; tone: string }> = {
  paused: { label: "paused", tone: "ok" },
  stopped: { label: "stopped", tone: "ok" },
  lowered: { label: "lowered", tone: "ok" },
  running: { label: "left running", tone: "warn" },
  failed: { label: "could not", tone: "bad" },
  "not-running": { label: "was idle", tone: "muted" }
};

/** A load bar: green when there is room, red when there is none. */
const Load = ({ label, value, detail }: { label: string; value: number | null; detail: string }) => {
  const v = value ?? 0;
  const tone = value === null ? "muted" : v >= 90 ? "bad" : v >= 70 ? "warn" : "ok";
  return (
    <div className="sys-load">
      <div className="sys-load-head">
        <span>{label}</span>
        <strong>{value === null ? "—" : `${Math.round(v)}%`}</strong>
      </div>
      <div className="sys-bar">
        <div className={`sys-bar-fill ${tone}`} style={{ width: `${Math.max(2, Math.min(100, v))}%` }} />
      </div>
      <small className="muted">{detail}</small>
    </div>
  );
};

const minutesAgo = (iso: string | null | undefined) => {
  if (!iso) return "";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ${m % 60} min ago`;
};

export const SystemPanel = () => {
  const toast = useToast();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [storage, setStorage] = useState<StorageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [profile, setProfile] = useState("gaming-balanced");
  const [audit, setAudit] = useState<Array<{ at: string; actor: string; action: string; detail: string; ok: boolean }>>([]);
  const [showStorage, setShowStorage] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await api.systemStatus();
      setStatus(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  const switching = Boolean(status?.switching) || status?.mode.profile === "resuming";
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), switching ? 3000 : 20000);
    return () => clearInterval(timer);
  }, [refresh, switching]);

  useEffect(() => {
    if (status?.watcher.settings.profile) setProfile((p) => (p === "gaming-balanced" ? status.watcher.settings.profile : p));
  }, [status?.watcher.settings.profile]);

  const loadStorage = useCallback(async () => {
    try {
      setStorage(await api.systemStorage());
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [toast]);

  useEffect(() => {
    if (showStorage && !storage) void loadStorage();
  }, [showStorage, storage, loadStorage]);

  useEffect(() => {
    if (!storage?.job) return;
    const timer = setInterval(() => void loadStorage(), 5000);
    return () => clearInterval(timer);
  }, [storage?.job, loadStorage]);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    try {
      await fn();
      if (done) toast(done, "ok");
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(null);
    }
  };

  if (!status) return <div className="card">{error ? <Banner kind="error">{error}</Banner> : <Busy label="Reading the PC…" />}</div>;

  const mode = status.mode;
  const inForce = mode.profile && mode.profile !== "normal" && mode.profile !== "resuming";
  const label = status.profiles.find((p) => p.id === mode.profile)?.label ?? mode.profile;
  const gaming = status.profiles.filter((p) => p.id.startsWith("gaming"));
  const others = status.profiles.filter((p) => !p.id.startsWith("gaming") && p.id !== "normal");
  const t = status.telemetry;
  const prompt = status.watcher.prompt;
  const failedSteps = mode.resume?.steps.filter((s) => s.state === "failed") ?? [];

  return (
    <>
      {prompt ? (
        <div className="card sys-prompt">
          <strong>{prompt.kind === "activate" ? `🎮 ${prompt.game} is running` : `${prompt.game} has closed`}</strong>
          <span className="muted">{prompt.kind === "activate" ? "Switch Gaming Mode on to give it the PC?" : "Put Agent Builder's work back?"}</span>
          <div className="btn-row">
            <button className="btn primary" disabled={busy !== null} onClick={() => void act("answer", () => api.gamingAnswer(true))}>
              {prompt.kind === "activate" ? "Gaming Mode on" : "Resume All"}
            </button>
            <button className="btn ghost" disabled={busy !== null} onClick={() => void act("answer", () => api.gamingAnswer(false))}>
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {/* ---------- the two big controls ---------- */}
      <section className={`card sys-hero ${mode.on ? "on" : ""}`}>
        <div className="sys-hero-state">
          <span className={`sys-dot ${mode.on ? "game" : inForce ? "warn" : switching ? "warn" : "ok"}`} />
          <div>
            <strong>{switching ? (status.switching?.to === "normal" || mode.profile === "resuming" ? "Resuming…" : "Switching…") : mode.on ? `${label} is on` : inForce ? `${label} is on` : mode.hold ? "New background work is on hold" : "Normal operation"}</strong>
            <small className="muted">
              {mode.on || inForce
                ? `Since ${minutesAgo(mode.since)}${mode.activatedBy ? ` · by ${mode.activatedBy}` : ""}${mode.game ? ` · ${mode.game.name}` : ""}`
                : status.watcher.running.length
                  ? `Playing ${status.watcher.running.map((g) => g.name).join(", ")}`
                  : `Model server ${status.modelServer} · game detection ${status.watcher.settings.detect === "off" ? "off" : status.watcher.watching ? `on (${status.watcher.settings.detect})` : status.watcher.detail}`}
            </small>
          </div>
        </div>
        <div className="sys-hero-buttons">
          <div className="sys-big-group">
            <button className="sys-big game" disabled={busy !== null || switching || Boolean(mode.on)} onClick={() => void act("mode", () => api.systemMode(profile), "Gaming Mode is switching on: this takes a minute.")}>
              🎮 Gaming Mode
            </button>
            <select value={profile} onChange={(e) => setProfile(e.target.value)} disabled={busy !== null || switching} aria-label="Gaming profile">
              {gaming.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <button className="sys-big resume" disabled={busy !== null || switching || (!mode.on && !inForce && !mode.hold)} onClick={() => void act("resume", () => api.systemResume(), "Resuming, one workload at a time.")}>
            ▶ Resume All
          </button>
        </div>
        <p className="hint">{status.profiles.find((p) => p.id === profile)?.about}</p>
        {status.error ? <Banner kind="error">{status.error}</Banner> : null}

        {mode.report && (mode.on || inForce || switching) ? (
          <div className="sys-report">
            {mode.report.actions.map((a) => (
              <div key={a.id} className="sys-row">
                <span className={`tag ${OUTCOME[a.outcome].tone}`}>{OUTCOME[a.outcome].label}</span>
                <span>
                  <strong>{a.label}</strong> <span className="muted">{a.detail}</span>
                </span>
              </div>
            ))}
            {mode.freed ? <p className="sys-freed">{mode.freed}</p> : null}
          </div>
        ) : null}

        {mode.resume && (switching || failedSteps.length) ? (
          <div className="sys-report">
            {mode.resume.steps.map((s) => (
              <div key={s.id} className="sys-row">
                <span className={`tag ${s.state === "done" ? "ok" : s.state === "failed" ? "bad" : "muted"}`}>{s.state === "waiting" ? "next" : s.state}</span>
                <span>
                  <strong>{s.label}</strong> <span className="muted">{s.detail}</span>
                </span>
                {s.state === "failed" ? (
                  <button className="btn small" disabled={busy !== null} onClick={() => void act(`retry-${s.id}`, () => api.systemRetry(s.id), `${s.label}: tried again.`)}>
                    Retry
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div className="chips sys-chips">
          {others.map((p) => (
            <button key={p.id} className={`chip ${mode.profile === p.id ? "active" : ""}`} title={p.about} disabled={busy !== null || switching} onClick={() => void act("mode", () => api.systemMode(p.id), `${p.label} is switching on.`)}>
              {p.label}
            </button>
          ))}
          <button className={`chip ${mode.hold && !inForce ? "active" : ""}`} disabled={busy !== null || switching} onClick={() => void act("hold", () => api.systemHold(!mode.hold), mode.hold ? "Background work may start again." : "No new background work until you release the hold.")}>
            {mode.hold && !inForce ? "Release the hold" : "Hold new background work"}
          </button>
          <button className="chip" disabled={busy !== null} onClick={() => void act("unload", () => api.modelUnload(), "The model is out of video memory.")}>
            Unload the AI model
          </button>
        </div>
      </section>

      {/* ---------- what the PC is doing ---------- */}
      <section className="card">
        <div className="sys-section-head">
          <strong>Right now</strong>
          <small className="muted">{t ? `measured ${minutesAgo(t.at)}` : "no measurement yet"}</small>
          <button className="btn small ghost" disabled={busy !== null} onClick={() => void act("measure", () => api.systemTelemetry(true))}>
            {busy === "measure" ? <Busy label="Measuring…" /> : "Measure now"}
          </button>
        </div>
        {t ? (
          <>
            <div className="sys-loads">
              <Load label="CPU" value={t.cpuPercent} detail={t.topCpu.slice(0, 2).map((p) => `${p.name} ${p.cpuPercent}%`).join(", ")} />
              <Load label="Memory" value={t.ram.availableMB === null ? null : 100 - (t.ram.availableMB / t.ram.totalMB) * 100} detail={t.ram.availableMB === null ? "" : `${(t.ram.availableMB / 1024).toFixed(1)} GB free of ${(t.ram.totalMB / 1024).toFixed(0)} GB`} />
              <Load label="GPU" value={t.gpu?.utilPercent ?? null} detail={t.gpu ? `${t.gpu.name.replace("NVIDIA GeForce ", "")}${t.gpu.tempC ? ` · ${Math.round(t.gpu.tempC)}°C` : ""}` : "no NVIDIA GPU found"} />
              <Load label="Video memory" value={t.gpu ? (t.gpu.vramUsedMB / t.gpu.vramTotalMB) * 100 : null} detail={t.gpu ? `${(t.gpu.vramUsedMB / 1024).toFixed(1)} of ${(t.gpu.vramTotalMB / 1024).toFixed(0)} GB` : ""} />
            </div>
            <div className="sys-drives">
              {t.disks.map((d) => (
                <div key={d.disk} className="sys-drive" title={`${d.queue} waiting · ${d.mbPerSec} MB/s · ${d.latencyMs} ms a request`}>
                  <span>{d.letters.map((l) => `${l}:`).join(" ") || `#${d.disk}`}</span>
                  <div className="sys-bar small">
                    <div className={`sys-bar-fill ${100 - d.idlePercent >= 90 ? "bad" : 100 - d.idlePercent >= 60 ? "warn" : "ok"}`} style={{ width: `${Math.max(2, 100 - d.idlePercent)}%` }} />
                  </div>
                  <small className="muted">{Math.round(100 - d.idlePercent)}% busy</small>
                </div>
              ))}
            </div>
          </>
        ) : null}
        <div className="sys-findings">
          {status.findings.map((f, i) => (
            <div key={i} className={`sys-finding ${f.severity}`}>
              <span>{f.text}</span>
              {f.culprits.length ? <small className="muted">Most of it: {f.culprits.join(", ")}</small> : null}
            </div>
          ))}
        </div>
      </section>

      {/* ---------- what Agent Builder runs ---------- */}
      <section className="card">
        <div className="sys-section-head">
          <strong>What Gaming Mode manages</strong>
        </div>
        {(status.workloads ?? []).map((w) => (
          <div key={w.id} className="sys-row">
            <span className={`sys-dot ${w.running ? "ok" : "idle"}`} />
            <span>
              <strong>{w.label}</strong> <span className="muted">{w.detail}</span>
            </span>
          </div>
        ))}
        <p className="hint">Never touched: {status.protected.join("; ")}.</p>
        <p className="hint">
          AI: {status.ai.localOnly ? "local only" : "cloud allowed"} · research {status.ai.researchOffline ? "offline" : "online (processed by the local model)"}.
          {status.ai.cloudKeysPresent.length && status.ai.localOnly ? ` Cloud keys in .env (${status.ai.cloudKeysPresent.join(", ")}) are ignored.` : ""}
        </p>
      </section>

      {/* ---------- game detection ---------- */}
      <section className="card">
        <div className="sys-section-head">
          <strong>Game detection</strong>
          <small className="muted">{status.watcher.detail}</small>
        </div>
        <div className="sys-settings">
          <label>
            When a game starts
            <select value={status.watcher.settings.detect} disabled={busy !== null} onChange={(e) => void act("gaming", () => api.gamingSettings({ detect: e.target.value as "ask" | "auto" | "off" }))}>
              <option value="ask">Ask me</option>
              <option value="auto">Switch Gaming Mode on</option>
              <option value="off">Do nothing</option>
            </select>
          </label>
          <label>
            Profile
            <select value={status.watcher.settings.profile} disabled={busy !== null} onChange={(e) => void act("gaming", () => api.gamingSettings({ profile: e.target.value }))}>
              {gaming.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            When it closes
            <select value={status.watcher.settings.autoResume ? "auto" : "ask"} disabled={busy !== null} onChange={(e) => void act("gaming", () => api.gamingSettings({ autoResume: e.target.value === "auto" }))}>
              <option value="ask">Ask me</option>
              <option value="auto">Resume by itself</option>
            </select>
          </label>
          <label>
            After (minutes)
            <input type="number" min={1} max={60} defaultValue={status.watcher.settings.graceMinutes} onBlur={(e) => void act("gaming", () => api.gamingSettings({ graceMinutes: Number(e.target.value) }))} />
          </label>
        </div>
      </section>

      {/* ---------- storage ---------- */}
      <section className="card">
        <div className="sys-section-head">
          <strong>Storage</strong>
          <small className="muted">{storage?.inventory ? `taken ${minutesAgo(storage.inventory.at)}` : "SSDs kept for games; Agent Builder's bulk on the hard drives"}</small>
          <button className="btn small ghost" onClick={() => setShowStorage((v) => !v)}>
            {showStorage ? "Hide" : "Show drives"}
          </button>
        </div>
        {showStorage ? (
          storage?.inventory ? (
            <>
              <div className="sys-volumes">
                {storage.inventory.volumes.map((v) => {
                  const games = storage.inventory!.games.filter((g) => g.letter === v.letter);
                  const gameGB = games.reduce((sum, g) => sum + (g.sizeGB ?? 0), 0);
                  const pieces = storage.inventory!.locations.filter((l) => l.letter === v.letter);
                  const used = ((v.sizeGB - v.freeGB) / v.sizeGB) * 100;
                  return (
                    <div key={v.letter} className="sys-volume">
                      <div className="sys-load-head">
                        <strong>
                          {v.letter}: <span className="muted">{v.label}</span>
                        </strong>
                        <span className={`tag ${v.tier.includes("ssd") ? "ok" : v.tier === "hdd-5400" ? "warn" : "muted"}`}>{storage.tiers[v.letter]}</span>
                      </div>
                      <div className="sys-bar">
                        <div className={`sys-bar-fill ${used >= 95 ? "bad" : used >= 85 ? "warn" : "ok"}`} style={{ width: `${used}%` }} />
                      </div>
                      <small className="muted">
                        {v.freeGB} GB free of {v.sizeGB} GB{gameGB ? ` · games ${Math.round(gameGB)} GB` : ""}
                        {pieces.length ? ` · ${pieces.map((p) => `${p.label}${p.sizeGB !== null ? ` ${p.sizeGB} GB` : ""}`).join(", ")}` : ""}
                        {storage.inventory!.benchmarks[v.letter] ? ` · writes ${storage.inventory!.benchmarks[v.letter].writeMBps} MB/s` : ""}
                      </small>
                    </div>
                  );
                })}
              </div>
              {storage.inventory.network.map((n) => (
                <div key={n.path} className="sys-row">
                  <span className={`sys-dot ${n.reachable ? "ok" : "bad"}`} />
                  <span>
                    <strong>NAS {n.letter ? `${n.letter}: ` : ""}</strong>
                    <span className="muted">
                      {n.path} — {n.detail}
                    </span>
                  </span>
                </div>
              ))}
              <div className="sys-findings">
                {storage.recommendations.map((r) => (
                  <div key={r.id} className={`sys-finding ${r.severity}`}>
                    <span>
                      {r.title} {r.needsApproval ? <span className="tag warn">needs your approval</span> : null}
                    </span>
                    <small className="muted">{r.detail}</small>
                  </div>
                ))}
              </div>
              <div className="btn-row">
                <button className="btn small" disabled={Boolean(storage.job)} onClick={() => void act("storage", async () => { await api.storageRefresh(); await loadStorage(); }, "Taking the inventory again.")}>
                  {storage.job ? <Busy label={storage.job.what} /> : "Take it again"}
                </button>
                {storage.inventory.locations
                  .filter((l) => l.sizeGB === null)
                  .slice(0, 4)
                  .map((l) => (
                    <button key={l.id} className="btn small ghost" disabled={Boolean(storage.job)} onClick={() => void act("storage", async () => { await api.storageMeasure(l.id); await loadStorage(); }, `Measuring ${l.label}; slow on a hard drive.`)}>
                      Measure {l.label}
                    </button>
                  ))}
              </div>
              <p className="hint">Nothing here moves or deletes anything: moves are recommendations, and the ones that touch data wait for you.</p>
            </>
          ) : (
            <Busy label={storage?.job ? storage.job.what : "Reading the drives…"} />
          )
        ) : null}
      </section>

      <section className="card">
        <div className="sys-section-head">
          <strong>Who switched what</strong>
          <button className="btn small ghost" onClick={() => void api.systemAudit().then((r) => setAudit(r.entries)).catch(() => undefined)}>
            Show
          </button>
        </div>
        {audit.map((entry, i) => (
          <div key={i} className="sys-row">
            <span className={`tag ${entry.ok ? "ok" : "bad"}`}>{entry.ok ? "ok" : "problem"}</span>
            <span>
              <strong>{entry.action}</strong> <span className="muted">{minutesAgo(entry.at)} · {entry.actor} · {entry.detail}</span>
            </span>
          </div>
        ))}
      </section>
    </>
  );
};
