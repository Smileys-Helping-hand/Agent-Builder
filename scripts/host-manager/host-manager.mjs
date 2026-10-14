#!/usr/bin/env node
/**
 * Host Manager — what is running on this PC, and the switches for it.
 *
 * A small service of its own (no npm install, nothing imported from the
 * builder), so it keeps answering when Agent Builder is down, stuck starting
 * or being updated — which is exactly when you need it. It:
 *
 *   • watches Agent Builder (and how far its launcher has got), the model
 *     server (Ollama), Jarvis on this PC, the image engine (ComfyUI) and the
 *     SaveState host (savestate.co.za), plus the PC itself (CPU, memory, GPU,
 *     disks);
 *   • starts, stops and restarts them, and switches SaveState hosting off (to
 *     give the PC its resources back) or on again;
 *   • tells Jarvis when something goes down, comes back, or is stuck starting,
 *     graded so he tells you (notice/warn) rather than guessing;
 *   • serves a dashboard (http://127.0.0.1:4100, and this PC's Tailscale
 *     address) and a JSON API for the Agent Builder app, Jarvis and, later,
 *     your own host app.
 *
 * Every request except the dashboard's empty shell needs HOST_MANAGER_KEY
 * (x-host-key or Authorization: Bearer). The key is made on first start and
 * kept in the builder's .env. Only the fixed actions below exist: nothing here
 * runs a command it is sent.
 *
 *   node scripts/host-manager/host-manager.mjs
 */
import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
// HOST_MANAGER_REPO: run a copy against another checkout (testing a branch against the live builder).
const REPO = process.env.HOST_MANAGER_REPO ? path.resolve(process.env.HOST_MANAGER_REPO) : path.resolve(HERE, '..', '..');
const DATA = path.join(REPO, 'data');
const ENV_FILE = path.join(REPO, '.env');
fs.mkdirSync(DATA, { recursive: true });

/* ─── settings (.env of the builder) ─── */

function readEnv() {
  const out = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    /* no .env yet */
  }
  return out;
}
const env = { ...readEnv(), ...process.env };

let KEY = (env.HOST_MANAGER_KEY ?? '').trim();
if (KEY.length < 24) {
  KEY = `hm_${randomBytes(24).toString('base64url')}`;
  fs.appendFileSync(ENV_FILE, `\n# Host Manager (scripts/host-manager): the key for its dashboard and API.\nHOST_MANAGER_KEY=${KEY}\n`);
}
const PORT = Number(env.HOST_MANAGER_PORT) || 4100;
const MACHINE = os.hostname();
const JARVIS_DIR = env.JARVIS_DIR || 'E:\\Services\\jarvis';
const SAVESTATE_CONFIG = path.join(os.homedir(), '.nexus-windows-host.json');
const HOLDS_FILE = path.join(DATA, 'host-holds.json');
const EVENTS_FILE = path.join(DATA, 'host-events.json');
const LAUNCHER_STATUS = path.join(DATA, 'launcher-status.json');

/* ─── small helpers ─── */

const now = () => Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return fallback;
  }
};
const writeJson = (file, value) => {
  try {
    fs.writeFileSync(file, JSON.stringify(value, null, 2));
  } catch {
    /* best effort */
  }
};

