/**
 * Resource modes: Gaming Mode and the other profiles, and Resume All.
 *
 * A profile says, for each workload (Workloads.ts), how far to go: keep it,
 * pause it, unload or stop it, or lower its priority. Switching:
 *   1. measures the PC (Telemetry),
 *   2. marks the mode first, so nothing new starts while it winds down,
 *   3. applies each workload's own safe pause, recording how to undo it,
 *   4. measures again after a few seconds, so the report says what was really freed.
 * Resume All undoes it in RESUME_ORDER, one workload at a time, waiting
 * between heavy ones until the PC has room (free memory, the builder's disk
 * not saturated), with each step's result kept; a step that fails is listed
 * with a retry, and the rest carry on.
 *
 * Every switch is in the audit log (data/system/audit.jsonl) and is told to
 * Jarvis. Only one switch runs at a time.
 */
import fs from "fs";
import path from "path";

import { JarvisClient } from "../integrations/JarvisClient.js";
import { GameMode, type GameModeState, type ModeReport, type ResumeProgress, type WorkloadAction } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";
import { Telemetry, snapshotOf } from "./Telemetry.js";
import { RESUME_ORDER, WORKLOADS, workload, type Level } from "./Workloads.js";

export interface Profile {
  id: string;
  label: string;
  about: string;
  /** The graphics card is the person's: no local model calls at all (Gaming Mode proper). */
  gpuToUser: boolean;
  /** No new background work starts while it is in force. */
  hold: boolean;
  levels: Record<string, Level>;
}

export const PROFILES: Profile[] = [
  {
    id: "gaming-balanced",
    label: "Gaming — Balanced",
    about: "The default. Pauses builds, research, sessions and VMs; unloads and stops the AI model; stops the image engine once it is idle and Jarvis's copy on this PC; lowers download programs' priority. SaveState stays up.",
    gpuToUser: true,
    hold: true,
    levels: { builds: "pause", research: "pause", loops: "pause", "lab-vms": "pause", model: "stop", "image-engine": "stop-if-idle", jarvis: "stop", savestate: "keep", downloads: "lower" }
  },
  {
    id: "gaming-max",
    label: "Gaming — Maximum",
    about: "Everything Balanced does, and stops the image engine even with pictures queued, stops SaveState hosting, and pauses qBittorrent's torrents with download programs at the lowest priority.",
    gpuToUser: true,
    hold: true,
    levels: { builds: "pause", research: "pause", loops: "pause", "lab-vms": "pause", model: "stop", "image-engine": "stop", jarvis: "stop", savestate: "stop", downloads: "pause-downloads" }
  },
  {
    id: "rendering",
    label: "Rendering",
    about: "For your own Blender or video work: frees the GPU like gaming (model stopped, builds and research paused) but keeps the image engine and Jarvis.",
    gpuToUser: true,
    hold: true,
    levels: { builds: "pause", research: "pause", loops: "pause", "lab-vms": "pause", model: "stop", "image-engine": "keep", jarvis: "keep", savestate: "keep", downloads: "lower" }
  },
  {
    id: "quiet",
    label: "Quiet / low resource",
    about: "Nothing new starts in the background and builds and research pause; the model is unloaded but answers when you ask it something.",
    gpuToUser: false,
    hold: true,
    levels: { builds: "pause", research: "pause", loops: "pause", "lab-vms": "keep", model: "unload", "image-engine": "keep", jarvis: "keep", savestate: "keep", downloads: "keep" }
  },
  {
    id: "ai-research",
    label: "AI research",
    about: "Research and investigations get the PC: builds and VMs pause, the image engine stops once idle, downloads get lower priority.",
    gpuToUser: false,
    hold: false,
    levels: { builds: "pause", research: "keep", loops: "keep", "lab-vms": "pause", model: "keep", "image-engine": "stop-if-idle", jarvis: "keep", savestate: "keep", downloads: "lower" }
  },
  {
    id: "development",
    label: "Development",
    about: "Builds and sessions get the PC: research pauses, the image engine stops once idle, downloads get lower priority.",
    gpuToUser: false,
    hold: false,
    levels: { builds: "keep", research: "pause", loops: "keep", "lab-vms": "keep", model: "keep", "image-engine": "stop-if-idle", jarvis: "keep", savestate: "keep", downloads: "lower" }
  }
];

