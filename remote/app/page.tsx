"use client";

import Link from "next/link";
import { useState } from "react";

import { api, type Problem } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "./ui";

type Step = { service: string; action: string; ok: boolean };

export default function Home() {
  const connected = useConnected();
  const toast = useToast();
  const status = useRemote(() => api.status(), 15000);
  const feed = useRemote(() => api.feed(6), 20000);
  const [working, setWorking] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [problems, setProblems] = useState<Problem[] | null>(null);

  if (connected === false) return <NotConnected />;

  const data = status.data;
  const healthy = data?.healthy ?? false;
  const unreachable = Boolean(status.error);

  const heroTone = unreachable ? "bad" : healthy ? "good" : "";
  const heroTitle = unreachable ? "Can't reach your PC" : healthy ? "Everything is running" : "Some things are off";
  const heroSub = unreachable
    ? "It may be asleep, or the address changed. Open Settings to reconnect."
    : data
      ? `${data.host} · ${data.research.running} topic(s) researching`
      : "Checking…";

  const run = async (name: string, action: () => Promise<void>) => {
    setWorking(name);
    try {
      await action();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWorking(null);
    }
  };

  const switchOn = () =>
    run("start", async () => {
      setProblems(null);
      const result = await api.startEverything();
      setSteps(result.steps);
      status.setData(result.status);
      void feed.refresh();
      toast(
        result.status.healthy ? "Everything is up" : "Started - some services still need a look",
        result.status.healthy ? "ok" : "info"
      );
    });

  const pause = () =>
    run("pause", async () => {
      setProblems(null);
      const result = await api.stopBackgroundWork();
      setSteps(result.steps);
      status.setData(result.status);
      toast("Background work paused - the GPU is free", "ok");
    });

  const troubleshoot = () =>
    run("check", async () => {
      setSteps(null);
      const result = await api.troubleshoot();
      setProblems(result.problems);
      toast(
        result.problems.length === 0 ? "Nothing needs attention" : `${result.problems.length} thing(s) to look at`,
        result.problems.length === 0 ? "ok" : "info"
      );
    });

  const rescan = () =>
    run("scan", async () => {
      const result = await api.scan();
      await status.refresh();
      toast(`Scanned ${result.scanned} project(s)`, "ok");
    });

  return (
    <>
      <Header
        title="Agent Builder"
        sub={data ? data.host : "Connecting…"}
        state={unreachable ? "down" : working ? "busy" : healthy ? "up" : "warn"}
      />

      <div className="wrap">
        <section className={`hero ${heroTone}`}>
          <div className="hero-label">Your machine</div>
          <h2 className="hero-title">{heroTitle}</h2>
          <p className="hero-sub">{heroSub}</p>

          {unreachable ? (
            <Link href="/settings">
              <button className="power">{Icon.gear} Open settings</button>
            </Link>
          ) : (
            <button className={`power ${healthy ? "all-good" : ""}`} onClick={switchOn} disabled={Boolean(working)}>
              {working === "start" ? (
                <Busy label="Starting everything…" />
              ) : (
                <>
                  {Icon.power} {healthy ? "Everything is on" : "Switch everything on"}
                </>
              )}
            </button>
          )}

          {!unreachable ? (
            <div className="quick">
              <button onClick={troubleshoot} disabled={Boolean(working)}>
                {working === "check" ? <Busy label="Checking" /> : <>{Icon.stethoscope} Troubleshoot</>}
              </button>
              <button onClick={pause} disabled={Boolean(working)}>
                {working === "pause" ? <Busy label="Pausing" /> : <>{Icon.pause} Pause work</>}
              </button>
              <button onClick={rescan} disabled={Boolean(working)}>
                {working === "scan" ? <Busy label="Scanning" /> : <>{Icon.search} Scan projects</>}
              </button>
              <button onClick={() => void status.refresh()} disabled={Boolean(working)}>
                {Icon.refresh} Refresh
              </button>
            </div>
          ) : null}
        </section>

        {status.error ? <Banner kind="error">{status.error}</Banner> : null}

        {steps ? (
          <div className="card fade-in">
            <h2>What just happened</h2>
            {steps.map((step) => (
              <div key={`${step.service}-${step.action}`} className="row">
                <span className={`pill ${step.ok ? "up" : "down"}`} />
                <div className="body">
                  <strong style={{ textTransform: "capitalize" }}>{step.service}</strong>
                  <span>{step.action}</span>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {problems ? (
          <div className="card fade-in">
            <h2>{problems.length === 0 ? "All clear" : "Worth a look"}</h2>
            {problems.length === 0 ? (
              <p className="hint" style={{ marginBottom: 0 }}>
                Nothing is wrong that I can see.
              </p>
            ) : (
              problems.map((problem) => (
                <div key={problem.title} className="row">
                  <span className={`pill ${problem.severity === "error" ? "down" : "degraded"}`} />
                  <div className="body">
                    <strong>{problem.title}</strong>
                    <span>{problem.detail}</span>
                    <span style={{ color: "var(--accent)", marginTop: 3 }}>{problem.fix}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : null}

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
              <div className={`stat ${data.counts.openIssues > 0 ? "alert" : ""}`}>
                <b>{data.counts.openIssues}</b>
                <span>Issues</span>
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
                    <strong>Reachable at</strong>
                    <span>{data.publicUrl}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : status.loading ? (
          <Skeleton rows={4} />
        ) : null}

        <div className="section-title">Latest</div>
        {feed.data && feed.data.feed.length > 0 ? (
          <div className="card">
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
                <button className="btn ghost small">{Icon.list} See everything</button>
              </Link>
            </div>
          </div>
        ) : feed.loading ? (
          <Skeleton rows={3} />
        ) : (
          <div className="card">
            <div className="empty">Nothing has happened yet.</div>
          </div>
        )}
      </div>
    </>
  );
}
