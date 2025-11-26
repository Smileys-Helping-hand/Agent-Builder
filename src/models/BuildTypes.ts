export type BuildMode =
  | "app"
  | "api"
  | "fullstack"
  | "automation"
  | "script"
  | "cli"
  | "desktop";

export type AutonomyLevel = "manual" | "semi" | "full";

export type BuildJobStatus =
  | "queued"
  | "planning"
  | "running"
  | "merging"
  | "testing"
  | "deploying"
  | "completed"
  | "failed"
  | "canceled";

export type BuildStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type BuildStep = {
  id: string;
  label: string;
  description?: string;
  agent?: string;
  status: BuildStepStatus;
  startedAt?: string;
  finishedAt?: string;
  log?: string;
};

export type BuildJobSnapshot = {
  id: string;
  prompt: string;
  mode: BuildMode;
  autonomy: AutonomyLevel;
  status: BuildJobStatus;
  plan?: string[];
  steps: BuildStep[];
  logs: string[];
  createdAt: string;
  updatedAt: string;
  outputDir?: string;
  metadata?: Record<string, unknown>;
};

export type BuildPlan = {
  overview: string;
  steps: Array<{
    id: string;
    title: string;
    detail: string;
    agent?: string;
  }>;
};