async function answers(url, timeoutMs = 4000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

async function ps(script, timeoutMs = 30_000) {
  const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

/**
 * One PowerShell call per check (they are slow to start): every process with
 * its command line, SaveState's task state, CPU load and the disks.
 */
let machineFacts = { task: null, cpuPct: 0, disks: [] };
async function processes() {
  const out = await ps(
    "$p = @(Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine); " +
      "$t = Get-ScheduledTask -TaskName 'SaveState Host' -ErrorAction SilentlyContinue; " +
      "$c = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; " +
      "$d = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | Select-Object DeviceID,Size,FreeSpace); " +
      "@{ p = $p; t = $(if ($t) { $t.State.ToString() } else { $null }); c = $c; d = $d } | ConvertTo-Json -Compress -Depth 3",
  ).catch(() => '');
  let data = {};
  try {
    data = JSON.parse(out || '{}');
  } catch {
    data = {};
  }
  machineFacts = {
    task: data.t ?? null,
    cpuPct: Number(data.c) || 0,
    disks: (data.d ?? []).map((d) => ({ drive: d.DeviceID, sizeGb: Math.round(d.Size / 1e9), freeGb: Math.round(d.FreeSpace / 1e9) })),
  };
  return (data.p ?? []).map((p) => ({ pid: p.ProcessId, name: p.Name ?? '', cmd: p.CommandLine ?? '' }));
}

async function listenerPid(port) {
  const out = await ps(`(Get-NetTCPConnection -LocalPort ${Number(port)} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`).catch(() => '');
  const pid = Number(out);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

async function kill(pids, tree = false) {
  for (const pid of new Set(pids.filter(Boolean))) {
    await run('taskkill.exe', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { windowsHide: true }).catch(() => undefined);
  }
}

/** Starts something detached and hidden, outliving this service. */
function launch(file, args, cwd, extraEnv = {}) {
  const child = spawn(file, args, { cwd, detached: true, stdio: 'ignore', windowsHide: true, env: { ...process.env, ...extraEnv } });
  child.unref();
  return child.pid;
}

/* ─── holds: things switched off on purpose stay off ─── */

const holds = () => readJson(HOLDS_FILE, {});
function setHold(id, on) {
  const next = holds();
  if (on) next[id] = { since: new Date().toISOString() };
  else delete next[id];
  writeJson(HOLDS_FILE, next);
}

/* ─── events, and telling Jarvis ─── */

let events = readJson(EVENTS_FILE, []);
const jarvisHooks = () => {
  const urls = [];
  if (env.JARVIS_WEBHOOK_URL) urls.push(env.JARVIS_WEBHOOK_URL.replace(/\/+$/, ''));
  const key = (env.JARVIS_API_KEY ?? '').trim();
  if (env.JARVIS_HOST && key) urls.push(`${env.JARVIS_HOST.replace(/\/+$/, '')}/api/assistant/webhook/${key}`);
  if (key) urls.push(`http://127.0.0.1:3005/api/assistant/webhook/${key}`);
  return [...new Set(urls)];
};

async function tellJarvis(event) {
  for (const url of jarvisHooks()) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app: 'Host Manager',
          sender: `Host Manager (${MACHINE})`,
          type: event.type,
          title: event.title,
          body: event.body ?? '',
          severity: event.severity,
          entityId: event.service ?? undefined,
          owner_user_id: env.JARVIS_OWNER_ID || undefined,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return true;
    } catch {
      /* next address */
    }
  }
  return false;
}

function record(event) {
  const full = { at: now(), ...event };
  events = [full, ...events].slice(0, 200);
  writeJson(EVENTS_FILE, events);
  if (event.severity && event.severity !== 'quiet') void tellJarvis(full);
  return full;
}

/* ─── the services ─── */

const COMFY_PORT = 8188;

function ollamaExe() {
  return [path.join(env.LOCALAPPDATA ?? '', 'Programs', 'Ollama', 'ollama.exe'), 'C:\\Program Files\\Ollama\\ollama.exe'].find((p) => p && fs.existsSync(p)) ?? null;
}

function comfyCommand() {
  const dir = path.join(env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'Comfy Desktop');
  const installs = readJson(path.join(dir, 'installations.json'), []);
  const settings = readJson(path.join(dir, 'settings.json'), {});
  for (const install of Array.isArray(installs) ? installs : []) {
    if (!install.installPath || install.status !== 'installed') continue;
    const python = path.join(install.installPath, 'ComfyUI', '.venv', 'Scripts', 'python.exe');
    if (!fs.existsSync(python)) continue;
    const args = ['-s', path.join('ComfyUI', 'main.py'), '--enable-manager', '--listen', '127.0.0.1', '--port', String(COMFY_PORT)];
    const models = path.join(dir, 'shared_model_paths.yaml');
    if (fs.existsSync(models)) args.push('--extra-model-paths-config', models);
    if (settings.inputDir) args.push('--input-directory', settings.inputDir);
    if (settings.outputDir) args.push('--output-directory', settings.outputDir);
    return { python, args, cwd: install.installPath };
  }
  return null;
}

const comfyProcesses = (procs) => procs.filter((p) => /python/i.test(p.name) && /ComfyUI[\\/]main\.py/i.test(p.cmd) && p.cmd.includes(`--port ${COMFY_PORT}`));

const savestateConfig = () => readJson(SAVESTATE_CONFIG, null);
/** Ready | Running | Disabled | null (not installed), from this check's facts. */
const savestateTask = () => machineFacts.task;

/**
 * Each service: how to tell it is up, and what start/stop mean for it.
 * ctx = { procs, holds } for this check.
 */
const SERVICES = [
  {
    id: 'agent-builder',
    name: 'Agent Builder',
    about: 'The builder and its app (port 4000), kept up by its launcher.',
    async probe(ctx) {
      const up = await answers('http://127.0.0.1:4000/api/update/check', 6000);
      const launcher = ctx.procs.find((p) => /powershell/i.test(p.name) && p.cmd.includes('scripts\\launcher\\start.ps1'));
      const step = readJson(LAUNCHER_STATUS, null);
      const stepLine = step && launcher ? `${step.step}${step.detail ? ` — ${step.detail}` : ''}` : null;
      if (up) return { state: 'up', detail: launcher ? 'Running, watched by its launcher' : 'Running (launcher not running: nothing will restart it)' };
      if (ctx.holds['agent-builder']) return { state: 'stopped', detail: 'Stopped from the Host Manager' };
      if (launcher) return { state: 'starting', detail: stepLine ?? 'Its launcher is starting it', step };
      return { state: 'down', detail: 'Not running' };
    },
    async start() {
      setHold('agent-builder', false);
      const cmd = path.join(REPO, 'Start Agent Builder.cmd');
      // Through Explorer, like the Start menu: its own window, outliving this service.
      if (fs.existsSync(cmd)) launch('explorer.exe', [cmd], REPO);
      else launch('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Minimized', '-File', path.join(REPO, 'scripts', 'launcher', 'start.ps1')], REPO);
    },
    async stop(ctx) {
      setHold('agent-builder', true);
      // The launcher first (so it does not restart the builder), then what it runs for the builder.
      // Jarvis and the model server are shared and stay; so does SaveState's tunnel.
      const pids = readJson(path.join(DATA, 'launcher-pids.json'), {});
      const targets = ctx.procs.filter(
        (p) =>
          (/powershell/i.test(p.name) && p.cmd.includes('scripts\\launcher\\start.ps1')) ||
          (/node/i.test(p.name) && (p.cmd.includes('src/server/server.ts') || p.cmd.includes('dist/bundle/server.js') || p.cmd.includes('jarvis-peer-bridge'))),
      );
      await kill(targets.map((p) => p.pid));
      const tunnel = ctx.procs.find((p) => p.pid === Number(pids.tunnel) && /cloudflared/i.test(p.name) && !p.cmd.includes('NexusEmuHost'));
      if (tunnel) await kill([tunnel.pid]);
    },
  },
  {
    id: 'model-server',
    name: 'Model server',
    about: 'Ollama (port 11434): the local AI for builds, Jarvis and research.',
    async probe(ctx) {
      if (await answers('http://127.0.0.1:11434/api/tags', 5000)) {
        const loaded = await fetch('http://127.0.0.1:11434/api/ps', { signal: AbortSignal.timeout(4000) })
          .then((r) => r.json())
          .then((j) => (j.models ?? []).map((m) => m.name))
          .catch(() => []);
        return { state: 'up', detail: loaded.length ? `Loaded: ${loaded.join(', ')}` : 'Running, no model loaded' };
      }
      if (ctx.holds['model-server']) return { state: 'stopped', detail: 'Stopped from the Host Manager' };
      if (readJson(path.join(DATA, 'game-mode.json'), {}).on) return { state: 'stopped', detail: 'Off for game mode' };
      return { state: 'down', detail: ollamaExe() ? 'Not running' : 'Ollama is not installed' };
    },
    async start() {
      setHold('model-server', false);
      const exe = ollamaExe();
      if (!exe) throw new Error('Ollama is not installed.');
      launch(exe, ['serve'], path.dirname(exe), {
        OLLAMA_CONTEXT_LENGTH: env.OLLAMA_NUM_CTX || '16384',
        OLLAMA_FLASH_ATTENTION: env.OLLAMA_FLASH_ATTENTION === 'false' ? '0' : '1',
        OLLAMA_KV_CACHE_TYPE: env.OLLAMA_KV_CACHE_TYPE || 'q8_0',
        OLLAMA_MAX_LOADED_MODELS: env.OLLAMA_MAX_LOADED_MODELS || '1',
      });
    },
    async stop(ctx) {
      setHold('model-server', true);
      await kill(ctx.procs.filter((p) => /^ollama/i.test(p.name)).map((p) => p.pid));
    },
  },
  {
    id: 'jarvis',
    name: 'Jarvis (this PC)',
    about: "Jarvis's copy on this PC (port 3005), with his heartbeat.",
    async probe(ctx) {
      if (await answers('http://127.0.0.1:3005/api/jarvis/status', 6000)) return { state: 'up', detail: 'Answering on port 3005' };
      if (ctx.holds.jarvis) return { state: 'stopped', detail: 'Stopped from the Host Manager' };
      if (!fs.existsSync(path.join(JARVIS_DIR, '.next', 'BUILD_ID'))) return { state: 'down', detail: `Not built in ${JARVIS_DIR}` };
      const starting = ctx.procs.some((p) => /node/i.test(p.name) && p.cmd.includes('start -p 3005'));
      return { state: starting ? 'starting' : 'down', detail: starting ? 'Starting' : 'Not running' };
    },
    async start() {
      setHold('jarvis', false);
      if (!fs.existsSync(path.join(JARVIS_DIR, '.next', 'BUILD_ID'))) throw new Error(`Jarvis is not built in ${JARVIS_DIR}.`);
      launch('cmd.exe', ['/c', `npx next start -p 3005 -H 127.0.0.1 >> "${path.join(DATA, 'jarvis.log')}" 2>&1`], JARVIS_DIR);
      launch('cmd.exe', ['/c', `node --env-file=.env scripts/jarvis-node-agent.mjs >> "${path.join(DATA, 'jarvis.log')}" 2>&1`], JARVIS_DIR);
    },
    async stop(ctx) {
      setHold('jarvis', true);
      await kill(ctx.procs.filter((p) => /node/i.test(p.name) && (p.cmd.includes('start -p 3005') || p.cmd.includes('jarvis-node-agent'))).map((p) => p.pid), true);
    },
  },
  {
    id: 'image-engine',
    name: 'Image engine',
    about: 'ComfyUI (port 8188): pictures and sprites. Starts by itself when something is drawn.',
    async probe(ctx) {
      if (await answers(`http://127.0.0.1:${COMFY_PORT}/system_stats`, 4000)) return { state: 'up', detail: 'Running (uses the graphics card)' };
      if (comfyProcesses(ctx.procs).length) return { state: 'starting', detail: 'Loading (a minute or two on a busy disk)' };
      return { state: 'stopped', detail: comfyCommand() ? 'Off — starts on its own when a picture is drawn' : 'Comfy Desktop has no installation to run' };
    },
    async start() {
      const command = comfyCommand();
      if (!command) throw new Error('Comfy Desktop has no installation to run.');
      launch(command.python, command.args, command.cwd);
    },
    async stop(ctx) {
      // Answering or still loading: ComfyUI's own python (and the venv launcher in front of it).
      const pid = await listenerPid(COMFY_PORT);
      await kill([pid, ...comfyProcesses(ctx.procs).map((p) => p.pid)], true);
    },
  },
  {
    id: 'savestate',
    name: 'SaveState hosting',
    about: 'savestate.co.za served from this PC: its server, game watcher and Drive mount. Off gives the PC its resources back; the tunnel stays, because Agent Builder and Jarvis are reached through it too.',
    async probe(ctx) {
      const cfg = savestateConfig();
      if (!cfg) return { state: 'absent', detail: 'Not set up on this PC' };
      const task = savestateTask();
      const server = await answers('http://127.0.0.1:3000/', 6000);
      const watchdog = ctx.procs.some((p) => /powershell/i.test(p.name) && p.cmd.includes('run-host.ps1'));
      if (task === 'Disabled' || ctx.holds.savestate) {
        return { state: server ? 'stopping' : 'stopped', detail: server ? 'Switched off; its server is still closing' : 'Switched off (it stays off after a restart too)' };
      }
      if (server) return { state: 'up', detail: watchdog ? 'Serving savestate.co.za, watched by its watchdog' : 'Serving, but its watchdog is not running' };
      return { state: watchdog ? 'starting' : 'down', detail: watchdog ? 'Its watchdog is starting the server' : `Not running (task: ${task ?? 'not installed'})` };
    },
    async start(ctx) {
      setHold('savestate', false);
      // The tunnel kept running while it was off; the watchdog starts its own, so close the old one first.
      const cfg = savestateConfig();
      const watchdog = ctx.procs.some((p) => /powershell/i.test(p.name) && p.cmd.includes('run-host.ps1'));
      if (!watchdog && cfg?.tunnelConfig) {
        await kill(ctx.procs.filter((p) => /cloudflared/i.test(p.name) && p.cmd.includes(cfg.tunnelConfig)).map((p) => p.pid));
      }
      await ps("Enable-ScheduledTask -TaskName 'SaveState Host' | Out-Null; Start-ScheduledTask -TaskName 'SaveState Host'");
    },
    async stop(ctx) {
      setHold('savestate', true);
      const cfg = savestateConfig();
      // Off for good (until switched on): no restart at logon, and the watchdog first so it restarts nothing.
      await ps("Disable-ScheduledTask -TaskName 'SaveState Host' | Out-Null; Stop-ScheduledTask -TaskName 'SaveState Host' -ErrorAction SilentlyContinue").catch(() => undefined);
      await kill(ctx.procs.filter((p) => /powershell/i.test(p.name) && (p.cmd.includes('run-host.ps1') || p.cmd.includes('game-watch.ps1'))).map((p) => p.pid));
      const server = await listenerPid(3000);
      const serverProc = ctx.procs.find((p) => p.pid === server);
      if (serverProc && cfg && (serverProc.cmd.includes('server.mjs') || serverProc.cmd.includes(cfg.appDir ?? '¬'))) await kill([server], true);
      if (cfg?.rclone) await kill(ctx.procs.filter((p) => /rclone/i.test(p.name) && p.cmd.includes(' mount ')).map((p) => p.pid));
    },
  },
];

