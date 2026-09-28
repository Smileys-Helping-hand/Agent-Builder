import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import useSWR from "swr";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import clsx from "clsx";
import { apiRequest, type ServerEvent } from "../lib/api";

type TopicStatus = "running" | "paused" | "stopped";
type FindingStatus = "open" | "corroborated" | "contested";
type DocumentKind = "summary" | "study_guide" | "report";

interface TopicSummary {
  id: string;
  title: string;
  question: string;
  status: TopicStatus;
  cycles: number;
  consecutiveEmptyCycles: number;
  lastCycleAt: string | null;
  lastNewFindingAt: string | null;
  nextCycleAt: string | null;
  lastError: string | null;
  createdAt: string;
  sourceCount: number;
  findingCount: number;
  corroboratedCount: number;
  contestedCount: number;
  openQuestionCount: number;
  documentCount: number;
  cycleRunning: boolean;
  generatingDocuments: boolean;
}

interface Finding {
  id: number;
  cycle: number;
  claim: string;
  sourceUrl: string | null;
  sourceTitle: string | null;
  confidence: number;
  supportCount: number;
  status: FindingStatus;
  createdAt: string;
}

interface Question {
  id: number;
  text: string;
  status: "open" | "explored";
  priority: number;
  timesExplored: number;
  createdCycle: number;
}

interface Source {
  id: number;
  url: string;
  title: string;
  provider: string;
  excerpt: string | null;
  cycle: number;
  fetchedAt: string;
}

interface DocumentMeta {
  id: number;
  kind: DocumentKind;
  version: number;
  title: string;
  findingCount: number;
  createdAt: string;
}

interface ActivityEntry {
  id: number;
  cycle: number;
  kind: string;
  message: string;
  createdAt: string;
}

interface TopicDetail {
  topic: TopicSummary;
  findings: Finding[];
  openQuestions: Question[];
  exploredQuestions: Question[];
  sources: Source[];
  documents: DocumentMeta[];
  activity: ActivityEntry[];
}

interface Lesson {
  id: number;
  scope: string;
  signature: string;
  lesson: string;
  timesApplied: number;
  timesHelped: number;
  utility: number;
}

interface BrainStatus {
  enabled: boolean;
  host: string | null;
  hasApiKey: boolean;
  reachable: boolean;
  identityVerified: boolean;
  lastSyncAt: string | null;
  lastError: string | null;
  queue: { pending: number; retrying: number; synced: number };
  warnings: string[];
}

interface SearchHit {
  kind: string;
  refId: string;
  topicId: string | null;
  title: string;
  snippet: string;
}

const DOCUMENT_LABELS: Record<DocumentKind, string> = {
  summary: "Summary",
  study_guide: "Study guide",
  report: "Full report"
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const formatAgo = (iso: string | null): string => {
  if (!iso) return "never";
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
};

const formatUntil = (iso: string | null): string => {
  if (!iso) return "—";
  const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
  if (seconds <= 5) return "any moment";
  if (seconds < 90) return `in ${seconds}s`;
  if (seconds < 5400) return `in ${Math.round(seconds / 60)} min`;
  return `in ${(seconds / 3600).toFixed(1)} h`;
};

const statusStyles: Record<TopicStatus, string> = {
  running: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  paused: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  stopped: "border-slate-600 bg-slate-800 text-slate-300"
};

const findingStyles: Record<FindingStatus, string> = {
  corroborated: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  contested: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  open: "border-slate-600 bg-slate-800 text-slate-300"
};

const providerStyles: Record<string, string> = {
  wikipedia: "text-slate-200 border-slate-500/50",
  arxiv: "text-rose-300 border-rose-500/40",
  github: "text-violet-300 border-violet-500/40",
  hackernews: "text-orange-300 border-orange-500/40",
  web: "text-sky-300 border-sky-500/40"
};

const Pill = ({ className, children }: { className: string; children: ReactNode }) => (
  <span className={clsx("inline-flex shrink-0 items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide", className)}>
    {children}
  </span>
);

const Card = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/30">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      {action}
    </div>
    {children}
  </section>
);

