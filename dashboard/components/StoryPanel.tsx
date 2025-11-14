import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  fetchStorySummary,
  fetchStoryTimeline,
  recallStoryEntity,
  sendStoryCommand,
  type ServerEvent,
  type StoryCommandResponse,
  type StoryEntitySnapshot,
  type StoryTimelineEvent
} from "../lib/api";
import heroImages from "../theme/heroImages";
import HeroSection from "./ui/HeroSection";

const dedupeEvents = (events: StoryTimelineEvent[]) => {
  const seen = new Set<string>();
  const result: StoryTimelineEvent[] = [];
  for (const event of events) {
    if (seen.has(event.id)) continue;
    seen.add(event.id);
    result.push(event);
  }
  return result;
};

const formatTimestamp = (timestamp: string) => new Date(timestamp).toLocaleString();

type StoryPanelProps = {
  events: ServerEvent[];
};

export const StoryPanel = ({ events }: StoryPanelProps) => {
  const [command, setCommand] = useState("");
  const [sessionId, setSessionId] = useState("storyworld");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [narrate, setNarrate] = useState(true);
  const [narration, setNarration] = useState<StoryCommandResponse["narration"] | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null);
  const [entitySnapshot, setEntitySnapshot] = useState<StoryEntitySnapshot | null>(null);
  const [timeline, setTimeline] = useState<StoryTimelineEvent[]>([]);

  const { data: fetchedTimeline, mutate: refreshTimeline } = useSWR("storyworld/timeline", () => fetchStoryTimeline(120), {
    refreshInterval: 15000
  });
  const { data: summaryData, mutate: refreshSummary } = useSWR(
    ["storyworld/summary", sessionId],
    () => fetchStorySummary(sessionId),
    {
      refreshInterval: 20000
    }
  );

  useEffect(() => {
    if (fetchedTimeline?.events) {
      setTimeline((prev) => dedupeEvents([...fetchedTimeline.events, ...prev]));
    }
  }, [fetchedTimeline?.events]);

  useEffect(() => {
    const newEvents = events
      .filter((event): event is Extract<ServerEvent, { type: "story" }> => event.type === "story")
      .map((event) => event.payload);
    if (newEvents.length > 0) {
      setTimeline((prev) => dedupeEvents([...newEvents, ...prev]).slice(0, 150));
    }
  }, [events]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!command.trim()) return;
      setIsSubmitting(true);
      setNarration(null);

      try {
        const response = await sendStoryCommand({ command: command.trim(), sessionId, narrate });
        if (response.events) {
          setTimeline((prev) => dedupeEvents([...response.events, ...prev]).slice(0, 150));
        }
        if (response.narration) {
          setNarration(response.narration);
        }
        setCommand("");
        await Promise.all([refreshTimeline(), refreshSummary()]);
      } catch (error) {
        console.error("Failed to submit story command", error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [command, sessionId, narrate, refreshTimeline, refreshSummary]
  );

  const selectEntity = useCallback(async (entityId: string) => {
    setSelectedEntity(entityId);
    try {
      const snapshot = await recallStoryEntity(entityId);
      setEntitySnapshot(snapshot);
    } catch (error) {
      console.error("Failed to load entity snapshot", error);
    }
  }, []);

  const activeSummary = summaryData?.summary ?? "No story events yet.";

  const renderedTimeline = useMemo(
    () =>
      timeline.map((entry) => (
        <button
          key={entry.id}
          onClick={() => selectEntity(entry.entityId)}
          className={`w-full rounded-lg border border-slate-800 px-4 py-3 text-left transition hover:border-fuchsia-500/50 hover:bg-fuchsia-950/20 ${
            selectedEntity === entry.entityId ? "border-fuchsia-600 bg-fuchsia-950/20" : ""
          }`}
        >
          <p className="text-xs uppercase tracking-wide text-fuchsia-300">{entry.entityLabel ?? entry.entityId}</p>
          <p className="mt-1 text-sm text-slate-100">{entry.description}</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-500">
            {formatTimestamp(entry.createdAt)} · Tags: {entry.tags.join(", ") || "none"}
          </p>
        </button>
      )),
    [timeline, selectEntity, selectedEntity]
  );

  return (
    <section className="mx-auto mt-10 max-w-6xl overflow-hidden rounded-xl border border-slate-900/60 bg-slate-950/60 shadow-2xl shadow-black/40">
      <HeroSection
        image={heroImages.story}
        title="StoryWorld Orchestrator"
        subtitle="Powered by Hustle Studio"
        className="rounded-t-xl border-b border-slate-800 overflow-hidden"
      />

      <div className="grid gap-8 px-6 pb-6 pt-2 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-xl border border-fuchsia-900/40 bg-slate-950/80 p-6 shadow-lg shadow-fuchsia-900/20">
          <h2 className="text-lg font-semibold text-fuchsia-200">StoryWorld Orchestrator</h2>
          <p className="mt-2 text-sm text-slate-400">
            Issue narrative directives and coordinate quests, NPCs, and terrain in your persistent Roblox world. All actions are
            tracked in WorldMemory for future recall.
          </p>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
              <label className="flex flex-col gap-2">
                <span className="text-xs uppercase tracking-wide text-slate-400">Command</span>
                <textarea
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  rows={4}
                  placeholder="Introduce a rival faction that challenges the current quest line"
                  className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 shadow-inner focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
                  disabled={isSubmitting}
                />
              </label>
              <div className="space-y-3">
                <label className="flex flex-col gap-2">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Session ID</span>
                  <input
                    value={sessionId}
                    onChange={(event) => setSessionId(event.target.value)}
                    className="rounded-md border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-slate-100 focus:border-fuchsia-500 focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
                  <input
                    type="checkbox"
                    checked={narrate}
                    onChange={(event) => setNarrate(event.target.checked)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-fuchsia-500 focus:ring-fuchsia-500"
                  />
                  Narrate with voice
                </label>
              </div>
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center justify-center rounded-md bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-fuchsia-400 disabled:cursor-not-allowed disabled:bg-slate-700"
            >
              {isSubmitting ? "Orchestrating story..." : "Execute Narrative Command"}
            </button>
          </form>
          {narration && (
            <div className="mt-4 rounded-lg border border-fuchsia-900/60 bg-fuchsia-950/30 p-4 text-sm text-fuchsia-100">
              <p className="font-semibold">Narration Ready</p>
              <p className="mt-1 text-xs text-fuchsia-200/80">Voice: {narration.voice}</p>
              <a
                href={narration.filePath}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-flex text-xs font-semibold text-fuchsia-300 underline hover:text-fuchsia-100"
              >
                Open narration audio
              </a>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-900 bg-slate-950/80 p-6">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-fuchsia-200">World Timeline</h3>
            <button
              onClick={() => {
                void refreshTimeline();
                void refreshSummary();
              }}
              className="text-xs uppercase tracking-wide text-fuchsia-400 hover:text-fuchsia-200"
            >
              Refresh
            </button>
          </div>
          <p className="mt-2 text-sm text-slate-400">Latest orchestrated events across quests, NPCs, and terrain.</p>
          <div className="mt-4 grid gap-3">{renderedTimeline}</div>
        </div>
      </div>

      <aside className="space-y-6">
        <div className="rounded-xl border border-fuchsia-900/40 bg-slate-950/80 p-5">
          <h3 className="text-base font-semibold text-fuchsia-200">Session Summary</h3>
          <p className="mt-2 whitespace-pre-line text-sm text-slate-200">{activeSummary}</p>
        </div>
        <div className="rounded-xl border border-slate-900 bg-slate-950/80 p-5">
          <h3 className="text-base font-semibold text-fuchsia-200">Entity Memory</h3>
          {entitySnapshot?.entity ? (
            <div className="space-y-3 text-sm text-slate-200">
              <div>
                <p className="font-semibold">{entitySnapshot.entity.label}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">{entitySnapshot.entity.type}</p>
                <p className="text-xs text-slate-500">Updated {formatTimestamp(entitySnapshot.entity.updatedAt)}</p>
              </div>
              {entitySnapshot.entity.metadata && (
                <pre className="overflow-x-auto rounded-md bg-slate-900/70 p-3 text-xs text-slate-300">
                  {JSON.stringify(entitySnapshot.entity.metadata, null, 2)}
                </pre>
              )}
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Recent Events</p>
                <ul className="mt-2 space-y-2">
                  {entitySnapshot.events.slice(0, 5).map((event) => (
                    <li key={event.id} className="rounded-md border border-slate-800 bg-slate-900/60 p-2">
                      <p className="text-xs text-slate-200">{event.description}</p>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">
                        {formatTimestamp(event.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Select an event to view its memory graph.</p>
          )}
        </div>
      </aside>
      </div>
    </section>
  );
};
