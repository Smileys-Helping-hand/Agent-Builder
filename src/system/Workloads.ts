/**
 * The workloads Agent Builder may pause for the person at the keyboard, each
 * paused through its own safe mechanism, and put back exactly as it was.
 *
 * Nothing here kills a process mid-write. Builds pause at their next model
 * call (BuildGate), research topics between cycles, VMs through QEMU's own
 * pause, the model is unloaded only after the answer in progress, the image
 * engine is stopped only once its queue is empty, torrents through
 * qBittorrent's own API, and other download programs only get a lower CPU
 * priority. Every action records what undoing it takes.
 *
 * What is never touched, by design: games (and their anti-cheat), Windows and
 * its services, Defender and other security software, drivers, audio, input,
 * networking, the desktop shell. Nothing outside this list is acted on.
 */
import fs from "fs";
import path from "path";

import { callHost } from "../server/host.js";
import { ContinuousImprover } from "../agent/ContinuousImprover.js";
import { VmLab } from "../lab/VmLab.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { Investigations } from "../research/Investigation.js";
import { ResearchEngine } from "../research/ResearchEngine.js";
import { ResearchStore } from "../research/ResearchStore.js";
import type { WorkloadAction } from "../utils/GameMode.js";
import { gpuLock } from "../utils/GpuLock.js";
import { OLLAMA_URL, checkOllama, ensureOllama } from "../utils/Ollama.js";
import { powershellJson, psQuote } from "./PowerShell.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How far a profile goes with one workload. */
export type Level = "keep" | "pause" | "unload" | "stop" | "stop-if-idle" | "lower" | "pause-downloads";

export type WorkloadClass = "background-ab" | "gpu-ab" | "service" | "optional-app";

export interface Workload {
  id: string;
  label: string;
  kind: WorkloadClass;
  /** What it is doing now, cheaply. */
  detect(): Promise<{ running: boolean; detail: string }>;
  apply(level: Level): Promise<WorkloadAction>;
  undo(action: WorkloadAction): Promise<{ ok: boolean; detail: string }>;
}

const action = (w: Pick<Workload, "id" | "label">, outcome: WorkloadAction["outcome"], detail: string, undo?: Record<string, unknown>): WorkloadAction => ({ id: w.id, label: w.label, outcome, detail, ...(undo ? { undo } : {}) });

const list = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

// ── Agent Builder's own work ───────────────────────────────────────────────

const builds: Workload = {
  id: "builds",
  label: "Builds",
  kind: "background-ab",
  async detect() {
    const running = BuildService.active().filter((b) => b.state === "running");
    return { running: running.length > 0, detail: running.length ? `${running.length} running` : "none running" };
  },
  async apply(level) {
    if (level === "keep") return action(this, "running", "kept running by this profile");
    const ids = BuildService.active()
      .filter((b) => b.state === "running")
      .map((b) => b.buildId)
      .filter((id) => BuildService.control(id, "pause"));
    return ids.length ? action(this, "paused", `${ids.length} paused at their next step (a model call or check already under way finishes first)`, { ids }) : action(this, "not-running", "none running");
  },
  async undo(done) {
    const ids = list(done.undo?.ids);
    const resumed = ids.filter((id) => BuildService.control(id, "resume"));
    return { ok: resumed.length === ids.length, detail: `${resumed.length} of ${ids.length} resumed${resumed.length < ids.length ? " (the others had finished or were stopped meanwhile)" : ""}` };
  }
};

const research: Workload = {
  id: "research",
  label: "Research topics",
  kind: "background-ab",
  async detect() {
    const running = ResearchStore.listTopics().filter((t) => t.status === "running");
    return { running: running.length > 0, detail: running.length ? `${running.length} researching` : "none researching" };
  },
  async apply(level) {
    if (level === "keep") return action(this, "running", "kept running by this profile");
    const engine = ResearchEngine.getInstance();
    const ids = ResearchStore.listTopics()
      .filter((t) => t.status === "running")
      .map((t) => t.id)
      .filter((id) => Boolean(engine.pause(id)));
    return ids.length ? action(this, "paused", `${ids.length} paused between reading cycles`, { ids }) : action(this, "not-running", "none researching");
  },
  async undo(done) {
    const engine = ResearchEngine.getInstance();
    const ids = list(done.undo?.ids);
    const resumed = ids.filter((id) => Boolean(engine.resume(id)));
    return { ok: resumed.length === ids.length, detail: `${resumed.length} of ${ids.length} resumed` };
  }
};

