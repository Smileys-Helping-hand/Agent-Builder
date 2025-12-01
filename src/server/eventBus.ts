import { EventEmitter } from "events";
import type { Task } from "../orchestrator/types.js";
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

type BuildJobEvent = {
  job: BuildJobSnapshot;
};

type PackagerBuildEvent = {
  taskId: string;
  downloadUrl?: string;
  version?: string;
  artifacts?: string[];
  primaryArtifact?: string;
  notes?: string;
  stage?: string;
  timestamp?: string;
  error?: string;
};

type BuildEvent = {
  type: "build";
  payload: BuildJobEvent | PackagerBuildEvent;
};

type BuilderEvent = {
  type: "builder";
  payload: {
    level: "info" | "warn" | "error";
    message: string;
    timestamp: string;
    details?: Record<string, unknown>;
  };
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
  | CollaborationEvent
  | BuildEvent
  | BuilderEvent;

class ServerEventBus extends EventEmitter {
  emitEvent(event: ServerEvent) {
    this.emit("event", event);
  }
}

export const eventBus = new ServerEventBus();

export const emitServerEvent = (event: ServerEvent) => {
  eventBus.emitEvent(event);
};
