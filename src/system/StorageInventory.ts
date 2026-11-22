/**
 * Storage inventory: every disk and drive on this PC, what kind it really is,
 * what lives on it, and where each workload belongs. Read-only: nothing here
 * moves, deletes or writes anything except its own small benchmark file and
 * its cached report.
 *
 * Facts come from Windows (Get-PhysicalDisk, Get-Partition, Get-Volume, mapped
 * network drives), Steam's own library list and app manifests (sizes without
 * walking a single game folder), Epic's install manifests, qBittorrent's
 * settings, and Agent Builder's configuration. A disk's speed class is
 * measured by Windows when it says (SSD, NVMe), and inferred from the model
 * number for hard drives (Windows reports their spindle speed as unknown);
 * each disk says which.
 *
 * `recommend()` is pure: it turns an inventory into advice, each item saying
 * whether it needs the owner's approval. It never acts.
 */
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";

import { powershellJson } from "./PowerShell.js";

export type Tier = "nvme-ssd" | "sata-ssd" | "hdd-7200" | "hdd-5400" | "hdd-unknown" | "usb" | "network";

export interface PhysicalDisk {
  number: number;
  model: string;
  bus: string;
  mediaType: string;
  sizeGB: number;
  health: string;
  tier: Tier;
  /** Where the tier came from: Windows, or the model number (assumed). */
  tierSource: "windows" | "model-number" | "unknown";
  rpm: number | null;
  letters: string[];
}

export interface Volume {
  letter: string;
  disk: number | null;
  label: string;
  fileSystem: string;
  sizeGB: number;
  freeGB: number;
  tier: Tier;
}

export interface GameLibrary {
  kind: "steam" | "epic" | "folder";
  path: string;
  letter: string;
  games: number | null;
  sizeGB: number | null;
}

export interface KnownLocation {
  id: string;
  label: string;
  path: string;
  letter: string;
  /** source code, models, generated media… — what it is and whether it can be regenerated. */
  kind: "source" | "models" | "generated" | "downloads" | "datasets" | "tools" | "archive";
  regenerable: boolean;
  sizeGB: number | null;
}

export interface NetworkShare {
  letter: string | null;
  path: string;
  host: string;
  reachable: boolean | null;
  detail: string;
}

export interface StorageInventory {
  at: string;
  disks: PhysicalDisk[];
  volumes: Volume[];
  games: GameLibrary[];
  locations: KnownLocation[];
  network: NetworkShare[];
  benchmarks: Record<string, Benchmark>;
  errors: string[];
}

export interface Benchmark {
  letter: string;
  at: string;
  writeMBps: number;
  syncLatencyMs: number;
  note: string;
}

export interface Recommendation {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  /** True when acting on it would move, delete or change data: the owner decides. Nothing here acts. */
  needsApproval: boolean;
}

/** Hard-drive families by model number, for the speed Windows does not report. */
const MODEL_RPM: Array<[RegExp, number, string]> = [
  [/^ST\d+DM00[1-4]/i, 7200, "Seagate BarraCuda desktop"],
  [/^ST\d+DM010/i, 7200, "Seagate BarraCuda desktop"],
  [/^ST\d+DM00[5-9]/i, 5400, "Seagate BarraCuda desktop (5400)"],
  [/^ST\d+LM\d+/i, 5400, "Seagate 2.5\" laptop"],
  [/^ST\d+(VN|NE|NM)\d+/i, 7200, "Seagate IronWolf/Exos"],
  [/^WDCWD\d+(EZEX|EZDX|EZAZX|FZEX|FZWX|FAEX|AAKX|AZLX)/i, 7200, "WD Blue/Black desktop"],
  [/^WDCWD\d+(EZRZ|EZRX|EZAZ|EFRX|EFAX|EFZX|EADS|EARS|PURZ|LPVX|LPCX|SPZX)/i, 5400, "WD 5400-class"],
  [/^(HGST|HTS|HDN|TOSHIBA(DT01|HDW[DE]))/i, 7200, "HGST/Toshiba desktop"]
];

