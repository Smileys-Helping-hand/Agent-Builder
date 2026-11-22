/**
 * Telemetry: what this PC is doing right now, measured, and why it is slow.
 *
 * One PowerShell run takes a one-second sample of the performance counters
 * (CPU, available memory, commit, paging, and each physical disk's idle time,
 * queue, throughput and latency), the processes using the most CPU, memory and
 * disk in that second, and nvidia-smi gives the GPU and VRAM. A sample takes
 * about three seconds, so callers get the last one when it is fresh enough and
 * only one runs at a time. A background sampler keeps a short history (every
 * minute; every five while Gaming Mode is on, to stay out of the way) for the
 * scheduler, which needs "busy for a while", not one spike.
 *
 * `explain()` turns a sample into plain findings ("E: is saturated: 0% idle,
 * queue 14; on it: Agent Builder, qBittorrent's downloads"), each naming the
 * processes responsible, so "why is my computer slow?" has a real answer.
 */
import { execFile } from "child_process";
import os from "os";
import { promisify } from "util";

import { GameMode } from "../utils/GameMode.js";
import { powershellJson } from "./PowerShell.js";

const run = promisify(execFile);

export interface DiskActivity {
  disk: number;
  letters: string[];
  idlePercent: number;
  queue: number;
  mbPerSec: number;
  latencyMs: number;
}

export interface ProcessSample {
  pid: number;
  name: string;
  path?: string | null;
  cpuPercent?: number;
  memMB?: number;
  ioMBps?: number;
  ioOps?: number;
}

export interface Telemetry {
  at: string;
  cores: number;
  cpuPercent: number | null;
  ram: { totalMB: number; availableMB: number | null; commitPercent: number | null };
  pagesPerSec: number | null;
  disks: DiskActivity[];
  gpu: { name: string; utilPercent: number; vramUsedMB: number; vramTotalMB: number; tempC: number | null } | null;
  gpuProcesses: Array<{ pid: number; name: string; usedMB: number | null }>;
  topCpu: ProcessSample[];
  topMemory: ProcessSample[];
  topIo: ProcessSample[];
  errors: string[];
}

export interface Finding {
  severity: "high" | "medium" | "info";
  area: "disk" | "memory" | "cpu" | "gpu" | "mode";
  text: string;
  culprits: string[];
}

const SCRIPT = `
$before = @{}; Get-Process | ForEach-Object { $before[$_.Id] = $_.CPU }
$t0 = Get-Date
$counters = Get-Counter -Counter @('\\Processor(_Total)\\% Processor Time','\\Memory\\Available MBytes','\\Memory\\Committed Bytes','\\Memory\\Commit Limit','\\Memory\\Pages/sec','\\PhysicalDisk(*)\\% Idle Time','\\PhysicalDisk(*)\\Avg. Disk Queue Length','\\PhysicalDisk(*)\\Disk Bytes/sec','\\PhysicalDisk(*)\\Avg. Disk sec/Transfer') -SampleInterval 1 -MaxSamples 1
$elapsed = ((Get-Date) - $t0).TotalSeconds
$samples = @($counters.CounterSamples | ForEach-Object { @{ p = ($_.Path -replace '^\\\\\\\\[^\\\\]+',''); i = $_.InstanceName; v = [double]$_.CookedValue } })
$procs = @(Get-Process | Where-Object { $_.Id -ne 0 } | ForEach-Object {
  $prev = $before[$_.Id]; $cpu = 0
  if ($prev -ne $null -and $_.CPU -ne $null) { $cpu = ($_.CPU - $prev) }
  @{ pid = $_.Id; name = $_.ProcessName; path = $_.Path; cpu = [double]$cpu; mem = [double]$_.WorkingSet64 }
})
$busy = @($samples | Where-Object { $_.p -like '*idle time' -and $_.i -ne '_total' -and $_.v -lt 50 }).Count -gt 0
$io = @(); if ($busy) { $io = @(Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $_.Name -ne '_Total' -and $_.Name -ne 'Idle' -and $_.IODataBytesPersec -gt 0 } | Sort-Object IODataBytesPersec -Descending | Select-Object -First 8 | ForEach-Object { @{ pid = [int]$_.IDProcess; name = ($_.Name -replace '#\\d+$',''); bytes = [double]$_.IODataBytesPersec; ops = [double]$_.IODataOperationsPersec } }) }
@{ elapsed = $elapsed; samples = $samples; procs = $procs; io = $io } | ConvertTo-Json -Depth 4 -Compress
`;

