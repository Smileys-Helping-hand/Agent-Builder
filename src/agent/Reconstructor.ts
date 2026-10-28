/**
 * Reconstructor — learning to build anything by rebuilding real apps.
 *
 * Give it an app (one of your projects, or a public Git repository) and it:
 *
 *   study      reads the code and writes a blueprint: what the app is for,
 *              every user-facing feature (each with how to check it), screens,
 *              data and the techniques that make it work
 *   rebuild    builds the app again from that blueprint alone, in a fresh
 *              folder — a clean-room rebuild that never sees the original code
 *   compare    checks the rebuild against the blueprint, feature by feature:
 *              coverage is the share of features it really has
 *   learn      turns every feature it missed into a general lesson for every
 *              later build (LessonMemory), and keeps the original as a worked
 *              example (ExemplarMemory) when it is yours or openly licensed;
 *              then rebuilds the gaps, up to three rounds
 *
 * What it has learned shows as the kinds of apps it has rebuilt and its
 * first-try coverage over time: the rebuilds of new apps getting more complete
 * is the evidence it can build more things.
 *
 * A rebuild is a private study copy kept in builds/; it is never published.
 * Code without an open licence teaches only general lessons, never examples.
 * One app at a time, in a queue (data/agent/reconstruct.json); it waits while
 * everything is paused.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { EcosystemStore } from "../ecosystem/EcosystemStore.js";
import { ExemplarMemory } from "../learning/ExemplarMemory.js";
import { LessonMemory } from "../learning/LessonMemory.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { ModelRouter } from "../tools/ModelRouter.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";

const run = promisify(execFile);

export type RunState = "queued" | "studying" | "rebuilding" | "comparing" | "learning" | "done" | "failed" | "stopped";

export interface BlueprintFeature {
  name: string;
  detail: string;
  /** How to tell the rebuild has it. */
  check: string;
}

export interface Blueprint {
  title: string;
  purpose: string;
  /** web app, game, tool, API, site… */
  kind: string;
  stack: string;
  features: BlueprintFeature[];
  screens: string[];
  data: string[];
  techniques: string[];
}

export interface Round {
  round: number;
  buildId: string;
  score: number | null;
  coverage: number | null;
  present: string[];
  missing: string[];
  at: string;
}

export interface ReconstructRun {
  id: string;
  source: {
    kind: "project" | "git";
    label: string;
    path: string;
    url: string | null;
    /** MIT, Apache-2.0, GPL…, or null when there is none. */
    license: string | null;
    /** Your own project, or openly licensed: may be kept as a worked example. */
    canKeep: boolean;
  };
  state: RunState;
  phase: string;
  createdAt: string;
  finishedAt: string | null;
  startedBy: string;
  blueprint: Blueprint | null;
  rounds: Round[];
  lessons: string[];
  keptAsExample: boolean;
  error: string | null;
}

const MAX_ROUNDS = Number(process.env.RECONSTRUCT_MAX_ROUNDS) || 3;
const GOOD_ENOUGH = 0.85;
const BUILD_LIMIT_MS = Number(process.env.RECONSTRUCT_BUILD_LIMIT_MS) || 4 * 3_600_000;
const FILE = () => path.resolve("data", "agent", "reconstruct.json");
const OPEN_LICENSES = /^(MIT|Apache-2\.0|BSD-[23]-Clause|ISC|Unlicense|0BSD|MPL-2\.0|CC0-1\.0)$/;

