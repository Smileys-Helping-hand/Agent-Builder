"use client";

/**
 * One research topic, opened up: what it is doing right now, what it has
 * found, what it is asking next, where it read it, and what it has written —
 * and the controls to steer every part of it. Shown inline under the topic,
 * or full screen with "Expand".
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { api, type TopicDetail, type TopicFinding } from "@/lib/api";
import { Banner, Busy, Icon, Skeleton, ago, useRemote, useToast } from "../ui";

type Tab = "live" | "findings" | "questions" | "sources" | "documents" | "settings";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "live", label: "Live" },
  { id: "findings", label: "Findings" },
  { id: "questions", label: "Questions" },
  { id: "sources", label: "Sources" },
  { id: "documents", label: "Documents" },
  { id: "settings", label: "Edit & control" }
];

const KIND_LABEL: Record<string, string> = { summary: "Summary", study_guide: "Study guide", report: "Report" };

const ACTIVITY_TONE: Record<string, string> = {
  finding: "good",
  document: "good",
  source: "",
  search: "",
  question: "accent",
  cycle: "accent",
  backoff: "warn",
  status: "",
  error: "bad"
};

export function TopicWorkspace({
  id,
  fullscreen,
  onToggleFullscreen,
  onChanged,
  onDeleted
}: {
  id: string;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onChanged: () => void;
  onDeleted: () => void;
}) {
  const toast = useToast();
  const detail = useRemote(() => api.topic(id), 4000);
  const [tab, setTab] = useState<Tab>("live");
  const [busy, setBusy] = useState(false);

  // Escape leaves full screen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onToggleFullscreen();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [fullscreen, onToggleFullscreen]);

  const act = async (label: string, run: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await run();
      if (label) toast(label, "ok");
      await detail.refresh();
      onChanged();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setBusy(false);
    }
  };

  const data = detail.data;
  const body = !data ? (
    detail.error ? <Banner kind="error">{detail.error}</Banner> : <Skeleton rows={3} />
  ) : (
    <>
      <StatusStrip data={data} />
      <div className="ws-tabs" role="tablist">
        {TABS.map((entry) => (
          <button key={entry.id} role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? "on" : ""} onClick={() => setTab(entry.id)}>
            {entry.label}
            {entry.id === "findings" ? <em>{data.findings.length}</em> : null}
            {entry.id === "questions" ? <em>{data.openQuestions.length}</em> : null}
            {entry.id === "sources" ? <em>{data.sources.length}</em> : null}
            {entry.id === "documents" ? <em>{data.documents.length}</em> : null}
          </button>
        ))}
      </div>
      <div className="ws-body fade-in" key={tab}>
        {tab === "live" ? <LiveFeed data={data} /> : null}
        {tab === "findings" ? <Findings data={data} busy={busy} act={act} /> : null}
        {tab === "questions" ? <Questions data={data} busy={busy} act={act} /> : null}
        {tab === "sources" ? <Sources data={data} /> : null}
        {tab === "documents" ? <Documents data={data} busy={busy} act={act} /> : null}
        {tab === "settings" ? <Settings data={data} busy={busy} act={act} onDeleted={onDeleted} /> : null}
      </div>
    </>
  );

  if (!fullscreen) {
    return (
      <div className="ws-inline">
        <div className="btn-row" style={{ justifyContent: "flex-end", marginBottom: 6 }}>
          <button className="btn small" onClick={onToggleFullscreen}>
            {Icon.external} Expand
          </button>
        </div>
        {body}
      </div>
    );
  }

  // Rendered on <body>: the card it belongs to animates and blurs, and either
  // would trap a fixed-position overlay inside the card instead of the screen.
  return createPortal(
    <div className="ws-overlay" role="dialog" aria-modal="true" aria-label={data?.topic.title ?? "Research topic"}>
      <div className="ws-overlay-head">
        <button className="btn small" onClick={onToggleFullscreen}>
          {Icon.back} Back
        </button>
        <strong>{data?.topic.title ?? "Research"}</strong>
        <span className={`pill ${data?.topic.status === "running" ? "up" : "degraded"}`} />
      </div>
      <div className="ws-overlay-body">{body}</div>
    </div>,
    document.body
  );
}

function StatusStrip({ data }: { data: TopicDetail }) {
  const { topic } = data;
  const running = topic.status === "running";
  return (
    <div className="ws-status">
      <div>
        <strong className={topic.cycleRunning ? "ws-now" : ""}>
          {topic.cycleRunning
            ? "Researching right now"
            : topic.generatingDocuments
              ? "Writing up documents"
              : running
                ? topic.nextCycleAt
                  ? `Next cycle ${inTime(topic.nextCycleAt)}`
                  : "Waiting for its next cycle"
                : topic.status === "paused"
                  ? "Paused"
                  : "Stopped"}
        </strong>
        <small>
          {topic.cycles ?? 0} cycles{topic.lastCycleAt ? ` · last ${ago(topic.lastCycleAt)}` : ""}
        </small>
      </div>
      <div className="chips" style={{ marginTop: 0 }}>
        <span className="chip accent">{topic.findingCount} findings</span>
        <span className="chip">{topic.corroboratedCount} confirmed</span>
        {topic.contestedCount ? <span className="chip warn">{topic.contestedCount} contested</span> : null}
        <span className="chip">{topic.sourceCount} sources</span>
      </div>
      {topic.lastError ? <Banner kind="error">Last cycle: {topic.lastError}</Banner> : null}
    </div>
  );
}

function LiveFeed({ data }: { data: TopicDetail }) {
  if (data.activity.length === 0) return <div className="empty">Nothing yet. The first cycle starts shortly.</div>;
  return (
    <ol className="ws-feed">
      {data.activity.map((entry) => (
        <li key={entry.id} className="ws-feed-item">
          <span className={`pill ${ACTIVITY_TONE[entry.kind] === "good" ? "up" : ACTIVITY_TONE[entry.kind] === "bad" ? "down" : ACTIVITY_TONE[entry.kind] === "warn" ? "degraded" : ""}`} />
          <div>
            <div className="ws-feed-msg">{entry.message}</div>
            <small>
              {entry.kind} · cycle {entry.cycle} · {ago(entry.createdAt)}
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}

type Act = (label: string, run: () => Promise<unknown>) => Promise<void>;

function Findings({ data, busy, act }: { data: TopicDetail; busy: boolean; act: Act }) {
  const [filter, setFilter] = useState<"all" | TopicFinding["status"]>("all");
  const [term, setTerm] = useState("");
  const shown = useMemo(
    () =>
      data.findings
        .filter((finding) => filter === "all" || finding.status === filter)
        .filter((finding) => !term.trim() || finding.claim.toLowerCase().includes(term.trim().toLowerCase())),
    [data.findings, filter, term]
  );
  return (
    <>
      <div className="ws-toolbar">
        <input className="ws-search" placeholder="Search findings" value={term} onChange={(event) => setTerm(event.target.value)} />
        <div className="chips" style={{ marginTop: 0 }}>
          {(["all", "open", "corroborated", "contested"] as const).map((value) => (
            <button key={value} className={`chip ${filter === value ? "accent" : ""}`} onClick={() => setFilter(value)}>
              {value === "all" ? "All" : value === "corroborated" ? "Confirmed" : value === "open" ? "Unconfirmed" : "Contested"}
            </button>
          ))}
        </div>
      </div>
      {shown.length === 0 ? <div className="empty">No findings match.</div> : null}
      {shown.map((finding) => (
        <div key={finding.id} className={`ws-finding ${finding.status}`}>
          <p>{finding.claim}</p>
          <div className="ws-meter" aria-label={`Confidence ${Math.round(finding.confidence * 100)}%`}>
            <i style={{ width: `${Math.round(finding.confidence * 100)}%` }} />
          </div>
          <div className="ws-finding-foot">
            <small>
              {Math.round(finding.confidence * 100)}% · {finding.supportCount} {finding.supportCount === 1 ? "source" : "sources"} · cycle {finding.cycle}
              {finding.sourceUrl ? (
                <>
                  {" · "}
                  <a href={finding.sourceUrl} target="_blank" rel="noreferrer">
                    {finding.sourceTitle || new URL(finding.sourceUrl).hostname}
                  </a>
                </>
              ) : null}
            </small>
            <span className="btn-row">
              {finding.status !== "corroborated" ? (
                <button className="btn small" disabled={busy} onClick={() => act("Confirmed.", () => api.judgeFinding(data.topic.id, finding.id, "confirm"))}>
                  {Icon.check} Confirm
                </button>
              ) : null}
              {finding.status !== "contested" ? (
                <button className="btn small danger" disabled={busy} onClick={() => act("Rejected.", () => api.judgeFinding(data.topic.id, finding.id, "reject"))}>
                  Reject
                </button>
              ) : null}
            </span>
          </div>
        </div>
      ))}
    </>
  );
}

function Questions({ data, busy, act }: { data: TopicDetail; busy: boolean; act: Act }) {
  const [text, setText] = useState("");
  return (
    <>
      <div className="ws-ask">
        <label className="field" style={{ margin: 0, flex: 1 }}>
          <span>Steer it: ask something and it goes to the top of the list</span>
          <input value={text} onChange={(event) => setText(event.target.value)} placeholder="e.g. What breaks first under heavy load?" />
        </label>
        <button
          className="btn primary"
          disabled={busy || text.trim().length < 10}
          onClick={() =>
            act("Added to the top.", async () => {
              await api.askTopic(data.topic.id, text.trim());
              setText("");
            })
          }
        >
          {Icon.sparkle} Ask
        </button>
      </div>
      <div className="section-title">Next up ({data.openQuestions.length})</div>
      {data.openQuestions.length === 0 ? <div className="empty">Nothing queued. It will think of more after the next cycle.</div> : null}
      {data.openQuestions.map((question) => (
        <div key={question.id} className="ws-question">
          <div className="ws-meter small" aria-label={`Priority ${Math.round(question.priority * 100)}%`}>
            <i style={{ width: `${Math.round(question.priority * 100)}%` }} />
          </div>
          <span>{question.text}</span>
          <span className="btn-row">
            <button className="btn small" title="Move to the top" disabled={busy} onClick={() => act("", () => api.prioritiseQuestion(data.topic.id, question.id))}>
              ↑
            </button>
            <button className="btn small" title="Drop it" disabled={busy} onClick={() => act("Dropped.", () => api.dropQuestion(data.topic.id, question.id))}>
              {Icon.trash}
            </button>
          </span>
        </div>
      ))}
      {data.exploredQuestions.length > 0 ? (
        <details className="ws-details">
          <summary>Already explored ({data.exploredQuestions.length})</summary>
          {data.exploredQuestions.map((question) => (
            <div key={question.id} className="ws-question explored">
              <span>{question.text}</span>
              <button className="btn small" title="Ask it again" disabled={busy} onClick={() => act("Back on the list.", () => api.prioritiseQuestion(data.topic.id, question.id))}>
                {Icon.refresh}
              </button>
            </div>
          ))}
        </details>
      ) : null}
    </>
  );
}

function Sources({ data }: { data: TopicDetail }) {
  if (data.sources.length === 0) return <div className="empty">No sources read yet.</div>;
  return (
    <>
      {data.sources.map((source) => (
        <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="ws-source">
          <strong>{source.title || source.url}</strong>
          <small>
            {safeHost(source.url)} · {source.provider} · cycle {source.cycle} · {ago(source.fetchedAt)}
          </small>
          {source.excerpt ? <p>{source.excerpt}</p> : null}
        </a>
      ))}
    </>
  );
}

function Documents({ data, busy, act }: { data: TopicDetail; busy: boolean; act: Act }) {
  const [open, setOpen] = useState<number | null>(null);
  const doc = useRemote(() => (open === null ? Promise.resolve(null) : api.topicDocument(data.topic.id, open)), 0, open === null ? undefined : `doc.${data.topic.id}.${open}`);
  useEffect(() => {
    void doc.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload only when a different document is opened
  }, [open]);

  return (
    <>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button
          className="btn"
          disabled={busy || data.topic.generatingDocuments}
          onClick={() => act("Writing new versions. This can take a few minutes.", () => api.regenerateDocuments(data.topic.id))}
        >
          {data.topic.generatingDocuments ? <Busy label="Writing…" /> : <>{Icon.refresh} Write fresh versions now</>}
        </button>
      </div>
      {data.documents.length === 0 ? <div className="empty">No documents yet. They are written once there are enough findings.</div> : null}
      <div className="ws-docs">
        {data.documents.map((entry) => (
          <button key={entry.id} className={`ws-doc ${open === entry.id ? "on" : ""}`} onClick={() => setOpen(open === entry.id ? null : entry.id)}>
            {Icon.book}
            <span>
              <strong>{KIND_LABEL[entry.kind] ?? entry.kind}</strong>
              <small>
                v{entry.version} · {entry.findingCount} findings · {ago(entry.createdAt)}
              </small>
            </span>
          </button>
        ))}
      </div>
      {open !== null ? (
        <article className="ws-reader">
          {doc.data?.document ? <Markdown text={doc.data.document.markdown} /> : doc.error ? <Banner kind="error">{doc.error}</Banner> : <Skeleton rows={4} />}
        </article>
      ) : null}
    </>
  );
}

function Settings({ data, busy, act, onDeleted }: { data: TopicDetail; busy: boolean; act: Act; onDeleted: () => void }) {
  const { topic } = data;
  const [title, setTitle] = useState(topic.title);
  const [question, setQuestion] = useState(topic.question);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty = title.trim() !== topic.title || question.trim() !== topic.question;
  const running = topic.status === "running";

  return (
    <>
      <label className="field">
        <span>Topic</span>
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="field">
        <span>The question it works from</span>
        <textarea rows={3} value={question} onChange={(event) => setQuestion(event.target.value)} />
      </label>
      <button className="btn primary" disabled={busy || !dirty || title.trim().length < 3} onClick={() => act("Saved. The next cycle uses it.", () => api.editTopic(topic.id, { title: title.trim(), question: question.trim() }))}>
        {Icon.check} Save changes
      </button>

      <div className="section-title">Control</div>
      <div className="btn-row">
        {running ? (
          <>
            <button className="btn" disabled={busy || topic.cycleRunning} onClick={() => act("Cycle started.", () => api.runTopicNow(topic.id))}>
              {Icon.play} Run a cycle now
            </button>
            <button className="btn" disabled={busy} onClick={() => act("Paused.", () => api.pauseTopic(topic.id))}>
              {Icon.pause} Pause
            </button>
          </>
        ) : (
          <button className="btn" disabled={busy} onClick={() => act("Resumed.", () => api.resumeTopic(topic.id))}>
            {Icon.power} Resume
          </button>
        )}
        {topic.status !== "stopped" ? (
          <button className="btn" disabled={busy} onClick={() => act("Stopped.", () => api.stopTopic(topic.id))}>
            {Icon.stop} Stop
          </button>
        ) : null}
        {confirmDelete ? (
          <>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() =>
                act("Deleted.", async () => {
                  await api.deleteTopic(topic.id);
                  onDeleted();
                })
              }
            >
              {Icon.trash} Yes, delete it and everything it found
            </button>
            <button className="btn ghost" onClick={() => setConfirmDelete(false)}>
              Keep it
            </button>
          </>
        ) : (
          <button className="btn danger" disabled={busy} onClick={() => setConfirmDelete(true)}>
            {Icon.trash} Delete…
          </button>
        )}
      </div>
    </>
  );
}

/** Just enough Markdown for the research documents: headings, lists, bold, links, paragraphs. */
export function Markdown({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, "\n").split(/\n{2,}/);
  return (
    <>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const heading = block.match(/^(#{1,4})\s+(.*)$/);
        if (heading && lines.length === 1) {
          const level = heading[1].length;
          const content = inline(heading[2]);
          return level <= 1 ? <h2 key={index}>{content}</h2> : level === 2 ? <h3 key={index}>{content}</h3> : <h4 key={index}>{content}</h4>;
        }
        // Text and list lines can share a block ("Still open:" then its items): keep each run as what it is.
        const runs: Array<{ list: boolean; lines: string[] }> = [];
        for (const line of lines) {
          const list = /^\s*([-*]|\d+\.)\s+/.test(line);
          if (runs.length && runs[runs.length - 1].list === list) runs[runs.length - 1].lines.push(line);
          else runs.push({ list, lines: [line] });
        }
        return (
          <div key={index} className="md-block">
            {runs.map((run, r) =>
              run.list ? (
                <ul key={r}>
                  {run.lines.map((line, i) => (
                    <li key={i}>{inline(line.replace(/^\s*([-*]|\d+\.)\s+/, ""))}</li>
                  ))}
                </ul>
              ) : (
                <p key={r}>
                  {run.lines.map((line, i) => (
                    <span key={i}>
                      {i > 0 ? <br /> : null}
                      {inline(line.replace(/^#{1,4}\s+/, ""))}
                    </span>
                  ))}
                </p>
              )
            )}
          </div>
        );
      })}
    </>
  );
}

const inline = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|`([^`]+)`|(?<![\w])_([^_\n]+)_(?![\w])/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    if (match[1]) parts.push(<strong key={match.index}>{match[1]}</strong>);
    else if (match[4]) parts.push(<code key={match.index}>{match[4]}</code>);
    else if (match[5]) parts.push(<em key={match.index}>{match[5]}</em>);
    else
      parts.push(
        <a key={match.index} href={match[3]} target="_blank" rel="noreferrer">
          {match[2]}
        </a>
      );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

const safeHost = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const inTime = (iso: string): string => {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "any moment";
  const minutes = Math.round(ms / 60000);
  return minutes < 1 ? "in under a minute" : minutes < 60 ? `in ${minutes} min` : `in ${Math.round(minutes / 60)} h`;
};
