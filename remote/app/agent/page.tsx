"use client";

/**
 * Agent Builder as an agent: who it is and how it is growing, a conversation
 * with it, its training ground, and continuous improvement with approvals.
 * Everything shown is counted from what it has really done.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api, type AgentMessage, type ChatPending, type ImproveCandidate } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";

type Tab = "growth" | "talk" | "ground" | "continuous";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "growth", label: "Growth" },
  { id: "talk", label: "Talk" },
  { id: "ground", label: "Training ground" },
  { id: "continuous", label: "Continuous & approvals" }
];

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

export default function AgentPage() {
  const connected = useConnected();
  const profile = useRemote(() => api.agentProfile(), 20000, "agent-profile");
  const [tab, setTab] = useState<Tab>("growth");
  if (connected === false) return <NotConnected />;
  const p = profile.data;

  return (
    <>
      <Header
        title={p ? `Agent Builder · Level ${p.level}` : "Agent Builder"}
        sub={p ? `${p.title} · ${p.xp} XP · ${p.doing.line}` : "Your builder, as an agent that grows"}
        state={profile.error ? "down" : p?.doing.busy ? "up" : "warn"}
      />
      <div className="wrap">
        <div className="ws-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="fade-in" key={tab} style={{ marginTop: 14 }}>
          {tab === "growth" ? <Growth profile={profile} /> : null}
          {tab === "talk" ? <Talk /> : null}
          {tab === "ground" ? <Ground /> : null}
          {tab === "continuous" ? <Continuous /> : null}
        </div>
      </div>
    </>
  );
}

function Growth({ profile }: { profile: ReturnType<typeof useRemote<Awaited<ReturnType<typeof api.agentProfile>>>> }) {
  const p = profile.data;
  if (!p) return profile.error ? <Banner kind="error">{profile.error}</Banner> : <Skeleton rows={4} />;
  const into = p.xp - p.levelXp;
  const span = Math.max(1, p.nextLevelXp - p.levelXp);
  const b = p.strength.builds;
  const growth = p.growth.length > 1 ? p.growth : [];
  const max = Math.max(1, ...growth.map((g) => g.xp));
  return (
    <>
      <div className="card agent-hero">
        <div className="agent-badge" aria-hidden="true">
          <span>{p.level}</span>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <strong style={{ fontSize: 18 }}>{p.title}</strong>
          <div className="muted small">
            {p.xp} XP · {p.nextLevelXp - p.xp} to level {p.level + 1}
          </div>
          <div className="learn-bar" style={{ marginTop: 8 }}>
            <i style={{ width: `${Math.round((into / span) * 100)}%` }} />
          </div>
          <div className="small" style={{ marginTop: 8 }}>
            {p.doing.parts.length ? p.doing.parts.join(" · ") : "Ready for work"}
          </div>
        </div>
      </div>

      <div className="section-title">Is it getting stronger?</div>
      <div className="rl-grid">
        <div className="card rl-card">
          <strong>Builds</strong>
          <div className="small">
            Last {b.recent}: <b>{pct(b.passRate)}</b> passed{b.passRateBefore !== null ? ` (the 20 before: ${pct(b.passRateBefore)})` : ""}
          </div>
          <div className="small">
            Average best score: <b>{b.averageScore === null ? "—" : Math.round(b.averageScore)}</b>
            {b.averageScoreBefore !== null ? ` (before: ${Math.round(b.averageScoreBefore)})` : ""}
          </div>
        </div>
        {p.strength.policies.map((pol) => (
          <div key={pol.id} className="card rl-card">
            <strong>{pol.label}</strong>
            <div className="small">
              {pol.leader ? (
                <>
                  Learned: <b>{pol.leader}</b> works best ({pct(pol.confidence)} sure)
                </>
              ) : (
                "Still exploring"
              )}{" "}
              · {pol.rewarded} rewarded tries
            </div>
          </div>
        ))}
      </div>
      <p className="muted small">
        Every way of working it is learning, with the training data for fine-tuning the model itself: <Link href="/training">Training</Link>
      </p>

      {growth.length ? (
        <>
          <div className="section-title">Growth over time</div>
          <div className="card">
            <svg viewBox={`0 0 ${Math.max(growth.length - 1, 1) * 10} 60`} preserveAspectRatio="none" className="agent-chart" role="img" aria-label="XP over time">
              <polyline fill="none" strokeWidth="2" points={growth.map((g, i) => `${i * 10},${58 - (g.xp / max) * 54}`).join(" ")} />
            </svg>
            <div className="muted small">
              {ago(growth[0].at)}: {growth[0].xp} XP → now: {p.xp} XP
            </div>
          </div>
        </>
      ) : null}

      <div className="section-title">Abilities</div>
      <div className="agent-abilities">
        {p.abilities.map((a) => (
          <div key={a.id} className={`card agent-ability ${a.ready ? "" : "off"}`}>
            <div className="rl-head">
              <strong>{a.label}</strong>
              {a.isNew ? <span className="tag ok">new</span> : null}
            </div>
            <small className="muted">
              {a.area}
              {a.since ? ` · since ${new Date(a.since).toLocaleDateString()}` : " · just added"}
              {a.uses !== null ? ` · used ${a.uses}×` : ""}
              {!a.ready && a.note ? ` · ${a.note}` : ""}
            </small>
          </div>
        ))}
      </div>

      <div className="section-title">Where its XP comes from</div>
      <div className="card">
        {p.sources.map((s) => (
          <div key={s.label} className="row">
            <div className="body">{s.label}</div>
            <span className="muted small">
              {s.count} → {s.xp} XP
            </span>
          </div>
        ))}
      </div>
    </>
  );
}

function Talk() {
  const toast = useToast();
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [pending, setPending] = useState<ChatPending | null>(null);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState("");
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void api
      .agentChat()
      .then((res) => {
        setMessages(res.messages);
        if (res.pending) {
          setPending(res.pending);
          setSending(true);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!sending) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await api.agentChat();
        if (stopped) return;
        setMessages(res.messages);
        setPending(res.pending);
        if (!res.pending) return setSending(false);
      } catch {
        // keep trying; the answer is kept on the PC either way
      }
      if (!stopped) timer = setTimeout(tick, 1500);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sending]);

  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [messages.length, pending?.partial.length]);

  const send = async (words: string) => {
    const clean = words.trim();
    if (!clean || sending) return;
    setSending(true);
    setText("");
    try {
      const res = await api.agentSay(clean);
      setMessages((m) => [...m, res.question]);
      setPending(res.pending);
    } catch (error) {
      setSending(false);
      setText(clean);
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  const act = async (message: AgentMessage) => {
    try {
      const res = await api.agentAct(message.id);
      toast(res.summary, res.ok ? "ok" : "error");
      const fresh = await api.agentChat();
      setMessages(fresh.messages);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  };

  return (
    <div className="talk">
      <div className="talk-thread" aria-live="polite">
        {messages.length === 0 && !sending ? (
          <div className="talk-empty">
            <strong>Talk with Agent Builder</strong>
            <p>Ask what it is working on, what it has learned, how it would improve your project — or ask it to do something.</p>
          </div>
        ) : null}
        {messages.map((m) => (
          <div key={m.id} className={`talk-msg ${m.role === "you" ? "you" : "research"}`}>
            <div className="talk-bubble">
              {m.text.split(/\n{2,}/).map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>
            {m.action ? (
              m.result ? (
                <small className={m.result.status < 400 ? "ok-text" : "bad-text"}>
                  {m.action.label}: {m.result.summary}
                </small>
              ) : (
                <button className="btn small primary" onClick={() => void act(m)}>
                  {Icon.sparkle} Do it: {m.action.label}
                </button>
              )
            ) : null}
            {m.from === "jarvis" && m.role === "you" ? <small className="muted">via Jarvis</small> : null}
          </div>
        ))}
        {sending ? (
          <div className="talk-msg research">
            {pending?.partial ? (
              <div className="talk-bubble">
                {pending.partial.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>{para}</p>
                ))}
                <span className="talk-caret" aria-hidden="true">▍</span>
              </div>
            ) : (
              <>
                <div className="talk-bubble talk-typing" aria-label="Thinking">
                  <i />
                  <i />
                  <i />
                </div>
                <small className="muted">{pending && pending.queueAhead > 0 ? `Waiting for the PC's model (${pending.queueAhead} ahead) · ${pending.seconds}s` : "Thinking…"}</small>
              </>
            )}
          </div>
        ) : null}
        <div ref={end} />
      </div>
      <div className="chips" style={{ marginTop: 8 }}>
        {["How are you doing?", "What have you learned lately?", "What are your newest abilities?", "What should we improve next?"].map((s) => (
          <button key={s} className="chip accent" disabled={sending} onClick={() => void send(s)}>
            {s}
          </button>
        ))}
      </div>
      <form
        className="talk-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <textarea
          rows={2}
          value={text}
          placeholder="Say something to Agent Builder…"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <button className="btn primary" type="submit" disabled={sending || !text.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

function Ground() {
  const toast = useToast();
  const ground = useRemote(() => api.ground(), 15000, "agent-ground");
  const [busy, setBusy] = useState<string | null>(null);
  const g = ground.data;
  if (!g) return ground.error ? <Banner kind="error">{ground.error}</Banner> : <Skeleton rows={4} />;

  const run = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try {
      await fn();
      toast(ok, "ok");
      await ground.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="card">
        <p className="small" style={{ marginTop: 0 }}>
          When the PC is idle it practises the challenge it is weakest at — up to {g.dailyLimit} a day — and learns from every try: its
          build approach is rewarded by the score, every fix becomes a lesson, every win is XP.{" "}
          {g.running ? <b>Practising now.</b> : `${g.today} practice build${g.today === 1 ? "" : "s"} today.`}
        </p>
        <div className="learn-plan">
          <button className="btn primary" disabled={busy !== null || Boolean(g.running)} onClick={() => void run("now", () => api.groundPractise(), "Practising its weakest challenge.")}>
            {busy === "now" ? <Busy label="Starting…" /> : "Practise now"}
          </button>
          <button className="btn" disabled={busy !== null} onClick={() => void run("toggle", () => api.groundEnabled(!g.enabled), g.enabled ? "Practice on its own is off." : "It practises when the PC is idle.")}>
            {g.enabled ? "Pause practising on its own" : "Let it practise on its own"}
          </button>
          <button className="btn ghost" disabled={busy !== null} onClick={() => void run("harder", () => api.groundHarder(), "Added harder challenges.")}>
            {busy === "harder" ? <Busy label="Thinking up harder ones…" /> : "Harder challenges"}
          </button>
        </div>
      </div>
      <div className="section-title">Challenges</div>
      <div className="card">
        {g.challenges
          .slice()
          .sort((a, b) => a.level - b.level)
          .map((c) => (
            <div key={c.id} className="row">
              <div className="body">
                <strong>{c.title}</strong> <small className="muted">· level {c.level}</small>
                <div className="muted small">{c.brief}</div>
              </div>
              <span className={`tag ${c.best === null ? "" : c.best >= 90 ? "ok" : c.best >= 60 ? "warn" : "bad"}`}>
                {c.tries ? `best ${c.best ?? 0} · ${c.wins}/${c.tries} won` : "not tried"}
              </span>
              <button className="btn small ghost" disabled={busy !== null || Boolean(g.running)} onClick={() => void run(c.id, () => api.groundPractise(c.id), `Practising ${c.title}.`)}>
                Try
              </button>
            </div>
          ))}
      </div>
    </>
  );
}

function Continuous() {
  const toast = useToast();
  const data = useRemote(() => api.continuous(), 10000, "agent-continuous");
  const projects = useRemote(() => api.projects(), 0, "projects");
  const [projectId, setProjectId] = useState("");
  const [focus, setFocus] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [diff, setDiff] = useState<{ id: string; text: string } | null>(null);

  const act = async (label: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(label);
    try {
      await fn();
      toast(ok, "ok");
      await data.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const sessions = data.data?.sessions ?? [];
  const candidates = data.data?.candidates ?? [];
  const waiting = candidates.filter((c) => c.state === "awaiting" || c.state === "conflict");
  const done = candidates.filter((c) => !["awaiting", "conflict"].includes(c.state)).slice(0, 20);

  return (
    <>
      <div className="card">
        <p className="small" style={{ marginTop: 0 }}>
          Pick a project and it keeps making it better, around the clock, until you stop it. Every change is built and tested on a copy;
          nothing touches the project until you approve it below — then it is applied and committed on the project's live branch.
        </p>
        <div className="learn-plan">
          <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
            <option value="">Choose a project…</option>
            {(projects.data?.projects ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 200 }} value={focus} placeholder="What to concentrate on (optional)" onChange={(e) => setFocus(e.target.value)} />
          <button className="btn primary" disabled={!projectId || busy !== null} onClick={() => void act("start", () => api.continuousStart(projectId, focus), "Improving it continuously. Changes will wait here for you.")}>
            Improve continuously
          </button>
        </div>
      </div>

      {sessions.length ? (
        <>
          <div className="section-title">Projects being improved</div>
          <div className="card">
            {sessions.map((s) => (
              <div key={s.id} className="row">
                <div className="body">
                  <strong>{s.projectName}</strong>{" "}
                  <small className="muted">
                    · {s.state} · {s.cycles} cycles · branch {s.liveBranch ?? "?"} · since {ago(s.startedAt)}
                  </small>
                  <div className="muted small">
                    {s.phase}
                    {s.focus ? ` · focus: ${s.focus}` : ""}
                    {s.lastError ? ` · last problem: ${s.lastError}` : ""}
                  </div>
                </div>
                {s.state !== "stopped" ? (
                  <button className="btn small danger" disabled={busy !== null} onClick={() => void act(s.id, () => api.continuousStop(s.id), "Stopped.")}>
                    Stop
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      <div className="section-title">Waiting for your approval · {waiting.length}</div>
      {waiting.length === 0 ? <p className="muted small">Nothing waiting.</p> : null}
      {waiting.map((c) => (
        <Approval key={c.id} c={c} busy={busy} diff={diff} setDiff={setDiff} act={act} />
      ))}

      {done.length ? (
        <>
          <div className="section-title">History</div>
          <div className="card">
            {done.map((c) => (
              <div key={c.id} className="row">
                <div className="body">
                  <strong>{c.title}</strong> <small className="muted">· {c.projectName} · {ago(c.createdAt)}</small>
                  {c.note ? <div className="muted small">{c.note}</div> : null}
                </div>
                <span className={`tag ${c.state === "approved" ? "ok" : c.state === "rejected" || c.state === "failed" ? "bad" : "info"}`}>
                  {c.state === "approved" && c.commit ? `approved · ${c.commit.hash.slice(0, 7)} on ${c.commit.branch}` : c.state}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function Approval({
  c,
  busy,
  diff,
  setDiff,
  act
}: {
  c: ImproveCandidate;
  busy: string | null;
  diff: { id: string; text: string } | null;
  setDiff: (d: { id: string; text: string } | null) => void;
  act: (label: string, fn: () => Promise<unknown>, ok: string) => Promise<void>;
}) {
  const toast = useToast();
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="rl-head">
        <strong>{c.title}</strong>
        <span className="tag info">{c.kind}</span>
      </div>
      <div className="small">{c.why}</div>
      <div className="muted small">
        {c.projectName} · {c.files.length} file{c.files.length === 1 ? "" : "s"}: {c.files.slice(0, 6).join(", ")}
        {c.test ? ` · checks ${c.test.passed ? "passed" : "failed"}${c.test.score !== null ? ` (score ${Math.round(c.test.score)})` : ""}` : ""}
      </div>
      {c.state === "conflict" && c.note ? <Banner kind="error">{c.note}</Banner> : null}
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          className="btn small"
          onClick={() =>
            diff?.id === c.id
              ? setDiff(null)
              : void api
                  .approvalDiff(c.id)
                  .then((r) => setDiff({ id: c.id, text: r.diff }))
                  .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"))
          }
        >
          {diff?.id === c.id ? "Hide changes" : "See the changes"}
        </button>
        <button className="btn small primary" disabled={busy !== null} onClick={() => void act(`ok-${c.id}`, () => api.approve(c.id), "Approved: applied and committed.")}>
          {busy === `ok-${c.id}` ? <Busy label="Applying…" /> : "Approve & merge"}
        </button>
        <button className="btn small ghost" disabled={busy !== null} onClick={() => void act(`no-${c.id}`, () => api.reject(c.id), "Rejected.")}>
          Reject
        </button>
      </div>
      {diff?.id === c.id ? <pre className="agent-diff">{diff.text || "(no changes)"}</pre> : null}
    </div>
  );
}
