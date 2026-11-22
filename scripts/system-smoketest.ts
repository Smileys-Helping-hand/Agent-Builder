/**
 * The workstation layer: storage, telemetry, pressure, game detection, profiles, local-only AI.
 *
 *   npm run test:system
 *
 * Pure checks run anywhere. Live checks (marked LIVE) read this PC — its disks
 * and counters — and change nothing. Gaming Mode's real pause/resume is in
 * test:game-mode (against a throwaway model server).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-system-"));
process.env.GAME_MODE_PATH = path.join(dir, "game-mode.json");
process.env.GAMING_SETTINGS_PATH = path.join(dir, "gaming.json");
process.env.TELEMETRY_SAMPLER = "off";
process.env.JARVIS_WEBHOOK_URL = "";
process.env.JARVIS_HOST = "";
process.env.JARVIS_API_KEY = "";
process.env.JARVIS_WEBHOOK_URL_LOCAL = "";

const { tierOf, recommend, smbReachable, StorageInventory } = await import("../src/system/StorageInventory.js");
const { explain, parseSample, Telemetry } = await import("../src/system/Telemetry.js");
const { pressureFrom } = await import("../src/system/Scheduler.js");
const { pickGames, NOT_A_GAME, GameWatcher, writeSettings, readSettings } = await import("../src/system/GameWatcher.js");
const { PROFILES } = await import("../src/system/ResourceModes.js");
const { WORKLOADS, RESUME_ORDER } = await import("../src/system/Workloads.js");
const { GameMode } = await import("../src/utils/GameMode.js");

let passed = 0;
const check = async (name: string, fn: () => unknown | Promise<unknown>) => {
  await fn();
  passed++;
  console.log(`[PASS] ${name}`);
};

await check("drives are classified by what they are, not their letter: NVMe, SATA SSD, 7,200 and 5,400 rpm by model number", () => {
  assert.equal(tierOf({ model: "SK hynix BC711", bus: "NVMe", mediaType: "SSD" }).tier, "nvme-ssd");
  assert.equal(tierOf({ model: "Samsung SSD 870 EVO 500GB", bus: "SATA", mediaType: "SSD" }).tier, "sata-ssd");
  assert.equal(tierOf({ model: "ST1000DM003-1SB102", bus: "SATA", mediaType: "HDD" }).tier, "hdd-7200");
  assert.equal(tierOf({ model: "WDC WD10EZEX-07ZF5A0", bus: "SATA", mediaType: "Unspecified" }).tier, "hdd-7200");
  assert.equal(tierOf({ model: "ST2000LM007-1R8174", bus: "SATA", mediaType: "HDD" }).tier, "hdd-5400");
  const usb = tierOf({ model: "ST500LM0 30-1RK17D", bus: "USB", mediaType: "Unspecified" });
  assert.equal(usb.tier, "hdd-5400", "a USB bridge's spaced model number still matches");
  assert.equal(usb.source, "model-number", "and says the speed was inferred");
  assert.equal(tierOf({ model: "Mystery Disk", bus: "SATA", mediaType: "Unspecified" }).tier, "hdd-unknown");
});

const inventory = {
  at: new Date().toISOString(),
  disks: [],
  volumes: [
    { letter: "C", disk: 1, label: "", fileSystem: "NTFS", sizeGB: 465, freeGB: 25, tier: "sata-ssd" as const },
    { letter: "E", disk: 4, label: "", fileSystem: "NTFS", sizeGB: 1862, freeGB: 108, tier: "hdd-5400" as const },
    { letter: "G", disk: 0, label: "", fileSystem: "NTFS", sizeGB: 930, freeGB: 102, tier: "hdd-7200" as const },
    { letter: "H", disk: 5, label: "", fileSystem: "NTFS", sizeGB: 465, freeGB: 46, tier: "nvme-ssd" as const },
    { letter: "J", disk: 7, label: "", fileSystem: "NTFS", sizeGB: 465, freeGB: 36, tier: "hdd-5400" as const },
    { letter: "K", disk: 6, label: "", fileSystem: "NTFS", sizeGB: 476, freeGB: 49, tier: "nvme-ssd" as const }
  ],
  games: [{ kind: "steam" as const, path: "H:\\SteamLibrary", letter: "H", games: 20, sizeGB: 372 }],
  locations: [
    { id: "repo", label: "Agent Builder (code)", path: "E:\\Projects\\Agent-Builder", letter: "E", kind: "source" as const, regenerable: false, sizeGB: 40 },
    { id: "comfy-models", label: "Image models (ComfyUI)", path: "H:\\ComfyUI-Models", letter: "H", kind: "models" as const, regenerable: true, sizeGB: 30 },
    { id: "torrents", label: "qBittorrent downloads", path: "K:\\downloads", letter: "K", kind: "downloads" as const, regenerable: false, sizeGB: null }
  ],
  network: [{ letter: "N", path: "\\\\nas\\share", host: "nas", reachable: false, detail: "does not answer on SMB (port 445)" }],
  benchmarks: {},
  errors: []
};

await check("recommendations keep SSDs for games, move the builder off the 5,400 rpm drive, and every move needs approval", () => {
  const recs = recommend(inventory, { ssdGameReserveGB: 40 });
  const byId = new Map(recs.map((r) => [r.id, r]));
  assert.ok(byId.get("slow-repo")?.detail.includes("G:"), "the builder's best place is the 7,200 rpm drive with room");
  assert.equal(byId.get("slow-repo")?.needsApproval, true);
  assert.ok(byId.get("ssd-comfy-models"), "image models on a game SSD are flagged");
  assert.equal(byId.get("ssd-comfy-models")?.needsApproval, true);
  assert.ok(byId.get("torrents-ssd")?.detail.includes("J:"), "downloads go to a slow drive that is not the builder's");
  assert.ok(!byId.get("torrents-ssd")?.detail.includes("E:"), "never to the drive the builder works from");
  assert.ok(!byId.has("ssd-torrents"), "the downloads advice is given once");
  assert.ok(byId.get("low-C"), "C: under 30 GB is flagged");
  assert.ok(byId.get("nas-nas"), "an unreachable NAS is reported");
  assert.equal(byId.get("nas-nas")?.needsApproval, false);
  assert.ok(recs.every((r) => !/^(ssd|slow|torrents)-/.test(r.id) || r.needsApproval), "anything that moves data waits for the owner");
});

const sample = (disk: { idle: number; queue: number }, extra: Partial<{ availableMB: number; commit: number }> = {}, at = new Date().toISOString()) => ({
  at,
  cores: 12,
  cpuPercent: 20,
  ram: { totalMB: 32768, availableMB: extra.availableMB ?? 12000, commitPercent: extra.commit ?? 40 },
  pagesPerSec: 50,
  disks: [{ disk: 4, letters: ["E"], idlePercent: disk.idle, queue: disk.queue, mbPerSec: 4, latencyMs: 400 }],
  gpu: { name: "RTX", utilPercent: 10, vramUsedMB: 1000, vramTotalMB: 8192, tempC: 50 },
  gpuProcesses: [],
  topCpu: [],
  topMemory: [{ pid: 1, name: "llama-server", memMB: 11000 }],
  topIo: [{ pid: 2, name: "rclone", ioMBps: 6 }, { pid: 3, name: "qbittorrent", ioMBps: 3.7 }],
  errors: []
});

await check("\"why is it slow\" names the saturated drive, what lives on it and the programs using it", () => {
  const findings = explain(sample({ idle: 0, queue: 60 }), { roles: { E: ["Agent Builder (code)"] } });
  const disk = findings.find((f) => f.area === "disk");
  assert.equal(disk?.severity, "high");
  assert.match(disk!.text, /E: is saturated: 0% idle, 60 requests waiting/);
  assert.match(disk!.text, /Agent Builder/);
  assert.ok(disk!.culprits.some((c) => /rclone/.test(c)) && disk!.culprits.some((c) => /qBittorrent/.test(c)));
  assert.equal(explain(sample({ idle: 95, queue: 0 }))[0].text, "Nothing is under pressure right now.");
  assert.ok(explain(sample({ idle: 95, queue: 0 }, { availableMB: 1500 })).some((f) => f.area === "memory" && /llama-server|local AI/.test(f.culprits.join())));
});

await check("counter samples are parsed per drive letter, with CPU per process over the sample", () => {
  const parsed = parseSample(
    {
      elapsed: 1,
      samples: [
        { p: "\\processor(_total)\\% processor time", i: "_total", v: 42.4 },
        { p: "\\memory\\available mbytes", i: null, v: 5000 },
        { p: "\\memory\\committed bytes", i: null, v: 50 },
        { p: "\\memory\\commit limit", i: null, v: 100 },
        { p: "\\physicaldisk(4 e:)\\% idle time", i: "4 e:", v: 3 },
        { p: "\\physicaldisk(4 e:)\\avg. disk queue length", i: "4 e:", v: 14 },
        { p: "\\physicaldisk(4 e:)\\avg. disk sec/transfer", i: "4 e:", v: 0.25 },
        { p: "\\physicaldisk(_total)\\% idle time", i: "_total", v: 90 }
      ],
      procs: [{ pid: 9, name: "node", path: null, cpu: 6, mem: 1024 * 1024 * 300 }],
      io: []
    },
    12,
    32768
  );
  assert.equal(parsed.cpuPercent, 42.4);
  assert.equal(parsed.ram.commitPercent, 50);
  assert.deepEqual(parsed.disks.map((d) => [d.letters.join(), d.idlePercent, d.queue, d.latencyMs]), [["E", 3, 14, 250]]);
  assert.equal(parsed.topCpu[0].cpuPercent, 50, "6 CPU-seconds in 1 s on 12 cores is 50%");
});

await check("heavy work waits for sustained pressure (two samples), not one spike or an old reading", () => {
  const busy = sample({ idle: 2, queue: 20 });
  const calm = sample({ idle: 90, queue: 0 });
  assert.match(pressureFrom([busy, busy], "E") ?? "", /E: is saturated/);
  assert.equal(pressureFrom([calm, busy], "E"), null, "one busy sample is a spike");
  const old = new Date(Date.now() - 10 * 60_000).toISOString();
  assert.equal(pressureFrom([sample({ idle: 2, queue: 20 }, {}, old), sample({ idle: 2, queue: 20 }, {}, old)], "E"), null, "stale samples say nothing");
  assert.match(pressureFrom([sample({ idle: 90, queue: 0 }, { availableMB: 1000 }), sample({ idle: 90, queue: 0 }, { availableMB: 900 })], "E") ?? "", /memory/);
});

await check("game detection: a game from a library counts; launchers, anti-cheat, installers and small helpers never do", () => {
  const roots = ["D:\\SteamLibrary\\steamapps\\common\\", "K:\\Game\\GTAV\\"];
  const settings = { ...readSettings(), extraGames: ["MyOwnGame"], ignore: ["ignoredgame"] };
  const games = pickGames(
    [
      { pid: 1, name: "eldenring", path: "D:\\SteamLibrary\\steamapps\\common\\ELDEN RING\\Game\\eldenring.exe", mb: 6000 },
      { pid: 2, name: "steam", path: "C:\\Program Files (x86)\\Steam\\steam.exe", mb: 300 },
      { pid: 3, name: "EasyAntiCheat_EOS", path: "D:\\SteamLibrary\\steamapps\\common\\Game\\EasyAntiCheat_EOS.exe", mb: 400 },
      { pid: 4, name: "UnityCrashHandler64", path: "D:\\SteamLibrary\\steamapps\\common\\Game\\UnityCrashHandler64.exe", mb: 200 },
      { pid: 5, name: "PlayGTAV", path: "K:\\Game\\GTAV\\PlayGTAV.exe", mb: 40 },
      { pid: 6, name: "GTA5", path: "K:\\Game\\GTAV\\GTA5.exe", mb: 5000 },
      { pid: 7, name: "MyOwnGame", path: null, mb: 10 },
      { pid: 8, name: "ignoredgame", path: "D:\\SteamLibrary\\steamapps\\common\\x\\ignoredgame.exe", mb: 900 },
      { pid: 9, name: "GTAVLauncher", path: "K:\\Game\\GTAV\\GTAVLauncher.exe", mb: 300 }
    ],
    roots,
    settings
  );
  assert.deepEqual(games.map((g) => g.pid).sort(), [1, 6, 7]);
  assert.ok(NOT_A_GAME.test("EpicGamesLauncher") && NOT_A_GAME.test("BEService_x64") && NOT_A_GAME.test("vgc"));
});

await check("game detection asks once a game has run 20 s, and offers Resume All only after the grace period", () => {
  writeSettings({ detect: "ask", graceMinutes: 1, extraGames: ["TestGame"] });
  const game = [{ pid: 4242, name: "TestGame", path: null, mb: 2000 }];
  GameWatcher._feed(game);
  assert.equal(GameWatcher.state().prompt, null, "one sighting is not enough");
  GameWatcher._feed(game);
  assert.equal(GameWatcher.state().prompt?.kind, "activate");
  assert.equal(GameMode.read().game?.name, "TestGame");
  GameWatcher.dismiss();
  GameMode.patch({ on: true, profile: "gaming-balanced" });
  GameWatcher._feed([]);
  assert.equal(GameWatcher.state().prompt, null, "closing the game does not resume at once");
  const realNow = Date.now;
  Date.now = () => realNow() + 61_000;
  try {
    GameWatcher._feed([]);
  } finally {
    Date.now = realNow;
  }
  assert.equal(GameWatcher.state().prompt?.kind, "resume", "after the grace period it offers to resume (autoResume is off)");
  GameWatcher.dismiss();
  GameMode.off();
});

await check("every profile says what to do with every workload, and resume knows every workload", () => {
  for (const p of PROFILES) for (const w of WORKLOADS) assert.ok(p.levels[w.id], `${p.id} covers ${w.id}`);
  for (const w of WORKLOADS) assert.ok(RESUME_ORDER.includes(w.id), `${w.id} has a place in the resume order`);
  const balanced = PROFILES.find((p) => p.id === "gaming-balanced")!;
  assert.equal(balanced.levels["image-engine"], "stop-if-idle", "the default never drops queued pictures");
  assert.equal(balanced.levels.savestate, "keep");
  assert.equal(RESUME_ORDER[0], "model", "the model server comes back first, so resumed builds can use it");
  assert.equal(RESUME_ORDER.at(-1), "downloads", "downloads come back last");
});

await check("a hold stops background loops but not the model; Gaming Mode stops both", async () => {
  const { ModelRouter } = await import("../src/tools/ModelRouter.js");
  GameMode.patch({ hold: true, on: false });
  assert.equal(GameMode.paused(), true);
  assert.equal(GameMode.isOn(), false, "the model stays usable for what the owner asks");
  GameMode.patch({ hold: false, on: true });
  assert.equal(GameMode.paused(), true);
  await assert.rejects(() => ModelRouter.generate("hi", { provider: "ollama" }), /Game mode is on/);
  GameMode.off();
});

await check("local AI only: cloud providers are refused, never silently used, wherever they are named", async () => {
  const { ModelRouter, getProviderFromEnv, getProviderForRole } = await import("../src/tools/ModelRouter.js");
  const { OpenAIClient } = await import("../src/tools/OpenAIClient.js");
  const saved = { ...process.env };
  try {
    delete process.env.LOCAL_AI_ONLY;
    process.env.MODEL_PROVIDER = "anthropic";
    process.env.GEMINI_API_KEY = "test-not-a-key";
    process.env.ROLE_CLOUD_FALLBACK = "true";
    process.env.OPENAI_API_KEY = "test-not-a-key";
    assert.equal(getProviderFromEnv(), "ollama", "Settings naming Claude still gets the local model");
    for (const role of ["visual", "3d", "prompter", "code", "qa"] as const) assert.equal(getProviderForRole(role).provider, "ollama", `${role} stays local`);
    await assert.rejects(() => ModelRouter.generate("hi", { provider: "anthropic" }), /locally only/);
    await assert.rejects(() => ModelRouter.generate("hi", { provider: "openai" }), /locally only/);
    await assert.rejects(() => ModelRouter.generate("hi", { provider: "gemini" }), /locally only/);
    assert.equal(await OpenAIClient.embed("private text"), null, "vector memory sends nothing to OpenAI");
    process.env.LOCAL_AI_ONLY = "false";
    assert.equal(getProviderFromEnv(), "anthropic", "only LOCAL_AI_ONLY=false in .env allows a cloud model");
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

await check("research offline: nothing is searched or fetched", async () => {
  const { searchAll, fetchDocument } = await import("../src/research/SourceProviders.js");
  process.env.RESEARCH_OFFLINE = "true";
  try {
    const started = Date.now();
    const { results, errors } = await searchAll("how do plants communicate", 5);
    assert.equal(results.length, 0);
    assert.match(String(errors.web), /offline/);
    assert.equal(await fetchDocument({ provider: "web", title: "x", url: "https://example.com", snippet: "" } as never), null);
    assert.ok(Date.now() - started < 1000, "no network was even tried");
  } finally {
    delete process.env.RESEARCH_OFFLINE;
  }
});

await check("an unreachable NAS is reported within seconds, never hangs", async () => {
  const started = Date.now();
  assert.equal(await smbReachable("192.0.2.1", 1500), false);
  assert.ok(Date.now() - started < 4000);
});

if (process.platform === "win32" && process.env.SYSTEM_LIVE !== "off") {
  await check("LIVE: this PC's storage inventory: every disk classified, C: found, game libraries read from their manifests", async () => {
    const live = await StorageInventory.take();
    assert.ok(live.disks.length >= 1);
    assert.ok(live.disks.every((d) => d.tier), "every disk has a class");
    assert.ok(live.volumes.some((v) => v.letter === "C"));
    console.log(`       ${live.disks.length} disks, ${live.volumes.length} drives, ${live.games.length} game libraries, ${live.network.length} network share(s), ${recommend(live).length} recommendations`);
  });
  await check("LIVE: a real measurement of CPU, memory, every drive and the GPU", async () => {
    const t = await Telemetry.sample(0);
    assert.equal(t.errors.length, 0, t.errors.join("; "));
    assert.ok(t.cpuPercent !== null && t.ram.availableMB !== null);
    assert.ok(t.disks.length >= 1);
    console.log(`       CPU ${t.cpuPercent}%, ${(t.ram.availableMB! / 1024).toFixed(1)} GB free, ${t.disks.length} drives, GPU ${t.gpu ? `${t.gpu.utilPercent}% ${t.gpu.vramUsedMB}/${t.gpu.vramTotalMB} MB` : "none"}`);
  });
}

console.log(`\nAll ${passed} system checks passed.`);
process.exit(0);