/* ─── the PC itself ─── */

async function system() {
  const [gpu] = await Promise.all([
    run('nvidia-smi', ['--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu', '--format=csv,noheader,nounits'], { windowsHide: true, timeout: 8000 })
      .then(({ stdout }) => {
        const [name, util, used, total, temp] = stdout.trim().split('\n')[0].split(',').map((s) => s.trim());
        return { name, util: Number(util), memUsedMb: Number(used), memTotalMb: Number(total), tempC: Number(temp) };
      })
      .catch(() => null),
  ]);
  return {
    machine: MACHINE,
    uptimeHours: Math.round((os.uptime() / 3600) * 10) / 10,
    cpuPct: machineFacts.cpuPct,
    memory: { usedGb: Math.round(((os.totalmem() - os.freemem()) / 1e9) * 10) / 10, totalGb: Math.round((os.totalmem() / 1e9) * 10) / 10 },
    gpu,
    disks: machineFacts.disks,
  };
}

/* ─── the watch ─── */

let snapshot = { at: 0, services: [], system: null };
const lastState = new Map();
const busy = new Map(); // id -> action in progress
let checking = null;

// Worth telling you about when it goes down by itself (the image engine comes and goes on purpose).
const WATCHED = new Set(['agent-builder', 'model-server', 'jarvis', 'savestate']);

