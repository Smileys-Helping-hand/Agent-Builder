"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, useConnected, useRemote, useToast } from "../ui";

const SUGGESTIONS = [
  "Running LLMs well on an 8GB GPU",
  "Making Next.js apps load faster",
  "Keeping SQLite fast as data grows"
];

export default function Research() {
  const connected = useConnected();
  const toast = useToast();
  const topics = useRemote(() => api.topics(), 30000);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);

  if (connected === false) return <NotConnected />;

  const start = async () => {
    setBusy(true);
    try {
      await api.startResearch(title.trim(), question.trim() || title.trim());
      setTitle("");
      setQuestion("");
      toast("Started. It keeps going until you stop it.", "ok");
      await topics.refresh();
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

  return (
    <>
      <Header
        title="Research"
        sub={list.length ? `${running} of ${list.length} running · ${findings} findings` : "Nothing running yet"}
        state={topics.error ? "down" : running > 0 ? "up" : "warn"}
      />

      <div className="wrap">
        {topics.error ? <Banner kind="error">{topics.error}</Banner> : null}

        <section className="hero">
          <div className="hero-label">New topic</div>
          <h2 className="hero-title">What do you want to know?</h2>
          <p className="hero-sub">
            It reads, checks every claim against its source, and writes study notes. It never stops on its own.
          </p>

          <label className="field" style={{ marginTop: 16 }}>
            <span>Topic</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Running LLMs on 8GB GPUs" />
          </label>

          <div className="chips" style={{ marginBottom: 12 }}>
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                className="chip accent"
                style={{ cursor: "pointer", fontFamily: "inherit" }}
                onClick={() => setTitle(suggestion)}
              >
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

        {topics.loading && list.length === 0 ? <Skeleton rows={3} /> : null}

        {list.length > 0 ? <div className="section-title">Topics</div> : null}

        {list.map((topic) => {
          const isRunning = topic.status === "running";
          return (
            <div key={topic.id} className="card">
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span className={`pill ${isRunning ? "up" : "degraded"}`} style={{ marginTop: 7 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 15.5, display: "block" }}>{topic.title}</strong>
                  <div className="chips" style={{ marginTop: 7 }}>
                    <span className="chip accent">{topic.findingCount} findings</span>
                    <span className="chip">{topic.corroboratedCount} confirmed</span>
                    <span className="chip">{topic.sourceCount} sources</span>
                    <span className="chip">{topic.documentCount} documents</span>
                  </div>
                  <div className="btn-row" style={{ marginTop: 12 }}>
                    <button className="btn small" onClick={() => toggle(topic.id, isRunning, topic.title)} disabled={busy}>
                      {isRunning ? <>{Icon.pause} Pause</> : <>{Icon.power} Resume</>}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
