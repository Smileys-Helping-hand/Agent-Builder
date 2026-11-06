/**
 * JarvisTasks — long-running work on Jarvis's own task list.
 *
 * Continuous-builder sessions, deep investigations, evaluations and VM test runs
 * each appear as one task in Jarvis (POST/PATCH /api/jarvis/tasks), kept up to date:
 * what it is doing now, how far it has got, blocked when it is stuck, done when it
 * ends. Jarvis's tasks have four states (todo, in_progress, blocked, done), so
 * the phase and the progress go in the notes.
 *
 * Needs JARVIS_HOST and JARVIS_API_KEY (or JARVIS_CLOUD_URL and JARVIS_PEER_KEY).
 * Nothing is lost when Jarvis cannot be reached: the next tick says the latest.
 * Which task is which is kept in data/agent/jarvis-tasks.json. JARVIS_TASKS=off turns it off.
 */
import fs from "fs";
import path from "path";

import { ContinuousImprover } from "../agent/ContinuousImprover.js";
import { VmTests } from "../lab/VmTests.js";
import { Evaluations } from "../learning/Evaluations.js";
import { Investigations } from "../research/Investigation.js";
import { Logger } from "../utils/Logger.js";

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done";

export interface TrackedWork {
  ref: string;
  title: string;
  status: TaskStatus;
  notes: string;
}

interface Tracked {
  taskId: number;
  status: TaskStatus;
  notes: string;
}

const FILE = () => path.resolve("data", "agent", "jarvis-tasks.json");
const TICK_MS = Number(process.env.JARVIS_TASKS_MS) || 5 * 60_000;

const read = (): Record<string, Tracked> => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as Record<string, Tracked>;
  } catch {
    return {};
  }
};
const write = (state: Record<string, Tracked>) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify(state, null, 2));
};

const target = (): { host: string; key: string } | null => {
  const host = (process.env.JARVIS_HOST || process.env.JARVIS_CLOUD_URL || "").replace(/\/+$/, "");
  const key = process.env.JARVIS_API_KEY || process.env.JARVIS_PEER_KEY || "";
  return host && key ? { host, key } : null;
};

/** Everything long-running, as what Jarvis should show. */
export const currentWork = (): TrackedWork[] => {
  const work: TrackedWork[] = [];
  for (const session of ContinuousImprover.list().sessions) {
    const done = session.plan.filter((m) => m.status === "done").length;
    const parked = session.plan.filter((m) => m.status === "parked").length;
    const failing = session.lastCheck && !session.lastCheck.passed ? session.lastCheck.failing.join(", ") : "";
    work.push({
      ref: `session:${session.id}`,
      title: `Building ${session.projectName}`,
      status: session.state === "stopped" ? "done" : session.lastError ? "blocked" : "in_progress",
      notes: [`${session.stage}: ${session.phase}`.slice(0, 300), `${done} of ${session.plan.length} milestones${parked ? `, ${parked} parked` : ""}, ${session.cycles} cycles`, failing ? `Checks failing: ${failing}` : "", session.lastError ? `Problem: ${session.lastError.slice(0, 300)}` : ""].filter(Boolean).join("\n")
    });
  }
  for (const item of Investigations.list()) {
    const done = item.specialists.filter((s) => s.status === "done").length;
    work.push({
      ref: `investigation:${item.id}`,
      title: `Investigating: ${item.objective}`.slice(0, 200),
      status: item.state === "done" || item.state === "stopped" ? "done" : item.state === "failed" ? "blocked" : "in_progress",
      notes: [item.phase.slice(0, 300), `${done} of ${item.specialists.length} specialists, ${item.experiments.length} experiments, round ${item.round}`, item.error ? `Problem: ${item.error.slice(0, 300)}` : ""].filter(Boolean).join("\n")
    });
  }
  for (const run of Evaluations.list().slice(0, 5)) {
    work.push({
      ref: `evaluation:${run.id}`,
      title: `Evaluating: ${run.label}`.slice(0, 200),
      status: run.state === "running" ? "in_progress" : run.state === "failed" ? "blocked" : "done",
      notes: run.score === null ? `${run.results.length} challenges done so far` : `Score ${Math.round(run.score * 100)}% over ${run.results.length} challenges`
    });
  }
  for (const run of VmTests.list(5)) {
    work.push({
      ref: `vmrun:${run.id}`,
      title: `Testing ${run.vmName} in a VM`.slice(0, 200),
      status: run.state === "running" ? "in_progress" : "done",
      notes: `${run.state}: ${run.counts.passed} passed, ${run.counts.failed} failed, ${run.counts.warned} warnings${run.build.iso ? ` (${run.build.iso})` : ""}`
    });
  }
  return work;
};

export const JarvisTasks = {
  /** Bring Jarvis's list up to date. Returns how many it created and changed. */
  async sync(): Promise<{ created: number; updated: number; skipped: string | null }> {
    const jarvis = target();
    if (!jarvis) return { created: 0, updated: 0, skipped: "JARVIS_HOST and its key are not set" };
    const headers = { Authorization: `Bearer ${jarvis.key}`, "Content-Type": "application/json" };
    const state = read();
    let created = 0;
    let updated = 0;
    for (const item of currentWork()) {
      const known = state[item.ref];
      // Finished before anyone asked Jarvis to track it: no need to fill his list with old work.
      if (!known && item.status === "done") continue;
      if (known && known.status === item.status && known.notes === item.notes) continue;
      const response = known
        ? await fetch(`${jarvis.host}/api/jarvis/tasks/${known.taskId}`, { method: "PATCH", headers, body: JSON.stringify({ status: item.status, notes: item.notes }), signal: AbortSignal.timeout(20_000) })
        : await fetch(`${jarvis.host}/api/jarvis/tasks`, { method: "POST", headers, body: JSON.stringify({ title: item.title, status: item.status, notes: item.notes, category: "Agent Builder" }), signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`Jarvis answered ${response.status} for ${item.ref}`);
      if (known) {
        state[item.ref] = { ...known, status: item.status, notes: item.notes };
        updated += 1;
      } else {
        const body = (await response.json()) as { task?: { id?: number } };
        if (typeof body.task?.id !== "number") throw new Error("Jarvis did not say which task it created.");
        state[item.ref] = { taskId: body.task.id, status: item.status, notes: item.notes };
        created += 1;
      }
      write(state);
    }
    return { created, updated, skipped: null };
  },

  start(): void {
    if (process.env.JARVIS_TASKS === "off") return;
    const tick = () =>
      void JarvisTasks.sync().catch((error) => {
        Logger.warn("Could not update Jarvis's task list", { error: (error as Error).message });
      });
    setTimeout(tick, 30_000).unref();
    setInterval(tick, TICK_MS).unref();
  }
};
