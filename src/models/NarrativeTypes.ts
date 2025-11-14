import type { CollaborationParticipant } from "../orchestrator/CollaborationHub.js";

export type NarrativeEntityType =
  | "scene"
  | "location"
  | "npc"
  | "player"
  | "quest"
  | "faction"
  | "event"
  | "object";

export type NarrativeEntity = {
  id: string;
  type: NarrativeEntityType;
  label: string;
  metadata?: Record<string, unknown>;
  updatedAt: string;
};

export type NarrativeRelationship = {
  id: string;
  fromId: string;
  toId: string;
  relation: string;
  weight?: number | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
};

export type StoryTimelineEvent = {
  id: string;
  entityId: string;
  entityType: NarrativeEntityType;
  entityLabel?: string;
  description: string;
  tags: string[];
  metadata?: Record<string, unknown>;
  relatedEntities?: Array<{ entityId: string; relation: string; label?: string }>;
  sessionId?: string | null;
  createdAt: string;
};

export type Scene = {
  id: string;
  title: string;
  synopsis: string;
  participants: string[];
  updatedAt: string;
};

export type Quest = {
  id: string;
  title: string;
  summary: string;
  scriptPath: string;
  steps: string[];
  rewards?: string[];
  status: "draft" | "active" | "completed" | "failed";
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type FactionRelationship = {
  factionId: string;
  status: "ally" | "enemy" | "neutral";
  notes?: string;
};

export type Faction = {
  id: string;
  name: string;
  alignment: "ally" | "enemy" | "neutral";
  description?: string;
  influence?: number;
  relationships: FactionRelationship[];
  updatedAt: string;
};

export type StoryBroadcast = {
  event: StoryTimelineEvent;
  participants?: CollaborationParticipant[];
};
