"use client";

/**
 * Training: how the agents are learning, and the knowledge they share with Jarvis.
 *
 * Each agent tries a few ways of working (how the chat explains, how lessons
 * teach, how a build plans), is rewarded by what actually happened (your
 * 👍/👎, your first quiz score, the build's score) and shifts towards what
 * works — Thompson sampling, so it keeps exploring while it is unsure. Every
 * rewarded answer is kept as training data for fine-tuning the model itself.
 */
import Link from "next/link";
import { useState } from "react";

import { api, type KnowledgeSearchResult } from "@/lib/api";
import { Banner, Busy, Header, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";

const SOURCE: Record<string, string> = {
  quiz: "first quiz score",
  "build-outcome": "build score",
  "app-rating": "your rating",
  "jarvis-rating": "told to Jarvis",
  unusable: "unusable output"
};

/** Training the model's own weights (QLoRA SFT, then DPO) on what was rewarded. */
function FineTunePanel() {
  const toast = useToast();
  const status = useRemote(() => api.fineTune(), 10000, "finetune");
  const [busy, setBusy] = useState(false);
  const s = status.data;
  const start = async (check: boolean) => {
    setBusy(true);
    try {
      await api.startFineTune(check);
      toast(check ? "Checking the training stack: a few real steps on a small model." : "Training started. Builds and research wait while it has the graphics card.", "ok");
      await status.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };
  const last = s?.running ?? s?.jobs[0] ?? null;
  const loss = last?.events.find((e) => e.event === "sft-done") as { loss_first?: number; loss_last?: number } | undefined;
  return (
    <div className="card">
      <p className="small" style={{ marginTop: 0 }}>
        Trains a LoRA adapter for the local model on the rewarded answers (supervised), then on your preferences (DPO). It needs 50
        rewarded answers to be worth it, and the whole graphics card while it runs. {s ? s.detail : ""}
      </p>
      <div className="learn-plan">
        <button className="btn" disabled={busy || !s?.ready || Boolean(s?.running)} onClick={() => void start(true)}>
          Check the training stack
        </button>
        <button className="btn primary" disabled={busy || !s?.ready || Boolean(s?.running)} onClick={() => void start(false)}>
          Fine-tune now
        </button>
      </div>
      {last ? (
        <p className="small">
          {last.check ? "Stack check" : "Training"} {ago(last.startedAt)}: <b>{last.state}</b>
          {loss?.loss_first !== undefined ? ` · loss ${loss.loss_first.toFixed(3)} → ${loss.loss_last?.toFixed(3)}` : ""}
          {last.state === "not-enough-data" ? " · not enough rewarded answers yet" : ""}
          {last.error ? <span className="bad-text"> · {last.error.slice(0, 300)}</span> : null}
          {last.out ? <span className="muted"> · adapter in {last.out}</span> : null}
        </p>
      ) : null}
    </div>
  );
}

export default function Training() {
  const connected = useConnected();
  const toast = useToast();
  const stats = useRemote(() => api.rlStats(), 15000, "rl-stats");
  const sync = useRemote(() => api.knowledgeStatus(), 30000, "knowledge-status");
  const [exporting, setExporting] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<KnowledgeSearchResult | null>(null);

  if (connected === false) return <NotConnected />;

  const policies = stats.data?.policies ?? [];
  const recent = stats.data?.recent ?? [];
  const rewarded = policies.reduce((n, p) => n + p.rewarded, 0);

  const exportData = async () => {
    setExporting(true);
    try {
      const res = await api.rlExport();
      toast(`Wrote ${res.sft} best answers and ${res.dpo} preference pairs to ${res.dir}.`, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setExporting(false);
    }
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      setResults(await api.knowledgeSearch(query.trim()));
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setSearching(false);
    }
  };

  return (
    <>
      <Header
        title="Training"
        sub={policies.length ? `${rewarded} rewarded tries across ${policies.length} agents` : "How the agents learn"}
        state={stats.error ? "down" : rewarded > 0 ? "up" : "warn"}
      />
      <div className="wrap">
        <div className="section-title">How the agents are learning</div>
        <p className="muted small" style={{ marginTop: 0 }}>
          Each agent tries a few ways of working and is rewarded by what actually happened. It keeps trying the others while it is unsure,
          and settles on what works. Rate answers and lessons to teach them faster. Agent Builder's own level, new abilities and practice
          are on its <Link href="/agent">agent page</Link>.
        </p>
        {!stats.data ? (
          stats.error ? <Banner kind="error">{stats.error}</Banner> : <Skeleton rows={3} />
        ) : (
          <div className="rl-grid">
            {policies.map((policy) => {
              const leader = [...policy.arms].sort((a, b) => b.chanceBest - a.chanceBest)[0];
              return (
                <div key={policy.id} className="card rl-card">
                  <div className="rl-head">
                    <strong>{policy.label}</strong>
                    <span className="tag info">{policy.rewarded} rewarded</span>
                  </div>
                  <small className="muted">Rewarded by {policy.reward}</small>
                  {policy.trend && policy.trend.recent !== null ? (
                    <div className="small">
                      Average outcome of the last {Math.min(20, policy.trend.decided)} tries: <b>{Math.round(policy.trend.recent * 100)}%</b>
                      {policy.trend.earlier !== null
                        ? ` (the ${policy.trend.decided - 20} before: ${Math.round(policy.trend.earlier * 100)}%) ${policy.trend.recent > policy.trend.earlier + 0.02 ? "▲ getting better" : policy.trend.recent < policy.trend.earlier - 0.02 ? "▼ worse lately" : "＝ steady"}`
                        : ""}
                    </div>
                  ) : null}
                  {policy.arms.map((arm) => (
                    <div key={arm.id} className="rl-arm">
                      <div className="rl-arm-label">
                        <span>
                          {arm.label}
                          {policy.rewarded >= 5 && arm.id === leader.id ? <b className="tag ok" style={{ marginLeft: 6 }}>leading</b> : null}
                        </span>
                        <small className="muted">
                          {arm.tries} tries · {arm.averageReward === null ? "no rewards yet" : `avg ${Math.round(arm.averageReward * 100)}%`}
                        </small>
                      </div>
                      <div className="rl-bar" title={`${Math.round(arm.chanceBest * 100)}% chance it is the best approach right now`}>
                        <i style={{ width: `${Math.round(arm.chanceBest * 100)}%` }} />
                      </div>
                    </div>
                  ))}
                  <small className="muted">Bar: the chance each approach is the best, from what it has seen so far.</small>
                </div>
              );
            })}
          </div>
        )}

        {recent.length ? (
          <>
            <div className="section-title">Latest tries</div>
            <div className="card">
              {recent.slice(0, 12).map((episode) => (
                <div key={episode.id} className="row">
                  <div className="body">
                    <strong>{policies.find((p) => p.id === episode.policy)?.label ?? episode.policy}</strong>
                    <small className="muted">
                      {" "}
                      · {policies.find((p) => p.id === episode.policy)?.arms.find((a) => a.id === episode.arm)?.label ?? episode.arm}
                      {episode.bucket !== "*" ? ` · ${episode.bucket}` : ""} · {ago(episode.createdAt)}
                    </small>
                  </div>
                  <span className={`tag ${episode.reward === null ? "" : episode.reward >= 0.6 ? "ok" : episode.reward >= 0.3 ? "warn" : "bad"}`}>
                    {episode.reward === null
                      ? "waiting for its reward"
                      : `${Math.round(episode.reward * 100)}% · ${episode.rewards.map((r) => SOURCE[r.source] ?? r.source).join(", ")}`}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <div className="section-title">Training data</div>
        <div className="card">
          <p className="small" style={{ marginTop: 0 }}>
            Every rewarded answer and lesson is kept. Export writes the best ones (for supervised fine-tuning) and pairs of answers to the
            same question where you preferred one (for preference training, DPO) as JSONL in data/rl/. These are the formats TRL and Unsloth
            read. Use <em>Answer differently</em> in a research chat and rate both answers to make preference pairs.
          </p>
          <button className="btn" disabled={exporting} onClick={() => void exportData()}>
            {exporting ? <Busy label="Exporting…" /> : "Export training data"}
          </button>
        </div>

        <div className="section-title">Fine-tune the model</div>
        <FineTunePanel />


        <div className="section-title">Knowledge shared with Jarvis</div>
        <div className="card">
          {sync.data ? (
            <p className="small" style={{ marginTop: 0 }}>
              {sync.data.reachable ? "Jarvis is connected." : "Jarvis is not reachable right now."} {sync.data.queue.synced} documents (reports,
              study guides, lessons) are in his knowledge base
              {sync.data.queue.pending + sync.data.queue.retrying ? `, ${sync.data.queue.pending + sync.data.queue.retrying} waiting to go` : ""}.
              He searches all of the builder's knowledge, and the builder reads what he knows about you when it teaches and builds.
            </p>
          ) : (
            <Skeleton rows={1} />
          )}
          <form
            className="learn-plan"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <input className="input" style={{ flex: 1, minWidth: 220 }} value={query} placeholder="Search everything both know…" onChange={(e) => setQuery(e.target.value)} />
            <button className="btn primary" type="submit" disabled={searching || !query.trim()}>
              {searching ? <Busy label="Searching…" /> : "Search"}
            </button>
          </form>
          {results ? (
            <div className="rl-results">
              <strong>Agent Builder ({results.local.length})</strong>
              {results.local.length ? (
                <ul>
                  {results.local.slice(0, 10).map((hit) => (
                    <li key={`${hit.kind}:${hit.refId}`}>
                      <b>{hit.title || hit.kind}</b> <small className="muted">({hit.kind})</small> — {hit.snippet.replace(/[«»]/g, "")}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">Nothing yet.</p>
              )}
              <strong>Jarvis</strong>
              {!results.jarvis.ok ? (
                <p className="muted small">{results.jarvis.detail}</p>
              ) : results.jarvis.memories.length + results.jarvis.documents.length === 0 ? (
                <p className="muted small">Nothing on that.</p>
              ) : (
                <ul>
                  {results.jarvis.memories.map((m, i) => (
                    <li key={`m${i}`}>
                      <small className="muted">({m.kind})</small> {m.content}
                    </li>
                  ))}
                  {results.jarvis.documents.map((d, i) => (
                    <li key={`d${i}`}>
                      <b>{d.title}</b> <small className="muted">(from {d.source})</small> — {d.passage}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