/** Continuous sessions, investigations and the learning loops: they ask GameMode.paused() before each step. */
const loops: Workload = {
  id: "loops",
  label: "Continuous sessions, investigations and learning",
  kind: "background-ab",
  async detect() {
    const sessions = ContinuousImprover.running().length;
    const investigations = Investigations.list().filter((i) => !["done", "failed", "stopped"].includes(String(i.state))).length;
    return { running: sessions + investigations > 0, detail: `${sessions} continuous session(s), ${investigations} investigation(s)` };
  },
  async apply(level) {
    const { running, detail } = await this.detect();
    if (level === "keep") return action(this, "running", `${detail}; kept running by this profile`);
    return running ? action(this, "paused", `${detail}: each finishes the step it is on (with its checks and checkpoint), then waits`, {}) : action(this, "not-running", detail);
  },
  async undo() {
    return { ok: true, detail: "they carry on from their next step" };
  }
};

const vms: Workload = {
  id: "lab-vms",
  label: "Virtual Test Lab VMs",
  kind: "background-ab",
  async detect() {
    const running = VmLab.list().filter((v) => v.state === "running");
    return { running: running.length > 0, detail: running.length ? `${running.length} running` : "none running" };
  },
  async apply(level) {
    if (level === "keep") return action(this, "running", "kept running by this profile");
    const running = VmLab.list().filter((v) => v.state === "running");
    const ids: string[] = [];
    const failed: string[] = [];
    for (const vm of running) {
      try {
        await VmLab.pause(vm.id);
        ids.push(vm.id);
      } catch (error) {
        failed.push(`${vm.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!running.length) return action(this, "not-running", "none running");
    return action(this, failed.length && !ids.length ? "failed" : "paused", `${ids.length} paused (their CPU is free; their memory stays reserved)${failed.length ? `; could not pause: ${failed.join("; ")}` : ""}`, { ids });
  },
  async undo(done) {
    const ids = list(done.undo?.ids);
    let ok = 0;
    for (const id of ids) {
      try {
        await VmLab.resume(id);
        ok++;
      } catch {
        // reported below
      }
    }
    return { ok: ok === ids.length, detail: `${ok} of ${ids.length} resumed` };
  }
};

/** Ask Ollama to drop every loaded model out of VRAM. */
export const unloadModels = async (): Promise<string[]> => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(4000) });
    const body = (await response.json()) as { models?: Array<{ name: string }> };
    const names = (body.models ?? []).map((model) => model.name);
    for (const name of names) {
      await fetch(`${OLLAMA_URL}/api/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: name, keep_alive: 0 }), signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
    }
    return names;
  } catch {
    return [];
  }
};

/** Stop the Ollama server Agent Builder uses: the process listening on its port (and its runners). */
export const stopOllama = async (): Promise<boolean> => {
  const port = Number(new URL(OLLAMA_URL).port || "11434");
  try {
    await powershellJson<unknown>(
      `$p = @(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
foreach ($id in $p) { $name = (Get-Process -Id $id).ProcessName; if ($name -match '^(ollama|llama-server|ollama_llama_server)$') { taskkill /PID $id /T /F | Out-Null } }
@{ pids = $p } | ConvertTo-Json -Compress`,
      30_000
    );
  } catch {
    // checked below
  }
  for (let waited = 0; waited < 10_000; waited += 500) {
    if ((await checkOllama()).state === "down") return true;
    await sleep(500);
  }
  return false;
};

