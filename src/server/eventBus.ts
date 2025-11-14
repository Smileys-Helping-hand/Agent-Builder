import { EventEmitter } from "events";
import type { Task } from "../orchestrator/types.js";
import type { StoryTimelineEvent } from "../models/NarrativeTypes.js";
import type { SimulationEvent as SimulationPayload } from "../orchestrator/WorldSimulator.js";
import type { BuildJobSnapshot } from "../models/BuildTypes.js";

type LogEvent = {
  type: "log";
  payload: {
    level: "info" | "warn" | "error";
    message: string;
    timestamp: string;
  };
};

type TaskEvent = {
  type: "task";
  payload: {
    task: Task;
    timestamp: string;
  };
};

type FeedbackEvent = {
  type: "feedback";
  payload: {
    summary: { count: number; ids: string[] };
    timestamp: string;
  };
};

type AnalyticsEvent = {
  type: "analytics";
  payload: {
    summary: Record<string, unknown>;
    timestamp: string;
  };
};

type MarketplaceEvent = {
  type: "marketplace";
  payload: Record<string, unknown> & { timestamp: string };
};

type ContainerEvent = {
  type: "container";
  payload: Record<string, unknown> & { timestamp: string };
};

type QueueEvent = {
  type: "queue";
  payload: Record<string, unknown> & { timestamp: string };
};

type HealthEvent = {
  type: "health";
  payload: { snapshot: Record<string, unknown>; timestamp: string };
};

type SecurityEvent = {
  type: "security";
  payload: Record<string, unknown> & { timestamp: string };
};

type RobloxSyncEvent = {
  type: "roblox_sync";
  payload: {
    status: "disconnected" | "connecting" | "connected" | "sync" | "playtest" | "error";
    message: string;
    path?: string;
    metadata?: Record<string, unknown>;
    timestamp: string;
  };
};

type CollaborationEvent = {
  type: "collaboration";
  payload: {
    sessionId: string;
    message: string;
    participants: Array<{ id: string; name: string; role: string }>;
    timestamp: string;
    context?: Record<string, unknown> | null;
  };
};

type BuildEvent = {
  type: "build";
  payload: {
    job: BuildJobSnapshot;
  };
};

type StoryEvent = {
  type: "story";
  payload: StoryTimelineEvent;
};

type SimulationEvent = {
  type: "simulation";
  payload: SimulationPayload;
};

export type ServerEvent =
  | LogEvent
  | TaskEvent
  | FeedbackEvent
  | AnalyticsEvent
  | MarketplaceEvent
  | ContainerEvent
  | QueueEvent
  | HealthEvent
  | SecurityEvent
  | RobloxSyncEvent
  | CollaborationEvent
  | BuildEvent
  | StoryEvent
  | SimulationEvent;

class ServerEventBus extends EventEmitter {
  emitEvent(event: ServerEvent) {
    this.emit("event", event);
  }
}

export const eventBus = new ServerEventBus();

export const emitServerEvent = (event: ServerEvent) => {
  eventBus.emitEvent(event);
};