interface RawSample {
  elapsed: number;
  samples: Array<{ p: string; i: string | null; v: number }>;
  procs: Array<{ pid: number; name: string; path: string | null; cpu: number; mem: number }>;
  io: Array<{ pid: number; name: string; bytes: number; ops: number }>;
}

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Parse the counter and process sample (exported for tests). */
export const parseSample = (raw: RawSample, cores: number, totalMB: number): Omit<Telemetry, "gpu" | "gpuProcesses" | "errors" | "at"> => {
  const value = (suffix: string) => raw.samples.find((s) => s.p.toLowerCase().endsWith(suffix.toLowerCase()))?.v ?? null;
  const committed = value("\\memory\\committed bytes");
  const limit = value("\\memory\\commit limit");
  const disks = new Map<string, DiskActivity>();
  for (const sample of raw.samples) {
    const match = /\\physicaldisk\(([^)]*)\)\\(.+)$/i.exec(sample.p);
    if (!match || !sample.i || sample.i === "_total") continue;
    const instance = sample.i;
    const number = Number(instance.split(" ")[0]);
    if (!Number.isFinite(number)) continue;
    const entry = disks.get(instance) ?? { disk: number, letters: (instance.match(/[a-z]:/gi) ?? []).map((l) => l[0].toUpperCase()), idlePercent: 100, queue: 0, mbPerSec: 0, latencyMs: 0 };
    const counter = match[2].toLowerCase();
    if (counter === "% idle time") entry.idlePercent = round(Math.max(0, Math.min(100, sample.v)));
    else if (counter === "avg. disk queue length") entry.queue = round(sample.v);
    else if (counter === "disk bytes/sec") entry.mbPerSec = round(sample.v / 1024 / 1024);
    else if (counter === "avg. disk sec/transfer") entry.latencyMs = round(sample.v * 1000);
    disks.set(instance, entry);
  }
  const seconds = Math.max(0.5, raw.elapsed || 1);
  const procs = (raw.procs ?? []).map((p) => ({ pid: p.pid, name: p.name, path: p.path, cpuPercent: round((p.cpu / seconds / cores) * 100), memMB: Math.round(p.mem / 1024 / 1024) }));
  return {
    cores,
    cpuPercent: value("\\processor(_total)\\% processor time") === null ? null : round(value("\\processor(_total)\\% processor time")!),
    ram: { totalMB, availableMB: value("\\memory\\available mbytes"), commitPercent: committed && limit ? round((committed / limit) * 100) : null },
    pagesPerSec: value("\\memory\\pages/sec") === null ? null : Math.round(value("\\memory\\pages/sec")!),
    disks: [...disks.values()].sort((a, b) => a.disk - b.disk),
    topCpu: [...procs].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 8),
    topMemory: [...procs].sort((a, b) => b.memMB - a.memMB).slice(0, 8),
    topIo: (raw.io ?? []).map((p) => ({ pid: p.pid, name: p.name, ioMBps: round(p.bytes / 1024 / 1024, 2), ioOps: Math.round(p.ops) }))
  };
};

/** Windows' own windows and shell, which every GPU list includes. */
const WINDOWS_SHELL = /^(explorer|dwm|StartMenuExperienceHost|ShellExperienceHost|SearchApp|SearchHost|TextInputHost|PhoneExperienceHost|ApplicationFrameHost|SystemSettings|LockApp|Widgets|msedgewebview2|SecHealthUI|GameBar|GameBarFTServer|Video\.UI|WindowsTerminal|ctfmon|NVIDIA Share|NVIDIA Overlay|nvcontainer)\.exe$/i;

const sampleGpu = async (): Promise<Pick<Telemetry, "gpu" | "gpuProcesses">> => {
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 8000 });
    const [name, util, used, total, temp] = stdout.trim().split("\n")[0].split(",").map((s) => s.trim());
    const gpuProcesses: Telemetry["gpuProcesses"] = [];
    try {
      const apps = await run("nvidia-smi", ["--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 8000 });
      for (const line of apps.stdout.trim().split("\n").filter(Boolean)) {
        const [pid, processName, memory] = line.split(",").map((s) => s.trim());
        const exe = processName.split(/[\\/]/).pop() ?? processName;
        if (WINDOWS_SHELL.test(exe)) continue;
        gpuProcesses.push({ pid: Number(pid), name: exe, usedMB: Number.isFinite(Number(memory)) ? Number(memory) : null });
      }
    } catch {
      // per-process GPU memory is often not reported on Windows (WDDM)
    }
    return { gpu: { name, utilPercent: Number(util), vramUsedMB: Number(used), vramTotalMB: Number(total), tempC: Number.isFinite(Number(temp)) ? Number(temp) : null }, gpuProcesses };
  } catch {
    return { gpu: null, gpuProcesses: [] };
  }
};

