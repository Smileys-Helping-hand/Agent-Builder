"use client";

import Link from "next/link";
import { useState } from "react";

import { api, type Problem } from "@/lib/api";
import { isLive, useActivity } from "./activity";
import { StateBadge, STAGE_LABEL } from "./build/parts";
import { Banner, Busy, Freshness, Header, Icon, Meter, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "./ui";

type Step = { service: string; action: string; ok: boolean };

export default function Home() {
  const connected = useConnected();
  const toast = useToast();
  const status = useRemote(() => api.status(), 15000, "status");
  const feed = useRemote(() => api.feed(6), 20000, "feed");
  const carryOn = useRemote(() => api.continueTimeline(), 60000, "continue");
  const activity = useActivity();
  const [working, setWorking] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [troubleshootProgress, setTroubleshootProgress] = useState<number | null>(null);
  const [troubleshootStage, setTroubleshootStage] = useState<string | null>(null);

  if (connected === false) return <NotConnected />;

  const data = status.data;
  const healthy = data?.healthy ?? false;
  const unreachable = Boolean(status.error) && !status.fresh;
  const recentBuilds = activity.live.length > 0 ? activity.live : activity.builds.slice(0, 3);

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

  const troubleshoot = async () => {
    setWorking("check");
    setSteps(null);
    setTroubleshootProgress(15);
    setTroubleshootStage("1/5: Auditing PC ports & API responsiveness...");
    try {
      await new Promise((r) => setTimeout(r, 350));
      setTroubleshootProgress(35);
      setTroubleshootStage("2/5: Checking Ollama local models & GPU acceleration...");
      await new Promise((r) => setTimeout(r, 350));
      setTroubleshootProgress(60);
      setTroubleshootStage("3/5: Checking Comfy Desktop state & VRAM footprint...");
      await new Promise((r) => setTimeout(r, 350));
      setTroubleshootProgress(80);
      setTroubleshootStage("4/5: Testing GitHub token & Jarvis Second Brain...");
      const result = await api.troubleshoot();
      setTroubleshootProgress(95);
      setTroubleshootStage("5/5: Inspecting disk space & memory usage...");
      await new Promise((r) => setTimeout(r, 250));
      setTroubleshootProgress(100);
      setTroubleshootStage("Diagnostics complete!");
      setProblems(result.problems);
      toast(
        result.problems.length === 0 ? "Nothing needs attention" : `${result.problems.length} thing(s) to look at`,
        result.problems.length === 0 ? "ok" : "info"
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
      setTroubleshootProgress(null);
      setTroubleshootStage(null);
    } finally {
      setWorking(null);
      setTimeout(() => {
        setTroubleshootProgress(null);
        setTroubleshootStage(null);
      }, 5000);
    }
  };

  const rescan = () =>
    run("scan", async () => {
      const result = await api.scan();
      await status.refresh();
      toast(`Scanned ${result.scanned} project(s)`, "ok");
    });

  const freeSpace = () =>
    run("clean", async () => {
      const result = await api.cleanup();
      toast(result.message, "ok");
      await status.refresh();
    });

  const fixProblem = (fixId: string) =>
    run(`fix-${fixId}`, async () => {
      const res = await api.fixTrouble(fixId);
      toast(res.message, res.ok ? "ok" : "error");
      await status.refresh();
      const updated = await api.troubleshoot();
      setProblems(updated.problems);
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
              <button onClick={freeSpace} disabled={Boolean(working)}>
                {working === "clean" ? <Busy label="Cleaning" /> : <>{Icon.sparkle} Free PC space</>}
              </button>
              <button
                onClick={() => {
                  const comfyService = data?.services.find((s) => s.id === "comfy");
                  const isComfyUp = comfyService?.state === "up";
                  run("comfy", async () => {
                    const res = await api.toggleService("comfy", isComfyUp ? "stop" : "start");
                    toast(res.message, res.success ? "ok" : "error");
                    await status.refresh();
                  });
                }}
                disabled={Boolean(working)}
                style={{
                  borderColor: data?.services.find((s) => s.id === "comfy")?.state === "up" ? "var(--bad)" : "var(--accent)"
                }}
              >
                {working === "comfy" ? (
                  <Busy label="Working…" />
                ) : data?.services.find((s) => s.id === "comfy")?.state === "up" ? (
                  "🛑 Close Comfy"
                ) : (
                  "🚀 Launch Comfy"
                )}
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

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -4 }}>
          <Freshness updatedAt={status.updatedAt} fresh={status.fresh} error={status.error} />
        </div>

        {recentBuilds.length > 0 ? (
          <>
            <div className="section-title">{activity.live.length > 0 ? `Building now (${activity.live.length})` : "Latest builds"}</div>
            <div className="card">
              {recentBuilds.map((build) => {
                const live = isLive(build);
                const score = live ? build.qualityScore : build.bestScore ?? build.qualityScore;
                return (
                  <Link key={build.buildId} href={`/build/?id=${encodeURIComponent(build.buildId)}`} className="live-build">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <strong style={{ fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {build.projectName}
                        </strong>
                        <StateBadge build={build} />
                      </div>
                      <small className="muted">
                        {live
                          ? `Pass ${build.iterations || 1} · ${STAGE_LABEL[build.stage ?? "starting"] ?? build.stage} · quality ${Math.round(score)}`
                          : `Quality ${Math.round(score)} · ${build.finishedAt ? ago(build.finishedAt) : ago(build.startedAt)}`}
                      </small>
                      {live ? <Meter value={score} target={build.qualityThreshold} /> : null}
                    </div>
                  </Link>
                );
              })}
              <div style={{ marginTop: 12 }}>
                <Link href="/build">
                  <button className="btn ghost small">{Icon.sparkle} All builds</button>
                </Link>
              </div>
            </div>
          </>
        ) : null}

        {troubleshootProgress !== null ? (
          <div className="card" style={{ borderColor: "var(--accent)", backgroundColor: "rgba(99, 102, 241, 0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <strong style={{ color: "var(--accent)", fontSize: 15 }}>🩺 System Troubleshoot in Progress</strong>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{troubleshootProgress}%</span>
            </div>
            <p style={{ margin: "4px 0 10px", fontSize: 13, color: "var(--text)" }}>{troubleshootStage}</p>
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 6, height: 10, overflow: "hidden" }}>
              <div
                style={{
                  width: `${troubleshootProgress}%`,
                  height: "100%",
                  backgroundColor: "var(--accent)",
                  transition: "width 0.4s ease"
                }}
              />
            </div>
          </div>
        ) : null}

        {!unreachable ? (
          <div className="card" style={{ padding: "10px 14px", marginTop: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>🖥️ PC Workspace Quick Launch:</span>
              <div className="btn-row">
                <button
                  className="btn small"
                  disabled={Boolean(working)}
                  onClick={() =>
                    run("vscode", async () => {
                      const res = await api.openWorkspace("vscode");
                      toast(res.message, "ok");
                    })
                  }
                >
                  Open in VS Code
                </button>
                <button
                  className="btn small"
                  disabled={Boolean(working)}
                  onClick={() =>
                    run("folder", async () => {
                      const res = await api.openWorkspace("projects");
                      toast(res.message, "ok");
                    })
                  }
                >
                  Open Projects Folder
                </button>
              </div>
            </div>
          </div>
        ) : null}

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
                <div key={problem.title} className="row" style={{ alignItems: "center" }}>
                  <span className={`pill ${problem.severity === "error" ? "down" : "degraded"}`} />
                  <div className="body">
                    <strong>{problem.title}</strong>
                    <span>{problem.detail}</span>
                    <span style={{ color: "var(--accent)", marginTop: 3 }}>{problem.fix}</span>
                  </div>
                  {problem.fixId ? (
                    <button
                      className="btn small primary"
                      style={{ marginLeft: "auto" }}
                      disabled={Boolean(working)}
                      onClick={() => fixProblem(problem.fixId!)}
                    >
                      {working === `fix-${problem.fixId}` ? <Busy label="Fixing…" /> : <>Fix now</>}
                    </button>
                  ) : null}
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

        <div className="section-title">Pick up where you left off</div>
        {carryOn.data && carryOn.data.timeline.length > 0 ? (
          <div className="card">
            {carryOn.data.timeline.slice(0, 8).map((entry, index) => (
              <div key={`${entry.kind}-${entry.at}-${index}`} className="feed-item">
                <span
                  className={`tag ${
                    entry.kind === "commit" ? "good" : entry.kind === "builder" ? "" : "warn"
                  }`}
                >
                  {entry.kind}
                </span>
                <div className="text">
                  <p>
                    {entry.projectName ? <strong>{entry.projectName}: </strong> : null}
                    {entry.title}
                  </p>
                  <time>{ago(entry.at)}</time>
                </div>
              </div>
            ))}
            {carryOn.data.unfinished.length > 0 ? (
              <div className="chips" style={{ marginTop: 12 }}>
                {carryOn.data.unfinished.slice(0, 6).map((project) => (
                  <span key={project.id} className="chip warn">
                    {project.name}
                    {project.gitDirty > 0 ? ` · ${project.gitDirty} uncommitted` : ""}
                    {project.gitAhead > 0 ? ` · ${project.gitAhead} unpushed` : ""}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        ) : carryOn.loading ? (
          <Skeleton rows={3} />
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