export const tierOf = (disk: { model: string; bus: string; mediaType: string }): { tier: Tier; source: PhysicalDisk["tierSource"]; rpm: number | null } => {
  const model = disk.model.replace(/\s+/g, "");
  if (/nvme/i.test(disk.bus)) return { tier: "nvme-ssd", source: "windows", rpm: 0 };
  if (/ssd/i.test(disk.mediaType)) return { tier: "sata-ssd", source: "windows", rpm: 0 };
  const known = MODEL_RPM.find(([pattern]) => pattern.test(model));
  if (known) return { tier: known[1] === 7200 ? "hdd-7200" : "hdd-5400", source: "model-number", rpm: known[1] };
  if (/usb/i.test(disk.bus)) return { tier: "usb", source: "windows", rpm: null };
  if (/hdd/i.test(disk.mediaType)) return { tier: "hdd-unknown", source: "windows", rpm: null };
  return { tier: "hdd-unknown", source: "unknown", rpm: null };
};

const SCRIPT = `
$disks = @(Get-PhysicalDisk | ForEach-Object { @{ number = [int]$_.DeviceId; model = $_.FriendlyName; bus = [string]$_.BusType; media = [string]$_.MediaType; size = [double]$_.Size; health = [string]$_.HealthStatus } })
$parts = @(Get-Partition | Where-Object { $_.DriveLetter } | ForEach-Object { @{ letter = [string]$_.DriveLetter; disk = [int]$_.DiskNumber } })
$vols = @(Get-Volume | Where-Object { $_.DriveLetter } | ForEach-Object { @{ letter = [string]$_.DriveLetter; label = $_.FileSystemLabel; fs = $_.FileSystem; size = [double]$_.Size; free = [double]$_.SizeRemaining } })
$netdrives = @(Get-CimInstance Win32_NetworkConnection | ForEach-Object { @{ letter = ([string]$_.LocalName).TrimEnd(':'); path = $_.RemoteName; status = $_.ConnectionState } })
$steamRoot = (Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue).SteamPath
$steam = @()
if ($steamRoot) {
  $vdf = Join-Path $steamRoot 'steamapps\\libraryfolders.vdf'
  if (Test-Path $vdf) {
    foreach ($m in (Select-String -Path $vdf -Pattern '"path"\\s+"([^"]+)"')) {
      $lib = $m.Matches[0].Groups[1].Value -replace '\\\\\\\\','\\'
      $size = 0; $count = 0
      foreach ($acf in (Get-ChildItem (Join-Path $lib 'steamapps') -Filter 'appmanifest_*.acf' -ErrorAction SilentlyContinue)) {
        $hit = Select-String -Path $acf.FullName -Pattern '"SizeOnDisk"\\s+"(\\d+)"' | Select-Object -First 1
        if ($hit) { $size += [double]$hit.Matches[0].Groups[1].Value; $count++ }
      }
      $steam += @{ path = $lib; games = $count; bytes = $size }
    }
  }
}
$epic = @()
$manifests = Join-Path $env:ProgramData 'Epic\\EpicGamesLauncher\\Data\\Manifests'
if (Test-Path $manifests) {
  foreach ($item in (Get-ChildItem $manifests -Filter '*.item')) {
    try { $j = Get-Content $item.FullName -Raw | ConvertFrom-Json; $epic += @{ path = $j.InstallLocation; bytes = [double]$j.InstallSize; name = $j.DisplayName } } catch {}
  }
}
$folders = @()
foreach ($v in $vols) { foreach ($n in @('Games','XboxGames','Ubisoft','GOG Games','Riot Games','EA Games','Epic Games')) { $p = "$($v.letter):\\$n"; if (Test-Path $p) { $folders += $p } } }
@{ disks = $disks; parts = $parts; vols = $vols; net = $netdrives; steam = $steam; epic = $epic; folders = $folders } | ConvertTo-Json -Depth 5 -Compress
`;