let last: Telemetry | null = null;
let inFlight: Promise<Telemetry> | null = null;
const history: Telemetry[] = [];
let sampler: NodeJS.Timeout | null = null;

const takeSample = async (): Promise<Telemetry> => {
  const errors: string[] = [];
  const totalMB = Math.round(os.totalmem() / 1024 / 1024);
  const cores = os.cpus().length;
  const [counters, gpu] = await Promise.all([
    powershellJson<RawSample>(SCRIPT, 45_000).catch((error: Error) => {
      errors.push(error.message);
      return null;
    }),
    sampleGpu()
  ]);
  const parsed = counters
    ? parseSample(counters, cores, totalMB)
    : { cores, cpuPercent: null, ram: { totalMB, availableMB: Math.round(os.freemem() / 1024 / 1024), commitPercent: null }, pagesPerSec: null, disks: [], topCpu: [], topMemory: [], topIo: [] };
  const sample: Telemetry = { at: new Date().toISOString(), ...parsed, ...gpu, errors };
  last = sample;
  history.push(sample);
  if (history.length > 30) history.shift();
  return sample;
};

export const Telemetry = {
  /** A sample no older than maxAgeMs (a new one is taken, one at a time, when needed). */
  async sample(maxAgeMs = 10_000): Promise<Telemetry> {
    if (last && Date.now() - Date.parse(last.at) <= maxAgeMs) return last;
    inFlight ??= takeSample().finally(() => {
      inFlight = null;
    });
    return inFlight;
  },

  /** The last sample, without waiting (null before the first). */
  last(): Telemetry | null {
    return last;
  },

  /** The recent samples, oldest first. */
  history(): Telemetry[] {
    return [...history];
  },

  /** Keep sampling in the background: every minute, every five while Gaming Mode is on. */
  startSampler(): void {
    if (sampler || process.platform !== "win32" || process.env.TELEMETRY_SAMPLER === "off") return;
    let lastRun = 0;
    sampler = setInterval(() => {
      const every = GameMode.isOn() ? 5 * 60_000 : 60_000;
      if (Date.now() - lastRun < every - 1000) return;
      lastRun = Date.now();
      void Telemetry.sample(0).catch(() => undefined);
    }, 15_000);
    sampler.unref?.();
  },

  stopSampler(): void {
    if (sampler) clearInterval(sampler);
    sampler = null;
  }
};

/** Friendly names for processes this PC is known to run. */
const KNOWN: Array<[RegExp, string]> = [
  [/^(ollama|ollama app|llama-server|ollama_llama_server)$/i, "the local AI model"],
  [/^qbittorrent$/i, "qBittorrent"],
  [/^bittorrent$/i, "BitTorrent"],
  [/^rclone$/i, "rclone sync"],
  [/^code$/i, "VS Code"],
  [/^msmpeng$/i, "Windows Defender (scanning)"],
  [/^searchindexer|searchprotocolhost$/i, "Windows Search indexing"],
  [/^(qemu-system-x86_64|vmmem|vmmemwsl)$/i, "WSL / the VM Lab"],
  [/^python$/i, "Python (ComfyUI or another tool)"],
  [/^node$/i, "Node (Agent Builder or another app)"],
  [/^steam|steamwebhelper$/i, "Steam"],
  [/^sonarr|radarr$/i, "Sonarr/Radarr"],
  [/^chrome|msedge$/i, "the browser"]
];

export const friendlyName = (name: string): string => {
  const hit = KNOWN.find(([pattern]) => pattern.test(name));
  return hit ? `${hit[1]} (${name})` : name;
};

export interface ExplainContext {
  /** Which drive letters hold what (Agent Builder, games, downloads…), from the storage inventory. */
  roles?: Record<string, string[]>;
}