async function check() {
  if (checking) return checking;
  checking = (async () => {
    const ctx = { procs: await processes(), holds: holds() };
    const services = [];
    for (const service of SERVICES) {
      let result;
      try {
        result = await service.probe(ctx);
      } catch (error) {
        result = { state: 'unknown', detail: error instanceof Error ? error.message : String(error) };
      }
      const previous = lastState.get(service.id);
      const since = previous && previous.state === result.state ? previous.since : now();
      lastState.set(service.id, { state: result.state, since });
      services.push({ id: service.id, name: service.name, about: service.about, ...result, since, busy: busy.get(service.id) ?? null, held: Boolean(ctx.holds[service.id]) });

      if (previous && previous.state !== result.state && !busy.has(service.id) && WATCHED.has(service.id)) {
        if (result.state === 'down' && previous.state === 'up') {
          record({ type: 'host.down', service: service.id, severity: 'warn', title: `${service.name} went down on ${MACHINE}`, body: result.detail });
        } else if (result.state === 'up' && (previous.state === 'down' || previous.state === 'starting')) {
          record({ type: 'host.up', service: service.id, severity: 'info', title: `${service.name} is up on ${MACHINE}` });
        }
      }
      // Stuck starting: the same launcher step for 8 minutes (once per step).
      if (result.state === 'starting' && now() - since > 8 * 60_000) {
        const key = `${service.id}:${result.detail}`;
        if (!stuckTold.has(key)) {
          stuckTold.add(key);
          record({ type: 'host.stuck', service: service.id, severity: 'warn', title: `${service.name} is stuck starting on ${MACHINE}`, body: `${result.detail} (for ${Math.round((now() - since) / 60_000)} minutes). Restart it from the Host Manager, or ask Jarvis to.` });
        }
      }
      if (result.state !== 'starting') for (const k of [...stuckTold]) if (k.startsWith(`${service.id}:`)) stuckTold.delete(k);
    }
    snapshot = { at: now(), services, system: await system().catch(() => null) };
    return snapshot;
  })().finally(() => {
    checking = null;
  });
  return checking;
}
const stuckTold = new Set();

