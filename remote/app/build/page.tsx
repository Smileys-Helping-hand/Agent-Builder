"use client";

import { useState } from "react";

import { api, type Build } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";
import { BuildLive } from "../build-live";

const PROFILES = [
  { id: "fast" as const, label: "Fast", hint: "Fewer repair passes. Good for a rough first look." },
  { id: "balanced" as const, label: "Balanced", hint: "The normal loop. Start here." },
  { id: "deep" as const, label: "Deep", hint: "More passes, and a bigger model critiques each fix. Slowest, best." }
];

const EXAMPLES = [
  { name: "Café landing page", description: "A one-page site for a coffee shop: hero, menu, opening hours, map and a contact form." },
  { name: "Invoice tracker", description: "A small web app to record invoices, mark them paid, and show what is overdue." },
  { name: "Booking form", description: "A booking page that takes a name, date and service, and emails the owner." }
];

const stateTone = (state: Build["state"]): string =>
  state === "running" ? "up" : state === "paused" ? "degraded" : state === "completed" ? "up" : "down";

export default function BuildPage() {
  const connected = useConnected();
  const toast = useToast();
  // 5s while something is in flight is frequent enough to feel live without
  // hammering a machine that is already busy generating code.
  const builds = useRemote(() => api.builds(), 5000);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profile, setProfile] = useState<"fast" | "balanced" | "deep">("balanced");
  const [busy, setBusy] = useState(false);
  const [guidance, setGuidance] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);

  if (connected === false) return <NotConnected />;

  const fail = (error: unknown) => toast(error instanceof Error ? error.message : String(error), "error");

  const start = async () => {
    setBusy(true);
    try {
      const { buildId } = await api.startBuild({
        projectName: name.trim(),
        description: description.trim(),
        profile
      });
      setName("");
      setDescription("");
      setOpen(buildId);
      toast("Building. You can close this — it keeps going.", "ok");
      await builds.refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const steer = async (build: Build) => {
    const text = (guidance[build.buildId] ?? "").trim();
    if (!text) return;
    setBusy(true);
    try {
      await api.guideBuild(build.buildId, text);
      setGuidance((current) => ({ ...current, [build.buildId]: "" }));
      toast("Noted. It takes effect on the next pass.", "ok");
      await builds.refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const control = async (build: Build, action: "pause" | "resume" | "stop") => {
    setBusy(true);
    try {
      if (action === "pause") await api.pauseBuild(build.buildId);
      else if (action === "resume") await api.resumeBuild(build.buildId);
      else await api.stopBuild(build.buildId);
      toast(`${build.projectName} ${action === "stop" ? "stopped" : action === "pause" ? "paused" : "resumed"}`, "ok");
      await builds.refresh();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const list = builds.data?.builds ?? [];
  const live = list.filter((build) => build.live && build.state !== "completed");
  const done = list.filter((build) => !live.includes(build));

  return (
    <>
      <Header
        title="Build"
        sub={live.length ? `${live.length} building now` : list.length ? `${list.length} builds so far` : "Describe it and it gets built"}
        state={builds.error ? "down" : live.length > 0 ? "busy" : "up"}
      />

      <div className="wrap">
        {builds.error ? <Banner kind="error">{builds.error}</Banner> : null}

        <section className="hero">
          <div className="hero-label">New build</div>
          <h2 className="hero-title">What should it build?</h2>
          <p className="hero-sub">
            Describe it the way you would to a developer. Your machine writes it, runs the tests, fixes what fails,
            and keeps going until it holds up — you can add instructions at any point while it works.
          </p>

          <label className="field" style={{ marginTop: 16 }}>
            <span>Call it something</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Café landing page" />
          </label>

          <label className="field">
            <span>What it should do</span>
            <textarea
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Who is it for, what should be on it, and what should happen when someone uses it."
            />
          </label>

          <div className="chips" style={{ marginBottom: 12 }}>
            {EXAMPLES.map((example) => (
              <button
                key={example.name}
                className="chip accent"
                style={{ cursor: "pointer", fontFamily: "inherit" }}
                onClick={() => {
                  setName(example.name);
                  setDescription(example.description);
                }}
              >
                {example.name}
              </button>
            ))}
          </div>

          <div className="field">
            <span>How hard should it try?</span>
            <div className="chips" style={{ marginTop: 2 }}>
              {PROFILES.map((option) => (
                <button
                  key={option.id}
                  className={`chip ${profile === option.id ? "accent" : ""}`}
                  style={{ cursor: "pointer", fontFamily: "inherit" }}
                  onClick={() => setProfile(option.id)}
                  title={option.hint}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <small style={{ color: "var(--muted)", display: "block", marginTop: 7 }}>
              {PROFILES.find((option) => option.id === profile)?.hint}
            </small>
          </div>

          <button
            className="power"
            onClick={start}
            disabled={busy || name.trim().length < 3 || description.trim().length < 15}
          >
            {busy ? <Busy label="Starting…" /> : <>{Icon.sparkle} Build it</>}
          </button>
          {description.trim().length > 0 && description.trim().length < 15 ? (
            <small style={{ color: "var(--muted)", display: "block", marginTop: 8 }}>
              A sentence or two gets a much better result than a few words.
            </small>
          ) : null}
        </section>

        {builds.loading && list.length === 0 ? <Skeleton rows={2} /> : null}

        {live.length > 0 ? <div className="section-title">Building now</div> : null}
        {live.map((build) => {
          const expanded = open === build.buildId;
          return (
            <div key={build.buildId} className="card">
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span className={`pill ${stateTone(build.state)}`} style={{ marginTop: 7 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 15.5, display: "block" }}>{build.projectName}</strong>
                  <small style={{ color: "var(--muted)" }}>Started {ago(build.startedAt)}</small>
                  <BuildLive buildId={build.buildId} initial={build} />
                  <div className="chips" style={{ marginTop: 9 }}>
                    <span className="chip accent">quality {Math.round(build.qualityScore)}</span>
                    {build.state === "paused" ? <span className="chip">paused</span> : null}
                    {build.guidance.length > 0 ? (
                      <span className="chip">{build.guidance.length} instruction{build.guidance.length === 1 ? "" : "s"}</span>
                    ) : null}
                  </div>

                  <label className="field" style={{ marginTop: 13 }}>
                    <span>Tell it something while it works</span>
                    <textarea
                      rows={2}
                      value={guidance[build.buildId] ?? ""}
                      onChange={(event) => setGuidance((current) => ({ ...current, [build.buildId]: event.target.value }))}
                      placeholder="e.g. Use dark colours, and add a page for opening hours."
                    />
                  </label>

                  <div className="btn-row">
                    <button className="btn" onClick={() => steer(build)} disabled={busy || !(guidance[build.buildId] ?? "").trim()}>
                      {Icon.sparkle} Send instruction
                    </button>
                    <button className="btn" onClick={() => control(build, build.state === "paused" ? "resume" : "pause")} disabled={busy}>
                      {build.state === "paused" ? Icon.power : Icon.pause} {build.state === "paused" ? "Resume" : "Pause"}
                    </button>
                    <button className="btn" onClick={() => control(build, "stop")} disabled={busy}>
                      Stop
                    </button>
                    <button className="btn" onClick={() => setOpen(expanded ? null : build.buildId)}>
                      {expanded ? "Hide passes" : "Show passes"}
                    </button>
                  </div>

                  {build.guidance.length > 0 ? (
                    <div style={{ marginTop: 12 }}>
                      <small style={{ color: "var(--muted)" }}>What you have told it</small>
                      {build.guidance.map((note, index) => (
                        <div key={index} style={{ marginTop: 6, fontSize: 13.5 }}>
                          <span style={{ color: "var(--muted)" }}>
                            {note.appliedAtIteration === null ? "from the next pass" : `from pass ${note.appliedAtIteration}`} ·{" "}
                          </span>
                          {note.text}
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {expanded ? (
                    <div style={{ marginTop: 13 }}>
                      {build.iterationDetail.slice().reverse().map((pass) => (
                        <div key={pass.iteration} style={{ padding: "9px 0", borderTop: "1px solid var(--line)" }}>
                          <strong style={{ fontSize: 13.5 }}>Pass {pass.iteration}</strong>
                          <span style={{ color: "var(--muted)", fontSize: 13 }}> · quality {Math.round(pass.qualityScore)} · {pass.status}</span>
                          {pass.improvements.length > 0 ? (
                            <ul style={{ margin: "6px 0 0 18px", padding: 0, fontSize: 13, color: "var(--muted)" }}>
                              {pass.improvements.slice(0, 4).map((improvement, index) => (
                                <li key={index}>{improvement}</li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {done.length > 0 ? <div className="section-title">Earlier builds</div> : null}
        {done.map((build) => (
          <div key={build.buildId} className="card">
            <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
              <span className={`pill ${stateTone(build.state)}`} style={{ marginTop: 7 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ fontSize: 15.5, display: "block" }}>{build.projectName}</strong>
                <small style={{ color: "var(--muted)" }}>
                  {build.state} · {build.iterations} pass{build.iterations === 1 ? "" : "es"} ·{" "}
                  {build.finishedAt ? ago(build.finishedAt) : ago(build.startedAt)}
                </small>
                {build.error ? <Banner kind="error">{build.error}</Banner> : null}
                <div className="chips" style={{ marginTop: 8 }}>
                  <span className="chip accent">quality {Math.round(build.qualityScore)}</span>
                  <span className="chip">{build.outputDir}</span>
                </div>
              </div>
            </div>
          </div>
        ))}

        {!builds.loading && list.length === 0 ? (
          <div className="empty">Nothing built yet. Describe something above and it gets going.</div>
        ) : null}
      </div>
    </>
  );
}
