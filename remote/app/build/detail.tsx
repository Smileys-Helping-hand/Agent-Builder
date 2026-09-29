"use client";

import { useMemo, useState } from "react";

import { api, type Build, type BuildEvent, type BuildProfile, type BuildThought } from "@/lib/api";
import { isLive, useActivity } from "../activity";
import { Banner, Busy, CopyButton, Freshness, Header, Icon, Meter, Skeleton, ago, duration, useRemote, useToast } from "../ui";
import { QUICK_STEERS, WritingPane } from "./writing";
import { PreviewPane } from "../preview";
import { BuildProgress, CHECK_LABEL, Checks, StateBadge, Stepper, bestPass, describe, latestPass } from "./parts";

const EVENT_TONE: Partial<Record<BuildEvent["kind"], string>> = {
  error: "bad",
  warn: "warn",
  done: "good",
  lesson: "good",
  guidance: "accent",
  score: ""
};

const THOUGHT_LABEL: Record<BuildThought["kind"], { label: string; tone: string }> = {
  plan: { label: "plan", tone: "accent" },
  lesson: { label: "memory", tone: "good" },
  check: { label: "checks", tone: "" },
  critique: { label: "review", tone: "warn" },
  repair: { label: "fix", tone: "warn" },
  review: { label: "next", tone: "accent" },
  decision: { label: "decision", tone: "" }
};

/** One entry in the thinking feed: long text folds, so the feed stays scannable. */
const Thought = ({ thought }: { thought: BuildThought }) => {
  const [open, setOpen] = useState(false);
  const { label, tone } = THOUGHT_LABEL[thought.kind] ?? { label: thought.kind, tone: "" };
  const failed = thought.kind === "check" && /fails/.test(thought.title);
  const long = thought.text.length > 280;
  return (
    <div className="thought">
      <div className="thought-head">
        <span className={`tag ${failed ? "bad" : thought.kind === "check" ? "good" : tone}`}>{label}</span>
        <strong>{thought.title}</strong>
        <time>{new Date(thought.at).toLocaleTimeString()}</time>
      </div>
      {thought.text ? (
        <div className={`thought-text ${thought.kind === "check" ? "mono" : ""} ${long && !open ? "clamped" : ""}`}>{thought.text}</div>
      ) : null}
      {long ? (
        <button className="link" onClick={() => setOpen((value) => !value)}>
          {open ? "Less" : "More"}
        </button>
      ) : null}
      {thought.files?.length ? (
        <div className="chips" style={{ marginTop: 6 }}>
          {thought.files.slice(0, 12).map((file) => (
            <span key={file} className="chip mono">
              {file}
            </span>
          ))}
          {thought.files.length > 12 ? <span className="chip">+{thought.files.length - 12}</span> : null}
        </div>
      ) : null}
    </div>
  );
};

const PROFILES: Array<{ id: BuildProfile; label: string }> = [
  { id: "fast", label: "Fast" },
  { id: "balanced", label: "Balanced" },
  { id: "deep", label: "Deep" }
];