const model: Workload = {
  id: "model",
  label: "Local AI model",
  kind: "gpu-ab",
  async detect() {
    const status = await checkOllama();
    if (status.state === "down") return { running: false, detail: "the model server is off" };
    // What is in memory now (/api/ps), not every model installed.
    let loaded: string[] = [];
    try {
      const response = await fetch(`${OLLAMA_URL}/api/ps`, { signal: AbortSignal.timeout(4000) });
      loaded = (((await response.json()) as { models?: Array<{ name: string; size_vram?: number; size?: number }> }).models ?? []).map((m) => `${m.name}${m.size && m.size_vram !== undefined ? ` (${Math.round((m.size_vram / m.size) * 100)}% on the GPU)` : ""}`);
    } catch {
      // the server answered /api/tags but not /api/ps: say what is known
    }
    return { running: true, detail: `server ${status.state}; in memory: ${loaded.join(", ") || "nothing"} (${status.models.length} installed)` };
  },
  async apply(level) {
    if (level === "keep") return action(this, "running", "kept loaded by this profile");
    // Let an answer already being written finish instead of cutting it off.
    let waited = 0;
    for (; gpuLock.busy && waited < 90_000; waited += 1000) await sleep(1000);
    const unloaded = await unloadModels();
    if (level === "unload") return action(this, unloaded.length ? "paused" : "not-running", unloaded.length ? `unloaded ${unloaded.join(", ")} from video memory${waited ? ` after the answer in progress (${Math.round(waited / 1000)} s)` : ""}; it loads again when next asked` : "no model was loaded");
    const wasUp = (await checkOllama()).state !== "down";
    if (!wasUp) return action(this, "not-running", "the model server was already off");
    const stopped = await stopOllama();
    return stopped
      ? action(this, "stopped", `unloaded${unloaded.length ? ` ${unloaded.join(", ")}` : ""} and stopped the model server, so nothing can load a model mid-game`, { stopped: true })
      : action(this, "failed", "unloaded, but the model server did not stop within 10 s", { stopped: false });
  },
  async undo(done) {
    if (!done.undo?.stopped) return { ok: true, detail: "nothing to start" };
    const up = await ensureOllama(45_000);
    return { ok: up, detail: up ? "model server started (the model loads when first asked)" : "the model server did not start within 45 s" };
  }
};

// ── Services the Host Manager runs ─────────────────────────────────────────

const COMFY = () => (process.env.COMFY_URL ?? process.env.LOCAL_MEDIA_API ?? "http://127.0.0.1:8188").replace(/\/+$/, "");

const comfyQueue = async (): Promise<{ running: number; pending: number } | null> => {
  try {
    const response = await fetch(`${COMFY()}/queue`, { signal: AbortSignal.timeout(3000) });
    const body = (await response.json()) as { queue_running?: unknown[]; queue_pending?: unknown[] };
    return { running: body.queue_running?.length ?? 0, pending: body.queue_pending?.length ?? 0 };
  } catch {
    return null;
  }
};

const hostState = async (id: string): Promise<string | null> => {
  try {
    const { body } = await callHost("/api/status?fresh=1");
    const services = Array.isArray(body.services) ? (body.services as Array<{ id: string; state: string }>) : [];
    return services.find((s) => s.id === id)?.state ?? null;
  } catch {
    return null;
  }
};

