"use client";

/**
 * Agent Builder as an agent: who it is and how it is growing, a conversation
 * with it, its training ground, and continuous improvement with approvals.
 * Everything shown is counted from what it has really done.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { api, type AgentMessage, type ChatPending, type Delivery, type ImproveCandidate, type ImproveSession, type ReconstructRun } from "@/lib/api";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";

type Tab = "growth" | "talk" | "ground" | "continuous" | "reconstruct";
const TABS: Array<{ id: Tab; label: string }> = [
  { id: "growth", label: "Growth" },
  { id: "talk", label: "Talk" },
  { id: "ground", label: "Training ground" },
  { id: "continuous", label: "Continuous & approvals" },
  { id: "reconstruct", label: "Reconstructor" }
];

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);

/** "72% now (was 45%) ▲": whether a rate went up since the stretch before. */
const trendText = (recent: number | null | undefined, earlier: number | null | undefined) => {
  if (recent === null || recent === undefined) return "not enough tries yet";
  if (earlier === null || earlier === undefined) return `${pct(recent)} so far`;
  const arrow = recent > earlier + 0.02 ? " ▲" : recent < earlier - 0.02 ? " ▼" : " ＝";
  return `${pct(recent)} now (was ${pct(earlier)})${arrow}`;
};

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
          {tab === "reconstruct" ? <Reconstruct /> : null}
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
        {p.strength.continuous && p.strength.continuous.steps > 0 ? (
          <div className="card rl-card">
            <strong>Continuous builder</strong>
            <div className="small">
              Steps that succeed: <b>{trendText(p.strength.continuous.recentSuccess, p.strength.continuous.earlierSuccess)}</b>
            </div>
            <div className="small">
              {p.strength.continuous.steps} steps · {p.strength.continuous.milestonesDone} milestones built
            </div>
          </div>
        ) : null}
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
            {pol.trend && pol.trend.decided > 0 ? <div className="small muted">Average outcome: {trendText(pol.trend.recent, pol.trend.earlier)}</div> : null}
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

const STAGE_LABEL: Record<ImproveSession["stage"], string> = {
  planning: "Planning",
  building: "Building",
  fixing: "Fixing",
  improving: "Improving",
  complete: "Complete"
};

type Act = (label: string, fn: () => Promise<unknown>, ok: string) => Promise<void>;

