"use client";

/**
 * This PC: what is running on it, with start, stop and restart, and the
 * switch for SaveState hosting (savestate.co.za) to give the PC its resources
 * back. From the Host Manager (scripts/host-manager), which keeps answering
 * while the builder is down: its own dashboard is on the PC at :4100.
 */
import { useCallback, useEffect, useState } from "react";

import { api, type HostService, type HostStatus } from "@/lib/api";
import { Busy, Icon, Skeleton, ago, useToast } from "../ui";

const PILL: Record<string, string> = { up: "up", starting: "degraded", stopping: "degraded", down: "down" };

export function ThisPcCard() {
  const toast = useToast();
  const [status, setStatus] = useState<HostStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: "stop" | "restart"; name: string } | null>(null);

  const load = useCallback(async (fresh = false) => {
    try {
      setStatus(await api.hostStatus(fresh));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load(true);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 10000);
    return () => clearInterval(timer);
  }, [load]);

  const act = async (service: HostService, action: "start" | "stop" | "restart") => {
    setConfirm(null);
    setBusy(service.id);
    try {
      const res = await api.hostAction(service.id, action);
      if (res.status) setStatus((now) => (now ? { ...now, ...res.status } : now));
      toast(`${service.name}: ${action === "stop" ? (service.id === "savestate" ? "switched off" : "stopped") : action === "start" ? (service.id === "savestate" ? "switching on" : "starting") : "restarting"}`, "ok");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
      void load(true);
    }
  };

  const sys = status?.system;
  return (
    <div className="card">
      <h2>This PC</h2>
      <p className="hint">What is running here, and the switches for it. Stopped things stay stopped until you start them.</p>
      {error ? <p className="hint" style={{ color: "var(--bad)" }}>{error}</p> : null}
      {!status && !error ? <Skeleton rows={4} /> : null}
      {sys ? (
        <div className="chips" style={{ marginBottom: 6 }}>
          <span className="chip">CPU {sys.cpuPct}%</span>
          <span className="chip">RAM {sys.memory.usedGb}/{sys.memory.totalGb} GB</span>
          {sys.gpu ? <span className="chip">GPU {sys.gpu.util}% · {Math.round((sys.gpu.memUsedMb / 1024) * 10) / 10}/{Math.round(sys.gpu.memTotalMb / 1024)} GB · {sys.gpu.tempC}°C</span> : null}
          {(sys.disks ?? []).filter((d) => d.freeGb < 60).map((d) => (
            <span key={d.drive} className="chip warn">{d.drive} {d.freeGb} GB free</span>
          ))}
        </div>
      ) : null}
      {status?.services.map((service) => {
        const working = busy === service.id || Boolean(service.busy);
        if (service.id === "savestate") {
          const on = !(service.state === "stopped" || service.state === "stopping" || service.held);
          return (
            <div key={service.id} className="row" style={{ alignItems: "flex-start" }}>
              <span className={`pill ${PILL[service.state] ?? ""}`} style={{ marginTop: 6 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: "block" }}>{service.name}</strong>
                <small style={{ color: "var(--muted)" }}>{working ? <Busy label={on ? "Switching off" : "Switching on"} /> : service.detail}</small>
              </div>
              <button
                className={`switch${on ? " on" : ""}`}
                aria-label={on ? "Switch SaveState hosting off" : "Switch SaveState hosting on"}
                aria-pressed={on}
                disabled={working || service.state === "absent"}
                onClick={() => (on ? setConfirm({ id: service.id, action: "stop", name: service.name }) : void act(service, "start"))}
              >
                <span />
              </button>
            </div>
          );
        }
        const running = service.state === "up" || service.state === "starting";
        return (
          <div key={service.id} className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
            <span className={`pill ${PILL[service.state] ?? ""}`} style={{ marginTop: 6 }} />
            <div style={{ flex: "1 1 180px", minWidth: 0 }}>
              <strong style={{ display: "block" }}>{service.name}</strong>
              <small style={{ color: "var(--muted)", overflowWrap: "anywhere" }}>
                {working ? <Busy label="Working" /> : service.detail}
                {service.state !== "up" && !working ? ` · ${ago(new Date(service.since).toISOString())}` : null}
              </small>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {!running ? (
                <button className="btn small" disabled={working} onClick={() => void act(service, "start")}>
                  {Icon.play} Start
                </button>
              ) : (
                <>
                  <button className="btn small" disabled={working} onClick={() => setConfirm({ id: service.id, action: "restart", name: service.name })}>
                    {Icon.refresh} Restart
                  </button>
                  <button className="btn small" disabled={working} onClick={() => setConfirm({ id: service.id, action: "stop", name: service.name })}>
                    {Icon.stop} Stop
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {confirm ? (
        <div className="row" style={{ background: "rgba(255,194,71,0.08)", borderRadius: 12, padding: 12, marginTop: 8, flexWrap: "wrap" }}>
          <span style={{ flex: "1 1 200px" }}>
            {confirm.id === "savestate"
              ? "Switch SaveState hosting off? savestate.co.za goes offline until you switch it on (Agent Builder and Jarvis stay reachable)."
              : confirm.id === "agent-builder" && confirm.action === "stop"
                ? "Stop Agent Builder? This app loses its connection until it is started again from the PC or the Host Manager."
                : `${confirm.action === "stop" ? "Stop" : "Restart"} ${confirm.name}?`}
          </span>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn small" onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className="btn small primary"
              onClick={() => {
                const service = status?.services.find((s) => s.id === confirm.id);
                if (service) void act(service, confirm.action);
              }}
            >
              {confirm.id === "savestate" ? "Switch off" : confirm.action === "stop" ? "Stop" : "Restart"}
            </button>
          </div>
        </div>
      ) : null}
      {status?.events?.length ? (
        <details style={{ marginTop: 10 }}>
          <summary className="hint" style={{ cursor: "pointer", margin: 0 }}>Recent on this PC</summary>
          {status.events.slice(0, 10).map((event) => (
            <div key={`${event.at}-${event.title}`} className="row" style={{ fontSize: 13 }}>
              <small style={{ color: "var(--muted)", width: 70, flex: "none" }}>{ago(new Date(event.at).toISOString())}</small>
              <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{event.title}</span>
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
}
