"use client";

import Link from "next/link";
import { useState } from "react";

import { api, type Problem } from "@/lib/api";
import { Banner, Busy, Header, NotConnected, ago, useConnected, useRemote } from "./ui";

export default function Home() {
  const connected = useConnected();
  const status = useRemote(() => api.status(), 15000);
  const feed = useRemote(() => api.feed(6), 20000);
  const [starting, setStarting] = useState(false);
  const [steps, setSteps] = useState<Array<{ service: string; action: string; ok: boolean }> | null>(null);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [pausing, setPausing] = useState(false);

  if (connected === false) return <NotConnected />;

  const data = status.data;
  const healthy = data?.healthy ?? false;

  const switchOn = async () => {
    setStarting(true);
    setProblems(null);
    try {
      const result = await api.startEverything();
      setSteps(result.steps);
      status.setData(result.status);
      void feed.refresh();
    } catch (error) {
      setSteps([{ service: "error", action: error instanceof Error ? error.message : String(error), ok: false }]);
    } finally {
      setStarting(false);
    }
  };

  // Pausing frees the GPU without making the builder unreachable — the thing
  // you want before gaming, and the thing you do not want to confuse with
  // shutting down (which is in Settings, behind a confirmation).
  const pauseWork = async () => {
    setPausing(true);
    setProblems(null);
    try {
      const result = await api.stopBackgroundWork();
      setSteps(result.steps);
      status.setData(result.status);
    } catch (error) {
      setSteps([{ service: "error", action: error instanceof Error ? error.message : String(error), ok: false }]);
    } finally {
      setPausing(false);
    }
  };

  const troubleshoot = async () => {
    setChecking(true);
    setSteps(null);
    try {
      const result = await api.troubleshoot();
      setProblems(result.problems);
    } catch (error) {
      setProblems([
        {
          severity: "error",
          title: "Could not run the check",
          detail: error instanceof Error ? error.message : String(error),
          fix: "Make sure your machine is awake and reachable."
        }
      ]);
    } finally {
      setChecking(false);
    }
  };

  return (
    <>
      <Header
        title="Agent Builder"
        sub={data ? data.host : "Connecting…"}
        state={status.error ? "down" : starting ? "busy" : healthy ? "up" : "warn"}
      />

      <div className="wrap">
        {status.error ? <Banner kind="error">{status.error}</Banner> : null}

        <div className="card">
          <button className={`power ${healthy ? "all-good" : ""}`} onClick={switchOn} disabled={starting}>
            {starting ? <Busy label="Starting everything…" /> : healthy ? "Everything is running" : "Switch everything on"}
          </button>

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn" onClick={troubleshoot} disabled={checking}>
              {checking ? <Busy label="Checking…" /> : "Troubleshoot"}
            </button>
            <button className="btn" onClick={pauseWork} disabled={pausing}>
              {pausing ? <Busy label="Pausing…" /> : "Pause work"}
            </button>
            <button className="btn ghost" onClick={() => void status.refresh()}>
              Refresh
            </button>
          </div>

          {steps ? (
            <div style={{ marginTop: 14 }}>
              {steps.map((step) => (
                <div key={step.service} className="row">
                  <span className={`pill ${step.ok ? "up" : "down"}`} />
                  <div className="body">
                    <strong>{step.service}</strong>
                    <span>{step.action}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {problems ? (
            problems.length === 0 ? (
              <Banner kind="ok">Everything checks out. Nothing needs attention.</Banner>
            ) : (
              <div style={{ marginTop: 14 }}>
                {problems.map((problem) => (
                  <div key={problem.title} className="row">
                    <span className={`pill ${problem.severity === "error" ? "down" : "degraded"}`} />
                    <div className="body">
                      <strong>{problem.title}</strong>
                      <span>{problem.detail}</span>
                      <span style={{ color: "var(--accent)", marginTop: 3 }}>{problem.fix}</span>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : null}
        </div>

        {data ? (
          <>
            <div className="stats">
              <div className="stat">
                <b>{data.counts.projects}</b>
                <span>Projects</span>
              </div>
              <div className="stat">
                <b>{data.research.findings}</b>
                <span>Findings</span>
              </div>
              <div className="stat">
                <b>{data.counts.openIssues}</b>
                <span>Open issues</span>
              </div>
            </div>

            <div className="section-title">Services</div>
            <div className="card">
              {data.services.map((service) => (
                <div key={service.id} className="row">
                  <span className={`pill ${service.state}`} />
                  <div className="body">
                    <strong>{service.label}</strong>
                    <span>{service.detail}</span>
                  </div>
                </div>
              ))}
              <div className="row">
                <span className="pill up" />
                <div className="body">
                  <strong>Hardware</strong>
                  <span>
                    {data.gpu} · {data.disk}
                  </span>
                </div>
              </div>
              {data.publicUrl ? (
                <div className="row">
                  <span className="pill up" />
                  <div className="body">
                    <strong>Reachable from anywhere at</strong>
                    <span>{data.publicUrl}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : status.loading ? (
          <div className="empty">
            <Busy label="Reading your machine…" />
          </div>
        ) : null}

        <div className="section-title">Latest</div>
        <div className="card">
          {feed.data && feed.data.feed.length > 0 ? (
            <>
              {feed.data.feed.map((entry) => (
                <div key={entry.id} className="feed-item">
                  <span className={`tag ${entry.kind === "error" ? "bad" : entry.kind === "repair" ? "good" : ""}`}>
                    {entry.kind}
                  </span>
                  <div className="text">
                    <p>{entry.message}</p>
                    <time>{ago(entry.at)}</time>
                  </div>
                </div>
              ))}
              <div style={{ marginTop: 12 }}>
                <Link href="/feed">
                  <button className="btn ghost small">See everything →</button>
                </Link>
              </div>
            </>
          ) : (
            <div className="empty">{feed.loading ? "Loading…" : "Nothing has happened yet."}</div>
          )}
        </div>
      </div>
    </>
  );
}
