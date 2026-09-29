"use client";

/**
 * A build, live: where it is, how far, what the model is writing right now,
 * what happened so far, and what it has made — so nobody sits watching a
 * spinner wondering whether anything is happening.
 */
import { useEffect, useRef, useState } from "react";

import { api, type Build, type StageId } from "@/lib/api";
import { Icon, ago } from "./ui";

const STAGES: Array<{ id: StageId; label: string }> = [
  { id: "writing", label: "Writing" },
  { id: "checking", label: "Checking" },
  { id: "fixing", label: "Fixing" },
  { id: "scoring", label: "Scoring" },
  { id: "improving", label: "Improving" }
];

const CHECKS = ["install", "typecheck", "build", "test", "lint"];

const duration = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes}m ${seconds % 60}s` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** Seconds since an ISO time, updated every second while shown. */
function useElapsed(since: string | null | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!since) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since ? Math.max(Math.round((now - new Date(since).getTime()) / 1000), 0) : null;
}

function Bar({ value, tone = "accent", label }: { value: number; tone?: "accent" | "good" | "warn"; label: string }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="live-bar" role="progressbar" aria-label={label} aria-valuenow={clamped} aria-valuemin={0} aria-valuemax={100}>
      <div className={`live-bar-fill tone-${tone}`} style={{ width: `${Math.max(clamped, 2)}%` }} />
    </div>
  );
}

/** What the build has made so far, in a pane, at phone or desktop size. */
export function BuildPreview({ buildId, live }: { buildId: string; live: boolean }) {
  const [link, setLink] = useState<{ available: boolean; builtAt: string | null; url: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<"phone" | "desktop">("desktop");
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const next = await api.buildPreview(buildId);
        if (stopped) return;
        // Reload the frame only when a newer build of it exists.
        setLink((previous) => {
          if (previous && previous.builtAt !== next.builtAt) setReloads((count) => count + 1);
          return next;
        });
        setError(null);
      } catch (caught) {
        if (!stopped) setError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void load();
    const timer = live ? setInterval(load, 10_000) : undefined;
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [buildId, live]);

  if (error) return <small style={{ color: "var(--bad)" }}>Preview unavailable: {error}</small>;
  if (!link) return <small style={{ color: "var(--muted)" }}>Loading the preview…</small>;
  if (!link.available) {
    return (
      <div className="preview-empty">
        Nothing to show yet. The preview appears as soon as a pass builds successfully{live ? ", and refreshes by itself after every pass" : ""}.
      </div>
    );
  }

  return (
    <div className="preview-pane">
      <div className="preview-bar">
        <span className="chips">
          <button className={`chip ${device === "phone" ? "accent" : ""}`} onClick={() => setDevice("phone")}>
            Phone
          </button>
          <button className={`chip ${device === "desktop" ? "accent" : ""}`} onClick={() => setDevice("desktop")}>
            Desktop
          </button>
        </span>
        <small style={{ color: "var(--muted)" }}>Built {link.builtAt ? ago(link.builtAt) : ""}</small>
        <span className="chips">
          <button className="chip" onClick={() => setReloads((count) => count + 1)} title="Reload">
            ↻
          </button>
          <a className="chip" href={link.url} target="_blank" rel="noreferrer">
            Open ↗
          </a>
        </span>
      </div>
      <div className="preview-frame-wrap">
        <iframe
          key={reloads}
          src={link.url}
          title="What the build has made so far"
          className={`preview-frame ${device}`}
          sandbox="allow-scripts allow-forms allow-popups"
        />
      </div>
    </div>
  );
}

/** Everything about a build in progress. Polls every two seconds while it runs. */
export function BuildLive({ buildId, initial, onChange }: { buildId: string; initial?: Build | null; onChange?: (build: Build) => void }) {
  const [build, setBuild] = useState<Build | null>(initial ?? null);
  const [showPreview, setShowPreview] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const thinkingRef = useRef<HTMLPreElement>(null);
  const running = build ? build.live && (build.state === "running" || build.state === "paused") : true;

  useEffect(() => {
    let stopped = false;
    const load = async () => {
      try {
        const next = await api.build(buildId);
        if (stopped) return;
        setBuild(next);
        onChange?.(next);
      } catch {
        // Keep showing the last good picture; the next poll may work.
      }
    };
    void load();
    if (!running) return;
    const timer = setInterval(load, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // onChange is a callback from the parent; re-subscribing on each render would restart polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildId, running]);

  // Keep the newest words in view, like a terminal.
  useEffect(() => {
    const box = thinkingRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [build?.progress?.thinking?.tail]);

  const p = build?.progress ?? null;
  const inStage = useElapsed(p?.stageStartedAt);
  const inPass = useElapsed(p?.passStartedAt);

  if (!build || !p) {
    return <small style={{ color: "var(--muted)" }}>Waiting for the build to report in…</small>;
  }

  const stageIndex = STAGES.findIndex((stage) => stage.id === p.stage);
  const thinking = p.thinking;
  const thinkingLive = thinking && !thinking.done && Date.now() - new Date(thinking.at).getTime() < 15_000;
  const recent = [...p.log].reverse();

  return (
    <div className="build-live">
      {/* where it is */}
      <ol className="stage-track" aria-label="Stages of this pass">
        {STAGES.map((stage, index) => (
          <li
            key={stage.id}
            className={
              p.stage === "finished" ? "done" : index < stageIndex ? "done" : index === stageIndex ? "now" : ""
            }
          >
            <span className="stage-dot" aria-hidden="true" />
            {stage.label}
          </li>
        ))}
      </ol>

      <p className="stage-label">
        {running && p.stage !== "finished" ? <span className="live-dot" aria-hidden="true" /> : null}
        {p.stageLabel}
        {inStage !== null && running && p.stage !== "finished" ? <small> · {duration(inStage)}</small> : null}
      </p>

      {/* how far */}
      <div className="live-bars">
        <div>
          <div className="live-bar-head">
            <span>
              Pass {p.pass || 1}
              {p.maxPasses < 50 ? ` of up to ${p.maxPasses}` : ""}
            </span>
            <span>
              {p.stage === "finished"
                ? "done"
                : p.passEtaSeconds !== null
                  ? `~${duration(p.passEtaSeconds)} left`
                  : inPass !== null
                    ? `${duration(inPass)} so far`
                    : ""}
            </span>
          </div>
          <Bar value={p.stage === "finished" ? 100 : p.passPercent} label="This pass" />
        </div>
        <div>
          <div className="live-bar-head">
            <span>Quality</span>
            <span>
              {Math.round(build.qualityScore)} of {p.target}
            </span>
          </div>
          <Bar value={p.qualityPercent} tone={p.qualityPercent >= 100 ? "good" : "warn"} label="Quality towards the target" />
        </div>
      </div>

      {/* the checks */}
      {Object.keys(p.checks).length ? (
        <div className="chips" style={{ marginTop: 10 }}>
          {CHECKS.filter((name) => p.checks[name]).map((name) => {
            const state = p.checks[name];
            return (
              <span key={name} className={`chip check-${state}`}>
                {state === "running" ? <span className="spin-sm" aria-hidden="true" /> : state === "passed" ? "✓" : state === "failed" ? "✗" : "–"} {name}
              </span>
            );
          })}
        </div>
      ) : null}

      {/* what it is thinking */}
      {thinking ? (
        <div className="thinking">
          <div className="thinking-head">
            <span>
              {thinkingLive ? <span className="live-dot" aria-hidden="true" /> : null}
              {thinkingLive ? "Writing now" : "Last answer"} · {thinking.phase}
            </span>
            <small>
              {thinking.model} · {thinking.tokensPerSecond} tok/s · {thinking.chars.toLocaleString("en-ZA")} chars
            </small>
          </div>
          <pre ref={thinkingRef} className="thinking-text">
            {thinking.tail}
            {thinkingLive ? <span className="caret" aria-hidden="true" /> : null}
          </pre>
        </div>
      ) : null}

      {/* what happened */}
      <div className="live-log">
        {(showLog ? recent : recent.slice(0, 5)).map((line, index) => (
          <div key={`${line.at}-${index}`} className={`log-line kind-${line.kind}`}>
            <small>{new Date(line.at).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</small>
            <span>{line.text}</span>
          </div>
        ))}
        {recent.length > 5 ? (
          <button className="btn small" style={{ marginTop: 6 }} onClick={() => setShowLog(!showLog)}>
            {showLog ? "Show less" : `Show all ${recent.length} steps`}
          </button>
        ) : null}
      </div>

      <div className="btn-row" style={{ marginTop: 10 }}>
        <button className="btn small" onClick={() => setShowPreview(!showPreview)}>
          {Icon.scan} {showPreview ? "Hide preview" : "Live preview"}
        </button>
      </div>
      {showPreview ? <BuildPreview buildId={buildId} live={running} /> : null}
    </div>
  );
}
