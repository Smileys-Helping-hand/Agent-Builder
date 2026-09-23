"use client";

import Link from "next/link";
import { useState } from "react";

import { api, type ServiceReport } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";

/**
 * The machine room.
 *
 * Home answers "is it fine?" with one button. This page is for when the answer
 * is no, or when you want to reach past the defaults: individual services, what
 * the hardware is doing, whether Jarvis is actually receiving anything, and the
 * switches that decide how much the machine does on its own.
 */

const SERVICE_STATE: Record<ServiceReport["state"], string> = {
  up: "up",
  down: "down",
  degraded: "degraded",
  unknown: ""
};

const pct = (value: number | undefined): string => (value === undefined ? "—" : `${Math.round(value)}%`);

/** The server reports memory in bytes; nobody wants to read that. */
const gb = (bytes: number): string => `${Math.round(bytes / 1024 ** 3)}GB`;

export default function Control() {
  const connected = useConnected();
  const toast = useToast();
  const status = useRemote(() => api.status(), 15000);
  const hardware = useRemote(() => api.hardware(), 20000);
  const jarvis = useRemote(() => api.jarvis(), 30000);
  const pipeline = useRemote(() => api.pipeline(), 30000);
  const builds = useRemote(() => api.builds(), 15000);

  const [working, setWorking] = useState<string | null>(null);
  const [confirmShutdown, setConfirmShutdown] = useState(false);

  if (connected === false) return <NotConnected />;

  const run = async (name: string, label: string, action: () => Promise<unknown>) => {
    setWorking(name);
    try {
      await action();
      toast(label, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWorking(null);
    }
  };

  const data = status.data;
  const specs = hardware.data?.specs;
  const used = hardware.data?.utilization;
  const live = (builds.data?.builds ?? []).filter((build) => build.live);
  const jarvisOk = jarvis.data?.last?.ok ?? null;

  return (
    <>
      <Header
        title="Control"
        sub={data ? `${data.host} · ${data.gpu}` : "Reading your machine…"}
        state={status.error ? "down" : data?.healthy ? "up" : "warn"}
      />

      <div className="wrap">
        {status.error ? <Banner kind="error">{status.error}</Banner> : null}

        {/* ---------- power ---------- */}
        <section className="hero">
          <div className="hero-label">Power</div>
          <h2 className="hero-title">{data?.healthy ? "Everything is running" : "Some things are off"}</h2>
          <p className="hero-sub">
            Starting brings up the model server and the background loops. Pausing frees the GPU without losing
            anything — work picks up where it stopped.
          </p>

          <div className="quick" style={{ marginTop: 14 }}>
            <button
              disabled={working !== null}
              onClick={() =>
                run("start", "Everything is starting.", async () => {
                  const result = await api.startEverything();
                  status.setData(result.status);
                })
              }
            >
              {working === "start" ? <Busy label="Starting…" /> : <>{Icon.power} Start everything</>}
            </button>

            <button
              disabled={working !== null}
              onClick={() =>
                run("pause", "Background work paused — the GPU is free.", async () => {
                  const result = await api.stopBackgroundWork();
                  status.setData(result.status);
                })
              }
            >
              {working === "pause" ? <Busy label="Pausing…" /> : <>{Icon.pause} Free the GPU</>}
            </button>

            <button
              disabled={working !== null}
              onClick={() =>
                run("restart", "Restarted.", async () => {
                  const result = await api.restartBackgroundWork();
                  status.setData(result.status);
                })
              }
            >
              {working === "restart" ? <Busy label="Restarting…" /> : <>{Icon.refresh} Restart background work</>}
            </button>

            <button
              disabled={working !== null}
              onClick={() =>
                run("check", "Checked.", async () => {
                  const result = await api.troubleshoot();
                  toast(
                    result.problems.length === 0 ? "Nothing needs attention." : `${result.problems.length} thing(s) to look at.`,
                    result.problems.length === 0 ? "ok" : "info"
                  );
                })
              }
            >
              {working === "check" ? <Busy label="Checking…" /> : <>{Icon.stethoscope} Check for problems</>}
            </button>

            <button disabled={working !== null} onClick={() => run("scan", "Rescanned your projects.", () => api.scan())}>
              {working === "scan" ? <Busy label="Scanning…" /> : <>{Icon.scan} Rescan projects</>}
            </button>

            <button disabled={working !== null} onClick={() => run("improve", "Improvement pass queued.", () => api.improveNow())}>
              {working === "improve" ? <Busy label="Queuing…" /> : <>{Icon.sparkle} Improve a delivered site</>}
            </button>
          </div>
        </section>

        {/* ---------- what is running ---------- */}
        <div className="section-title">What is running</div>
        {status.loading && !data ? <Skeleton rows={3} /> : null}
        {(data?.services ?? []).map((service) => (
          <div key={service.id} className="card">
            <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
              <span className={`pill ${SERVICE_STATE[service.state]}`} style={{ marginTop: 7 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 15 }}>{service.label}</strong>
                <small style={{ color: "var(--muted)", display: "block", marginTop: 3, overflowWrap: "anywhere" }}>
                  {service.detail}
                </small>
              </div>
            </div>
          </div>
        ))}

        {/* ---------- builds in flight ---------- */}
        {live.length > 0 ? (
          <>
            <div className="section-title">Building now ({live.length})</div>
            {live.map((build) => (
              <div key={build.buildId} className="card">
                <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <span className={`pill ${build.state === "paused" ? "degraded" : "up"}`} style={{ marginTop: 7 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 15 }}>{build.projectName}</strong>
                    <small style={{ color: "var(--muted)", display: "block", marginTop: 3 }}>
                      Pass {build.iterations || 1} · {build.stage} · quality {Math.round(build.qualityScore)}
                      {build.orderId ? " · for a customer order" : ""}
                    </small>
                    <div className="btn-row" style={{ marginTop: 10 }}>
                      <button
                        className="btn"
                        disabled={working !== null}
                        onClick={() =>
                          run(build.buildId, build.state === "paused" ? "Resumed." : "Paused.", async () => {
                            await (build.state === "paused" ? api.resumeBuild(build.buildId) : api.pauseBuild(build.buildId));
                            await builds.refresh();
                          })
                        }
                      >
                        {build.state === "paused" ? "Resume" : "Pause"}
                      </button>
                      <button
                        className="btn"
                        disabled={working !== null}
                        onClick={() =>
                          run(`${build.buildId}-stop`, "Stopped.", async () => {
                            await api.stopBuild(build.buildId);
                            await builds.refresh();
                          })
                        }
                      >
                        Stop
                      </button>
                      <Link className="btn" href="/build">
                        Open
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : null}

        {/* ---------- hardware ---------- */}
        <div className="section-title">This machine</div>
        <div className="card">
          {hardware.error ? <Banner kind="error">{hardware.error}</Banner> : null}
          <div className="stats">
            <div className="stat">
              <strong>{pct(used?.cpuUsage)}</strong>
              <span>CPU</span>
            </div>
            <div className="stat">
              <strong>{pct(used?.memoryUsage)}</strong>
              <span>Memory</span>
            </div>
            <div className="stat">
              <strong>{specs?.optimalConcurrency ?? "—"}</strong>
              <span>Parallel jobs</span>
            </div>
          </div>
          <small style={{ color: "var(--muted)", display: "block", marginTop: 10 }}>
            {specs?.cpuCores ? `${specs.cpuCores} cores · ` : ""}
            {specs?.totalMemory ? `${gb(specs.totalMemory)} RAM · ` : ""}
            best model size here: {specs?.recommendedModelSize ?? "unknown"}
          </small>
          {used?.recommendation ? (
            <small style={{ color: "var(--muted)", display: "block", marginTop: 5 }}>{used.recommendation}</small>
          ) : null}
          {data ? (
            <small style={{ color: "var(--muted)", display: "block", marginTop: 5 }}>
              {data.gpu} · {data.disk}
            </small>
          ) : null}
        </div>

        {/* ---------- the customer pipeline ---------- */}
        <div className="section-title">Customer pipeline</div>
        <div className="card">
          {pipeline.data ? (
            <>
              <div className="chips">
                <span className={`chip ${pipeline.data.site.configured ? "accent" : ""}`}>
                  {pipeline.data.site.configured ? "site connected" : "no site"}
                </span>
                <span className="chip">{pipeline.data.autoStart ? "builds start on their own" : "builds are manual"}</span>
                <span className="chip">{pipeline.data.autoImprove ? "keeps improving" : "improvement off"}</span>
                <span className="chip">{pipeline.data.maxConcurrent} build at a time</span>
              </div>
              <div className="stats" style={{ marginTop: 12 }}>
                <div className="stat">
                  <strong>{pipeline.data.counts.received + pipeline.data.counts.review + pipeline.data.counts.failed}</strong>
                  <span>need you</span>
                </div>
                <div className="stat">
                  <strong>{pipeline.data.counts.building + pipeline.data.counts.accepted}</strong>
                  <span>in progress</span>
                </div>
                <div className="stat">
                  <strong>{pipeline.data.counts.delivered + pipeline.data.counts.maintained}</strong>
                  <span>delivered</span>
                </div>
              </div>
              <small style={{ color: "var(--muted)", display: "block", marginTop: 10 }}>
                {pipeline.data.site.configured
                  ? `Last checked ${pipeline.data.lastIntakeAt ? ago(pipeline.data.lastIntakeAt) : "not yet"} · ${pipeline.data.site.site}`
                  : "Set SITE_URL and SITE_API_KEY on your machine to pull orders from your website."}
              </small>
              <div className="btn-row" style={{ marginTop: 11 }}>
                <Link className="btn" href="/orders">
                  {Icon.list} Open orders
                </Link>
                <button
                  className="btn"
                  disabled={working !== null || !pipeline.data.site.configured}
                  onClick={() => run("pull", "Checked the site.", async () => {
                    const result = await api.pullOrders();
                    toast(result.created > 0 ? `${result.created} new order(s).` : "Nothing new.", "ok");
                    await pipeline.refresh();
                  })}
                >
                  {Icon.refresh} Check the site now
                </button>
              </div>
            </>
          ) : (
            <Skeleton rows={2} />
          )}
        </div>

        {/* ---------- jarvis ---------- */}
        <div className="section-title">Jarvis</div>
        <div className="card">
          {jarvis.data ? (
            <>
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span
                  className={`pill ${jarvisOk === null ? "degraded" : jarvisOk ? "up" : "down"}`}
                  style={{ marginTop: 7 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 15 }}>
                    {!jarvis.data.configured
                      ? "Not set up"
                      : jarvisOk === null
                        ? "Set up, nothing sent yet"
                        : jarvisOk
                          ? "Connected"
                          : "Not getting through"}
                  </strong>
                  <small style={{ color: "var(--muted)", display: "block", marginTop: 3, overflowWrap: "anywhere" }}>
                    {jarvis.data.url ?? "Set JARVIS_HOST and JARVIS_API_KEY on your machine."}
                  </small>
                  {jarvis.data.last ? (
                    <small style={{ color: "var(--muted)", display: "block", marginTop: 5, overflowWrap: "anywhere" }}>
                      Last try {ago(jarvis.data.last.at)}: {jarvis.data.last.detail}
                    </small>
                  ) : null}
                  {jarvis.data.queued > 0 ? (
                    <Banner kind="info">
                      {jarvis.data.queued} message(s) waiting. They go through as soon as Jarvis answers.
                    </Banner>
                  ) : null}
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 11 }}>
                <button
                  className="btn"
                  disabled={working !== null || !jarvis.data.configured}
                  onClick={() =>
                    run("jarvis", "Sent.", async () => {
                      const result = await api.testJarvis();
                      toast(result.ok ? "Jarvis got it." : result.detail, result.ok ? "ok" : "error");
                      await jarvis.refresh();
                    })
                  }
                >
                  {working === "jarvis" ? <Busy label="Sending…" /> : <>{Icon.sparkle} Send a test</>}
                </button>
                <button
                  className="btn"
                  disabled={working !== null || !jarvis.data.configured}
                  onClick={() =>
                    run("handoff", "Briefing sent.", async () => {
                      await api.sendHandoff();
                      await jarvis.refresh();
                    })
                  }
                >
                  {Icon.book} Send him the full picture
                </button>
              </div>
            </>
          ) : (
            <Skeleton rows={2} />
          )}
        </div>

        {/* ---------- elsewhere ---------- */}
        <div className="section-title">Elsewhere</div>
        <div className="card">
          <div className="quick">
            <Link href="/research">{Icon.flask} Research</Link>
            <Link href="/feed">{Icon.list} Activity feed</Link>
            <Link href="/projects">{Icon.folder} Projects</Link>
            <Link href="/settings">{Icon.gear} Settings</Link>
            <Link href="/help">{Icon.book} Help</Link>
          </div>
        </div>

        {/* ---------- the dangerous one, last ---------- */}
        <div className="section-title">Shut down</div>
        <div className="card">
          <p className="hint">
            Stops everything on your machine, including this API. You will not be able to reach it from here again
            until you start it at the PC.
          </p>
          {confirmShutdown ? (
            <div className="btn-row">
              <button
                className="btn"
                disabled={working !== null}
                onClick={() =>
                  run("shutdown", "Shutting down.", async () => {
                    await api.shutdown();
                    setConfirmShutdown(false);
                  })
                }
              >
                Yes, shut it all down
              </button>
              <button className="btn" onClick={() => setConfirmShutdown(false)}>
                Keep it running
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirmShutdown(true)} disabled={working !== null}>
              {Icon.power} Shut everything down
            </button>
          )}
        </div>
      </div>
    </>
  );
}