const hostService = (id: string, label: string, startAgain: boolean): Workload => ({
  id,
  label,
  kind: "service",
  async detect() {
    const state = await hostState(id);
    return { running: state === "up" || state === "starting", detail: state ?? "the Host Manager did not answer" };
  },
  async apply(level) {
    if (level === "keep") return action(this, "running", "kept running by this profile");
    const state = await hostState(id);
    if (state === null) return action(this, "failed", "the Host Manager did not answer, so it was left as it is");
    if (state !== "up" && state !== "starting") return action(this, "not-running", `already ${state}`);
    if (id === "image-engine") {
      // Let the picture being drawn finish; pictures still queued would be lost if it stopped.
      let queue = await comfyQueue();
      for (let waited = 0; queue && queue.running > 0 && waited < 120_000; waited += 3000) {
        await sleep(3000);
        queue = await comfyQueue();
      }
      if (queue && (queue.running > 0 || queue.pending > 0) && level === "stop-if-idle") {
        return action(this, "running", `left running: ${queue.running} drawing, ${queue.pending} queued would be lost (Gaming — Maximum stops it anyway)`);
      }
    }
    const result = await callHost(`/api/services/${id}/stop`, { method: "POST", body: JSON.stringify({ by: "Agent Builder resource mode" }) }).catch((error: Error) => ({ status: 502, body: { error: error.message } }));
    return result.status < 400 ? action(this, "stopped", "stopped", { start: startAgain }) : action(this, "failed", `could not stop it: ${String(result.body.error ?? result.status)}`);
  },
  async undo(done) {
    if (!done.undo?.start) return { ok: true, detail: "left off: it starts by itself when it is needed" };
    const result = await callHost(`/api/services/${id}/start`, { method: "POST", body: JSON.stringify({ by: "Agent Builder resume" }) }).catch((error: Error) => ({ status: 502, body: { error: error.message } }));
    return result.status < 400 ? { ok: true, detail: "started" } : { ok: false, detail: `could not start it: ${String(result.body.error ?? result.status)}` };
  }
});

// ── The owner's download programs ──────────────────────────────────────────

/** qBittorrent's Web UI on this PC, when it lets this PC in without a password. */
const qbt = (): string | null => {
  try {
    const ini = fs.readFileSync(path.join(process.env.APPDATA ?? "", "qBittorrent", "qBittorrent.ini"), "utf8");
    const port = /^WebUI\\Port=(\d+)$/m.exec(ini)?.[1];
    const open = /^WebUI\\LocalHostAuth=false$/m.test(ini);
    return port && open ? `http://127.0.0.1:${port}` : null;
  } catch {
    return null;
  }
};

