"use client";

/**
 * What the builder taught itself: fixes the Stuck Doctor worked out when a
 * build kept failing the same way, kept so the next build is fixed at once.
 */
import { useState } from "react";

import { api, type PlaybookEntry } from "@/lib/api";
import { Busy, Skeleton, ago, useRemote, useToast } from "../ui";

export function LearnedFixes() {
  const toast = useToast();
  const playbook = useRemote(() => api.playbook(), 60000, "playbook");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const forget = async (entry: PlaybookEntry) => {
    setBusy(entry.id);
    try {
      await api.forgetFix(entry.id);
      toast("Forgotten", "ok");
      void playbook.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const entries = playbook.data?.entries ?? [];
  return (
    <section className="card">
      <h2>What it taught itself</h2>
      <p className="hint">
        When a build keeps failing the same way, it stops rewriting the code, finds out why (the installed packages, Stack Overflow, GitHub issues), tries fixes and keeps only what works. Each one is
        remembered here and used straight away the next time.
      </p>
      {playbook.loading && !playbook.data ? <Skeleton rows={2} /> : null}
      {!playbook.loading && entries.length === 0 ? <p className="muted small">Nothing yet: it learns the first time a build gets stuck.</p> : null}
      {entries.map((entry) => (
        <div key={entry.id} className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <span className={`pill ${entry.failed > entry.worked ? "degraded" : "up"}`} style={{ marginTop: 6 }} />
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <strong style={{ display: "block", overflowWrap: "anywhere" }}>{entry.cause || entry.pattern}</strong>
            <small style={{ color: "var(--muted)", overflowWrap: "anywhere" }}>
              {entry.code} · worked {entry.worked}× {entry.failed ? `· failed ${entry.failed}× ` : ""}· {ago(entry.lastUsedAt ?? entry.createdAt)}
            </small>
            {open === entry.id ? (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <div className="muted small" style={{ overflowWrap: "anywhere" }}>When: {entry.pattern}</div>
                <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
                  {entry.steps.map((step) => (
                    <li key={step} style={{ overflowWrap: "anywhere" }}>{step}</li>
                  ))}
                </ul>
                {entry.evidence.length ? (
                  <div className="muted small" style={{ overflowWrap: "anywhere" }}>
                    Found in:{" "}
                    {entry.evidence.map((source, i) => (
                      <span key={source}>
                        {i ? ", " : ""}
                        {/^https:\/\//.test(source) ? (
                          <a href={source} target="_blank" rel="noreferrer">
                            {new URL(source).hostname.replace(/^www\./, "")}
                          </a>
                        ) : (
                          source
                        )}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn small ghost" onClick={() => setOpen(open === entry.id ? null : entry.id)}>
              {open === entry.id ? "Less" : "How"}
            </button>
            <button className="btn small" disabled={busy !== null} onClick={() => void forget(entry)}>
              {busy === entry.id ? <Busy label="…" /> : "Forget"}
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