const read = (): ReconstructRun[] => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as ReconstructRun[];
  } catch {
    return [];
  }
};
const write = (runs: ReconstructRun[]) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  const tmp = `${FILE()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(runs.slice(-200), null, 2), "utf8");
  fs.renameSync(tmp, FILE());
};
const get = (id: string) => read().find((r) => r.id === id) ?? null;
const patch = (id: string, change: Partial<ReconstructRun>) => {
  const runs = read();
  const target = runs.find((r) => r.id === id);
  if (target) Object.assign(target, change);
  write(runs);
  return target ?? null;
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const extractJson = (text: string): Record<string, unknown> | null => {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};
const strings = (value: unknown, max = 30): string[] =>
  (Array.isArray(value) ? value : [])
    .map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as Record<string, unknown>).name ?? (v as Record<string, unknown>).title ?? "") : ""))
    .map((v) => v.trim().slice(0, 200))
    .filter(Boolean)
    .slice(0, max);

/* ─── reading code ─── */

const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "coverage", ".turbo", ".cache", "target", "venv", ".venv", "__pycache__", "vendor"]);
const CODE = /\.(tsx?|jsx?|mjs|vue|svelte|html|css|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|lua|gd|json|md|toml|ya?ml|sql)$/i;

/** The files of a folder, without blocking (git's list when it is a repository). */
const filesOf = async (root: string): Promise<string[]> => {
  try {
    const { stdout } = await run("git", ["ls-files"], { cwd: root, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const listed = stdout.split(/\r?\n/).filter(Boolean);
    if (listed.length) return listed.filter((f) => CODE.test(f) && !f.split("/").some((part) => SKIP.has(part)));
  } catch {
    /* not a repository: walk it */
  }
  const found: string[] = [];
  const walk = async (dir: string, rel: string) => {
    if (found.length > 5000) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name) && !entry.name.startsWith(".")) await walk(path.join(dir, entry.name), `${rel}${entry.name}/`);
      } else if (CODE.test(entry.name)) found.push(`${rel}${entry.name}`);
    }
  };
  await walk(root, "");
  return found;
};

/** What the model reads: the file list, the README, the manifest and the most telling source files. */
const digestOf = async (root: string, budget = 26_000): Promise<string> => {
  const files = await filesOf(root);
  const readHead = async (file: string, max: number) => {
    const text = await fs.promises.readFile(path.join(root, file), "utf8").catch(() => "");
    return text.length > max ? `${text.slice(0, max)}\n… (cut)` : text;
  };
  const telling = (file: string) => {
    const name = file.toLowerCase();
    let score = 0;
    if (/(^|\/)(app|main|index|server|game|routes?|store|schema|models?)\.[a-z]+$/.test(name)) score += 5;
    if (/(pages|app|screens|views|components|routes|api|scenes)\//.test(name)) score += 3;
    if (/\.(tsx|jsx|vue|svelte|py|go|rs|gd|lua|cs)$/.test(name)) score += 2;
    if (/test|spec|\.d\.ts$|lock|\.json$|\.md$|\.css$|\.ya?ml$/.test(name)) score -= 4;
    return score - file.split("/").length * 0.2;
  };
  const parts = [`Files (${files.length}):\n${files.slice(0, 300).join("\n")}${files.length > 300 ? "\n…" : ""}`];
  const readme = files.find((f) => /^readme\.md$/i.test(f));
  if (readme) parts.push(`## ${readme}\n${await readHead(readme, 3000)}`);
  for (const manifest of ["package.json", "pyproject.toml", "Cargo.toml", "go.mod", "project.godot"]) {
    if (files.includes(manifest)) parts.push(`## ${manifest}\n${await readHead(manifest, 2000)}`);
  }
  let used = parts.join("\n\n").length;
  for (const file of [...files].sort((a, b) => telling(b) - telling(a))) {
    if (used > budget) break;
    const text = await readHead(file, 3500);
    if (!text.trim()) continue;
    parts.push(`## ${file}\n${text}`);
    used += text.length + file.length + 4;
  }
  return parts.join("\n\n").slice(0, budget + 4000);
};

const licenseOf = async (root: string): Promise<string | null> => {
  const names = await fs.promises.readdir(root).catch(() => [] as string[]);
  const file = names.find((n) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(n));
  if (!file) return null;
  const text = (await fs.promises.readFile(path.join(root, file), "utf8").catch(() => "")).slice(0, 4000);
  if (/MIT License|Permission is hereby granted, free of charge/i.test(text)) return "MIT";
  if (/Apache License,?\s+Version 2\.0/i.test(text)) return "Apache-2.0";
  if (/GNU AFFERO GENERAL PUBLIC LICENSE/i.test(text)) return "AGPL-3.0";
  if (/GNU LESSER GENERAL PUBLIC LICENSE/i.test(text)) return "LGPL";
  if (/GNU GENERAL PUBLIC LICENSE/i.test(text)) return "GPL";
  if (/Mozilla Public License,? v(ersion)? 2\.0/i.test(text)) return "MPL-2.0";
  if (/Redistribution and use in source and binary forms/i.test(text)) return /Neither the name/i.test(text) ? "BSD-3-Clause" : "BSD-2-Clause";
  if (/Permission to use, copy, modify, and\/or distribute/i.test(text)) return "ISC";
  if (/This is free and unencumbered software released into the public domain/i.test(text)) return "Unlicense";
  return "other";
};

