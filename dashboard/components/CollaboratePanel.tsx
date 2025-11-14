"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  CollaborationParticipant,
  CollaborationSnapshot,
  createCollaborationSession,
  fetchCollaborationSnapshot,
  joinCollaborationSession,
  listCollaborationSessions,
  subscribeToEvents,
  updateCollaborationContext,
  type CollaborationRoomContext,
  type ServerEvent
} from "../lib/api";

const randomParticipant = (): CollaborationParticipant => {
  const randomId = Math.random().toString(36).slice(2, 10);
  const roles: CollaborationParticipant["role"][] = ["Builder", "UX", "QA", "Ops"];
  return {
    id: randomId,
    name: `Guest-${randomId.slice(0, 4)}`,
    role: roles[Math.floor(Math.random() * roles.length)]
  };
};

export function CollaboratePanel() {
  const [sessionId, setSessionId] = useState("");
  const [currentParticipant, setCurrentParticipant] = useState<CollaborationParticipant>(() => randomParticipant());
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [status, setStatus] = useState("Idle");
  const [joining, setJoining] = useState(false);
  const [contextDraft, setContextDraft] = useState<CollaborationRoomContext | null>(null);
  const [syncingContext, setSyncingContext] = useState(false);

  useEffect(() => {
    const subscription = subscribeToEvents((event: ServerEvent) => {
      if (event.type !== "collaboration") return;
      if (sessionId && event.payload.sessionId !== sessionId) return;
      void fetchCollaborationSnapshot(event.payload.sessionId).then((result) => {
        setSnapshot(result.snapshot);
        setContextDraft(result.snapshot.context ?? null);
      });
    });

    return () => subscription.close();
  }, [sessionId]);

  const handleCreate = useCallback(async () => {
    setJoining(true);
      try {
        const { snapshot: created } = await createCollaborationSession();
        setSessionId(created.id);
        setSnapshot(created);
        setContextDraft(created.context ?? null);
        setStatus(`Session ${created.id} ready`);
      } catch (error) {
        console.error("Failed to create session", error);
        setStatus("Failed to create session");
      } finally {
      setJoining(false);
    }
  }, []);

  const handleJoin = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!sessionId) return;
      setJoining(true);
      try {
        const result = await joinCollaborationSession(sessionId, {
          id: currentParticipant.id,
          name: currentParticipant.name,
          role: currentParticipant.role
        });
        setSnapshot(result.session.snapshot);
        setContextDraft(result.session.snapshot.context ?? null);
        setStatus(`Joined session ${result.session.id}`);
      } catch (error) {
        console.error("Failed to join session", error);
        setStatus("Failed to join session");
      } finally {
        setJoining(false);
      }
    },
    [sessionId, currentParticipant]
  );

  const inviteUrl = useMemo(() => {
    if (!sessionId || typeof window === "undefined") {
      return "";
    }
    const url = new URL(window.location.href);
    url.hash = `collab:${sessionId}`;
    return url.toString();
  }, [sessionId]);

  const syncContext = async () => {
    if (!sessionId || !contextDraft) return;
    setSyncingContext(true);
    try {
      const result = await updateCollaborationContext(sessionId, contextDraft);
      setContextDraft(result.context);
      await fetchCollaborationSnapshot(sessionId).then((res) => setSnapshot(res.snapshot));
      setStatus("Context synced");
    } catch (error) {
      console.error("Failed to sync context", error);
      setStatus("Failed to sync context");
    } finally {
      setSyncingContext(false);
    }
  };

  const loadLatestSession = async () => {
    try {
      const result = await listCollaborationSessions();
      const latest = result.sessions[0];
      if (latest) {
        setSessionId(latest.id);
        setSnapshot(latest);
        setContextDraft(latest.context ?? null);
        setStatus(`Loaded session ${latest.id}`);
      }
    } catch (error) {
      console.error("Failed to list sessions", error);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Live Collaboration</h2>
          <button
            className="rounded-md border border-sky-500/60 bg-sky-600/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-sky-200"
            onClick={() => {
              setCurrentParticipant(randomParticipant());
            }}
          >
            Shuffle Avatar
          </button>
        </div>
        <p className="text-sm text-slate-400">
          Create or join a shared editing session. Participants and file diffs stream into the Monaco editor in upcoming releases.
        </p>

        <form className="space-y-3" onSubmit={handleJoin}>
          <div>
            <label className="text-xs uppercase tracking-wide text-slate-400">Session ID</label>
            <input
              value={sessionId}
              onChange={(event) => setSessionId(event.target.value)}
              placeholder="default-abc123"
              className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Display Name</label>
              <input
                value={currentParticipant.name}
                onChange={(event) => setCurrentParticipant((prev) => ({ ...prev, name: event.target.value }))}
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">Role</label>
              <select
                value={currentParticipant.role}
                onChange={(event) =>
                  setCurrentParticipant((prev) => ({ ...prev, role: event.target.value as CollaborationParticipant["role"] }))
                }
                className="mt-1 w-full rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              >
                <option value="Builder">Builder</option>
                <option value="UX">UX</option>
                <option value="QA">QA</option>
                <option value="Ops">Ops</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={joining || !sessionId}
              className="rounded-md bg-emerald-600/80 px-4 py-2 text-sm font-semibold text-emerald-50 disabled:opacity-50"
            >
              Join Session
            </button>
            <button
              type="button"
              onClick={handleCreate}
              disabled={joining}
              className="rounded-md border border-indigo-500/60 bg-indigo-600/20 px-4 py-2 text-sm font-semibold text-indigo-100 disabled:opacity-50"
            >
              Create Session
            </button>
            <button
              type="button"
              onClick={loadLatestSession}
              className="rounded-md border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800/70"
            >
              Load Latest
            </button>
          </div>
        </form>

        <p className="text-xs font-mono uppercase tracking-wide text-slate-500">{status}</p>

        <div className="rounded-md border border-slate-800 bg-slate-950/50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Invite Link</p>
          <p className="mt-1 break-all text-sm text-slate-200">{inviteUrl || "Create or join a session to generate a link."}</p>
        </div>

        <div className="rounded-md border border-slate-800 bg-slate-950/50 p-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">Room Context</p>
          <textarea
            value={contextDraft?.summary ?? ""}
            onChange={(event) =>
              setContextDraft((prev) => ({
                summary: event.target.value,
                activeAgents: prev?.activeAgents ?? [],
                repos: prev?.repos,
                lastCommand: prev?.lastCommand,
                updatedAt: new Date().toISOString()
              }))
            }
            placeholder="Shared goals, repos, or TODOs"
            className="mt-2 h-24 w-full rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
          />
          <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-400">
            <span>Active agents: {contextDraft?.activeAgents.join(", ") || "–"}</span>
            <span>Repos: {contextDraft?.repos?.join(", ") || "–"}</span>
          </div>
          <button
            type="button"
            onClick={syncContext}
            disabled={syncingContext || !sessionId}
            className="mt-3 rounded-md bg-sky-500/80 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {syncingContext ? "Syncing…" : "Sync Context"}
          </button>
        </div>
      </div>

      <aside className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h3 className="text-sm font-semibold text-slate-100">Participants</h3>
        <ul className="space-y-2">
          {(snapshot?.participants ?? []).map((participant) => (
            <li key={participant.id} className="flex items-center justify-between rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2">
              <div>
                <p className="text-sm font-medium text-slate-100">{participant.name}</p>
                <p className="text-xs uppercase tracking-wide text-slate-500">{participant.role}</p>
              </div>
              {participant.cursor && (
                <span className="rounded bg-slate-800 px-2 py-1 text-[10px] font-mono text-slate-300">
                  {participant.cursor.filePath}:{participant.cursor.position.line}:{participant.cursor.position.column}
                </span>
              )}
            </li>
          ))}
        </ul>
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Recent Files</p>
          <ul className="mt-2 space-y-1">
            {snapshot && Object.keys(snapshot.files).length === 0 && (
              <li className="text-xs text-slate-500">No diffs recorded yet.</li>
            )}
            {snapshot &&
              Object.entries(snapshot.files).map(([filePath, diff]) => (
                <li key={filePath} className="rounded border border-slate-800 bg-slate-950/60 p-2">
                  <p className="text-xs font-semibold text-slate-200">{filePath}</p>
                  <pre className="mt-1 max-h-32 overflow-auto text-[11px] text-slate-400">{diff}</pre>
                </li>
              ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
