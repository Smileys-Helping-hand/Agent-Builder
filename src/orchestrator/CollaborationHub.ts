import { EventEmitter } from "events";
import { emitServerEvent } from "../server/eventBus.js";
import type { BuildJobSnapshot } from "../models/BuildTypes.js";

export type CollaborationRoomContext = {
  summary: string;
  repos?: string[];
  activeAgents: string[];
  lastCommand?: string;
  updatedAt: string;
};

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
  private readonly contexts = new Map<string, CollaborationRoomContext>();

  static getInstance() {
    if (!this.instance) {
      this.instance = new CollaborationHub();
    }
    return this.instance;
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
    this.broadcastCollaboration(sessionId, `${participant.name} joined the session`);
    return this.toSnapshot(session);
  }

  leaveSession(sessionId: string, participantId: string) {
    const session = this.ensureSession(sessionId);
    session.participants = session.participants.filter((participant) => participant.id !== participantId);
    session.updatedAt = new Date();
    this.broadcastCollaboration(sessionId, `${participantId} left the session`);
    return this.toSnapshot(session);
  }

  updateFile(sessionId: string, filePath: string, content: string) {
    const session = this.ensureSession(sessionId);
    session.files.set(filePath, content);
    session.updatedAt = new Date();
    this.broadcastCollaboration(sessionId, `Updated ${filePath}`);
  }

  readFile(sessionId: string, filePath: string) {
    const session = this.ensureSession(sessionId);
    return session.files.get(filePath) ?? "";
  }

  subscribe(listener: (event: { type: "collaboration"; payload: unknown }) => void) {
    this.emitter.on("collaboration", listener);
    return () => this.emitter.off("collaboration", listener);
  }

  private ensureSession(sessionId: string) {
    if (!this.sessions.has(sessionId)) {
      this.createSession(sessionId as "default" | "sandbox" | "team");
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.sessions.get(sessionId)!;
  }

  private updateContext(sessionId: string, context: Partial<CollaborationRoomContext>) {
    const existing = this.contexts.get(sessionId) ?? {
      summary: "",
      activeAgents: [],
      updatedAt: new Date().toISOString()
    };
    const merged: CollaborationRoomContext = {
      ...existing,
      ...context,
      updatedAt: new Date().toISOString()
    };
    this.contexts.set(sessionId, merged);
    return merged;
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
}