/* ─── the stages ─── */

const study = async (runId: string): Promise<Blueprint> => {
  const current = get(runId)!;
  patch(runId, { state: "studying", phase: "Reading the code and writing its blueprint" });
  const digest = await digestOf(current.source.path);
  const answer = await ModelRouter.generate(
    `Study this app's code and write its blueprint: everything someone would need to build the same app again WITHOUT seeing this code.

${digest}

List every user-facing feature (what a person can do or see), each with a one-line way to check it is there. Include the screens or
pages, the data it keeps, and the techniques that make it work well (algorithms, patterns, libraries, tricks). Be specific to this app.

Answer with JSON only:
{"title": "<the app's name>", "purpose": "<what it is for, 1-2 sentences>", "kind": "<web app|game|tool|API|website|mobile app|...>",
 "stack": "<languages and frameworks>", "features": [{"name": "<short>", "detail": "<what it does>", "check": "<how to tell it works>"}],
 "screens": ["..."], "data": ["..."], "techniques": ["..."]}`
  );
  const parsed = extractJson(answer);
  const rawFeatures = Array.isArray(parsed?.features) ? parsed.features : [];
  const features = rawFeatures
    .map((f) => (f && typeof f === "object" ? (f as Record<string, unknown>) : { name: String(f) }))
    .map((f) => ({
      name: String(f.name ?? f.title ?? "").trim().slice(0, 120),
      detail: String(f.detail ?? f.description ?? "").trim().slice(0, 600),
      check: String(f.check ?? f.howToCheck ?? "").trim().slice(0, 300)
    }))
    .filter((f) => f.name.length > 2)
    .slice(0, 40);
  if (!parsed || features.length === 0) {
    Logger.warn("Reconstructor: no usable blueprint in the model's answer", { answer: answer.slice(0, 1500) });
    throw new Error("The model did not write a usable blueprint of the app.");
  }
  const blueprint: Blueprint = {
    title: String(parsed.title ?? current.source.label).trim().slice(0, 120) || current.source.label,
    purpose: String(parsed.purpose ?? "").trim().slice(0, 600),
    kind: String(parsed.kind ?? "app").trim().slice(0, 40),
    stack: String(parsed.stack ?? "").trim().slice(0, 200),
    features,
    screens: strings(parsed.screens),
    data: strings(parsed.data),
    techniques: strings(parsed.techniques)
  };
  patch(runId, { blueprint });
  return blueprint;
};

const briefOf = (blueprint: Blueprint) => `Build ${blueprint.title}: ${blueprint.purpose}
It is a ${blueprint.kind}${blueprint.stack ? ` (the original uses ${blueprint.stack}; use what suits you best)` : ""}.

Every one of these features must work:
${blueprint.features.map((f, i) => `${i + 1}. ${f.name}: ${f.detail}${f.check ? ` (check: ${f.check})` : ""}`).join("\n")}
${blueprint.screens.length ? `\nScreens: ${blueprint.screens.join("; ")}` : ""}${blueprint.data.length ? `\nData it keeps: ${blueprint.data.join("; ")}` : ""}${
  blueprint.techniques.length ? `\nTechniques that make it work well: ${blueprint.techniques.join("; ")}` : ""
}

Build it completely from this description: real, working features, no placeholders.`;

const waitForBuild = async (runId: string, buildId: string): Promise<void> => {
  const started = Date.now();
  while (BuildService.isRunning(buildId)) {
    if (get(runId)?.state === "stopped" || Date.now() - started > BUILD_LIMIT_MS) {
      BuildService.control(buildId, "stop");
      for (let i = 0; i < 60 && BuildService.isRunning(buildId); i++) await sleep(1000);
      return;
    }
    await sleep(15_000);
  }
};

