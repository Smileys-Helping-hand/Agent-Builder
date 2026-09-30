"use client";

/**
 * Power tools: load the model before a build needs it, restart the builder
 * without going to the PC, and read the builder's own log from anywhere.
 */
import { useState } from "react";

import { ApiError, api } from "@/lib/api";
import { Busy, Icon, useRemote, useToast } from "../ui";

type Level = "all" | "warn" | "error";

const LEVELS: Array<{ id: Level; label: string }> = [
  { id: "all", label: "Everything" },
  { id: "warn", label: "Warnings" },
  { id: "error", label: "Errors" }
];

export function PowerTools() {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRestart, setConfirmRestart] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [level, setLevel] = useState<Level>("warn");

  const warm = async () => {
    setBusy("warm");
    try {
      const res = await api.warmModel();
      toast(`${res.message} (${res.seconds}s)`, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const restart = async (force = false) => {
    setBusy("restart");
    try {
      const res = await api.restartBuilder(force);
      setConfirmRestart(null);
      toast(res.message, "ok");
    } catch (error) {
      // Builds are running: say so, and let them choose.
      if (error instanceof ApiError && error.status === 409 && /build\(s\) running/.test(error.message)) setConfirmRestart(error.message);
      else toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="card">
      <h2>Power tools</h2>
      <p className="hint">For the moments before a demo, and for when something looks wrong.</p>
      <div className="quick">
        <button onClick={warm} disabled={busy !== null}>
          {busy === "warm" ? <Busy label="Loading the model" /> : <>{Icon.sparkle} Warm up the model</>}
        </button>
        <button onClick={() => void restart(false)} disabled={busy !== null}>
          {busy === "restart" ? <Busy label="Restarting" /> : <>{Icon.refresh} Restart the builder</>}
        </button>
        <button onClick={() => setShowLog((open) => !open)}>
          {Icon.list} {showLog ? "Hide" : "Show"} the builder's log
        </button>
      </div>
      {confirmRestart ? (
        <div className="confirm-box">
          <p>{confirmRestart}</p>
          <div className="btn-row">
            <button className="btn danger" onClick={() => void restart(true)} disabled={busy !== null}>
              Restart anyway
            </button>
            <button className="btn" onClick={() => setConfirmRestart(null)}>
              Keep them running
            </button>
          </div>
        </div>
      ) : null}
      {showLog ? <LogView level={level} onLevel={setLevel} /> : null}
    </div>
  );
}

function LogView({ level, onLevel }: { level: Level; onLevel: (level: Level) => void }) {
  const toast = useToast();
  const log = useRemote(() => api.builderLog(250, level === "all" ? undefined : level), 5000, `log.${level}`);
  const lines = log.data?.lines ?? [];
  return (
    <div className="log-view">
      <div className="log-head">
        <div className="segmented small">
          {LEVELS.map((option) => (
            <button key={option.id} className={level === option.id ? "on" : ""} onClick={() => onLevel(option.id)}>
              {option.label}
            </button>
          ))}
        </div>
        <button
          className="chip"
          onClick={() => {
            const text = lines.map((line) => `${line.at ?? ""} [${line.level}] ${line.message}`).join("\n");
            void navigator.clipboard.writeText(text).then(
              () => toast("Log copied", "ok"),
              () => toast("Could not copy", "error")
            );
          }}
        >
          Copy
        </button>
      </div>
      <div className="log-lines" role="log" aria-live="polite">
        {lines.length === 0 ? <p className="muted">{log.loading ? "Loading…" : "Nothing here."}</p> : null}
        {lines
          .slice()
          .reverse()
          .map((line, index) => (
            <div key={`${line.at}-${index}`} className={`log-line lvl-${line.level}`}>
              <time>{line.at ? new Date(line.at).toLocaleTimeString() : ""}</time>
              <span>{line.message}</span>
            </div>
          ))}
      </div>
    </div>
  );
}