const qbtCall = async (base: string, route: string, form?: Record<string, string>) => {
  const response = await fetch(`${base}${route}`, {
    method: form ? "POST" : "GET",
    headers: form ? { "Content-Type": "application/x-www-form-urlencoded", Referer: base } : { Referer: base },
    body: form ? new URLSearchParams(form).toString() : undefined,
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`qBittorrent answered ${response.status}`);
  return response;
};

const ACTIVE_TORRENT = /^(downloading|uploading|stalledDL|stalledUP|forcedDL|forcedUP|metaDL|forcedMetaDL|queuedDL|queuedUP|checkingDL|checkingUP|allocating)$/;

const LOWER_NAMES = () => (process.env.GAMING_LOWER_PROCESSES ?? "qbittorrent,BitTorrent,rclone").split(",").map((n) => n.trim()).filter((n) => /^[\w.-]+$/.test(n));

const downloads: Workload = {
  id: "downloads",
  label: "Downloads and sync (qBittorrent, BitTorrent, rclone)",
  kind: "optional-app",
  async detect() {
    const names = LOWER_NAMES();
    const found = await powershellJson<Array<{ name: string }> | { name: string }>(`@(Get-Process -Name ${names.map(psQuote).join(",")} | ForEach-Object { @{ name = $_.ProcessName } }) | ConvertTo-Json -Compress`, 20_000).catch(() => []);
    const running = [...new Set((Array.isArray(found) ? found : [found]).map((p) => p.name))];
    return { running: running.length > 0, detail: running.length ? running.join(", ") : "none running" };
  },
  async apply(level) {
    if (level === "keep") return action(this, "running", "left alone by this profile");
    const notes: string[] = [];
    let hashes: string[] = [];
    let api: string | null = null;
    const base = qbt();
    if (level === "pause-downloads" && base) {
      try {
        const version = await (await qbtCall(base, "/api/v2/app/version")).text();
        api = /^v?5/.test(version.trim()) ? "stop" : "pause";
        const torrents = (await (await qbtCall(base, "/api/v2/torrents/info")).json()) as Array<{ hash: string; state: string }>;
        hashes = torrents.filter((t) => ACTIVE_TORRENT.test(t.state)).map((t) => t.hash);
        if (hashes.length) await qbtCall(base, `/api/v2/torrents/${api}`, { hashes: hashes.join("|") });
        notes.push(`${hashes.length} active torrent(s) paused in qBittorrent`);
      } catch (error) {
        notes.push(`qBittorrent's Web UI did not answer (${error instanceof Error ? error.message : String(error)}), so its torrents keep going`);
        hashes = [];
      }
    } else if (level === "pause-downloads") {
      notes.push("qBittorrent's Web UI is not open to this PC without a password, so torrents keep going (lower priority only)");
    }
    const priority = level === "pause-downloads" ? "Idle" : "BelowNormal";
    const names = LOWER_NAMES();
    const lowered = await powershellJson<Array<{ pid: number; name: string; previous: string }> | { pid: number; name: string; previous: string }>(
      `@(Get-Process -Name ${names.map(psQuote).join(",")} | ForEach-Object { $prev = $_.PriorityClass.ToString(); try { $_.PriorityClass = '${priority}'; @{ pid = $_.Id; name = $_.ProcessName; previous = $prev } } catch {} }) | ConvertTo-Json -Compress`,
      20_000
    ).catch(() => []);
    const processes = Array.isArray(lowered) ? lowered : [lowered];
    if (processes.length) notes.push(`${processes.map((p) => p.name).join(", ")} set to ${priority === "Idle" ? "the lowest" : "below-normal"} CPU priority (disk use is not throttled by this)`);
    if (!processes.length && !hashes.length) return action(this, "not-running", notes.join("; ") || "none running");
    return action(this, hashes.length ? "paused" : "lowered", notes.join("; "), { processes, hashes, api });
  },
  async undo(done) {
    const notes: string[] = [];
    let ok = true;
    const hashes = list(done.undo?.hashes);
    const base = qbt();
    if (hashes.length && base) {
      try {
        await qbtCall(base, `/api/v2/torrents/${done.undo?.api === "stop" ? "start" : "resume"}`, { hashes: hashes.join("|") });
        notes.push(`${hashes.length} torrent(s) resumed`);
      } catch (error) {
        ok = false;
        notes.push(`could not resume torrents: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const processes = (Array.isArray(done.undo?.processes) ? done.undo!.processes : []) as Array<{ pid: number; name: string; previous: string }>;
    const valid = processes.filter((p) => Number.isInteger(p.pid) && /^[\w.-]+$/.test(p.name) && /^(Idle|BelowNormal|Normal|AboveNormal|High)$/.test(p.previous));
    if (valid.length) {
      await powershellJson<unknown>(
        `${valid.map((p) => `$p = Get-Process -Id ${p.pid}; if ($p -and $p.ProcessName -eq ${psQuote(p.name)}) { $p.PriorityClass = '${p.previous}' }`).join("\n")}\n@{ ok = $true } | ConvertTo-Json -Compress`,
        20_000
      ).catch(() => {
        ok = false;
      });
      notes.push(`priority restored for ${valid.map((p) => p.name).join(", ")}`);
    }
    return { ok, detail: notes.join("; ") || "nothing to undo" };
  }
};

/** Every workload, in the order a switch applies them (resume goes in RESUME_ORDER). */
export const WORKLOADS: Workload[] = [builds, research, loops, vms, model, hostService("image-engine", "Image engine (ComfyUI)", false), hostService("jarvis", "Jarvis's copy on this PC", true), hostService("savestate", "SaveState hosting", true), downloads];

/** Put back the heavy things last, one at a time: the model server first so builds can use it, downloads at the very end. */
export const RESUME_ORDER = ["model", "jarvis", "savestate", "lab-vms", "builds", "research", "loops", "image-engine", "downloads"];

export const workload = (id: string) => WORKLOADS.find((w) => w.id === id) ?? null;

/** Never acted on, whatever a profile says; shown so it is clear what is protected. */
export const PROTECTED = ["the game you are playing (and its anti-cheat)", "Windows and its services", "Windows Defender and other security software", "drivers, audio, input and networking", "the desktop shell", "any program not listed as a workload"];