const compare = async (runId: string, buildId: string, round: number): Promise<Round> => {
  const current = get(runId)!;
  const blueprint = current.blueprint!;
  patch(runId, { state: "comparing", phase: `Checking the rebuild against the blueprint (round ${round})` });
  const view = BuildService.view(buildId);
  const dir = view?.outputDir ?? "";
  const digest = dir && fs.existsSync(dir) ? await digestOf(dir, 22_000) : "(the rebuild left no files)";
  const answer = await ModelRouter.generate(
    `An app was rebuilt from a list of features. Check the rebuilt code below against each feature: is it really implemented and wired
in (not a placeholder, not a stub)? Be strict.

Features:
${blueprint.features.map((f, i) => `F${i + 1}. ${f.name}: ${f.detail}`).join("\n")}

The rebuilt code:
${digest}

Answer with JSON only: {"present": ["F1", "..."], "missing": ["F2", "..."]}`
  );
  const parsed = extractJson(answer);
  const ids = (value: unknown) =>
    new Set((Array.isArray(value) ? value : []).map((v) => Number(String(v).replace(/^F/i, ""))).filter((n) => n >= 1 && n <= blueprint.features.length));
  const presentIds = ids(parsed?.present);
  const present = blueprint.features.filter((_, i) => presentIds.has(i + 1)).map((f) => f.name);
  const missing = blueprint.features.filter((_, i) => !presentIds.has(i + 1)).map((f) => f.name);
  const result: Round = {
    round,
    buildId,
    score: view ? Math.round(view.bestScore ?? view.qualityScore ?? 0) : null,
    coverage: parsed ? Math.round((present.length / blueprint.features.length) * 100) / 100 : null,
    present,
    missing,
    at: new Date().toISOString()
  };
  patch(runId, { rounds: [...get(runId)!.rounds.filter((r) => r.round !== round), result] });
  return result;
};

/** General lessons from what the rebuild missed, for every later build. */
const learn = async (runId: string, missed: string[]): Promise<void> => {
  const current = get(runId)!;
  const blueprint = current.blueprint!;
  patch(runId, { state: "learning", phase: "Learning from what the rebuild missed" });
  if (missed.length) {
    const details = blueprint.features.filter((f) => missed.includes(f.name));
    const answer = await ModelRouter.generate(
      `A builder rebuilt a ${blueprint.kind} ("${blueprint.title}") from a feature list and missed these features:
${details.map((f) => `- ${f.name}: ${f.detail}`).join("\n")}

For each, write ONE general lesson (one or two sentences) that would make a builder get it right next time in ANY ${blueprint.kind}
of this sort: what to build and how, not this app's names.

Answer with JSON only: {"lessons": [{"feature": "<name>", "lesson": "<the lesson>"}]}`
    );
    const parsed = extractJson(answer);
    const items = (Array.isArray(parsed?.lessons) ? parsed.lessons : [])
      .map((l) => (l && typeof l === "object" ? (l as Record<string, unknown>) : {}))
      .map((l) => ({ feature: String(l.feature ?? "").slice(0, 120), lesson: String(l.lesson ?? "").trim().slice(0, 500) }))
      .filter((l) => l.lesson.length > 20);
    const learned: string[] = [];
    for (const item of items) {
      LessonMemory.recordTaught("build", `reconstruct: ${blueprint.kind}: ${item.feature || item.lesson.slice(0, 60)}`, item.lesson, null);
      learned.push(item.lesson);
    }
    patch(runId, { lessons: [...get(runId)!.lessons, ...learned].slice(-60) });
  }
  // The original as a worked example for similar briefs, when it is ours or openly licensed.
  if (current.source.canKeep && !get(runId)!.keptAsExample) {
    const id = ExemplarMemory.recordSuccess(current.source.path, blueprint.title, `${blueprint.purpose} ${blueprint.features.map((f) => f.name).join(", ")}`, 95);
    if (id !== null) patch(runId, { keptAsExample: true });
  }
};

