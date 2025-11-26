import { useMemo } from "react";
import type { ServerEvent } from "../lib/api";

type EventFeedProps = {
  events: ServerEvent[];
};

export const EventFeed = ({ events }: EventFeedProps) => {
  const rendered = useMemo(
    () =>
      events.slice(0, 50).map((event, index) => {
        if (event.type === "log") {
          return (
            <li key={`${event.payload.timestamp}-${index}`} className="rounded-md border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-slate-500">
                {event.payload.level} · {new Date(event.payload.timestamp).toLocaleTimeString()}
              </p>
              <p className="mt-1 text-sm text-slate-200">{event.payload.message}</p>
            </li>
          );
        }

        if (event.type === "feedback") {
          return (
            <li key={`${event.payload.timestamp}-${index}`} className="rounded-md border border-emerald-900 bg-emerald-950/40 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-emerald-400">Feedback Processed</p>
              <p className="mt-1 text-sm text-emerald-100">
                Aggregated {event.payload.summary.count} entr{event.payload.summary.count === 1 ? "y" : "ies"}
              </p>
              <p className="text-xs text-emerald-300/70">{new Date(event.payload.timestamp).toLocaleTimeString()}</p>
            </li>
          );
        }

        if (event.type === "analytics") {
          return (
            <li key={`${event.payload.timestamp}-${index}`} className="rounded-md border border-sky-900 bg-sky-950/40 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-sky-300">Analytics Snapshot</p>
              <p className="mt-1 text-sm text-slate-200">{Object.keys(event.payload.summary ?? {}).length} metrics refreshed</p>
              <p className="text-xs text-slate-400">{new Date(event.payload.timestamp).toLocaleTimeString()}</p>
            </li>
          );
        }

        if (event.type === "marketplace") {
          const rawAction = event.payload.action;
          const actionLabel = typeof rawAction === "string" ? rawAction : String(rawAction ?? "change");
          const identifier =
            typeof event.payload.pluginId === "string"
              ? event.payload.pluginId
              : typeof event.payload.requestId === "string"
                ? event.payload.requestId
                : "request";
          return (
            <li key={`${event.payload.timestamp}-${index}`} className="rounded-md border border-amber-900 bg-amber-950/40 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-amber-300">Marketplace Update</p>
              <p className="mt-1 text-sm text-slate-100">{actionLabel.toUpperCase()} · {identifier}</p>
              <p className="text-xs text-amber-200/70">{new Date(event.payload.timestamp).toLocaleTimeString()}</p>
            </li>
          );
        }

        if (event.type === "container") {
          const rawAction = event.payload.action;
          const actionLabel = typeof rawAction === "string" ? rawAction : String(rawAction ?? "update");
          const containerId = typeof event.payload.containerId === "string" ? event.payload.containerId : "container";
          return (
            <li key={`${event.payload.timestamp}-${index}`} className="rounded-md border border-purple-900 bg-purple-950/40 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-purple-300">Sandbox</p>
              <p className="mt-1 text-sm text-slate-100">{actionLabel.toUpperCase()} · {containerId}</p>
              <p className="text-xs text-purple-200/70">{new Date(event.payload.timestamp).toLocaleTimeString()}</p>
            </li>
          );
        }

        if (event.type === "queue") {
          const queueName = typeof event.payload.queue === "string" ? event.payload.queue : "queue";
          const action = typeof event.payload.action === "string" ? event.payload.action : "event";
          return (
            <li key={`${event.payload.timestamp}-${index}`} className="rounded-md border border-cyan-900 bg-cyan-950/40 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-cyan-300">Queue {queueName}</p>
              <p className="mt-1 text-sm text-slate-100">{action.toUpperCase()}</p>
              <p className="text-xs text-cyan-200/70">{new Date(event.payload.timestamp).toLocaleTimeString()}</p>
            </li>
          );
        }

        if (event.type === "health") {
          return (
            <li key={`${event.payload.timestamp}-${index}`} className="rounded-md border border-emerald-900 bg-emerald-950/40 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-emerald-300">Health Snapshot</p>
              <p className="mt-1 text-sm text-slate-100">Status: {event.payload.snapshot.status.toUpperCase()}</p>
              <p className="text-xs text-emerald-200/70">{new Date(event.payload.timestamp).toLocaleTimeString()}</p>
            </li>
          );
        }

        if (event.type === "security") {
          const action = typeof event.payload.action === "string" ? event.payload.action : "security";
          const status = typeof event.payload.status === "string" ? event.payload.status : "ok";
          return (
            <li key={`${event.payload.timestamp}-${index}`} className="rounded-md border border-rose-900 bg-rose-950/40 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-rose-300">Security</p>
              <p className="mt-1 text-sm text-slate-100">{action.toUpperCase()} · {status.toUpperCase()}</p>
              <p className="text-xs text-rose-200/70">{new Date(event.payload.timestamp).toLocaleTimeString()}</p>
            </li>
          );
        }

        if (event.type === "builder") {
          const status = (event.payload.level as string)?.toUpperCase() ?? "INFO";
          const message = (event.payload.message as string) ?? "";
          return (
            <li
              key={`${event.payload.timestamp ?? index}`}
              className="rounded-md border border-blue-900 bg-blue-950/40 p-3 text-blue-100"
            >
              <p className="text-xs font-mono uppercase tracking-wide">Builder</p>
              <p className="mt-1 text-sm">{message}</p>
              {event.payload.details && (
                <p className="text-xs text-blue-200">{JSON.stringify(event.payload.details)}</p>
              )}
              <p className="text-[10px] uppercase tracking-wide text-blue-300">{status}</p>
            </li>
          );
        }

        if (event.type === "collaboration") {
          return (
            <li
              key={`${event.payload.timestamp}-${index}`}
              className="rounded-md border border-indigo-900 bg-indigo-950/40 p-3"
            >
              <p className="text-xs font-mono uppercase tracking-wide text-indigo-300">Collaboration</p>
              <p className="mt-1 text-sm text-slate-100">{event.payload.message}</p>
              <p className="text-xs text-indigo-200/70">
                Participants: {event.payload.participants.map((participant) => participant.name).join(", ") || "n/a"}
              </p>
              {event.payload.context && (
                <p className="text-[10px] text-indigo-200/60">
                  {event.payload.context.summary} · Agents: {event.payload.context.activeAgents.join(", ") || "–"}
                </p>
              )}
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                {new Date(event.payload.timestamp).toLocaleTimeString()} · Session {event.payload.sessionId}
              </p>
            </li>
          );
        }

        if (event.type === "build" && (event.payload as any)?.job) {
          return (
            <li
              key={`${event.payload.job.id}-${index}`}
              className="rounded-md border border-sky-900 bg-sky-950/40 p-3"
            >
              <p className="text-xs font-mono uppercase tracking-wide text-sky-300">Build Engine</p>
              <p className="mt-1 text-sm text-slate-100">{event.payload.job.prompt}</p>
              <p className="text-xs text-slate-400">
                Mode: {event.payload.job.mode.toUpperCase()} · Status: {event.payload.job.status.toUpperCase()}
              </p>
              {event.payload.job.plan && event.payload.job.plan.length > 0 && (
                <p className="text-[10px] text-slate-500">Plan: {event.payload.job.plan.join(" → ")}</p>
              )}
            </li>
          );
        }

        if (event.type === "story") {
          return (
            <li
              key={`${event.payload.id}-${index}`}
              className="rounded-md border border-fuchsia-900 bg-fuchsia-950/40 p-3"
            >
              <p className="text-xs font-mono uppercase tracking-wide text-fuchsia-300">StoryWorld</p>
              <p className="mt-1 text-sm text-slate-100">{event.payload.description}</p>
              <p className="text-xs text-fuchsia-200/70">
                {event.payload.entityLabel ?? event.payload.entityId} · {event.payload.tags.join(", ")}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                {new Date(event.payload.createdAt).toLocaleTimeString()} · Session {event.payload.sessionId ?? "storyworld"}
              </p>
            </li>
          );
        }

        if (event.type === "simulation") {
          return (
            <li
              key={`${event.payload.id}-${index}`}
              className="rounded-md border border-amber-900 bg-amber-950/40 p-3"
            >
              <p className="text-xs font-mono uppercase tracking-wide text-amber-300">Simulation</p>
              <p className="mt-1 text-sm text-slate-100">{event.payload.description}</p>
              <p className="text-xs text-amber-200/70">
                {event.payload.label ?? event.payload.category.toUpperCase()}
                {event.payload.npcId ? ` · NPC ${event.payload.npcId}` : ""}
              </p>
              <p className="text-[10px] uppercase tracking-wide text-slate-500">
                {new Date(event.payload.timestamp).toLocaleTimeString()}
              </p>
            </li>
          );
        }

        if (event.type === "task") {
          return (
            <li key={`${event.payload.task.id}-${index}`} className="rounded-md border border-slate-800 bg-slate-900/60 p-3">
              <p className="text-xs font-mono uppercase tracking-wide text-sky-400">
                Task {event.payload.task.agentType}
              </p>
              <p className="mt-1 text-sm text-slate-200">Status: {event.payload.task.status}</p>
              <p className="text-xs text-slate-400">
                Updated {new Date(event.payload.timestamp).toLocaleTimeString()}
              </p>
            </li>
          );
        }

        return null;
      }),
    [events]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-100">Live Activity</h2>
        <span className="text-xs uppercase tracking-wide text-slate-500">Last {Math.min(events.length, 50)} events</span>
      </div>
      <ul className="grid gap-2">{rendered}</ul>
    </div>
  );
};
