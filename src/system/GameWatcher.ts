/**
 * Game detection: notices when a game starts and when it has really ended.
 *
 * A game is a process running from a game library this PC has (Steam
 * libraries' steamapps\common, Epic installs, the Games/XboxGames/Ubisoft
 * folders the storage inventory found, GAME_DIRS, and games you add by name),
 * using at least 150 MB, and seen twice in a row (20 s). Launchers, crash
 * reporters, installers and anti-cheat services are never counted as the
 * game, so closing Steam does not end a session, and they are never touched:
 * this only reads process names and paths, once every 10 s, from one
 * long-lived PowerShell (not a new one each time).
 *
 * What happens is the owner's setting (data/system/gaming.json):
 *   detect "ask"  — the app and Jarvis ask whether to switch Gaming Mode on (the default),
 *          "auto" — it switches on by itself, with the chosen profile,
 *          "off"  — nothing is watched;
 *   autoResume — after the game has been closed for graceMinutes, resume by
 *          itself (otherwise it asks).
 */
import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";

import { JarvisClient } from "../integrations/JarvisClient.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";
import { psQuote } from "./PowerShell.js";
import { StorageInventory } from "./StorageInventory.js";

export interface GamingSettings {
  detect: "ask" | "auto" | "off";
  profile: string;
  autoResume: boolean;
  graceMinutes: number;
  /** Extra executables (name without .exe) that are games. */
  extraGames: string[];
  /** Executables never to count as games. */
  ignore: string[];
  /** Extra folders games are installed in. */
  extraDirs: string[];
}

export interface DetectedGame {
  name: string;
  exe: string;
  pid: number;
  since: string;
}

export interface WatcherState {
  watching: boolean;
  detail: string;
  running: DetectedGame[];
  /** A question for the owner: switch Gaming Mode on for this game, or resume now that it has closed. */
  prompt: { kind: "activate" | "resume"; game: string; at: string } | null;
  lastSeen: string | null;
}

const FILE = path.resolve(process.env.GAMING_SETTINGS_PATH ?? "data/system/gaming.json");
const DEFAULTS: GamingSettings = { detect: "ask", profile: "gaming-balanced", autoResume: false, graceMinutes: 3, extraGames: [], ignore: [], extraDirs: [] };

/** Never the game itself: launchers, helpers, installers, crash reporters, anti-cheat. */
export const NOT_A_GAME =
  /^(steam|steamwebhelper|steamservice|steamerrorreporter|gameoverlayui|EpicGamesLauncher|EpicWebHelper|EpicOnlineServices.*|UnrealCEFSubProcess|UbisoftConnect|upc|UplayWebCore|UbisoftGameLauncher.*|GalaxyClient.*|EADesktop|EABackgroundService|Origin.*|RiotClient.*|Battle\.net|Agent|CrashReport.*|CrashReportClient|UnityCrashHandler(32|64)|unins\d*|setup.*|.*installer.*|vc_redist.*|dxsetup|redist.*|EasyAntiCheat.*|EACLauncher|BEService.*|BattlEye.*|vgc|vgtray|PnkBstr.*|CefSharp.*|QtWebEngineProcess|xboxapp.*|GameBar.*|XboxPcApp|launcher|.*launcher)$/i;

export const readSettings = (): GamingSettings => {
  try {
    return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(FILE, "utf8")) as Partial<GamingSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
};

