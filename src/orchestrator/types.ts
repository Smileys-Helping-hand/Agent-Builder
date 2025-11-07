export type Task = {
  id: string;
  description: string;
  agentType: string;
  status: "pending" | "in_progress" | "done" | "failed";
  result?: any;
  error?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  dependencies?: string[];
  metadata?: Record<string, unknown>;
};

export type AgentResponse = {
  taskId: string;
  success: boolean;
  output?: any;
  error?: string;
};
