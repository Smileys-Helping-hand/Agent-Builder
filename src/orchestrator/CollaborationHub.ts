import { EventEmitter } from "events";
import { emitServerEvent } from "../server/eventBus.js";
import type { StoryTimelineEvent } from "../models/NarrativeTypes.js";
import type { SimulationEvent } from "./WorldSimulator.js";
import type { BuildJobSnapshot } from "../models/BuildTypes.js";

export type RobloxSyncStatus = "disconnected" | "connecting" | "connected" | "sync" | "playtest" | "error";

export type RobloxSyncPayload = {
  status: RobloxSyncStatus;
  message: string;
  path?: string;
  metadata?: Record<string, unknown>;
  timestamp: string;
};

export type CollaborationEvent =
  | {
      type: "roblox_sync";
      payload: RobloxSyncPayload;
    }
  | {
      type: "collaboration";
      payload: {
        sessionId: string;
        message: string;
        participants: CollaborationParticipant[];
        timestamp: string;
        context?: CollaborationRoomContext | null;
      };
    };

export type CollaborationRoomContext = {
  summary: string;
  repos?: string[];
  activeAgents: string[];
  lastCommand?: string;
  updatedAt: string;
};

export type StoryBroadcastListener = (event: StoryTimelineEvent) => void;
export type SimulationListener = (event: SimulationEvent) => void;

export type CollaborationParticipant = {
  id: string;
  name: string;
  role: "Builder" | "UX" | "QA" | "Ops";
  cursor?: { filePath: string; position: { line: number; column: number } } | null;
  socketId?: string;
};

export type SessionSnapshot = {
  id: string;
  room: "default" | "sandbox" | "team";
  participants: CollaborationParticipant[];
  files: Record<string, string>;
  updatedAt: string;
  context?: CollaborationRoomContext | null;
};

type RobloxListener = (payload: RobloxSyncPayload) => void;

export class CollaborationHub {
  private static instance: CollaborationHub | null = null;
  private readonly emitter = new EventEmitter();
  private readonly sessions = new Map<
    string,
    {
      id: string;
      room: "default" | "sandbox" | "team";
      participants: CollaborationParticipant[];
      files: Map<string, string>;
      updatedAt: Date;
    }
  >();
  private readonly storyTimeline: StoryTimelineEvent[] = [];
  private readonly simulationLog: SimulationEvent[] = [];
  private readonly contexts = new Map<string, CollaborationRoomContext>();

  static getInstance() {
    if (!this.instance) {
      this.instance = new CollaborationHub();
    }
    return this.instance;
  }

  broadcastRobloxSync(payload: Omit<RobloxSyncPayload, "timestamp"> & { timestamp?: string }) {
    const enriched: RobloxSyncPayload = {
      ...payload,
      timestamp: payload.timestamp ?? new Date().toISOString()
    };

    emitServerEvent({ type: "roblox_sync", payload: enriched });
    this.emitter.emit("roblox_sync", enriched);
  }

  broadcastStoryEvent(event: StoryTimelineEvent) {
    this.storyTimeline.unshift(event);
    if (this.storyTimeline.length > 200) {
      this.storyTimeline.length = 200;
    }

    emitServerEvent({ type: "story", payload: event });
    this.emitter.emit("story", event);
  }

  broadcastSimulation(event: SimulationEvent) {
    this.simulationLog.unshift(event);
    if (this.simulationLog.length > 200) {
      this.simulationLog.length = 200;
    }

    emitServerEvent({ type: "simulation", payload: event });
    this.emitter.emit("simulation", event);
  }

