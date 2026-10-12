"use client";

/**
 * The Template Academy: the builder teaching itself new website templates.
 * Ideas are practised (built, carried on, started over) until one scores
 * 100 and meets the template contract; then it graduates as a hidden draft
 * you can preview and publish with a price. It practises when the PC is
 * idle, and suggests new ideas itself when it runs out.
 */
import { useState } from "react";

import { api, type AcademyIdea } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, useConnected, useRemote, useToast } from "../ui";

const STATUS: Record<AcademyIdea["status"], { label: string; tone: string }> = {
  idea: { label: "Waiting to practise", tone: "" },
  practising: { label: "Practising", tone: "accent" },
  graduated: { label: "Graduated: ready to publish", tone: "accent" },
  published: { label: "On sale", tone: "" },
  parked: { label: "Parked", tone: "warn" }
};

const OUTCOME: Record<string, string> = {
  running: "building now",
  passed: "passed",
  short: "short of 100",
  failed: "failed",
  stopped: "stepped aside for an order"
};

function IdeaCard({ idea, onChange }: { idea: AcademyIdea; onChange: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [price, setPrice] = useState("4500");
  const act = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    try {
      await fn();
      toast(done);
      onChange();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };
  const status = STATUS[idea.status];
  const last = idea.attempts[idea.attempts.length - 1];
  return (
    <article className="card academy-card">
      <div className="academy-head">
        <span className="academy-icon" aria-hidden="true">
          {idea.icon}
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3 style={{ margin: 0 }}>{idea.name}</h3>
          <p className="muted small" style={{ margin: "2px 0 0" }}>
            {idea.category} · {idea.from === "academy" ? "its own idea" : "your idea"}
          </p>
        </div>
        <span className={`chip ${status.tone}`}>{status.label}</span>
      </div>

      <div className="academy-score" aria-label={`Best score ${idea.bestScore} of 100`}>
        <span style={{ width: `${Math.min(100, idea.bestScore)}%` }} />
      </div>
      <p className="muted small" style={{ margin: "6px 0 0" }}>
        Best {idea.bestScore}/100 · {idea.attempts.length} attempt{idea.attempts.length === 1 ? "" : "s"}
        {last ? ` · last: ${last.kind}, ${OUTCOME[last.outcome] ?? last.outcome}${last.score !== null ? ` at ${last.score}` : ""}` : ""}
      </p>
      {last?.failing.length ? <p className="muted small" style={{ margin: "4px 0 0" }}>Holding it back: {last.failing.slice(0, 4).join(", ")}</p> : null}
      {idea.note ? <p className="small" style={{ margin: "6px 0 0" }}>{idea.note}</p> : null}

      <div className="btn-row" style={{ marginTop: 12 }}>
        {idea.status === "idea" || idea.status === "parked" || (idea.status === "practising" && last?.outcome !== "running") ? (
          <button className="btn small primary" disabled={busy !== null} onClick={() => act("practise", () => api.academyPractise(idea.id), "Practising now.")}>
            {busy === "practise" ? <Busy label="Starting…" /> : <>{Icon.play} Practise now</>}
          </button>
        ) : null}
        {idea.status === "graduated" ? (
          <>
            <input className="academy-price" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} aria-label="Price in rand" />
            <button
              className="btn small primary"
              disabled={busy !== null || !price}
              onClick={() => act("publish", () => api.academyPublish(idea.id, Number(price)), "Published: it is in the shop.")}
            >
              {busy === "publish" ? <Busy label="Publishing…" /> : <>{Icon.check} Publish at R{price}</>}
            </button>
          </>
        ) : null}
        {idea.status !== "published" ? (
          <button
            className="btn small ghost"
            disabled={busy !== null}
            onClick={() => window.confirm(`Remove "${idea.name}" from the academy?`) && act("remove", () => api.academyRemove(idea.id), "Removed.")}
          >
            {Icon.trash} Remove
          </button>
        ) : null}
      </div>
    </article>
  );
}

export default function Academy() {
  const connected = useConnected();
  const toast = useToast();
  const academy = useRemote(() => api.academy(), 20000, "academy");
  const [name, setName] = useState("");
  const [brief, setBrief] = useState("");
  const [mustHave, setMustHave] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  if (connected === false) return <NotConnected />;
  const data = academy.data;

  const add = async () => {
    setBusy("add");
    try {
      await api.academyAdd({ name, brief, mustHave: mustHave.split("\n").map((line) => line.trim()).filter(Boolean) });
      setName("");
      setBrief("");
      setMustHave("");
      toast("Added. It practises when the PC is free.");
      void academy.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const propose = async () => {
    setBusy("propose");
    try {
      const { ideas } = await api.academyPropose(3);
      toast(ideas.length ? `New ideas: ${ideas.map((idea) => idea.name).join(", ")}` : "No new ideas this time.");
      void academy.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const ideas = data?.ideas ?? [];
  const order: AcademyIdea["status"][] = ["graduated", "practising", "idea", "parked", "published"];
  const sorted = [...ideas].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));

  return (
    <>
      <Header title="Template Academy" sub="New templates, practised until they score 100" state={data?.running.length ? "busy" : data?.enabled ? "up" : "warn"} />
      <div className="wrap">
        {data && !data.enabled ? <Banner kind="info">The academy is switched off on the PC (ACADEMY=off).</Banner> : null}
        {data ? (
          <section className="card">
            <div className="academy-stats">
              <div>
                <strong>{data.running.length ? "Practising" : "Idle"}</strong>
                <span className="muted small">{data.running.map((r) => r.idea).join(", ") || "practises when the PC is free"}</span>
              </div>
              <div>
                <strong>
                  {data.practisedToday}/{data.dailyLimit}
                </strong>
                <span className="muted small">practice builds today</span>
              </div>
              <div>
                <strong>{(data.counts.graduated ?? 0) + (data.counts.published ?? 0)}</strong>
                <span className="muted small">graduated</span>
              </div>
            </div>
          </section>
        ) : academy.loading ? (
          <Skeleton rows={2} />
        ) : null}

        <h2 className="section-title">Templates in training</h2>
        {sorted.length === 0 && data ? <p className="muted">No ideas yet. Add one below, or let it suggest some.</p> : null}
        {sorted.map((idea) => (
          <IdeaCard key={idea.id} idea={idea} onChange={() => academy.refresh()} />
        ))}

        <section className="card">
          <h2>Teach it a new template</h2>
          <p className="hint">What kind of business, and what its site must do. It practises until the template scores 100, then asks you to publish it.</p>
          <label className="field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Law Firm" />
          </label>
          <label className="field">
            <span>What it is for</span>
            <textarea rows={3} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="A site for a small law firm: practice areas, the attorneys, fees and a consultation request." />
          </label>
          <label className="field">
            <span>Must have (one per line)</span>
            <textarea rows={3} value={mustHave} onChange={(e) => setMustHave(e.target.value)} placeholder={"Practice areas\nConsultation request form"} />
          </label>
          <div className="btn-row">
            <button className="btn primary" disabled={busy !== null || name.trim().length < 3 || brief.trim().length < 10} onClick={add}>
              {busy === "add" ? <Busy label="Adding…" /> : <>{Icon.sparkle} Add to the academy</>}
            </button>
            <button className="btn ghost" disabled={busy !== null} onClick={propose}>
              {busy === "propose" ? <Busy label="Thinking…" /> : "Suggest ideas"}
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