export const NORMAL = { id: "normal", label: "Normal operation", about: "Everything runs." };

export const profile = (id: string) => PROFILES.find((p) => p.id === id) ?? null;

// ── Audit ───────────────────────────────────────────────────────────────────

const AUDIT = path.resolve("data/system/audit.jsonl");

export const audit = (entry: { actor: string; action: string; detail: string; ok: boolean }) => {
  try {
    fs.mkdirSync(path.dirname(AUDIT), { recursive: true });
    fs.appendFileSync(AUDIT, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
  } catch {
    // the audit must never break a switch
  }
};

export const readAudit = (limit = 100) => {
  try {
    return fs
      .readFileSync(AUDIT, "utf8")
      .trim()
      .split("\n")
      .slice(-limit)
      .map((line) => JSON.parse(line) as { at: string; actor: string; action: string; detail: string; ok: boolean })
      .reverse();
  } catch {
    return [];
  }
};

const tell = (subject: string, body: string, severity: "info" | "notice" | "warn" = "info") => {
  if (!JarvisClient.isConfigured()) return;
  void JarvisClient.send({ type: "status", severity, subject, body, metadata: { mode: GameMode.read().profile ?? "normal" } }).catch(() => undefined);
};

// ── Switching ───────────────────────────────────────────────────────────────

let switching: { to: string; since: string } | null = null;
let lastError: string | null = null;

export const switchState = () => ({ switching, error: lastError });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const summary = (actions: WorkloadAction[]) => {
  const done = actions.filter((a) => ["paused", "stopped", "lowered"].includes(a.outcome)).map((a) => a.label);
  const left = actions.filter((a) => a.outcome === "running").map((a) => `${a.label} (${a.detail})`);
  const failed = actions.filter((a) => a.outcome === "failed").map((a) => `${a.label}: ${a.detail}`);
  return [done.length ? `Paused or stopped: ${done.join(", ")}.` : "Nothing needed pausing.", left.length ? `Left running: ${left.join("; ")}.` : "", failed.length ? `Could not: ${failed.join("; ")}.` : ""].filter(Boolean).join(" ");
};

/** A short sentence on what was freed, from the before/after measurements. */
export const freed = (report: Pick<ModeReport, "before" | "after">): string => {
  const { before, after } = report;
  if (!before || !after) return "";
  const parts: string[] = [];
  if (before.vramUsedMB !== null && after.vramUsedMB !== null) parts.push(`video memory ${before.vramUsedMB} → ${after.vramUsedMB} MB`);
  if (before.ramAvailableMB !== null && after.ramAvailableMB !== null) parts.push(`free RAM ${(before.ramAvailableMB / 1024).toFixed(1)} → ${(after.ramAvailableMB / 1024).toFixed(1)} GB`);
  if (before.cpuPercent !== null && after.cpuPercent !== null) parts.push(`CPU ${before.cpuPercent}% → ${after.cpuPercent}%`);
  return parts.length ? `Measured: ${parts.join(", ")}.` : "";
};

const applyProfile = async (target: Profile, by: string): Promise<GameModeState> => {
  const current = GameMode.read();
  if (current.profile && current.profile !== "normal" && current.profile !== target.id && (current.on || current.hold || current.report)) {
    await resumeAll(`${by} (switching to ${target.label})`, { quiet: true });
  }
  const before = snapshotOf(await Telemetry.sample(0).catch(() => null));
  const report: ModeReport = { profile: target.id, startedAt: new Date().toISOString(), finishedAt: null, actions: [], before, after: null };
  // Marked first, so nothing new starts while the rest winds down.
  GameMode.write({ ...GameMode.read(), on: target.gpuToUser, hold: target.hold, profile: target.id, since: new Date().toISOString(), activatedBy: by, report, resume: null });
  for (const w of WORKLOADS) {
    const level = target.levels[w.id] ?? "keep";
    let result: WorkloadAction;
    try {
      result = await w.apply(level);
    } catch (error) {
      result = { id: w.id, label: w.label, outcome: "failed", detail: error instanceof Error ? error.message : String(error) };
    }
    report.actions.push(result);
    GameMode.patch({ report: { ...report } });
  }
  await sleep(5000);
  report.after = snapshotOf(await Telemetry.sample(0).catch(() => null));
  report.finishedAt = new Date().toISOString();
  const pausedBuilds = (report.actions.find((a) => a.id === "builds")?.undo?.ids as string[] | undefined) ?? [];
  const pausedTopics = (report.actions.find((a) => a.id === "research")?.undo?.ids as string[] | undefined) ?? [];
  const stoppedServices = report.actions.filter((a) => a.outcome === "stopped" && ["jarvis", "savestate", "image-engine"].includes(a.id)).map((a) => a.id);
  const state = GameMode.patch({ report: { ...report }, pausedBuilds, pausedTopics, stoppedServices });
  const text = `${summary(report.actions)} ${freed(report)}`.trim();
  audit({ actor: by, action: `mode ${target.id}`, detail: text, ok: !report.actions.some((a) => a.outcome === "failed") });
  Logger.log(`${target.label} on`, { by, actions: report.actions.map((a) => `${a.id}:${a.outcome}`) });
  tell(`${target.label} is on`, text, "notice");
  return state;
};

interface ResumeOptions {
  quiet?: boolean;
  /** Wait for room between heavy steps (off in tests). */
  waitForRoom?: boolean;
}

/** Wait (up to a minute) until memory is free and the builder's disk is not saturated. */
const waitForRoom = async (): Promise<string> => {
  const letter = process.cwd()[0].toUpperCase();
  for (let waited = 0; waited < 60_000; waited += 10_000) {
    const t = await Telemetry.sample(8000).catch(() => null);
    if (!t) return "";
    const disk = t.disks.find((d) => d.letters.includes(letter));
    const busy = disk && disk.idlePercent < 15 && disk.queue >= 4;
    const tight = t.ram.availableMB !== null && t.ram.availableMB < 3000;
    if (!busy && !tight) return waited ? ` (waited ${waited / 1000} s for room)` : "";
    await sleep(10_000);
  }
  return " (the PC stayed busy; carried on after a minute)";
};

export const resumeAll = async (by: string, options: ResumeOptions = {}): Promise<GameModeState> => {
  const state = GameMode.read();
  const actions = state.report?.actions ?? legacyActions(state);
  // A resume the builder's restart cut short carries on from the step it reached.
  const unfinished = state.profile === "resuming" && state.resume && !state.resume.finishedAt ? state.resume : null;
  const progress: ResumeProgress = unfinished ?? {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    steps: RESUME_ORDER.flatMap((id) => actions.filter((a) => a.id === id && ["paused", "stopped", "lowered"].includes(a.outcome)).map((a) => ({ id: a.id, label: a.label, state: "waiting" as const, detail: "", at: null })))
  };
  // The graphics card back first, the hold kept until the end so the loops do not all start at once.
  GameMode.patch({ on: false, hold: true, profile: "resuming", resume: progress });
  for (const step of progress.steps) {
    if (step.state === "done") continue;
    const done = actions.find((a) => a.id === step.id)!;
    const w = workload(step.id);
    let room = "";
    if (options.waitForRoom !== false && ["builds", "lab-vms", "research", "loops"].includes(step.id)) room = await waitForRoom();
    try {
      const result = w ? await w.undo(done) : { ok: false, detail: "unknown workload" };
      Object.assign(step, { state: result.ok ? "done" : "failed", detail: result.detail + room, at: new Date().toISOString() });
    } catch (error) {
      Object.assign(step, { state: "failed", detail: error instanceof Error ? error.message : String(error), at: new Date().toISOString() });
    }
    GameMode.patch({ resume: { ...progress } });
  }
  progress.finishedAt = new Date().toISOString();
  GameMode.patch({ resume: { ...progress } });
  const final = GameMode.off();
  const failed = progress.steps.filter((s) => s.state === "failed");
  const text = progress.steps.length ? `${progress.steps.filter((s) => s.state === "done").map((s) => s.label).join(", ") || "Nothing"} back.${failed.length ? ` Not back: ${failed.map((s) => `${s.label} (${s.detail})`).join("; ")} — retry from the Control page or ask Jarvis.` : ""}` : "Nothing had been paused.";
  audit({ actor: by, action: "resume all", detail: text, ok: failed.length === 0 });
  Logger.log("Resumed normal operation", { by, steps: progress.steps.map((s) => `${s.id}:${s.state}`) });
  if (!options.quiet) tell("Back to normal operation", text, failed.length ? "warn" : "info");
  return final;
};

/** A game-mode file from before profiles: turn what it recorded into actions to undo. */
const legacyActions = (state: GameModeState): WorkloadAction[] => {
  const out: WorkloadAction[] = [];
  if (state.pausedBuilds?.length) out.push({ id: "builds", label: "Builds", outcome: "paused", detail: "", undo: { ids: state.pausedBuilds } });
  if (state.pausedTopics?.length) out.push({ id: "research", label: "Research topics", outcome: "paused", detail: "", undo: { ids: state.pausedTopics } });
  if (state.on) out.push({ id: "model", label: "Local AI model", outcome: "stopped", detail: "", undo: { stopped: true } });
  for (const id of state.stoppedServices ?? []) out.push({ id, label: id, outcome: "stopped", detail: "", undo: { start: id !== "image-engine" } });
  return out;
};

/** After a restart: finish a resume that was cut short. */
export const recoverOnStart = () => {
  const state = GameMode.read();
  if (state.profile === "resuming" && state.resume && !state.resume.finishedAt && !switching) {
    Logger.log("Finishing a resume that a restart interrupted");
    void startSwitch("normal", "recovery after restart")?.catch(() => undefined);
  }
};

/** Retry one step of the last resume that failed. */
export const retryStep = async (id: string, by: string): Promise<{ ok: boolean; detail: string }> => {
  const state = GameMode.read();
  const step = state.resume?.steps.find((s) => s.id === id && s.state === "failed");
  const done = state.report?.actions.find((a) => a.id === id);
  const w = workload(id);
  if (!step || !done || !w) throw Object.assign(new Error(`No failed step "${id}" to retry.`), { status: 404 });
  const result = await w.undo(done);
  step.state = result.ok ? "done" : "failed";
  step.detail = result.detail;
  step.at = new Date().toISOString();
  GameMode.patch({ resume: state.resume });
  audit({ actor: by, action: `retry ${id}`, detail: result.detail, ok: result.ok });
  return result;
};

/** Run one switch at a time; the promise, or null when the same switch is already running. */
export const startSwitch = (to: string, by: string): Promise<GameModeState> | null => {
  if (switching) {
    if (switching.to === to) return null;
    throw Object.assign(new Error(`Still switching to ${switching.to}; try again in a moment.`), { status: 409 });
  }
  const target = to === "normal" ? null : profile(to);
  if (to !== "normal" && !target) throw Object.assign(new Error(`No profile "${to}". Choose one of: ${PROFILES.map((p) => p.id).join(", ")}, or normal.`), { status: 400 });
  switching = { to, since: new Date().toISOString() };
  lastError = null;
  return (target ? applyProfile(target, by) : resumeAll(by))
    .catch((error) => {
      lastError = error instanceof Error ? error.message : String(error);
      audit({ actor: by, action: `switch to ${to}`, detail: lastError, ok: false });
      Logger.warn(`Resource mode: switching to ${to} failed`, { error: lastError });
      throw error;
    })
    .finally(() => {
      switching = null;
    });
};

/** "Stop new background jobs until further notice", without pausing anything that is running. */
export const setHold = (on: boolean, by: string): GameModeState => {
  const state = GameMode.patch({ hold: on || (GameMode.read().profile !== "normal" && Boolean(profile(GameMode.read().profile ?? "")?.hold)) });
  audit({ actor: by, action: on ? "hold new background work" : "release the hold", detail: "", ok: true });
  tell(on ? "New background work is on hold" : "Background work may start again", on ? "Running work carries on; nothing new starts until the hold is released." : "", "info");
  return state;
};