/** Plain findings about where the pressure is, most serious first. */
export const explain = (t: Telemetry, context: ExplainContext = {}): Finding[] => {
  const findings: Finding[] = [];
  const io = t.topIo.filter((p) => (p.ioMBps ?? 0) >= 0.2).slice(0, 4).map((p) => `${friendlyName(p.name)} ${p.ioMBps} MB/s`);
  for (const disk of t.disks) {
    const name = disk.letters.length ? disk.letters.map((l) => `${l}:`).join(" ") : `disk ${disk.disk}`;
    const holds = disk.letters.flatMap((l) => context.roles?.[l] ?? []);
    const on = holds.length ? ` On it: ${[...new Set(holds)].join(", ")}.` : "";
    if (disk.idlePercent < 10 && disk.queue >= 4) {
      findings.push({ severity: "high", area: "disk", text: `${name} is saturated: ${disk.idlePercent}% idle, ${disk.queue} requests waiting, ${disk.latencyMs} ms a request, moving ${disk.mbPerSec} MB/s.${on} Everything reading from it waits.`, culprits: io });
    } else if (disk.idlePercent < 35 && disk.latencyMs > 50) {
      findings.push({ severity: "medium", area: "disk", text: `${name} is busy: ${disk.idlePercent}% idle, ${disk.latencyMs} ms a request.${on}`, culprits: io });
    }
  }
  if (t.ram.availableMB !== null && t.ram.availableMB < 2500) {
    findings.push({ severity: "high", area: "memory", text: `Only ${(t.ram.availableMB / 1024).toFixed(1)} GB of ${(t.ram.totalMB / 1024).toFixed(0)} GB memory is free.`, culprits: t.topMemory.slice(0, 4).map((p) => `${friendlyName(p.name)} ${(p.memMB! / 1024).toFixed(1)} GB`) });
  }
  if (t.ram.commitPercent !== null && t.ram.commitPercent > 85) {
    findings.push({ severity: t.ram.commitPercent > 93 ? "high" : "medium", area: "memory", text: `Committed memory is at ${t.ram.commitPercent}% of what RAM plus the page file allow: new programs (and WSL) may fail to start.`, culprits: t.topMemory.slice(0, 4).map((p) => `${friendlyName(p.name)} ${(p.memMB! / 1024).toFixed(1)} GB`) });
  }
  if (t.pagesPerSec !== null && t.pagesPerSec > 1500) {
    findings.push({ severity: "medium", area: "memory", text: `Windows is paging ${t.pagesPerSec} pages a second: memory is being swapped to disk, which stalls programs on a slow disk.`, culprits: [] });
  }
  if (t.cpuPercent !== null && t.cpuPercent > 85) {
    findings.push({ severity: "high", area: "cpu", text: `The CPU is at ${t.cpuPercent}%.`, culprits: t.topCpu.slice(0, 4).map((p) => `${friendlyName(p.name)} ${p.cpuPercent}%`) });
  }
  if (t.gpu) {
    const vramPercent = (t.gpu.vramUsedMB / t.gpu.vramTotalMB) * 100;
    const users = t.gpuProcesses.map((p) => `${friendlyName(p.name)}${p.usedMB ? ` ${p.usedMB} MB` : ""}`);
    if (t.gpu.utilPercent > 85) findings.push({ severity: "medium", area: "gpu", text: `The GPU is at ${t.gpu.utilPercent}%.`, culprits: users });
    if (vramPercent > 90) findings.push({ severity: "medium", area: "gpu", text: `Video memory is ${Math.round(vramPercent)}% full (${t.gpu.vramUsedMB} of ${t.gpu.vramTotalMB} MB): a game or model loading now may stutter or spill into system RAM.`, culprits: users });
  }
  const mode = GameMode.read();
  if (mode.on) findings.push({ severity: "info", area: "mode", text: `Gaming Mode is on (${mode.profile ?? "gaming"}): Agent Builder's own work is paused.`, culprits: [] });
  else if (mode.hold) findings.push({ severity: "info", area: "mode", text: "New background work is on hold.", culprits: [] });
  if (!findings.some((f) => f.severity !== "info")) findings.unshift({ severity: "info", area: "cpu", text: "Nothing is under pressure right now.", culprits: [] });
  const order = { high: 0, medium: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
};

/** A compact before/after figure for a mode switch. */
export const snapshotOf = (t: Telemetry | null) =>
  t
    ? {
        at: t.at,
        cpuPercent: t.cpuPercent,
        ramAvailableMB: t.ram.availableMB,
        vramUsedMB: t.gpu?.vramUsedMB ?? null,
        gpuPercent: t.gpu?.utilPercent ?? null,
        busiestDisk: t.disks.length ? (([d]) => ({ letter: d.letters.join("") || String(d.disk), idlePercent: d.idlePercent }))([...t.disks].sort((a, b) => a.idlePercent - b.idlePercent)) : null
      }
    : null;