interface Raw {
  disks: Array<{ number: number; model: string; bus: string; media: string; size: number; health: string }>;
  parts: Array<{ letter: string; disk: number }>;
  vols: Array<{ letter: string; label: string; fs: string; size: number; free: number }>;
  net: Array<{ letter: string; path: string; status: string }>;
  steam: Array<{ path: string; games: number; bytes: number }>;
  epic: Array<{ path: string; bytes: number; name: string }>;
  folders: string[];
}

const GB = 1024 ** 3;
const gb = (bytes: number) => Math.round((bytes / GB) * 10) / 10;
const letterOf = (p: string) => (/^([a-z]):/i.exec(p)?.[1] ?? "").toUpperCase();
const FILE = path.resolve("data/system/storage.json");

/** Agent Builder's own pieces and the tools it drives, wherever this PC keeps them. */
export const knownLocations = (): Array<Omit<KnownLocation, "letter" | "sizeGB">> => {
  const env = process.env;
  const repo = process.cwd();
  const userOllama = env.OLLAMA_MODELS || path.join(os.homedir(), ".ollama", "models");
  const list: Array<Omit<KnownLocation, "letter" | "sizeGB">> = [
    { id: "repo", label: "Agent Builder (code)", path: repo, kind: "source", regenerable: false },
    { id: "builds", label: "Agent Builder builds", path: path.join(repo, "builds"), kind: "generated", regenerable: false },
    { id: "data", label: "Agent Builder data (memory, research, sessions)", path: path.join(repo, "data"), kind: "datasets", regenerable: false },
    { id: "game-demos", label: "Game versions", path: path.join(repo, "data", "game-demos"), kind: "generated", regenerable: true },
    { id: "ollama", label: "Local AI models (Ollama)", path: userOllama, kind: "models", regenerable: true },
    { id: "comfy-models", label: "Image models (ComfyUI)", path: env.COMFY_MODELS_PATH || "H:\\ComfyUI-Models", kind: "models", regenerable: true },
    { id: "comfy", label: "ComfyUI / MediaGen", path: env.COMFY_DIR || "E:\\MediaGen", kind: "tools", regenerable: true },
    { id: "unity-levels", label: "Unity level project", path: env.UNITY_LEVEL_PROJECT || "E:\\Projects\\AgentBuilderLevels", kind: "generated", regenerable: false },
    { id: "blender", label: "Blender", path: env.BLENDER_PATH ? path.dirname(env.BLENDER_PATH) : "E:\\Tools", kind: "tools", regenerable: true },
  ];
  const wsl = wslDisk();
  if (wsl) list.push({ id: "wsl", label: "WSL disk (VM Lab, NexusOS builds)", path: wsl, kind: "tools", regenerable: false });
  const qbt = qbittorrentSavePath();
  if (qbt) list.push({ id: "torrents", label: "qBittorrent downloads", path: qbt, kind: "downloads", regenerable: false });
  return list.filter((entry) => fs.existsSync(entry.path));
};

/** The WSL distribution's virtual disk (ext4.vhdx), whose size is just its file size. */
export const wslDisk = (): string | null => {
  const packages = path.join(os.homedir(), "AppData", "Local", "Packages");
  try {
    for (const name of fs.readdirSync(packages)) {
      if (!/^CanonicalGroupLimited/i.test(name)) continue;
      const vhdx = path.join(packages, name, "LocalState", "ext4.vhdx");
      if (fs.existsSync(vhdx)) return vhdx;
    }
  } catch {
    // no WSL
  }
  return null;
};

/** qBittorrent's default download folder, from its settings file. */
export const qbittorrentSavePath = (): string | null => {
  try {
    const ini = fs.readFileSync(path.join(process.env.APPDATA ?? "", "qBittorrent", "qBittorrent.ini"), "utf8");
    const match = /^Session\\DefaultSavePath=(.+)$/m.exec(ini) ?? /^Downloads\\SavePath=(.+)$/m.exec(ini);
    return match ? match[1].trim().replace(/\\\\/g, "\\") : null;
  } catch {
    return null;
  }
};

