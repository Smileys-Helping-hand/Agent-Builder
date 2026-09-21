"use client";

import { useState } from "react";

import { api } from "@/lib/api";
import { Banner, Busy, Header, NotConnected, useConnected, useRemote } from "../ui";

export default function Research() {
  const connected = useConnected();
  const topics = useRemote(() => api.topics(), 30000);
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (connected === false) return <NotConnected />;

  const start = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api.startResearch(title.trim(), question.trim() || title.trim());
      setTitle("");
      setQuestion("");
      setMessage({ kind: "ok", text: "Started. It will keep going until you stop it." });
      await topics.refresh();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, running: boolean) => {
    setBusy(true);
    try {
      await (running ? api.pauseTopic(id) : api.resumeTopic(id));
      await topics.refresh();
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const list = topics.data?.topics ?? [];

  return (
    <>
      <Header title="Research" sub={list.length ? `${list.length} topic(s)` : "Nothing running yet"} />
      <div className="wrap">
        {topics.error ? <Banner kind="error">{topics.error}</Banner> : null}

        <div className="card">
          <h2>Research something</h2>
          <p className="hint">It reads, checks every claim against its source, and writes study notes. It never stops on its own.</p>
          <label className="field">
            <span>Topic</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Running LLMs on 8GB GPUs"
            />
          </label>
          <label className="field">
            <span>What do you want to know? (optional)</span>
            <textarea
              rows={3}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="A specific question gets sharper answers."
            />
          </label>
          <button className="btn primary" onClick={start} disabled={busy || title.trim().length < 3}>
            {busy ? <Busy label="Starting…" /> : "Start research"}
          </button>
          {message ? <Banner kind={message.kind}>{message.text}</Banner> : null}
        </div>

        {list.map((topic) => {
          const running = topic.status === "running";
          return (
            <div key={topic.id} className="card">
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span className={`pill ${running ? "up" : "degraded"}`} style={{ marginTop: 7 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 15 }}>{topic.title}</strong>
                  <p className="hint" style={{ margin: "4px 0 10px" }}>
                    {topic.findingCount} findings ({topic.corroboratedCount} confirmed) · {topic.sourceCount} sources ·{" "}
                    {topic.documentCount} documents
                  </p>
                  <button className="btn small" onClick={() => toggle(topic.id, running)} disabled={busy}>
                    {running ? "Pause" : "Resume"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {topics.loading ? (
          <div className="empty">
            <Busy label="Loading topics…" />
          </div>
        ) : null}
      </div>
    </>
  );
}