/** Agent Builder's launcher died and nothing brings the builder back: start it (unless it was stopped on purpose). */
async function keepBuilderUp() {
  const builder = snapshot.services.find((s) => s.id === 'agent-builder');
  if (!builder || builder.state !== 'down' || builder.held || busy.has('agent-builder')) return;
  if (now() - builder.since < 3 * 60_000) return;
  record({ type: 'host.autostart', service: 'agent-builder', severity: 'notice', title: `Agent Builder was down for 3 minutes on ${MACHINE}; starting it` });
  await act('agent-builder', 'start', 'Host Manager').catch(() => undefined);
}

async function act(id, action, by = 'someone') {
  const service = SERVICES.find((s) => s.id === id);
  if (!service) throw Object.assign(new Error('No such service.'), { status: 404 });
  if (!['start', 'stop', 'restart'].includes(action)) throw Object.assign(new Error('Start, stop or restart.'), { status: 400 });
  if (busy.has(id)) throw Object.assign(new Error(`It is already ${busy.get(id)}.`), { status: 409 });
  busy.set(id, action === 'stop' ? 'stopping' : action === 'start' ? 'starting' : 'restarting');
  try {
    const ctx = { procs: await processes(), holds: holds() };
    if (action === 'stop' || action === 'restart') await service.stop(ctx);
    if (action === 'restart') await sleep(3000);
    if (action === 'start' || action === 'restart') await service.start({ procs: await processes(), holds: holds() });
    const verb = action === 'stop' ? (id === 'savestate' ? 'switched off' : 'stopped') : action === 'start' ? (id === 'savestate' ? 'switched on' : 'started') : 'restarted';
    record({ type: `host.${action}`, service: id, severity: id === 'savestate' ? 'notice' : 'info', title: `${service.name} ${verb} on ${MACHINE}`, body: `By ${by}.` });
  } finally {
    busy.delete(id);
    lastState.delete(id);
    setTimeout(() => void check(), 2000);
  }
}