/** Whether a host answers on SMB (445), within two seconds: never hangs on a dead share. */
export const smbReachable = (host: string, timeoutMs = 2000): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = net.connect({ host, port: 445 });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });

const readCache = (): StorageInventory | null => {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as StorageInventory;
  } catch {
    return null;
  }
};

const writeCache = (inventory: StorageInventory) => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(inventory, null, 2));
};

/** Build the inventory from Windows' answer (exported for tests). */
export const assemble = (raw: Raw, extra: { locations: Array<Omit<KnownLocation, "letter" | "sizeGB">>; sizes?: Record<string, number>; benchmarks?: Record<string, Benchmark>; network: NetworkShare[] }): StorageInventory => {
  const disks: PhysicalDisk[] = raw.disks.map((d) => {
    const { tier, source, rpm } = tierOf({ model: d.model, bus: d.bus, mediaType: d.media });
    return { number: d.number, model: d.model, bus: d.bus, mediaType: d.media, sizeGB: gb(d.size), health: d.health, tier, tierSource: source, rpm, letters: raw.parts.filter((p) => p.disk === d.number).map((p) => p.letter.toUpperCase()) };
  });
  const volumes: Volume[] = raw.vols
    .map((v) => {
      const disk = raw.parts.find((p) => p.letter.toUpperCase() === v.letter.toUpperCase())?.disk ?? null;
      return { letter: v.letter.toUpperCase(), disk, label: v.label ?? "", fileSystem: v.fs ?? "", sizeGB: gb(v.size), freeGB: gb(v.free), tier: disks.find((d) => d.number === disk)?.tier ?? "hdd-unknown" };
    })
    .sort((a, b) => a.letter.localeCompare(b.letter));
  const games: GameLibrary[] = [
    ...raw.steam.map((s) => ({ kind: "steam" as const, path: s.path, letter: letterOf(s.path), games: s.games, sizeGB: gb(s.bytes) })),
    ...raw.epic.filter((e) => e.path).map((e) => ({ kind: "epic" as const, path: e.path, letter: letterOf(e.path), games: 1, sizeGB: e.bytes ? gb(e.bytes) : null })),
    ...raw.folders.map((f) => ({ kind: "folder" as const, path: f, letter: letterOf(f), games: null, sizeGB: null }))
  ];
  const fileSize = (p: string) => {
    try {
      const stat = fs.statSync(p);
      return stat.isFile() ? gb(stat.size) : null;
    } catch {
      return null;
    }
  };
  const locations = extra.locations.map((l) => ({ ...l, letter: letterOf(l.path), sizeGB: fileSize(l.path) ?? extra.sizes?.[l.id] ?? null }));
  return { at: new Date().toISOString(), disks, volumes, games, locations, network: extra.network, benchmarks: extra.benchmarks ?? {}, errors: [] };
};

let inFlight: Promise<StorageInventory> | null = null;