const runRound = async (runId: string, round: number, previous: Round | null): Promise<Round> => {
  const current = get(runId)!;
  patch(runId, { state: "rebuilding", phase: round === 1 ? "Rebuilding it from the blueprint alone" : `Round ${round}: adding what it missed` });
  const build =
    previous && BuildService.view(previous.buildId)
      ? BuildService.continue(previous.buildId, {
          instruction: `Add these features, which are still missing or incomplete; keep everything that works:\n${current
            .blueprint!.features.filter((f) => previous.missing.includes(f.name))
            .map((f) => `- ${f.name}: ${f.detail}${f.check ? ` (check: ${f.check})` : ""}`)
            .join("\n")}`,
          startedBy: `reconstruct:${runId}`
        })
      : BuildService.start({
          projectName: `rebuild-${current.blueprint!.title.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase().slice(0, 40)}`,
          description: briefOf(current.blueprint!),
          profile: "balanced",
          maxIterations: 4,
          startedBy: `reconstruct:${runId}`
        });
  await waitForBuild(runId, build.buildId);
  if (get(runId)?.state === "stopped") throw new Error("stopped");
  return compare(runId, build.buildId, round);
};

async function work(runId: string): Promise<void> {
  const current = get(runId)!;
  try {
    const blueprint = current.blueprint ?? (await study(runId));
    let last: Round | null = get(runId)!.rounds.slice(-1)[0] ?? null;
    let round = last ? last.round + 1 : 1;
    const until = last ? round : MAX_ROUNDS;
    for (; round <= until; round++) {
      last = await runRound(runId, round, last);
      await learn(runId, last.missing);
      if ((last.coverage ?? 0) >= GOOD_ENOUGH) break;
    }
    const best = Math.max(...get(runId)!.rounds.map((r) => r.coverage ?? 0));
    patch(runId, {
      state: "done",
      finishedAt: new Date().toISOString(),
      phase: `Rebuilt ${blueprint.title}: ${Math.round(best * 100)}% of its ${blueprint.features.length} features; ${get(runId)!.lessons.length} lessons learned`
    });
  } catch (error) {
    const message = (error as Error)?.message ?? String(error);
    if (get(runId)?.state === "stopped") return;
    Logger.warn("Reconstructor: a run failed", { run: runId, error: message });
    patch(runId, { state: "failed", finishedAt: new Date().toISOString(), error: message, phase: `Stopped: ${message}` });
  }
}

/* ─── the queue ─── */

let working = false;

async function drain(): Promise<void> {
  if (working || process.env.RECONSTRUCT_NO_LOOP === "1") return;
  working = true;
  try {
    for (;;) {
      const next = read().find((r) => r.state === "queued");
      if (!next) return;
      while (GameMode.isOn()) {
        patch(next.id, { phase: "Waiting while everything is paused" });
        await sleep(60_000);
      }
      await work(next.id);
    }
  } finally {
    working = false;
  }
}

const slug = (text: string) => text.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 40) || "app";