  broadcastCollaboration(sessionId: string, message: string) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    const payload = {
      sessionId,
      message,
      participants: [...session.participants],
      timestamp: new Date().toISOString(),
      context: this.contexts.get(sessionId) ?? null
    };
    emitServerEvent({ type: "collaboration", payload });
    this.emitter.emit("collaboration", payload);
  }

  broadcastBuild(job: BuildJobSnapshot, sessionId?: string | null) {
    if (sessionId) {
      this.updateContext(sessionId, {
        summary: job.prompt,
        lastCommand: job.logs.at(-1) ?? job.status,
        activeAgents: Array.from(
          new Set([
            ...(this.contexts.get(sessionId)?.activeAgents ?? []),
            ...job.steps.map((step) => step.agent).filter((agent): agent is string => Boolean(agent))
          ])
        ),
        repos: job.metadata?.repositories as string[] | undefined
      });
    }
    this.emitter.emit("build", { job, sessionId: sessionId ?? null });
  }

  onBuild(listener: (payload: { job: BuildJobSnapshot; sessionId: string | null }) => void) {
    this.emitter.on("build", listener);
    return () => this.emitter.off("build", listener);
  }

  setSessionContext(sessionId: string, context: Partial<CollaborationRoomContext>) {
    const merged = this.updateContext(sessionId, context);
    this.broadcastCollaboration(sessionId, "Context updated");
    return merged;
  }

  getSessionContext(sessionId: string) {
    return this.contexts.get(sessionId) ?? null;
  }

  listSessions(): SessionSnapshot[] {
    return [...this.sessions.values()].map((session) => this.toSnapshot(session));
  }

  onRobloxSync(listener: RobloxListener) {
    this.emitter.on("roblox_sync", listener);
    return () => {
      this.emitter.off("roblox_sync", listener);
    };
  }

  onStoryEvent(listener: StoryBroadcastListener) {
    this.emitter.on("story", listener);
    return () => {
      this.emitter.off("story", listener);
    };
  }

  onSimulation(listener: SimulationListener) {
    this.emitter.on("simulation", listener);
    return () => {
      this.emitter.off("simulation", listener);
    };
  }

  createSession(room: "default" | "sandbox" | "team" = "default") {
    const id = `${room}-${Math.random().toString(36).slice(2, 8)}`;
    const session = {
      id,
      room,
      participants: [] as CollaborationParticipant[],
      files: new Map<string, string>(),
      updatedAt: new Date()
    };
    this.sessions.set(id, session);
    this.updateContext(id, {
      summary: `Session ${id} ready`,
      activeAgents: [],
      repos: [],
      lastCommand: "create"
    });
    this.broadcastCollaboration(id, `Session ${id} created`);
    return this.toSnapshot(session);
  }

  joinSession(sessionId: string, participant: CollaborationParticipant, socketId?: string) {
    const session = this.ensureSession(sessionId);
    const existing = session.participants.find((member) => member.id === participant.id);
    if (existing) {
      existing.cursor = participant.cursor ?? null;
      existing.name = participant.name;
      existing.role = participant.role;
      existing.socketId = socketId;
    } else {
      session.participants.push({ ...participant, socketId });
    }
    session.updatedAt = new Date();
    this.broadcastCollaboration(session.id, `${participant.name} joined the session`);
    return { participants: [...session.participants], snapshot: this.toSnapshot(session), id: session.id };
  }

  updateCursor(sessionId: string, participantId: string, cursor: CollaborationParticipant["cursor"] | null) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    const participant = session.participants.find((member) => member.id === participantId);
    if (!participant) return null;
    participant.cursor = cursor ?? null;
    session.updatedAt = new Date();
    return [...session.participants];
  }

  recordDiff(sessionId: string, filePath: string, diff: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    session.files.set(filePath, diff);
    session.updatedAt = new Date();
    const update = { sessionId, filePath, diff, timestamp: new Date().toISOString() };
    this.broadcastCollaboration(sessionId, `Updated ${filePath}`);
    return update;
  }

  removeBySocket(socketId: string) {
    const updates: { sessionId: string; participants: CollaborationParticipant[] }[] = [];
    for (const session of this.sessions.values()) {
      const before = session.participants.length;
      session.participants = session.participants.filter((participant) => participant.socketId !== socketId);
      if (session.participants.length !== before) {
        updates.push({ sessionId: session.id, participants: [...session.participants] });
        this.broadcastCollaboration(session.id, "Participant disconnected");
      }
    }
    return updates;
  }

  snapshot(sessionId: string) {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return this.toSnapshot(session);
  }

  private ensureSession(sessionId: string) {
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        room: "default",
        participants: [],
        files: new Map<string, string>(),
        updatedAt: new Date()
      };
      this.sessions.set(sessionId, session);
    }
    return session;
  }

  private toSnapshot(session: {
    id: string;
    room: "default" | "sandbox" | "team";
    participants: CollaborationParticipant[];
    files: Map<string, string>;
    updatedAt: Date;
  }): SessionSnapshot {
    return {
      id: session.id,
      room: session.room,
      participants: [...session.participants],
      files: Object.fromEntries(session.files.entries()),
      updatedAt: session.updatedAt.toISOString(),
      context: this.contexts.get(session.id) ?? null
    };
  }

  private updateContext(sessionId: string, context: Partial<CollaborationRoomContext>) {
    const existing = this.contexts.get(sessionId);
    const merged: CollaborationRoomContext = {
      summary: context.summary ?? existing?.summary ?? `Session ${sessionId}`,
      repos: context.repos ?? existing?.repos,
      activeAgents: context.activeAgents ?? existing?.activeAgents ?? [],
      lastCommand: context.lastCommand ?? existing?.lastCommand,
      updatedAt: new Date().toISOString()
    };
    this.contexts.set(sessionId, merged);
    return merged;
  }

  getStoryTimeline(limit = 100): StoryTimelineEvent[] {
    return this.storyTimeline.slice(0, limit);
  }

  getSimulationLog(limit = 100): SimulationEvent[] {
    return this.simulationLog.slice(0, limit);
  }
}