const markdownComponents: Components = {
  h1: ({ node: _node, ...props }) => <h1 className="mb-3 mt-2 text-2xl font-bold text-slate-100" {...props} />,
  h2: ({ node: _node, ...props }) => <h2 className="mb-2 mt-6 text-lg font-semibold text-slate-100" {...props} />,
  h3: ({ node: _node, ...props }) => <h3 className="mb-2 mt-4 font-semibold text-slate-200" {...props} />,
  p: ({ node: _node, ...props }) => <p className="my-2 leading-relaxed text-slate-300" {...props} />,
  ul: ({ node: _node, ...props }) => <ul className="my-2 list-disc space-y-1.5 pl-5 text-slate-300" {...props} />,
  ol: ({ node: _node, ...props }) => <ol className="my-2 list-decimal space-y-1.5 pl-5 text-slate-300" {...props} />,
  li: ({ node: _node, ...props }) => <li className="leading-relaxed" {...props} />,
  strong: ({ node: _node, ...props }) => <strong className="font-semibold text-slate-100" {...props} />,
  em: ({ node: _node, ...props }) => <em className="text-slate-400" {...props} />,
  blockquote: ({ node: _node, ...props }) => (
    <blockquote className="my-3 border-l-2 border-amber-500/60 bg-amber-500/5 px-3 py-2 text-sm text-amber-100/90" {...props} />
  ),
  a: ({ node: _node, ...props }) => (
    <a className="text-sky-400 underline decoration-dotted underline-offset-2 hover:text-sky-300" target="_blank" rel="noreferrer noopener" {...props} />
  ),
  code: ({ node: _node, ...props }) => <code className="rounded bg-slate-800 px-1 py-0.5 text-[0.85em] text-slate-200" {...props} />
};

// --- start form ----------------------------------------------------------------

const StartResearchForm = ({ onStarted }: { onStarted: (id: string) => void }) => {
  const [title, setTitle] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { topic } = await apiRequest<{ topic: TopicSummary }>("/api/research/topics", {
        method: "POST",
        body: JSON.stringify({ title, question })
      });
      setTitle("");
      setQuestion("");
      onStarted(topic.id);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Research a topic">
      <form onSubmit={submit} className="space-y-3">
        <div>
          <label htmlFor="research-title" className="text-xs font-medium text-slate-400">
            Topic
          </label>
          <input
            id="research-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Retrieval-augmented generation"
            maxLength={160}
            required
            className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        </div>
        <div>
          <label htmlFor="research-question" className="text-xs font-medium text-slate-400">
            What do you want to know? <span className="text-slate-600">(optional)</span>
          </label>
          <textarea
            id="research-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="How do RAG systems decide what to retrieve, and where do they fail?"
            maxLength={1000}
            rows={3}
            className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/40"
          />
        </div>
        {error && <p className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>}
        <button
          type="submit"
          disabled={busy || title.trim().length < 3}
          className="inline-flex w-full items-center justify-center rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-700"
        >
          {busy ? "Starting…" : "Start research"}
        </button>
        <p className="text-xs leading-relaxed text-slate-500">
          Keeps researching until you pause or stop it — including across restarts. It reads new sources, checks every
          finding against its source, and rewrites the study documents as it learns.
        </p>
      </form>
    </Card>
  );
};

// --- topic list ------------------------------------------------------------------