export const Reconstructor = {
  list() {
    return { runs: [...read()].reverse(), skills: Reconstructor.skills() };
  },

  /**
   * What it has learned to build: the kinds of apps rebuilt, and its first-try
   * coverage on new apps, recent against earlier — the measure that it can
   * build more things than before.
   */
  skills() {
    const done = read().filter((r) => r.rounds.length && r.blueprint);
    const firstTry = done.map((r) => r.rounds.find((x) => x.round === 1)?.coverage).filter((c): c is number => typeof c === "number");
    const mean = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : null);
    const kinds = new Map<string, number>();
    for (const r of done) kinds.set(r.blueprint!.kind.toLowerCase(), (kinds.get(r.blueprint!.kind.toLowerCase()) ?? 0) + 1);
    return {
      appsRebuilt: done.length,
      featuresStudied: done.reduce((sum, r) => sum + r.blueprint!.features.length, 0),
      lessons: done.reduce((sum, r) => sum + r.lessons.length, 0),
      examplesKept: done.filter((r) => r.keptAsExample).length,
      kinds: [...kinds].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      firstTryCoverage: { recent: mean(firstTry.slice(-5)), earlier: firstTry.length > 5 ? mean(firstTry.slice(-10, -5)) : null }
    };
  },

  /** Queue one of the owner's projects. */
  fromProject(projectId: string, startedBy = "owner"): ReconstructRun {
    const project = EcosystemStore.getProject(projectId);
    if (!project) throw new Error("Unknown project.");
    return queue({ kind: "project", label: project.name, path: project.path, url: null, license: null, canKeep: true }, startedBy);
  },

  /** Queue a public Git repository: cloned (shallow) into builds/ first. */
  async fromGit(url: string, startedBy = "owner"): Promise<ReconstructRun> {
    const clean = url.trim();
    const allowLocal = process.env.RECONSTRUCT_ALLOW_LOCAL_GIT === "1";
    if (!/^https:\/\/[\w.-]+\/[\w.~/-]+$/.test(clean) && !(allowLocal && /^file:\/\//.test(clean))) {
      throw new Error("Give an https address of a public Git repository, e.g. https://github.com/owner/repo.");
    }
    const dir = path.resolve("builds", `reconstruct_src_${slug(clean.split("/").slice(-1)[0].replace(/\.git$/, ""))}_${Date.now()}`);
    try {
      await run("git", ["clone", "--depth", "1", "--quiet", clean, dir], { windowsHide: true, timeout: 10 * 60_000 });
    } catch (error) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new Error(`Could not clone it: ${((error as Error)?.message ?? "").split("\n").slice(-2).join(" ").slice(0, 200)}`);
    }
    const license = await licenseOf(dir);
    return queue(
      { kind: "git", label: clean.replace(/^https?:\/\/(www\.)?/, "").replace(/\.git$/, ""), path: dir, url: clean, license, canKeep: Boolean(license && OPEN_LICENSES.test(license)) },
      startedBy
    );
  },

  /** Another round on a finished run: rebuild what it still misses. */
  again(runId: string): ReconstructRun {
    const current = get(runId);
    if (!current) throw new Error("Unknown run.");
    if (!["done", "failed", "stopped"].includes(current.state)) throw new Error("It is still working.");
    if (!current.blueprint) throw new Error("It has no blueprint yet; queue it again.");
    patch(runId, { state: "queued", phase: "Queued for another round", error: null, finishedAt: null });
    void drain();
    return get(runId)!;
  },

  stop(runId: string): ReconstructRun | null {
    const current = get(runId);
    if (!current) return null;
    const lastBuild = current.rounds.slice(-1)[0]?.buildId;
    patch(runId, { state: "stopped", finishedAt: new Date().toISOString(), phase: "Stopped by you" });
    for (const build of BuildService.active().filter((b) => b.startedBy === `reconstruct:${runId}`)) BuildService.control(build.buildId, "stop");
    if (lastBuild && BuildService.isRunning(lastBuild)) BuildService.control(lastBuild, "stop");
    return get(runId);
  },

  /** After a restart: a run cut off part-way goes back in the queue and carries on from its last finished stage. */
  resume(): void {
    const runs = read();
    let changed = false;
    for (const r of runs) {
      if (["studying", "rebuilding", "comparing", "learning"].includes(r.state)) {
        r.state = "queued";
        r.phase = "Picked up again after a restart";
        changed = true;
      }
    }
    if (changed) write(runs);
    void drain();
  },

  running(): string | null {
    const active = read().find((r) => ["studying", "rebuilding", "comparing", "learning"].includes(r.state));
    return active ? `Reconstructing ${active.source.label}` : null;
  },

  /** For tests: the stages one at a time. */
  testHooks: { work, study, compare, learn, licenseOf, digestOf }
};

function queue(source: ReconstructRun["source"], startedBy: string): ReconstructRun {
  const runs = read();
  const existing = runs.find((r) => r.source.path === source.path && ["queued", "studying", "rebuilding", "comparing", "learning"].includes(r.state));
  if (existing) return existing;
  const entry: ReconstructRun = {
    id: `rec_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    source,
    state: "queued",
    phase: runs.some((r) => r.state === "queued" || r.state === "studying" || r.state === "rebuilding") ? "Waiting for the app before it" : "Starting",
    createdAt: new Date().toISOString(),
    finishedAt: null,
    startedBy,
    blueprint: null,
    rounds: [],
    lessons: [],
    keptAsExample: false,
    error: null
  };
  runs.push(entry);
  write(runs);
  void drain();
  return entry;
}