export const StorageInventory = {
  /** The last inventory taken (cached on disk), or null. */
  cached(): StorageInventory | null {
    return readCache();
  },

  /** Take the inventory now (about 10-20 s; one at a time). Keeps measured sizes and benchmarks from before. */
  async take(): Promise<StorageInventory> {
    inFlight ??= (async () => {
      const previous = readCache();
      const raw = await powershellJson<Raw>(SCRIPT, 120_000);
      const network: NetworkShare[] = [];
      const shares = new Map<string, NetworkShare>();
      for (const n of raw.net ?? []) {
        const host = /^\\\\([^\\]+)/.exec(n.path)?.[1] ?? "";
        shares.set(n.path, { letter: n.letter || null, path: n.path, host, reachable: null, detail: n.status ?? "" });
      }
      for (const host of (process.env.NAS_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean)) {
        if (![...shares.values()].some((s) => s.host === host)) shares.set(`\\\\${host}`, { letter: null, path: `\\\\${host}`, host, reachable: null, detail: "from NAS_HOSTS" });
      }
      for (const share of shares.values()) {
        share.reachable = share.host ? await smbReachable(share.host) : null;
        const windows = share.detail && !/^connected$/i.test(share.detail) && share.detail !== "from NAS_HOSTS" ? `; Windows shows the mapping as "${share.detail}" (reconnect it in File Explorer)` : "";
        share.detail = share.reachable ? `answers on SMB (port 445)${windows}` : `does not answer on SMB (port 445)${windows}`;
        network.push(share);
      }
      const sizes = Object.fromEntries((previous?.locations ?? []).filter((l) => l.sizeGB !== null).map((l) => [l.id, l.sizeGB as number]));
      const inventory = assemble(raw, { locations: knownLocations(), sizes, benchmarks: previous?.benchmarks, network });
      writeCache(inventory);
      return inventory;
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  },

  /**
   * Measure one known location's size by walking it, gently: async, a pause
   * every 2000 entries so the disk serves others too, at most maxEntries.
   * Slow on a hard drive; one at a time.
   */
  async measure(id: string, maxEntries = 2_000_000): Promise<{ id: string; sizeGB: number; entries: number; complete: boolean }> {
    const inventory = readCache() ?? (await StorageInventory.take());
    const location = inventory.locations.find((l) => l.id === id);
    if (!location) throw Object.assign(new Error(`No known location "${id}".`), { status: 404 });
    let bytes = 0;
    let entries = 0;
    let complete = true;
    const stack = [location.path];
    while (stack.length) {
      const dir = stack.pop()!;
      let handle: fs.Dir;
      try {
        handle = await fs.promises.opendir(dir);
      } catch {
        continue;
      }
      for await (const entry of handle) {
        entries++;
        if (entries % 2000 === 0) await new Promise((resolve) => setTimeout(resolve, 50));
        if (entries > maxEntries) {
          complete = false;
          break;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(full);
        else if (entry.isFile()) bytes += (await fs.promises.stat(full).catch(() => null))?.size ?? 0;
      }
      if (!complete) break;
    }
    const sizeGB = gb(bytes);
    const fresh = readCache() ?? inventory;
    writeCache({ ...fresh, locations: fresh.locations.map((l) => (l.id === id ? { ...l, sizeGB } : l)) });
    return { id, sizeGB, entries, complete };
  },

  /**
   * Write speed of one drive: 128 MB written in 4 MB pieces and flushed, then
   * deleted. Refused while that drive is busy or short of space, so it never
   * gets in the way. Reads are not measured: Windows would serve them from memory.
   */
  async benchmark(letter: string, busyIdlePercent: number | null): Promise<Benchmark> {
    const drive = letter.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 1);
    if (!drive) throw Object.assign(new Error("Say which drive (a letter)."), { status: 400 });
    if (busyIdlePercent !== null && busyIdlePercent < 50) throw Object.assign(new Error(`${drive}: is busy (${busyIdlePercent}% idle) — not adding a benchmark to it now.`), { status: 409 });
    const stat = await fs.promises.statfs(`${drive}:\\`).catch(() => null);
    if (!stat) throw Object.assign(new Error(`${drive}: is not available.`), { status: 404 });
    if (stat.bavail * stat.bsize < 2 * GB) throw Object.assign(new Error(`${drive}: has under 2 GB free — not writing a test file.`), { status: 409 });
    const dir = path.join(`${drive}:\\`, ".agent-builder-bench");
    const file = path.join(dir, `bench-${process.pid}.bin`);
    await fs.promises.mkdir(dir, { recursive: true });
    const chunk = Buffer.alloc(4 * 1024 * 1024, 7);
    const handle = await fs.promises.open(file, "w");
    const started = process.hrtime.bigint();
    let syncTotal = 0;
    try {
      for (let i = 0; i < 32; i++) {
        await handle.write(chunk);
        if (i % 8 === 7) {
          const s = process.hrtime.bigint();
          await handle.sync();
          syncTotal += Number(process.hrtime.bigint() - s) / 1e6;
        }
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
    const seconds = Number(process.hrtime.bigint() - started) / 1e9;
    await fs.promises.rm(file, { force: true });
    await fs.promises.rmdir(dir).catch(() => undefined);
    const result: Benchmark = { letter: drive, at: new Date().toISOString(), writeMBps: Math.round(128 / seconds), syncLatencyMs: Math.round(syncTotal / 4), note: "128 MB written and flushed, then deleted. Read speed is not measured (Windows caches reads)." };
    const inventory = readCache();
    if (inventory) writeCache({ ...inventory, benchmarks: { ...inventory.benchmarks, [drive]: result } });
    return result;
  }
};

const isSsd = (tier: Tier) => tier === "nvme-ssd" || tier === "sata-ssd";
const TIER_LABEL: Record<Tier, string> = { "nvme-ssd": "NVMe SSD", "sata-ssd": "SATA SSD", "hdd-7200": "7,200 rpm hard drive", "hdd-5400": "5,400 rpm hard drive", "hdd-unknown": "hard drive", usb: "USB drive", network: "network share" };
export const tierLabel = (tier: Tier) => TIER_LABEL[tier];

/** What each drive letter holds, for telemetry's "on it:" (games, Agent Builder pieces, downloads). */
export const rolesByLetter = (inventory: StorageInventory | null): Record<string, string[]> => {
  const roles: Record<string, string[]> = {};
  const add = (letter: string, what: string) => {
    if (!letter) return;
    (roles[letter] ??= []).includes(what) || roles[letter].push(what);
  };
  for (const g of inventory?.games ?? []) add(g.letter, g.kind === "steam" ? "a Steam library" : g.kind === "epic" ? "Epic games" : "games");
  for (const l of inventory?.locations ?? []) add(l.letter, l.label);
  return roles;
};

/**
 * Advice from an inventory. SSD space is kept for games: Agent Builder's bulk
 * belongs on the 7,200 rpm drives, downloads and archives on the slow ones and
 * the NAS. Every move is a recommendation for the owner, never an action.
 */
export const recommend = (inventory: StorageInventory, options: { ssdGameReserveGB?: number } = {}): Recommendation[] => {
  const out: Recommendation[] = [];
  const reserve = options.ssdGameReserveGB ?? Number(process.env.SSD_GAME_RESERVE_GB ?? 40);
  const volume = (letter: string) => inventory.volumes.find((v) => v.letter === letter);
  const fast = inventory.volumes.filter((v) => v.tier === "hdd-7200").sort((a, b) => b.freeGB - a.freeGB);

  for (const v of inventory.volumes) {
    const low = v.letter === "C" ? v.freeGB < 30 : v.freeGB < Math.max(15, v.sizeGB * 0.05);
    if (low) out.push({ id: `low-${v.letter}`, severity: v.freeGB < 10 ? "high" : "medium", title: `${v.letter}: is nearly full (${v.freeGB} GB free of ${v.sizeGB} GB)`, detail: v.letter === "C" ? "Windows needs room on C: for updates, the page file and temporary files; keep at least 30 GB free." : `A nearly full ${tierLabel(v.tier)} slows down and leaves no room for game updates or builds.`, needsApproval: false });
  }

  for (const location of inventory.locations) {
    const v = volume(location.letter);
    if (!v) continue;
    if (isSsd(v.tier) && location.kind !== "source" && location.kind !== "downloads") {
      const target = fast.find((t) => t.freeGB > (location.sizeGB ?? 0) * 1.2 + 10);
      out.push({
        id: `ssd-${location.id}`,
        severity: v.freeGB < reserve ? "high" : "medium",
        title: `${location.label} is on ${v.letter}: (${tierLabel(v.tier)}), space meant for games`,
        detail: `${location.path}${location.sizeGB !== null ? ` (${location.sizeGB} GB)` : " (size not measured yet)"}. ${target ? `It would fit on ${target.letter}: (${tierLabel(target.tier)}, ${target.freeGB} GB free)` : "No 7,200 rpm drive has room for it right now"}; ${location.kind === "models" ? "models load a little slower from a hard drive, once per session" : "it does not need SSD speed"}. Moving it needs your approval.`,
        needsApproval: true
      });
    }
    if (v.tier === "hdd-5400" && (location.id === "repo" || location.id === "data")) {
      const target = fast.find((t) => t.freeGB > (location.sizeGB ?? 60) * 1.3);
      out.push({
        id: `slow-${location.id}`,
        severity: "high",
        title: `${location.label} works from ${v.letter}: (${tierLabel(v.tier)})`,
        detail: `Every build, install and model answer reads it; on this drive the builder freezes when anything else uses the disk. ${target ? `${target.letter}: (${tierLabel(target.tier)}, ${target.freeGB} GB free) is the best place with room${location.sizeGB === null ? " (measure its size first)" : ""}.` : "No 7,200 rpm drive has enough free space for it; free space on G:, F: or D: first, or keep it here and keep downloads off this drive."} Moving it needs your approval and a stop of the builder.`,
        needsApproval: true
      });
    }
    if (location.id === "torrents" && isSsd(v.tier)) {
      // Not the drive Agent Builder works from: downloads there are what froze it.
      const busy = new Set(inventory.locations.filter((l) => l.id === "repo" || l.id === "data").map((l) => l.letter));
      const slow = inventory.volumes.filter((t) => (t.tier === "hdd-5400" || t.tier === "usb") && !busy.has(t.letter)).sort((a, b) => b.freeGB - a.freeGB)[0];
      out.push({ id: "torrents-ssd", severity: "medium", title: `qBittorrent downloads to ${v.letter}: (${tierLabel(v.tier)})`, detail: `Downloads (${location.path}) write constantly and do not need an SSD.${slow ? ` ${slow.letter}: (${tierLabel(slow.tier)}, ${slow.freeGB} GB free) suits them.` : ""} Change it in qBittorrent → Options → Downloads.`, needsApproval: true });
    }
  }

  const repo = inventory.locations.find((l) => l.id === "repo");
  const torrents = inventory.locations.find((l) => l.id === "torrents");
  if (repo && torrents && repo.letter === torrents.letter) {
    out.push({ id: "downloads-with-builder", severity: "high", title: `Downloads and Agent Builder share ${repo.letter}:`, detail: "Torrent traffic and the builder fight over one disk; move the downloads to another drive.", needsApproval: true });
  }

  for (const library of inventory.games) {
    const v = volume(library.letter);
    const heavy = inventory.locations.filter((l) => l.letter === library.letter && (l.kind === "models" || l.id === "repo" || l.id === "builds"));
    if (v && heavy.length && library.kind === "steam" && (library.games ?? 0) > 0) {
      out.push({ id: `shared-${library.letter}`, severity: "info", title: `${library.letter}: holds games and ${heavy.map((h) => h.label).join(", ")}`, detail: `A game loading from ${library.letter}: competes with Agent Builder reading the same disk. Gaming Mode pauses Agent Builder's work, so this only matters outside it.`, needsApproval: false });
    }
  }

  for (const share of inventory.network) {
    if (share.reachable === false) out.push({ id: `nas-${share.host}`, severity: "medium", title: `The NAS ${share.host} is not reachable`, detail: `${share.path}${share.letter ? ` (${share.letter}:)` : ""} ${share.detail}. Backups and archives to it cannot run until it is back.`, needsApproval: false });
  }
  if (!inventory.network.length) out.push({ id: "nas-none", severity: "info", title: "No NAS share is mapped", detail: "Map the QNAP share (or set NAS_HOSTS in .env) so backups and archives have somewhere off this PC to go.", needsApproval: false });

  const order = { high: 0, medium: 1, info: 2 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
};