export const writeSettings = (changes: Partial<GamingSettings>): GamingSettings => {
  const current = readSettings();
  const next: GamingSettings = {
    detect: changes.detect && ["ask", "auto", "off"].includes(changes.detect) ? changes.detect : current.detect,
    profile: typeof changes.profile === "string" && /^[a-z-]+$/.test(changes.profile) ? changes.profile : current.profile,
    autoResume: typeof changes.autoResume === "boolean" ? changes.autoResume : current.autoResume,
    graceMinutes: Number.isFinite(Number(changes.graceMinutes)) ? Math.min(60, Math.max(1, Number(changes.graceMinutes))) : current.graceMinutes,
    extraGames: Array.isArray(changes.extraGames) ? changes.extraGames.map(String).filter((n) => /^[\w .-]{1,80}$/.test(n)) : current.extraGames,
    ignore: Array.isArray(changes.ignore) ? changes.ignore.map(String).filter((n) => /^[\w .-]{1,80}$/.test(n)) : current.ignore,
    extraDirs: Array.isArray(changes.extraDirs) ? changes.extraDirs.map(String).filter((d) => /^[a-z]:\\/i.test(d) && !/["'`$]/.test(d)) : current.extraDirs
  };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  return next;
};

/** The folders games run from on this PC (exported for tests). */
export const gameRoots = (settings: GamingSettings): string[] => {
  const inventory = StorageInventory.cached();
  const roots = new Set<string>();
  for (const library of inventory?.games ?? []) {
    roots.add(library.kind === "steam" ? path.join(library.path, "steamapps", "common") : library.path);
  }
  for (const dir of [...(process.env.GAME_DIRS ?? "").split(";"), ...settings.extraDirs]) if (dir.trim()) roots.add(dir.trim());
  return [...roots].map((r) => r.replace(/[\\/]+$/, "") + "\\");
};

/** Which of the reported processes are games (exported for tests). */
export const pickGames = (processes: Array<{ pid: number; name: string; path: string | null; mb: number }>, roots: string[], settings: GamingSettings): Array<{ pid: number; name: string; exe: string }> => {
  const lowerRoots = roots.map((r) => r.toLowerCase());
  const extra = new Set(settings.extraGames.map((n) => n.toLowerCase().replace(/\.exe$/, "")));
  const ignore = new Set(settings.ignore.map((n) => n.toLowerCase().replace(/\.exe$/, "")));
  return processes
    .filter((p) => {
      const name = p.name.toLowerCase();
      if (ignore.has(name) || NOT_A_GAME.test(p.name)) return false;
      if (extra.has(name)) return true;
      if (!p.path || p.mb < 150) return false;
      const lower = p.path.toLowerCase();
      return lowerRoots.some((root) => lower.startsWith(root));
    })
    .map((p) => ({ pid: p.pid, name: p.name, exe: p.path ?? p.name }));
};

const watcherScript = (roots: string[], extra: string[]) => `
$roots = @(${roots.map(psQuote).join(",") || "''"})
$extra = @(${extra.map(psQuote).join(",") || "''"})
while ($true) {
  $found = @(Get-Process | Where-Object {
    $p = $_.Path
    ($p -and ($roots | Where-Object { $_ -and $p.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) })) -or ($extra -contains $_.ProcessName)
  } | ForEach-Object { @{ pid = $_.Id; name = $_.ProcessName; path = $_.Path; mb = [math]::Round($_.WorkingSet64 / 1MB) } })
  Write-Output ('GAMES ' + (ConvertTo-Json -InputObject $found -Compress))
  Start-Sleep -Seconds 10
}
`;

const state: WatcherState = { watching: false, detail: "not started", running: [], prompt: null, lastSeen: null };
let child: ChildProcess | null = null;
let candidates = new Map<number, number>();
let endedAt: number | null = null;
let restartTimer: NodeJS.Timeout | null = null;
let onSwitch: ((to: string, by: string) => Promise<unknown> | null) | null = null;

const notify = (subject: string, body: string) => {
  if (JarvisClient.isConfigured()) void JarvisClient.send({ type: "status", severity: "notice", subject, body }).catch(() => undefined);
};

const handle = (processes: Array<{ pid: number; name: string; path: string | null; mb: number }>) => {
  const settings = readSettings();
  const games = pickGames(processes, gameRoots(settings), settings);
  const seen = new Map<number, number>();
  for (const game of games) seen.set(game.pid, (candidates.get(game.pid) ?? 0) + 1);
  candidates = seen;
  const confirmed = games.filter((g) => (seen.get(g.pid) ?? 0) >= 2);
  const before = new Set(state.running.map((g) => g.pid));
  state.running = confirmed.map((g) => state.running.find((r) => r.pid === g.pid) ?? { name: g.name, exe: g.exe, pid: g.pid, since: new Date().toISOString() });
  state.lastSeen = new Date().toISOString();
  const started = state.running.filter((g) => !before.has(g.pid));
  const mode = GameMode.read();

  if (started.length) {
    endedAt = null;
    const game = started[0];
    GameMode.patch({ game: { name: game.name, exe: game.exe, since: game.since } });
    if (mode.on) {
      if (state.prompt?.kind === "resume") state.prompt = null;
    } else if (settings.detect === "auto" && onSwitch) {
      Logger.log("Game detected; switching Gaming Mode on", { game: game.name });
      void onSwitch(settings.profile, `detected: ${game.name}`)?.catch(() => undefined);
    } else if (settings.detect === "ask") {
      state.prompt = { kind: "activate", game: game.name, at: new Date().toISOString() };
      notify(`${game.name} started`, "Switch Gaming Mode on? Say \"activate Gaming Mode\", or use the app.");
    }
  }

  if (!state.running.length && before.size) {
    endedAt = Date.now();
    if (state.prompt?.kind === "activate") state.prompt = null;
  }
  if (!state.running.length && endedAt && Date.now() - endedAt >= settings.graceMinutes * 60_000) {
    const ended = mode.game?.name ?? "The game";
    endedAt = null;
    GameMode.patch({ game: null });
    if (GameMode.read().on || (GameMode.read().profile ?? "normal") !== "normal") {
      if (settings.autoResume && onSwitch) {
        Logger.log("Game closed; resuming", { game: ended });
        void onSwitch("normal", `game closed: ${ended}`)?.catch(() => undefined);
      } else {
        state.prompt = { kind: "resume", game: ended, at: new Date().toISOString() };
        notify(`${ended} closed`, "Resume Agent Builder's work? Say \"resume normal operations\", or use the app.");
      }
    }
  }
};

export const GameWatcher = {
  state(): WatcherState & { settings: GamingSettings } {
    return { ...state, settings: readSettings() };
  },

  /** Clear the question (the owner answered or dismissed it). */
  dismiss(): void {
    state.prompt = null;
  },

  start(switcher: (to: string, by: string) => Promise<unknown> | null): void {
    onSwitch = switcher;
    if (child || process.platform !== "win32") return;
    const settings = readSettings();
    if (settings.detect === "off") {
      state.watching = false;
      state.detail = "off in the settings";
      return;
    }
    const roots = gameRoots(settings);
    if (!roots.length) {
      state.watching = false;
      state.detail = "no game libraries known yet (take a storage inventory)";
      restartTimer = setTimeout(() => {
        restartTimer = null;
        GameWatcher.start(switcher);
      }, 10 * 60_000);
      restartTimer.unref?.();
      return;
    }
    const encoded = Buffer.from(watcherScript(roots, settings.extraGames), "utf16le").toString("base64");
    child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    state.watching = true;
    state.detail = `watching ${roots.length} game folder(s)`;
    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith("GAMES ")) continue;
        try {
          const parsed = JSON.parse(line.slice(6)) as unknown;
          handle((Array.isArray(parsed) ? parsed : parsed ? [parsed] : []) as Array<{ pid: number; name: string; path: string | null; mb: number }>);
        } catch {
          // a partial line; the next one comes in 10 s
        }
      }
    });
    child.on("exit", () => {
      child = null;
      state.watching = false;
      state.detail = "the watcher stopped; starting it again in a minute";
      restartTimer = setTimeout(() => {
        restartTimer = null;
        GameWatcher.start(switcher);
      }, 60_000);
      restartTimer.unref?.();
    });
    process.once("exit", () => child?.kill());
  },

  /** Stop and start again (after the settings or the game libraries change). */
  restart(): void {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    const switcher = onSwitch;
    if (child) {
      child.removeAllListeners("exit");
      child.kill();
      child = null;
    }
    if (switcher) GameWatcher.start(switcher);
  },

  /** For tests: feed one poll. */
  _feed: handle
};
