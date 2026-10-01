"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, usePersistentState, useRemote, useToast } from "../ui";
import { LearningPanel } from "./learning";
import { LearningReportCard } from "./report";
import { TopicWorkspace } from "./workspace";

const SUGGESTIONS = [
  "Running LLMs well on an 8GB GPU",
  "Making Next.js apps load faster",
  "Keeping SQLite fast as data grows"
];

export default function Research() {
  const connected = useConnected();
  const toast = useToast();
  const topics = useRemote(() => api.topics(), 8000);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = usePersistentState<string | null>("research-open", null);
  const [fullscreen, setFullscreen] = useState(false);
  const [formOpen, setFormOpen] = usePersistentState<boolean | null>("research-form-open", null);
  const [search, setSearch] = useState("");

  if (connected === false) return <NotConnected />;

  const start = async () => {
    setBusy(true);
    try {
      const { topic } = await api.startResearch(title.trim(), question.trim() || title.trim());
      setTitle("");
      setQuestion("");
      toast("Started. It keeps going until you stop it.", "ok");
      await topics.refresh();
      setOpenId(topic.id);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, running: boolean, name: string) => {
    setBusy(true);
    try {
      await (running ? api.pauseTopic(id) : api.resumeTopic(id));
      toast(`${name} ${running ? "paused" : "resumed"}`, "ok");
      await topics.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const list = topics.data?.topics ?? [];
  const running = list.filter((topic) => topic.status === "running").length;
  const findings = list.reduce((total, topic) => total + topic.findingCount, 0);
  const showForm = formOpen ?? list.length === 0;
  const term = search.trim().toLowerCase();
  const shown = term ? list.filter((topic) => `${topic.title} ${topic.question}`.toLowerCase().includes(term)) : list;

  return (
    <>
      <Header
        title="Research"
        sub={list.length ? `${running} of ${list.length} running · ${findings} findings` : "Nothing running yet"}
        state={topics.error ? "down" : running > 0 ? "up" : "warn"}
      />

      <div className="wrap">
        {topics.error ? <Banner kind="error">{topics.error}</Banner> : null}

        {showForm ? (
          <section className="hero">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
              <div>
                <div className="hero-label">New topic</div>
                <h2 className="hero-title">What do you want to know?</h2>
              </div>
              {list.length > 0 ? (
                <button className="btn small ghost" onClick={() => setFormOpen(false)}>
                  Hide
                </button>
              ) : null}
            </div>
            <p className="hero-sub">It reads, checks every claim against its source, and writes study notes. It never stops on its own.</p>

            <label className="field" style={{ marginTop: 16 }}>
              <span>Topic</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Running LLMs on 8GB GPUs" />
            </label>

            <div className="chips" style={{ marginBottom: 12 }}>
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} className="chip accent" style={{ cursor: "pointer", fontFamily: "inherit" }} onClick={() => setTitle(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>

            <label className="field">
              <span>A specific question gets sharper answers (optional)</span>
              <textarea rows={2} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="What actually works, and what are the trade-offs?" />
            </label>

            <button className="power" onClick={start} disabled={busy || title.trim().length < 3}>
              {busy ? <Busy label="Starting…" /> : <>{Icon.sparkle} Start researching</>}
            </button>
          </section>
        ) : (
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={() => setFormOpen(true)}>
              {Icon.sparkle} New topic
            </button>
          </div>
        )}

        <LearningReportCard />

        {topics.loading && list.length === 0 ? <Skeleton rows={3} /> : null}

        {list.length > 0 ? (
          <div className="section-title" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span>Topics</span>
            {list.length > 3 ? (
              <input className="ws-search" style={{ marginLeft: "auto", maxWidth: 240 }} placeholder="Find a topic" value={search} onChange={(event) => setSearch(event.target.value)} />
            ) : null}
          </div>
        ) : null}

        {shown.map((topic) => {
          const isRunning = topic.status === "running";
          const open = openId === topic.id;
          return (
            <div key={topic.id} className={`card ws-card ${open ? "open" : ""}`}>
              <button className="ws-card-head" onClick={() => setOpenId(open ? null : topic.id)} aria-expanded={open}>
                <span className={`pill ${isRunning ? "up" : "degraded"}`} style={{ marginTop: 7 }} />
                <span style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <strong style={{ fontSize: 15.5, display: "block" }}>{topic.title}</strong>
                  <small style={{ color: "var(--muted)" }}>
                    {topic.cycleRunning ? "Researching right now" : isRunning ? "Running" : topic.status === "paused" ? "Paused" : "Stopped"}
                    {topic.lastCycleAt ? ` · last cycle ${ago(topic.lastCycleAt)}` : ""}
                  </small>
                  <span className="chips" style={{ marginTop: 7, display: "flex" }}>
                    <span className="chip accent">{topic.findingCount} findings</span>
                    <span className="chip">{topic.corroboratedCount} confirmed</span>
                    <span className="chip">{topic.sourceCount} sources</span>
                    <span className="chip">{topic.documentCount} documents</span>
                  </span>
                </span>
                <span className={`ws-chevron ${open ? "up" : ""}`} aria-hidden="true">
                  ▾
                </span>
              </button>

              {!open ? (
                <div className="btn-row" style={{ marginTop: 12 }}>
                  <button className="btn small" onClick={() => toggle(topic.id, isRunning, topic.title)} disabled={busy}>
                    {isRunning ? <>{Icon.pause} Pause</> : <>{Icon.power} Resume</>}
                  </button>
                  <button
                    className="btn small"
                    onClick={() => {
                      setOpenId(topic.id);
                      setFullscreen(true);
                    }}
                  >
                    {Icon.external} Open full screen
                  </button>
                </div>
              ) : (
                <TopicWorkspace
                  id={topic.id}
                  fullscreen={fullscreen}
                  onToggleFullscreen={() => setFullscreen((value) => !value)}
                  onChanged={() => void topics.refresh()}
                  onDeleted={() => {
                    setFullscreen(false);
                    setOpenId(null);
                    void topics.refresh();
                  }}
                />
              )}
            </div>
          );
        })}

        {term && shown.length === 0 ? <div className="empty">No topic matches “{search}”.</div> : null}

        <div className="section-title">What the builder has learned</div>
        <LearningPanel />
      </div>
    </>
  );
}