export const BuildDetail = ({ id, onBack, onOpen }: { id: string; onBack: () => void; onOpen: (id: string) => void }) => {
  const toast = useToast();
  const activity = useActivity();
  const fromList = activity.builds.find((build) => build.buildId === id) ?? null;
  // The single-build route has everything; poll it quickly only while it runs.
  const detail = useRemote(() => api.build(id), fromList && !isLive(fromList) ? 0 : 2500, `build.${id}`);
  const build: Build | null = detail.data ?? fromList;

  const [busy, setBusy] = useState<string | null>(null);
  const [steer, setSteer] = useState("");
  const [instruction, setInstruction] = useState("");
  const [profile, setProfile] = useState<BuildProfile | null>(null);
  const [showAllEvents, setShowAllEvents] = useState(false);
  const [showAllThoughts, setShowAllThoughts] = useState(false);
  const [openPass, setOpenPass] = useState<number | null>(null);
  const [files, setFiles] = useState<{ list: string[]; total: number; exists: boolean } | null>(null);
  const [viewing, setViewing] = useState<{ path: string; content: string; truncated: boolean } | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const events = useMemo(() => (build?.events ?? []).slice().reverse(), [build?.events]);
  const thoughts = useMemo(() => (build?.thoughts ?? []).slice().reverse(), [build?.thoughts]);

  if (!build) {
    return (
      <>
        <Header title="Build" sub="Loading…" back={onBack} />
        <div className="wrap">
          {detail.error && !detail.loading ? (
            <Banner kind="error">{detail.error === "Unknown build." ? "This build is no longer on the builder's list." : detail.error}</Banner>
          ) : (
            <Skeleton rows={4} />
          )}
        </div>
      </>
    );
  }

  const live = isLive(build);
  const { label, tone } = describe(build);
  const best = bestPass(build);
  const latest = latestPass(build);
  const score = live ? build.qualityScore : build.bestScore ?? build.qualityScore;
  const blocker = (live ? latest : best)?.blocker ?? null;

  const act = async (name: string, action: () => Promise<void>) => {
    setBusy(name);
    try {
      await action();
      await Promise.all([detail.refresh(), activity.refresh()]);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const loadFiles = () =>
    act("files", async () => {
      const result = await api.buildFiles(build.buildId);
      setFiles({ list: result.files, total: result.total ?? result.files.length, exists: result.exists });
    });

  const viewFile = (path: string) =>
    act(`file:${path}`, async () => {
      const result = await api.buildFile(build.buildId, path);
      setViewing({ path, content: result.content, truncated: result.truncated });
    });

  return (
    <>
      <Header title={build.projectName} sub={label} state={live ? "busy" : tone === "bad" ? "down" : tone === "warn" ? "warn" : "up"} back={onBack} />

      <div className="wrap">
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <Freshness updatedAt={detail.updatedAt ?? activity.updatedAt} fresh={detail.fresh || activity.fresh} error={detail.error} />
        </div>

        {/* ---------- where it stands ---------- */}
        <section className={`hero ${tone === "good" ? "good" : tone === "bad" ? "bad" : ""}`}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <div className="hero-label">{live ? "Building now" : "Result"}</div>
            <StateBadge build={build} />
          </div>
          <div className="big-score">
            {Math.round(score)}
            <small>/100{build.qualityThreshold ? ` · target ${build.qualityThreshold}` : ""}</small>
          </div>
          {live ? <BuildProgress build={build} /> : <Meter value={score} target={build.qualityThreshold} />}
          {!live ? (
            <p className="hero-sub" style={{ marginTop: 10 }}>
              {build.outcome ?? (build.error ? `Failed: ${build.error}` : `${label}.`)}
            </p>
          ) : null}
          {live ? <Stepper stage={build.stage} attempt={build.repairAttempt} /> : null}

          <div className="mini-stats">
            <div>
              <b>{build.iterations}</b>
              <span>passes</span>
            </div>
            <div>
              <b>{duration(build.startedAt, live ? null : build.finishedAt)}</b>
              <span>{live ? "so far" : "took"}</span>
            </div>
            <div>
              <b style={{ textTransform: "capitalize" }}>{build.profile ?? "—"}</b>
              <span>effort</span>
            </div>
          </div>

          {live ? (
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                className="btn"
                disabled={Boolean(busy)}
                onClick={() =>
                  act("pause", async () => {
                    if (build.state === "paused") await api.resumeBuild(build.buildId);
                    else await api.pauseBuild(build.buildId);
                    toast(build.state === "paused" ? "Resumed" : "Paused — the GPU is free until you resume", "ok");
                  })
                }
              >
                {busy === "pause" ? <Busy label="…" /> : build.state === "paused" ? <>{Icon.play} Resume</> : <>{Icon.pause} Pause</>}
              </button>
              {confirmStop ? (
                <>
                  <button
                    className="btn danger"
                    disabled={Boolean(busy)}
                    onClick={() =>
                      act("stop", async () => {
                        await api.stopBuild(build.buildId);
                        setConfirmStop(false);
                        toast("Stopped. You can continue it later.", "ok");
                      })
                    }
                  >
                    {busy === "stop" ? <Busy label="Stopping" /> : <>{Icon.stop} Yes, stop it</>}
                  </button>
                  <button className="btn ghost" onClick={() => setConfirmStop(false)}>
                    Keep going
                  </button>
                </>
              ) : (
                <button className="btn" disabled={Boolean(busy)} onClick={() => setConfirmStop(true)}>
                  {Icon.stop} Stop
                </button>
              )}
            </div>
          ) : null}
        </section>

        {detail.error && detail.data ? <Banner kind="error">{detail.error}</Banner> : null}

        {/* On a wide screen the preview sits beside everything else, so you
            can watch what it is making and what it is thinking at once. */}
        <div className="detail-grid">
        <aside className="detail-side">
          {/* ---------- what it has made, live ---------- */}
          <div className="section-title">{live ? "Live preview — updates after every pass" : "Preview"}</div>
          <div className="card">
            <PreviewPane kind="build" id={build.buildId} refreshKey={`${build.iterations}-${build.state}-${build.qualityScore}`} title={`${build.projectName} preview`} />
          </div>
        </aside>
        <div className="detail-main">

        {/* ---------- what it is writing, token by token ---------- */}
        {live ? (
          <>
            <div className="section-title">Watching it write — live</div>
            <WritingPane writing={build.writing} stage={build.stage} />
          </>
        ) : null}

        {/* ---------- what it is thinking ---------- */}
        {thoughts.length > 0 ? (
          <>
            <div className="section-title">{live ? "What it is thinking — live" : "How it thought it through"}</div>
            <div className={`card thoughts ${live ? "live" : ""}`}>
              {(showAllThoughts ? thoughts : thoughts.slice(0, 8)).map((thought, index) => (
                <Thought key={`${thought.at}-${index}`} thought={thought} />
              ))}
              {thoughts.length > 8 ? (
                <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setShowAllThoughts((value) => !value)}>
                  {showAllThoughts ? "Show less" : `Show all ${thoughts.length}`}
                </button>
              ) : null}
            </div>
          </>
        ) : live ? (
          <div className="card">
            <div className="empty">Waiting for its first thoughts — the model is writing the first pass.</div>
          </div>
        ) : null}

        {/* ---------- steer it, or carry on ---------- */}
        {live ? (
          <div className="card">
            <h2>Tell it something while it works</h2>
            <p className="hint">It joins the instructions from the next pass and stays for the rest of the build.</p>
            <div className="chips" style={{ marginBottom: 10 }}>
              {QUICK_STEERS.map((quick) => (
                <button key={quick.label} className={`chip ${steer === quick.text ? "accent" : ""}`} onClick={() => setSteer(quick.text)}>
                  {quick.label}
                </button>
              ))}
            </div>
            <textarea
              rows={2}
              value={steer}
              onChange={(event) => setSteer(event.target.value)}
              placeholder="e.g. Use dark colours, and add a page for opening hours."
            />
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                disabled={Boolean(busy) || !steer.trim()}
                onClick={() =>
                  act("steer", async () => {
                    await api.guideBuild(build.buildId, steer.trim());
                    setSteer("");
                    toast("Noted. It takes effect on the next pass.", "ok");
                  })
                }
              >
                {busy === "steer" ? <Busy label="Sending" /> : <>{Icon.sparkle} Send instruction</>}
              </button>
            </div>
          </div>
        ) : (
          <div className="card">
            <h2>Carry on with it</h2>
            <p className="hint">
              Starts a new build in the same folder, from the best code this one left
              {blocker ? `, and tells it what still fails (${CHECK_LABEL[blocker.name] ?? blocker.name})` : ""}.
            </p>
            <textarea
              rows={2}
              value={instruction}
              onChange={(event) => setInstruction(event.target.value)}
              placeholder={blocker ? "Optional — e.g. Make the tests pass, then add a contact page." : "What should it do next? (optional)"}
            />
            <div className="chips" style={{ marginTop: 10 }}>
              {PROFILES.map((option) => (
                <button
                  key={option.id}
                  className={`chip ${((profile ?? build.profile ?? "balanced") === option.id) ? "accent" : ""}`}
                  onClick={() => setProfile(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <button
                className="btn primary"
                disabled={Boolean(busy)}
                onClick={() =>
                  act("continue", async () => {
                    const result = await api.continueBuild(build.buildId, {
                      instruction: instruction.trim() || undefined,
                      profile: profile ?? undefined
                    });
                    setInstruction("");
                    toast("Carrying on. Follow it here.", "ok");
                    onOpen(result.buildId);
                  })
                }
              >
                {busy === "continue" ? <Busy label="Starting" /> : <>{Icon.play} Continue building</>}
              </button>
            </div>
          </div>
        )}

        {/* ---------- why it is not done ---------- */}
        {blocker ? (
          <div className="card">
            <h2>
              {live ? "What the last pass tripped on" : "Why it is not passing yet"}: {CHECK_LABEL[blocker.name] ?? blocker.name}
            </h2>
            <p className="hint">The end of what the {blocker.name} check printed.</p>
            <pre className="log">{blocker.output || "(no output)"}</pre>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <CopyButton text={blocker.output} label="Copy error" />
            </div>
          </div>
        ) : null}

        {/* ---------- instructions given ---------- */}
        {build.guidance.length > 0 ? (
          <div className="card">
            <h2>What you have told it</h2>
            {build.guidance.map((note, index) => (
              <div key={index} className="row">
                <span className="pill up" />
                <div className="body">
                  <strong style={{ fontWeight: 560 }}>{note.text}</strong>
                  <span>
                    {note.appliedAtIteration === null ? "from the next pass" : `from pass ${note.appliedAtIteration}`} · {ago(note.at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {/* ---------- passes ---------- */}
        <div className="section-title">Passes</div>
        {build.iterationDetail.length === 0 ? (
          <div className="card">
            <div className="empty">{live ? "The first pass is still being written." : "No pass finished."}</div>
          </div>
        ) : (
          <div className="card">
            {build.iterationDetail
              .slice()
              .reverse()
              .map((pass) => {
                const expanded = openPass === pass.iteration;
                const isBest = best?.iteration === pass.iteration;
                return (
                  <div key={pass.iteration} className="pass">
                    <button className="pass-head" onClick={() => setOpenPass(expanded ? null : pass.iteration)}>
                      <span className={`pass-score ${pass.qualityScore >= 80 ? "good" : pass.qualityScore >= 50 ? "warn" : "bad"}`}>
                        {Math.round(pass.qualityScore)}
                      </span>
                      <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                        <strong>
                          Pass {pass.iteration}
                          {isBest ? <span className="chip accent" style={{ marginLeft: 8 }}>best</span> : null}
                        </strong>
                        <Checks checks={pass.checks} compact />
                      </div>
                      <small className="muted">{pass.at ? ago(pass.at) : ""}</small>
                    </button>
                    {expanded ? (
                      <div className="pass-body fade-in">
                        {pass.files ? <p className="muted small">{pass.files} file(s) written</p> : null}
                        {pass.improvements.length > 0 ? (
                          <>
                            <p className="muted small" style={{ marginBottom: 4 }}>What it decided to improve</p>
                            <ul>
                              {pass.improvements.map((improvement, index) => (
                                <li key={index}>{improvement}</li>
                              ))}
                            </ul>
                          </>
                        ) : null}
                        {pass.blocker ? (
                          <>
                            <p className="muted small" style={{ marginBottom: 4 }}>{CHECK_LABEL[pass.blocker.name] ?? pass.blocker.name} failed with</p>
                            <pre className="log small">{pass.blocker.output.slice(-1500)}</pre>
                          </>
                        ) : pass.passed ? (
                          <p className="small" style={{ color: "var(--good)" }}>Every check passed on this pass.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
          </div>
        )}

        {/* ---------- activity ---------- */}
        {events.length > 0 ? (
          <>
            <div className="section-title">What happened</div>
            <div className="card">
              {(showAllEvents ? events : events.slice(0, 12)).map((event, index) => (
                <div key={`${event.at}-${index}`} className="feed-item">
                  <span className={`tag ${EVENT_TONE[event.kind] ?? ""}`}>{event.kind}</span>
                  <div className="text">
                    <p>{event.message}</p>
                    <time>{new Date(event.at).toLocaleString()}</time>
                  </div>
                </div>
              ))}
              {events.length > 12 ? (
                <button className="btn ghost small" style={{ marginTop: 10 }} onClick={() => setShowAllEvents((value) => !value)}>
                  {showAllEvents ? "Show less" : `Show all ${events.length}`}
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {/* ---------- files ---------- */}
        <div className="section-title">Files</div>
        <div className="card">
          <div className="row" style={{ borderTop: "none", paddingTop: 0 }}>
            <div className="body">
              <strong>Folder on the PC</strong>
              <span className="mono">{build.outputDir}</span>
            </div>
          </div>
          <div className="btn-row">
            <button className="btn" disabled={Boolean(busy)} onClick={loadFiles}>
              {busy === "files" ? <Busy label="Loading" /> : <>{Icon.file} {files ? "Refresh files" : "Show files"}</>}
            </button>
            <button
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => act("editor", async () => toast((await api.openBuild(build.buildId, "editor")).message, "ok"))}
            >
              {Icon.code} Open in VS Code
            </button>
            <button
              className="btn"
              disabled={Boolean(busy)}
              onClick={() => act("folder", async () => toast((await api.openBuild(build.buildId, "folder")).message, "ok"))}
            >
              {Icon.folder} Open folder
            </button>
            <CopyButton text={build.outputDir} label="Copy path" />
          </div>

          {files ? (
            files.exists ? (
              <div className="file-list fade-in">
                {files.list.length === 0 ? <div className="empty">No files yet.</div> : null}
                {files.list.map((path) => (
                  <button key={path} className={`file ${viewing?.path === path ? "on" : ""}`} onClick={() => viewFile(path)}>
                    {Icon.file}
                    <span>{path}</span>
                  </button>
                ))}
                {files.total > files.list.length ? <small className="muted">…and {files.total - files.list.length} more</small> : null}
              </div>
            ) : (
              <Banner kind="info">The folder is not there any more.</Banner>
            )
          ) : null}

          {viewing ? (
            <div className="fade-in" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "space-between" }}>
                <strong className="mono" style={{ fontSize: 13 }}>{viewing.path}</strong>
                <div className="btn-row">
                  <CopyButton text={viewing.content} />
                  <button className="btn small ghost" onClick={() => setViewing(null)}>
                    Close
                  </button>
                </div>
              </div>
              <pre className="log code">{viewing.content}</pre>
              {viewing.truncated ? <small className="muted">Only the start of a large file is shown.</small> : null}
            </div>
          ) : null}
        </div>

        {/* ---------- what it was asked ---------- */}
        <div className="section-title">What it was asked for</div>
        <div className="card">
          <p className="prose">{build.description}</p>
          <div className="chips">
            <span className="chip">started {new Date(build.startedAt).toLocaleString()}</span>
            <span className="chip">by {build.startedBy}</span>
            {build.orderId ? <span className="chip accent">order {build.orderId}</span> : null}
            {build.continuedFrom ? (
              <button className="chip accent" onClick={() => onOpen(build.continuedFrom!)}>
                carries on from an earlier build
              </button>
            ) : null}
            <span className="chip mono">{build.buildId}</span>
          </div>
          {!live ? (
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button
                className="btn ghost small"
                disabled={Boolean(busy)}
                onClick={() =>
                  act("forget", async () => {
                    if (!window.confirm("Remove this build from the list? Its folder stays on the PC.")) return;
                    await api.forgetBuild(build.buildId);
                    toast("Removed from the list. The folder is still on the PC.", "ok");
                    onBack();
                  })
                }
              >
                {Icon.trash} Remove from list
              </button>
            </div>
          ) : null}
        </div>
        </div>
        </div>
      </div>
    </>
  );
};