function Continuous() {
  const toast = useToast();
  const data = useRemote(() => api.continuous(), 10000, "agent-continuous");
  const [busy, setBusy] = useState<string | null>(null);

  const act: Act = async (label, fn, ok) => {
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
  const deliveries = data.data?.deliveries ?? [];
  const legacy = data.data?.candidates ?? [];
  const waiting = deliveries.filter((d) => d.state === "awaiting");
  const waitingLegacy = legacy.filter((c) => c.state === "awaiting" || c.state === "conflict");
  const decided = deliveries.filter((d) => d.state !== "awaiting" && d.state !== "superseded").slice(0, 15);

  return (
    <>
      <StartBuild busy={busy} act={act} />

      <div className="section-title">Waiting for your approval · {waiting.length + waitingLegacy.length}</div>
      {waiting.length + waitingLegacy.length === 0 ? (
        <p className="muted small">Nothing waiting. Work shows up here whenever a workspace is clean and has something new for you.</p>
      ) : null}
      {waiting.map((d) => (
        <DeliveryCard key={d.id} d={d} busy={busy} act={act} />
      ))}
      {waitingLegacy.map((c) => (
        <Approval key={c.id} c={c} busy={busy} act={act} />
      ))}

      {sessions.length ? (
        <>
          <div className="section-title">Projects in the continuous builder</div>
          {sessions.map((s) => (
            <SessionCard key={s.id} s={s} busy={busy} act={act} />
          ))}
        </>
      ) : null}

      {decided.length ? (
        <>
          <div className="section-title">Decided</div>
          <div className="card">
            {decided.map((d) => (
              <div key={d.id} className="row">
                <div className="body">
                  <strong>{d.title}</strong> <small className="muted">· {d.projectName} · {ago(d.decidedAt ?? d.createdAt)}</small>
                  <div className="muted small">
                    {d.applied.length ? `${d.applied.length} file(s) added` : ""}
                    {d.declined.length ? `${d.applied.length ? " · " : ""}${d.declined.length} declined` : ""}
                    {d.note ? ` · ${d.note}` : ""}
                  </div>
                </div>
                <span className={`tag ${d.state === "approved" ? "ok" : d.state === "declined" ? "bad" : "info"}`}>
                  {d.commit ? `${d.state} · ${d.commit.hash.slice(0, 7)} on ${d.commit.branch}` : d.state}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
}

function StartBuild({ busy, act }: { busy: string | null; act: Act }) {
  const projects = useRemote(() => api.projects(), 0, "projects");
  const [kind, setKind] = useState<"existing" | "new">("existing");
  const [projectId, setProjectId] = useState("");
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [mode, setMode] = useState<"complete" | "forever">("forever");
  const [checkCommand, setCheckCommand] = useState("");
  const ready = kind === "existing" ? Boolean(projectId) : name.trim().length > 1 && goal.trim().length >= 10;

  return (
    <div className="card">
      <p className="small" style={{ marginTop: 0 }}>
        Give it a project and a goal, however big, and it works on it around the clock: it plans a roadmap, builds every milestone,
        fixes until every check passes, then keeps researching and improving it if you want. It all happens in its own workspace;
        your project only changes when you approve what it delivers, part by part.
      </p>
      <div className="btn-row" style={{ marginBottom: 8 }}>
        <button className={`btn small ${kind === "existing" ? "primary" : "ghost"}`} onClick={() => setKind("existing")}>
          A project I have
        </button>
        <button className={`btn small ${kind === "new" ? "primary" : "ghost"}`} onClick={() => setKind("new")}>
          A new project from nothing
        </button>
      </div>
      {kind === "existing" ? (
        <select className="input" value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project" style={{ width: "100%" }}>
          <option value="">Choose a project…</option>
          {(projects.data?.projects ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      ) : (
        <input className="input" style={{ width: "100%" }} value={name} placeholder="Name of the new project (e.g. My Linux OS)" onChange={(e) => setName(e.target.value)} />
      )}
      <textarea
        className="input"
        style={{ width: "100%", marginTop: 8, minHeight: 110 }}
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder={
          kind === "new"
            ? "What to build, in as much detail as you like: what it is, what it must do, how you will know it is done…"
            : "The goal and your instructions (optional), e.g. make it a flawless emulator: fix every emulation issue, then performance, then features"
        }
      />
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className={`btn small ${mode === "complete" ? "primary" : "ghost"}`} onClick={() => setMode("complete")}>
          Finish it, then stop
        </button>
        <button className={`btn small ${mode === "forever" ? "primary" : "ghost"}`} onClick={() => setMode("forever")}>
          Finish it, then keep improving forever
        </button>
      </div>
      <input
        className="input"
        style={{ width: "100%", marginTop: 8 }}
        value={checkCommand}
        onChange={(e) => setCheckCommand(e.target.value)}
        placeholder="Check command that must pass (optional, e.g. make, cargo test, npm test); detected when empty"
      />
      <div className="btn-row" style={{ marginTop: 10 }}>
        <button
          className="btn primary"
          disabled={!ready || busy !== null}
          onClick={() =>
            void act(
              "start",
              () =>
                api.continuousStart({
                  ...(kind === "existing" ? { projectId } : { newProject: name }),
                  goal,
                  mode,
                  ...(checkCommand.trim() ? { checkCommand } : {})
                }),
              "Started. It plans first, then builds; deliveries will wait here for you."
            )
          }
        >
          {busy === "start" ? <Busy label="Starting…" /> : "Start the continuous builder"}
        </button>
      </div>
    </div>
  );
}

function SessionCard({ s, busy, act }: { s: ImproveSession; busy: string | null; act: Act }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const done = s.plan.filter((m) => m.status === "done").length;
  const parked = s.plan.filter((m) => m.status === "parked").length;
  const roadmapPct = s.plan.length ? Math.round((done / s.plan.length) * 100) : 0;
  const running = s.state !== "stopped";

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="rl-head">
        <strong>{s.projectName}</strong>
        <span className={`tag ${s.stage === "complete" ? "ok" : running ? "info" : "warn"}`}>
          {STAGE_LABEL[s.stage]}
          {running ? "" : " · stopped"}
        </span>
      </div>
      <div className="muted small">
        {s.mode === "forever" ? "Keeps improving forever" : "Stops when the goal is met"} · {s.cycles} steps · since {ago(s.startedAt)} · branch {s.liveBranch ?? "?"}
      </div>
      <div className="small" style={{ marginTop: 6 }}>
        {s.phase}
      </div>
      {s.lastError ? <div className="muted small">Last problem: {s.lastError}</div> : null}

      {s.plan.length ? (
        <div className="progress compact">
          <div>
            <div className="progress-label">
              <strong>Roadmap</strong>
              <span>
                {done}/{s.plan.length}
                {parked ? ` · ${parked} parked` : ""}
              </span>
            </div>
            <div className={`bar ${running ? "active" : "paused"}`}>
              <i style={{ width: `${roadmapPct}%` }} />
            </div>
          </div>
        </div>
      ) : null}
      {s.progress && s.progress.steps > 0 ? (
        <div className="small" style={{ marginTop: 6 }}>
          Getting better: <b>{trendText(s.progress.recentSuccess, s.progress.earlierSuccess)}</b> of steps succeed
          {s.progress.cleanStreak > 1 ? ` · ${s.progress.cleanStreak} in a row` : ""}
          {s.progress.approved ? ` · ${s.progress.approved} deliveries approved` : ""}
        </div>
      ) : null}
      {s.lastCheck ? (
        <div className="small" style={{ marginTop: 6 }}>
          Checks:{" "}
          {s.lastCheck.passed ? (s.lastCheck.verified ? "all passing" : "none apply yet (add a check command)") : `failing: ${s.lastCheck.failing.join(", ")}`}
          {s.lastCheck.command ? ` (${s.lastCheck.command})` : ""}
        </div>
      ) : null}

      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => setOpen((v) => !v)}>
          {open ? "Less" : "Roadmap, history & settings"}
        </button>
        {running ? (
          <button className="btn small danger" disabled={busy !== null} onClick={() => void act(`stop-${s.id}`, () => api.continuousStop(s.id), "Stopped. Carry on any time from here.")}>
            Stop
          </button>
        ) : (
          <button className="btn small primary" disabled={busy !== null} onClick={() => void act(`go-${s.id}`, () => api.continuousRestart(s.id), "Carrying on from where it got to.")}>
            Carry on
          </button>
        )}
        {s.researchTopicId ? (
          <Link className="btn small ghost" href={`/research?topic=${encodeURIComponent(s.researchTopicId)}`}>
            Its research
          </Link>
        ) : null}
      </div>

      {open ? (
        <div style={{ marginTop: 10 }}>
          {s.goal ? (
            <>
              <div className="muted small">Goal</div>
              <div className="small" style={{ whiteSpace: "pre-wrap" }}>
                {s.goal}
              </div>
            </>
          ) : null}
          {s.notes.length ? (
            <div className="muted small" style={{ marginTop: 6 }}>
              Your later notes: {s.notes.join(" · ")}
            </div>
          ) : null}
          <div className="learn-plan" style={{ marginTop: 8 }}>
            <input className="input" style={{ flex: 1, minWidth: 200 }} value={note} placeholder="A new instruction (the roadmap is revised)" onChange={(e) => setNote(e.target.value)} />
            <button
              className="btn small primary"
              disabled={!note.trim() || busy !== null}
              onClick={() => void act(`note-${s.id}`, () => api.continuousInstruct(s.id, note).then(() => setNote("")), "Noted. The roadmap will be revised.")}
            >
              Send
            </button>
            <button
              className="btn small"
              disabled={busy !== null}
              onClick={() =>
                void act(
                  `mode-${s.id}`,
                  () => api.continuousConfigure(s.id, { mode: s.mode === "forever" ? "complete" : "forever" }),
                  s.mode === "forever" ? "It will stop when the goal is met." : "It will keep improving after the goal is met."
                )
              }
            >
              {s.mode === "forever" ? "Stop when done instead" : "Keep improving forever"}
            </button>
          </div>

          {s.plan.length ? (
            <ol className="small" style={{ paddingLeft: 18, marginTop: 10 }}>
              {s.plan.map((m) => (
                <li key={m.id} style={{ opacity: m.status === "done" ? 0.65 : 1 }}>
                  {m.status === "done" ? "✓ " : m.status === "doing" ? "→ " : m.status === "parked" ? "‖ " : ""}
                  <strong>{m.title}</strong>
                  {m.status === "parked" && m.note ? <span className="muted"> — parked ({m.note}); tried again later</span> : null}
                  {m.attempts > 1 && m.status !== "done" ? <span className="muted"> · {m.attempts} attempts</span> : null}
                </li>
              ))}
            </ol>
          ) : null}

          {s.journal.length ? (
            <>
              <div className="muted small" style={{ marginTop: 8 }}>
                Recent steps
              </div>
              {[...s.journal]
                .reverse()
                .slice(0, 10)
                .map((step, i) => (
                  <div key={`${step.at}-${i}`} className="small">
                    <span className={`tag ${step.outcome === "kept" ? "ok" : step.outcome === "failed" || step.outcome === "rolled-back" ? "bad" : "info"}`}>{step.outcome}</span> {step.title}{" "}
                    <span className="muted">
                      · {ago(step.at)}
                      {step.note ? ` · ${step.note}` : ""}
                    </span>
                  </div>
                ))}
            </>
          ) : null}
          {s.lastCheck && !s.lastCheck.passed ? <pre className="agent-diff">{s.lastCheck.output || "(no output)"}</pre> : null}
        </div>
      ) : null}
    </div>
  );
}

/** Files grouped by their top folder, so a big delivery can be taken in parts. */
const groupOf = (file: string) => (file.includes("/") ? file.slice(0, file.indexOf("/")) : "(top level)");

function DeliveryCard({ d, busy, act }: { d: Delivery; busy: string | null; act: Act }) {
  const toast = useToast();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(d.files.map((f) => f.path)));
  const [diff, setDiff] = useState<{ file: string | null; text: string } | null>(null);
  const [note, setNote] = useState("");
  const groups = new Map<string, Delivery["files"]>();
  for (const f of d.files) groups.set(groupOf(f.path), [...(groups.get(groupOf(f.path)) ?? []), f]);
  const toggle = (files: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const f of files) {
        if (on) next.add(f);
        else next.delete(f);
      }
      return next;
    });
  const show = (file: string | null) => {
    if (diff && diff.file === file) {
      setDiff(null);
      return;
    }
    void api
      .approvalDiff(d.id, file ?? undefined)
      .then((r) => setDiff({ file, text: r.diff }))
      .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
  };
  const lines = d.files.reduce((sum, f) => sum + f.added + f.removed, 0);

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="rl-head">
        <strong>{d.title}</strong>
        <span className={`tag ${d.major ? "warn" : "info"}`}>{d.major ? "Major change" : "Ready"}</span>
      </div>
      <div className="muted small">
        {d.projectName} · {d.files.length} file{d.files.length === 1 ? "" : "s"} · {lines} lines · checks {d.check?.verified ? "passing" : "none apply"} · {ago(d.createdAt)}
      </div>
      {d.major ? <Banner kind="info">Major: {d.majorWhy.join("; ")}. Choose which parts to add to your project.</Banner> : null}
      {d.summary.length ? (
        <ul className="small" style={{ paddingLeft: 18, margin: "8px 0" }}>
          {d.summary.slice(-12).map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : null}

      <div style={{ marginTop: 6 }}>
        {[...groups].map(([group, files]) => {
          const all = files.every((f) => chosen.has(f.path));
          return (
            <details key={group} style={{ marginBottom: 4 }}>
              <summary className="small">
                <label onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={all} onChange={(e) => toggle(files.map((f) => f.path), e.target.checked)} /> <strong>{group}</strong>
                </label>{" "}
                <span className="muted">· {files.length} file(s)</span>
              </summary>
              {files.map((f) => (
                <div key={f.path} className="small" style={{ paddingLeft: 22 }}>
                  <label>
                    <input type="checkbox" checked={chosen.has(f.path)} onChange={(e) => toggle([f.path], e.target.checked)} /> {f.path}
                  </label>{" "}
                  <span className="muted">
                    {f.change} +{f.added} −{f.removed}
                  </span>{" "}
                  <button className="btn small ghost" onClick={() => show(f.path)}>
                    {diff?.file === f.path ? "hide" : "view"}
                  </button>
                </div>
              ))}
            </details>
          );
        })}
      </div>

      <input className="input" style={{ width: "100%", marginTop: 8 }} value={note} placeholder="A note if you decline (it learns from it)" onChange={(e) => setNote(e.target.value)} />
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button className="btn small" onClick={() => show(null)}>
          {diff?.file === null ? "Hide changes" : "All changes"}
        </button>
        <button
          className="btn small primary"
          disabled={busy !== null || chosen.size === 0}
          onClick={() =>
            void act(
              `ok-${d.id}`,
              () => api.approve(d.id, [...chosen]),
              chosen.size === d.files.length ? "Added to your project and committed." : `Added ${chosen.size} file(s); the rest were taken back out of the workspace.`
            )
          }
        >
          {busy === `ok-${d.id}` ? <Busy label="Applying…" /> : chosen.size === d.files.length ? "Add all to my project" : `Add ${chosen.size} of ${d.files.length} parts`}
        </button>
        <button className="btn small ghost" disabled={busy !== null} onClick={() => void act(`no-${d.id}`, () => api.reject(d.id, note), "Declined: taken back out of the workspace.")}>
          Decline
        </button>
      </div>
      {diff ? <pre className="agent-diff">{diff.text || "(no changes)"}</pre> : null}
    </div>
  );
}

/** A single change from the first version of the continuous builder. */
function Approval({ c, busy, act }: { c: ImproveCandidate; busy: string | null; act: Act }) {
  const toast = useToast();
  const [diff, setDiff] = useState<string | null>(null);
  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="rl-head">
        <strong>{c.title}</strong>
        <span className="tag info">{c.kind}</span>
      </div>
      <div className="small">{c.why}</div>
      <div className="muted small">
        {c.projectName} · {c.files.length} file{c.files.length === 1 ? "" : "s"}: {c.files.slice(0, 6).join(", ")}
      </div>
      {c.state === "conflict" && c.note ? <Banner kind="error">{c.note}</Banner> : null}
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          className="btn small"
          onClick={() => {
            if (diff !== null) {
              setDiff(null);
              return;
            }
            void api
              .approvalDiff(c.id)
              .then((r) => setDiff(r.diff))
              .catch((e) => toast(e instanceof Error ? e.message : String(e), "error"));
          }}
        >
          {diff !== null ? "Hide changes" : "See the changes"}
        </button>
        <button className="btn small primary" disabled={busy !== null} onClick={() => void act(`ok-${c.id}`, () => api.approve(c.id), "Approved: applied and committed.")}>
          {busy === `ok-${c.id}` ? <Busy label="Applying…" /> : "Approve & merge"}
        </button>
        <button className="btn small ghost" disabled={busy !== null} onClick={() => void act(`no-${c.id}`, () => api.reject(c.id), "Rejected.")}>
          Reject
        </button>
      </div>
      {diff !== null ? <pre className="agent-diff">{diff || "(no changes)"}</pre> : null}
    </div>
  );
}

/** The Reconstructor: rebuild any app from its blueprint, compare, and learn from what was missed. */
function Reconstruct() {
  const toast = useToast();
  const data = useRemote(() => api.reconstruct(), 15000, "agent-reconstruct");
  const projects = useRemote(() => api.projects(), 0, "projects");
  const [kind, setKind] = useState<"project" | "git">("project");
  const [projectId, setProjectId] = useState("");
  const [gitUrl, setGitUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

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

  const skills = data.data?.skills;
  const runs = data.data?.runs ?? [];
  const working = (state: ReconstructRun["state"]) => ["queued", "studying", "rebuilding", "comparing", "learning"].includes(state);

  return (
    <>
      <div className="card">
        <p className="small" style={{ marginTop: 0 }}>
          Give it any app and it learns to build things like it: it studies the code into a blueprint of every feature, rebuilds the app from
          that blueprint alone (it never sees the code while building), checks the rebuild feature by feature, and turns everything it missed
          into lessons every later build uses. Rebuilds are private study copies; code without an open licence teaches lessons only.
        </p>
        <div className="btn-row" style={{ marginBottom: 8 }}>
          <button className={`btn small ${kind === "project" ? "primary" : "ghost"}`} onClick={() => setKind("project")}>
            One of my projects
          </button>
          <button className={`btn small ${kind === "git" ? "primary" : "ghost"}`} onClick={() => setKind("git")}>
            A Git repository
          </button>
        </div>
        <div className="learn-plan">
          {kind === "project" ? (
            <select className="input" style={{ flex: 1 }} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
              <option value="">Choose a project…</option>
              {(projects.data?.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <input className="input" style={{ flex: 1, minWidth: 220 }} value={gitUrl} placeholder="https://github.com/owner/repo" onChange={(e) => setGitUrl(e.target.value)} />
          )}
          <button
            className="btn primary"
            disabled={busy !== null || (kind === "project" ? !projectId : !gitUrl.trim())}
            onClick={() =>
              void act(
                "start",
                () => api.reconstructStart(kind === "project" ? { projectId } : { gitUrl: gitUrl.trim() }),
                "Queued. It studies the app first, then rebuilds it."
              )
            }
          >
            {busy === "start" ? <Busy label={kind === "git" ? "Cloning…" : "Queueing…"} /> : "Reconstruct and learn"}
          </button>
        </div>
      </div>

      {skills && skills.appsRebuilt > 0 ? (
        <>
          <div className="section-title">What it has learned</div>
          <div className="rl-grid">
            <div className="card rl-card">
              <strong>First-try coverage</strong>
              <div className="small">
                How much of a new app its first rebuild gets right: <b>{trendText(skills.firstTryCoverage.recent, skills.firstTryCoverage.earlier)}</b>
              </div>
            </div>
            <div className="card rl-card">
              <strong>Studied</strong>
              <div className="small">
                {skills.appsRebuilt} apps · {skills.featuresStudied} features · {skills.lessons} lessons · {skills.examplesKept} kept as worked examples
              </div>
            </div>
            <div className="card rl-card">
              <strong>Kinds of apps</strong>
              <div className="small">{skills.kinds.map((k) => `${k.kind} (${k.count})`).join(" · ")}</div>
            </div>
          </div>
        </>
      ) : null}

      {runs.length ? <div className="section-title">Apps</div> : null}
      {runs.map((run) => {
        const best = run.rounds.reduce((max, r) => Math.max(max, r.coverage ?? 0), 0);
        const last = run.rounds[run.rounds.length - 1];
        return (
          <div key={run.id} className="card" style={{ marginBottom: 10 }}>
            <div className="rl-head">
              <strong>{run.blueprint?.title ?? run.source.label}</strong>
              <span className={`tag ${run.state === "done" ? "ok" : run.state === "failed" ? "bad" : working(run.state) ? "info" : "warn"}`}>{run.state}</span>
            </div>
            <div className="muted small">
              {run.source.kind === "git" ? `${run.source.label} · licence ${run.source.license ?? "none"}` : "your project"}
              {run.blueprint ? ` · ${run.blueprint.kind} · ${run.blueprint.features.length} features` : ""} · {ago(run.createdAt)}
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              {run.phase}
            </div>
            {run.rounds.length ? (
              <div className="progress compact">
                <div>
                  <div className="progress-label">
                    <strong>Features rebuilt</strong>
                    <span>{run.rounds.map((r) => `round ${r.round}: ${r.coverage === null ? "?" : `${Math.round(r.coverage * 100)}%`}`).join(" → ")}</span>
                  </div>
                  <div className={`bar ${working(run.state) ? "active" : ""}`}>
                    <i style={{ width: `${Math.round(best * 100)}%` }} />
                  </div>
                </div>
              </div>
            ) : null}
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn small" onClick={() => setOpen(open === run.id ? null : run.id)}>
                {open === run.id ? "Less" : "Blueprint, gaps & lessons"}
              </button>
              {working(run.state) ? (
                <button className="btn small danger" disabled={busy !== null} onClick={() => void act(`stop-${run.id}`, () => api.reconstructStop(run.id), "Stopped.")}>
                  Stop
                </button>
              ) : run.blueprint && last && last.missing.length ? (
                <button className="btn small primary" disabled={busy !== null} onClick={() => void act(`again-${run.id}`, () => api.reconstructAgain(run.id), "Another round queued.")}>
                  Rebuild what it missed
                </button>
              ) : null}
            </div>
            {open === run.id ? (
              <div style={{ marginTop: 10 }}>
                {run.error ? <Banner kind="error">{run.error}</Banner> : null}
                {run.blueprint ? (
                  <>
                    <div className="small">{run.blueprint.purpose}</div>
                    <ol className="small" style={{ paddingLeft: 18, marginTop: 8 }}>
                      {run.blueprint.features.map((f) => (
                        <li key={f.name}>
                          {last ? (last.present.includes(f.name) ? "✓ " : "✗ ") : ""}
                          <strong>{f.name}</strong> — {f.detail}
                        </li>
                      ))}
                    </ol>
                    {run.blueprint.techniques.length ? <div className="muted small">Techniques: {run.blueprint.techniques.join(" · ")}</div> : null}
                  </>
                ) : null}
                {run.lessons.length ? (
                  <>
                    <div className="muted small" style={{ marginTop: 8 }}>
                      Lessons it learned (used by every build from now on)
                    </div>
                    <ul className="small" style={{ paddingLeft: 18 }}>
                      {run.lessons.map((lesson, i) => (
                        <li key={i}>{lesson}</li>
                      ))}
                    </ul>
                  </>
                ) : null}
                {run.keptAsExample ? <div className="muted small">Kept as a worked example for similar builds.</div> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </>
  );
}