const TopicList = ({
  topics,
  selectedId,
  onSelect
}: {
  topics: TopicSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) => (
  <Card title={`Topics (${topics.length})`}>
    {topics.length === 0 ? (
      <p className="text-sm text-slate-500">No research yet. Start a topic above.</p>
    ) : (
      <ul className="space-y-2">
        {topics.map((topic) => (
          <li key={topic.id}>
            <button
              type="button"
              onClick={() => onSelect(topic.id)}
              className={clsx(
                "w-full rounded-lg border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-sky-500/40",
                topic.id === selectedId ? "border-sky-500/60 bg-sky-500/5" : "border-slate-800 bg-slate-950/40 hover:border-slate-700"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-slate-100">{topic.title}</span>
                <Pill className={statusStyles[topic.status]}>
                  {topic.cycleRunning && <span className="mr-1 h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />}
                  {topic.cycleRunning ? "reading" : topic.status}
                </Pill>
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-slate-400">
                {topic.findingCount} findings · {topic.sourceCount} sources · {topic.openQuestionCount} open questions
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Last new finding {formatAgo(topic.lastNewFindingAt)}
                {topic.status === "running" && !topic.cycleRunning && ` · next look ${formatUntil(topic.nextCycleAt)}`}
              </p>
            </button>
          </li>
        ))}
      </ul>
    )}
  </Card>
);

// --- detail views ------------------------------------------------------------------

const DocumentsView = ({ topicId, documents }: { topicId: string; documents: DocumentMeta[] }) => {
  const ordered = (["summary", "study_guide", "report"] as DocumentKind[])
    .map((kind) => documents.find((document) => document.kind === kind))
    .filter((document): document is DocumentMeta => Boolean(document));
  const [kind, setKind] = useState<DocumentKind>("summary");
  const active = ordered.find((document) => document.kind === kind) ?? ordered[0];

  const { data, error, isLoading } = useSWR<{ document: DocumentMeta & { markdown: string } }>(
    active ? ["research-document", topicId, active.id] : null,
    () => apiRequest(`/api/research/topics/${topicId}/documents/${active?.id}`)
  );

  if (ordered.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-800 p-6 text-center text-sm text-slate-400">
        Study documents are written once the research has 3 findings, then rewritten after every 8 new ones.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {ordered.map((document) => (
          <button
            key={document.kind}
            type="button"
            onClick={() => setKind(document.kind)}
            className={clsx(
              "rounded-md px-3 py-1.5 text-sm font-medium transition",
              document.kind === active?.kind ? "bg-sky-500 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            )}
          >
            {DOCUMENT_LABELS[document.kind]}
            <span className="ml-1.5 text-xs opacity-70">v{document.version}</span>
          </button>
        ))}
        {active && (
          <span className="ml-auto text-xs text-slate-500">
            From {active.findingCount} findings · {formatAgo(active.createdAt)}
          </span>
        )}
      </div>
      {isLoading && <p className="text-sm text-slate-500">Loading document…</p>}
      {error && <p className="text-sm text-rose-300">{errorText(error)}</p>}
      {data && (
        <article className="max-w-none rounded-lg border border-slate-800 bg-slate-950/50 p-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {data.document.markdown}
          </ReactMarkdown>
        </article>
      )}
    </div>
  );
};

const FindingsView = ({ findings }: { findings: Finding[] }) => {
  const [filter, setFilter] = useState<"all" | FindingStatus>("all");
  const visible = filter === "all" ? findings : findings.filter((finding) => finding.status === filter);
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {(["all", "corroborated", "open", "contested"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setFilter(option)}
            className={clsx(
              "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition",
              filter === option ? "bg-slate-200 text-slate-900" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
            )}
          >
            {option}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">No findings{filter === "all" ? " yet" : ` marked ${filter}`}.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((finding) => (
            <li key={finding.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
              <div className="flex items-start gap-3">
                <Pill className={findingStyles[finding.status]}>{finding.status}</Pill>
                <p className="flex-1 text-sm leading-relaxed text-slate-200">{finding.claim}</p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pl-1 text-xs text-slate-500">
                <span className="flex items-center gap-2">
                  confidence
                  <span className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-800">
                    <span className="block h-full rounded-full bg-sky-500" style={{ width: `${Math.round(finding.confidence * 100)}%` }} />
                  </span>
                  <span className="tabular-nums">{Math.round(finding.confidence * 100)}%</span>
                </span>
                <span className="tabular-nums">
                  {finding.supportCount} source{finding.supportCount === 1 ? "" : "s"}
                </span>
                <span>cycle {finding.cycle}</span>
                {finding.sourceUrl && (
                  <a href={finding.sourceUrl} target="_blank" rel="noreferrer noopener" className="truncate text-sky-400 hover:text-sky-300">
                    {finding.sourceTitle ?? finding.sourceUrl}
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const QuestionsView = ({ open, explored }: { open: Question[]; explored: Question[] }) => (
  <div className="grid gap-6 md:grid-cols-2">
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Up next ({open.length})</h4>
      {open.length === 0 ? (
        <p className="text-sm text-slate-500">The frontier is empty — the next cycle will generate new angles.</p>
      ) : (
        <ol className="space-y-2">
          {open.map((question) => (
            <li key={question.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3 text-sm text-slate-200">
              {question.text}
              <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
                priority
                <span className="h-1 w-12 overflow-hidden rounded-full bg-slate-800">
                  <span className="block h-full bg-emerald-500" style={{ width: `${Math.round(question.priority * 100)}%` }} />
                </span>
                {question.timesExplored > 0 && <span>revisit #{question.timesExplored + 1}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
    <div>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Already investigated ({explored.length})</h4>
      <ul className="space-y-1.5">
        {explored.map((question) => (
          <li key={question.id} className="text-sm text-slate-400">
            <span className="mr-2 text-slate-600">✓</span>
            {question.text}
          </li>
        ))}
      </ul>
    </div>
  </div>
);

const SourcesView = ({ sources }: { sources: Source[] }) =>
  sources.length === 0 ? (
    <p className="text-sm text-slate-500">No sources read yet.</p>
  ) : (
    <ul className="space-y-2">
      {sources.map((source) => (
        <li key={source.id} className="rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="flex items-start gap-2">
            <Pill className={providerStyles[source.provider] ?? providerStyles.web}>{source.provider}</Pill>
            <a href={source.url} target="_blank" rel="noreferrer noopener" className="flex-1 text-sm font-medium text-sky-400 hover:text-sky-300">
              {source.title}
            </a>
            <span className="whitespace-nowrap text-xs text-slate-500">cycle {source.cycle}</span>
          </div>
          {source.excerpt && <p className="mt-1.5 line-clamp-2 text-xs text-slate-400">{source.excerpt}</p>}
        </li>
      ))}
    </ul>
  );

const activityDot: Record<string, string> = {
  error: "bg-rose-500",
  finding: "bg-emerald-500",
  document: "bg-violet-500",
  backoff: "bg-amber-500",
  question: "bg-sky-400",
  status: "bg-slate-300"
};

const ActivityView = ({ activity }: { activity: ActivityEntry[] }) => (
  <ol className="space-y-2">
    {activity.map((entry) => (
      <li key={entry.id} className="flex gap-3 text-sm">
        <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", activityDot[entry.kind] ?? "bg-slate-600")} />
        <div className="flex-1">
          <p className="text-slate-300">{entry.message}</p>
          <p className="text-xs text-slate-500">
            {formatAgo(entry.createdAt)}
            {entry.cycle > 0 && ` · cycle ${entry.cycle}`}
          </p>
        </div>
      </li>
    ))}
  </ol>
);

type DetailTab = "documents" | "findings" | "questions" | "sources" | "activity";

const TopicDetailView = ({
  detail,
  onChanged,
  onDeleted
}: {
  detail: TopicDetail;
  onChanged: () => void;
  onDeleted: () => void;
}) => {
  const { topic } = detail;
  const [tab, setTab] = useState<DetailTab>("documents");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (label: string, path: string, init: RequestInit) => {
    setBusy(label);
    setError(null);
    try {
      await apiRequest(path, init);
      onChanged();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete "${topic.title}" and everything it has learned? This cannot be undone.`)) return;
    setBusy("delete");
    try {
      await apiRequest(`/api/research/topics/${topic.id}`, { method: "DELETE" });
      onDeleted();
    } catch (caught) {
      setError(errorText(caught));
      setBusy(null);
    }
  };

  const tabs: Array<[DetailTab, string, number | null]> = [
    ["documents", "Study documents", detail.documents.length],
    ["findings", "Findings", topic.findingCount],
    ["questions", "Questions", topic.openQuestionCount],
    ["sources", "Sources", topic.sourceCount],
    ["activity", "Activity", null]
  ];

  const stats: Array<[string, number]> = [
    ["Research cycles", topic.cycles],
    ["Sources read", topic.sourceCount],
    ["Findings", topic.findingCount],
    ["Corroborated", topic.corroboratedCount],
    ["Contested", topic.contestedCount]
  ];

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-black/30">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold text-slate-100">{topic.title}</h2>
            <Pill className={statusStyles[topic.status]}>{topic.cycleRunning ? "reading now" : topic.status}</Pill>
          </div>
          <p className="mt-1 text-sm text-slate-400">{topic.question}</p>
          <p className="mt-1 text-xs text-slate-500">
            Started {formatAgo(topic.createdAt)} · last new finding {formatAgo(topic.lastNewFindingAt)}
            {topic.status === "running" && !topic.cycleRunning && ` · next look ${formatUntil(topic.nextCycleAt)}`}
            {topic.consecutiveEmptyCycles > 0 && ` · ${topic.consecutiveEmptyCycles} quiet cycle(s), searching new angles`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {topic.status === "running" ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("pause", `/api/research/topics/${topic.id}/pause`, { method: "POST" })}
              className="rounded-md border border-amber-500/50 px-3 py-1.5 text-sm font-medium text-amber-200 hover:bg-amber-500/10 disabled:opacity-50"
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("resume", `/api/research/topics/${topic.id}/resume`, { method: "POST" })}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-emerald-400 disabled:opacity-50"
            >
              Resume
            </button>
          )}
          {topic.status !== "stopped" && (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => act("stop", `/api/research/topics/${topic.id}/stop`, { method: "POST" })}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Stop
            </button>
          )}
          <button
            type="button"
            disabled={busy !== null || topic.findingCount === 0 || topic.generatingDocuments}
            onClick={() => act("regenerate", `/api/research/topics/${topic.id}/documents/regenerate`, { method: "POST" })}
            className="rounded-md border border-violet-500/50 px-3 py-1.5 text-sm font-medium text-violet-200 hover:bg-violet-500/10 disabled:opacity-50"
          >
            {busy === "regenerate" || topic.generatingDocuments ? "Writing documents…" : "Rewrite documents now"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={remove}
            className="rounded-md px-3 py-1.5 text-sm font-medium text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {(error || topic.lastError) && (
        <p className="mt-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error ?? `Last cycle hit an error (it will retry): ${topic.lastError}`}
        </p>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
            <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums text-slate-100">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap gap-1 border-b border-slate-800" role="tablist">
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={clsx(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition",
              tab === key ? "border-sky-500 text-slate-100" : "border-transparent text-slate-400 hover:text-slate-200"
            )}
          >
            {label}
            {count !== null && <span className="ml-1.5 text-xs tabular-nums text-slate-500">{count}</span>}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === "documents" && <DocumentsView topicId={topic.id} documents={detail.documents} />}
        {tab === "findings" && <FindingsView findings={detail.findings} />}
        {tab === "questions" && <QuestionsView open={detail.openQuestions} explored={detail.exploredQuestions} />}
        {tab === "sources" && <SourcesView sources={detail.sources} />}
        {tab === "activity" && <ActivityView activity={detail.activity} />}
      </div>
    </section>
  );
};

// --- side cards --------------------------------------------------------------------------

const renderSnippet = (snippet: string) =>
  snippet.split(/«([^»]*)»/).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={index} className="rounded bg-sky-500/20 px-0.5 text-sky-200">
        {part}
      </mark>
    ) : (
      <span key={index}>{part}</span>
    )
  );

const KnowledgeSearch = ({ onOpenTopic }: { onOpenTopic: (id: string) => void }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const search = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!query.trim()) return;
    setError(null);
    try {
      const data = await apiRequest<{ results: SearchHit[] }>(`/api/research/search?q=${encodeURIComponent(query.trim())}`);
      setResults(data.results);
    } catch (caught) {
      setError(errorText(caught));
    }
  };

  return (
    <Card title="Search everything learned">
      <form onSubmit={search} className="flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Findings, documents, lessons…"
          aria-label="Search knowledge"
          className="min-w-0 flex-1 rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-100 focus:border-sky-500 focus:outline-none"
        />
        <button type="submit" className="rounded-md bg-slate-200 px-3 py-1.5 text-sm font-semibold text-slate-900 hover:bg-white">
          Search
        </button>
      </form>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
      {results && (
        <ul className="mt-3 space-y-2">
          {results.length === 0 && <li className="text-sm text-slate-500">Nothing matches that yet.</li>}
          {results.slice(0, 12).map((hit) => (
            <li key={`${hit.kind}-${hit.refId}`}>
              <button
                type="button"
                disabled={!hit.topicId}
                onClick={() => hit.topicId && onOpenTopic(hit.topicId)}
                className="w-full rounded-md border border-slate-800 p-2 text-left hover:border-slate-700 disabled:cursor-default"
              >
                <span className="text-[11px] uppercase tracking-wide text-slate-500">
                  {hit.kind.replace("document:", "").replace("_", " ")} · {hit.title}
                </span>
                <p className="mt-0.5 text-xs leading-relaxed text-slate-300">{renderSnippet(hit.snippet)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

const SecondBrainCard = () => {
  const { data, error, mutate } = useSWR<{ status: BrainStatus }>("second-brain-status", () => apiRequest("/api/second-brain/status"), {
    refreshInterval: 30_000
  });
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const status = data?.status;

  const syncNow = async () => {
    setSyncing(true);
    setMessage(null);
    try {
      const result = await apiRequest<{ synced: number; failed: number; skipped: boolean; reason?: string }>("/api/second-brain/sync", {
        method: "POST"
      });
      setMessage(result.skipped ? `Not synced: ${result.reason}` : `Synced ${result.synced}, failed ${result.failed}`);
      await mutate();
    } catch (caught) {
      setMessage(errorText(caught));
    } finally {
      setSyncing(false);
    }
  };

  const check = (ok: boolean, label: string) => (
    <li className="flex items-center gap-2 text-xs">
      <span className={clsx("h-2 w-2 rounded-full", ok ? "bg-emerald-500" : "bg-rose-500")} />
      <span className={ok ? "text-slate-300" : "text-slate-400"}>{label}</span>
    </li>
  );

  return (
    <Card
      title="Second-Brain sync"
      action={
        <button
          type="button"
          onClick={syncNow}
          disabled={syncing}
          className="rounded-md border border-slate-700 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50"
        >
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      }
    >
      {error && <p className="text-xs text-rose-300">{errorText(error)}</p>}
      {status && (
        <div className="space-y-3">
          <p className="truncate font-mono text-xs text-slate-400">{status.host ?? "no host configured"}</p>
          <ul className="space-y-1">
            {check(status.enabled, "Sync enabled")}
            {check(status.hasApiKey, "API key set")}
            {check(status.reachable, "Reachable")}
            {check(status.identityVerified, "Answers as an API (health check)")}
          </ul>
          <p className="text-xs tabular-nums text-slate-400">
            {status.queue.synced} synced · {status.queue.pending} waiting · {status.queue.retrying} retrying
          </p>
          {status.lastError && <p className="rounded-md bg-rose-500/10 px-2 py-1.5 text-xs text-rose-200">{status.lastError}</p>}
          {status.warnings.map((warning) => (
            <p key={warning} className="rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200">
              {warning}
            </p>
          ))}
          {message && <p className="text-xs text-slate-300">{message}</p>}
        </div>
      )}
    </Card>
  );
};

const LessonsCard = () => {
  const { data, error } = useSWR<{ lessons: Lesson[] }>("learning-lessons", () => apiRequest("/api/learning/lessons?scope=build"), {
    refreshInterval: 30_000
  });
  const lessons = data?.lessons ?? [];
  return (
    <Card title={`What the builder has learned (${lessons.length})`}>
      {error && <p className="text-xs text-rose-300">{errorText(error)}</p>}
      {lessons.length === 0 && !error && <p className="text-sm text-slate-500">No lessons yet.</p>}
      <ul className="space-y-3">
        {lessons.slice(0, 8).map((lesson) => (
          <li key={lesson.id}>
            <p className="text-xs leading-relaxed text-slate-300">{lesson.lesson}</p>
            <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
              <span className="h-1 w-14 overflow-hidden rounded-full bg-slate-800">
                <span className="block h-full bg-emerald-500" style={{ width: `${Math.round(lesson.utility * 100)}%` }} />
              </span>
              <span className="tabular-nums">
                fixed it {lesson.timesHelped} of {lesson.timesApplied} time{lesson.timesApplied === 1 ? "" : "s"}
              </span>
            </div>
            <p className="mt-0.5 truncate font-mono text-[10px] text-slate-600" title={lesson.signature}>
              {lesson.signature}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
};

// --- panel -------------------------------------------------------------------------------

export const ResearchPanel = ({ events = [] }: { events?: ServerEvent[] }) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: topicsData, error: topicsError, mutate: mutateTopics } = useSWR<{ topics: TopicSummary[] }>(
    "research-topics",
    () => apiRequest("/api/research/topics"),
    { refreshInterval: 10_000 }
  );
  const topics = useMemo(() => topicsData?.topics ?? [], [topicsData]);

  useEffect(() => {
    if (topics.length === 0) return;
    if (!selectedId || !topics.some((topic) => topic.id === selectedId)) setSelectedId(topics[0].id);
  }, [topics, selectedId]);

  const {
    data: detail,
    error: detailError,
    mutate: mutateDetail
  } = useSWR<TopicDetail>(selectedId ? ["research-topic", selectedId] : null, () => apiRequest(`/api/research/topics/${selectedId}`), {
    refreshInterval: 8_000
  });

  // Refresh immediately when the server reports research progress, rather than waiting for the next poll.
  const latestResearchEvent = useMemo(() => events.find((event) => (event as { type: string }).type === "research"), [events]);
  useEffect(() => {
    if (!latestResearchEvent) return;
    void mutateTopics();
    void mutateDetail();
  }, [latestResearchEvent, mutateTopics, mutateDetail]);

  const refresh = () => {
    void mutateTopics();
    void mutateDetail();
  };

  return (
    <section className="mx-auto mt-10 max-w-7xl px-6">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-100">Research</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-400">
          Continuous research across Wikipedia, arXiv, GitHub, Hacker News and the web. Every finding is checked against the
          source it came from, and study documents are rewritten as the research grows — then synced to Second-Brain.
        </p>
      </div>

      {topicsError && (
        <p className="mb-4 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          Could not load research: {errorText(topicsError)}. Sign in on the Overview tab if you haven&apos;t.
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <StartResearchForm
            onStarted={(id) => {
              setSelectedId(id);
              refresh();
            }}
          />
          <TopicList topics={topics} selectedId={selectedId} onSelect={setSelectedId} />
          <KnowledgeSearch onOpenTopic={setSelectedId} />
          <LessonsCard />
          <SecondBrainCard />
        </div>

        <div className="min-w-0">
          {detailError && <p className="text-sm text-rose-300">{errorText(detailError)}</p>}
          {detail ? (
            <TopicDetailView
              key={detail.topic.id}
              detail={detail}
              onChanged={refresh}
              onDeleted={() => {
                setSelectedId(null);
                refresh();
              }}
            />
          ) : (
            !detailError && (
              <div className="rounded-xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
                {topics.length === 0 ? "Start a topic to begin researching." : "Loading…"}
              </div>
            )
          )}
        </div>
      </div>
    </section>
  );
};