/* ─── HTTP ─── */

const digest = (v) => createHash('sha256').update(v).digest();
function authorised(req) {
  const header = String(req.headers['x-host-key'] ?? '') || String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  return header.length > 0 && timingSafeEqual(digest(header), digest(KEY));
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) break;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const DASHBOARD = path.join(HERE, 'dashboard.html');

async function handle(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
    return send(res, 200, fs.readFileSync(DASHBOARD, 'utf8'), 'text/html; charset=utf-8');
  }
  if (url.pathname === '/api/health') return send(res, 200, { ok: true, machine: MACHINE });
  if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
  if (!authorised(req)) return send(res, 401, { error: 'The Host Manager key is needed.' });

  if (req.method === 'GET' && url.pathname === '/api/status') {
    const fresh = url.searchParams.get('fresh') === '1' || now() - snapshot.at > 20_000;
    const snap = fresh ? await check() : snapshot;
    return send(res, 200, { ...snap, launcher: readJson(LAUNCHER_STATUS, null), holds: holds(), events: events.slice(0, 25) });
  }
  if (req.method === 'GET' && url.pathname === '/api/events') {
    const since = Number(url.searchParams.get('since')) || 0;
    return send(res, 200, { events: events.filter((e) => e.at > since).slice(0, 100) });
  }
  const m = /^\/api\/services\/([a-z-]+)\/(start|stop|restart)$/.exec(url.pathname);
  if (req.method === 'POST' && m) {
    const body = await readBody(req);
    const by = typeof body.by === 'string' && body.by.trim() ? body.by.trim().slice(0, 60) : 'the Host Manager dashboard';
    try {
      await act(m[1], m[2], by);
      return send(res, 200, { ok: true, status: await check() });
    } catch (error) {
      return send(res, error.status ?? 500, { error: error.message ?? 'That did not work.' });
    }
  }
  return send(res, 404, { error: 'Not found' });
}

function listen(host) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => send(res, 500, { error: error instanceof Error ? error.message : 'Failed' }));
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE' && host === '127.0.0.1') {
      console.log(`[host-manager] already running on ${PORT}`);
      process.exit(0);
    }
    console.error(`[host-manager] could not listen on ${host}:${PORT}:`, error.message);
  });
  server.listen(PORT, host, () => console.log(`[host-manager] http://${host}:${PORT}`));
}

process.on('uncaughtException', (e) => console.error('[host-manager] survived:', e));
process.on('unhandledRejection', (e) => console.error('[host-manager] survived:', e));

listen('127.0.0.1');
// This PC's Tailscale address too, so Jarvis on the laptop can reach it (never the LAN or the internet).
const tailscale = Object.values(os.networkInterfaces())
  .flat()
  .find((a) => a && a.family === 'IPv4' && /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(a.address));
if (tailscale) listen(tailscale.address);

record({ type: 'host.manager', severity: 'quiet', title: `Host Manager started on ${MACHINE}` });
const loop = async () => {
  await check().catch((e) => console.error('[host-manager] check failed:', e));
  await keepBuilderUp().catch(() => undefined);
  setTimeout(loop, 15_000);
};
void loop();
