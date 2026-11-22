/**
 * The Model Laboratory: which local model is best on this PC, measured.
 *
 * It runs the same graded challenges on each candidate, one model at a time
 * (every model is unloaded before the next is loaded), and measures what the
 * PC actually does: load time, how the model splits between the graphics card
 * and RAM, peak video memory and RAM, time to the first token, tokens a second,
 * and every failure. The challenges are the Evaluations' fixed set (coding,
 * diagnosis, reading, planning, this PC's procedures) plus the lab's own:
 * structured JSON, a tool call, a needle in a long document, repairing a buggy
 * function, a game rule, and a synthesis that must cite its sources and notice
 * where they disagree. Every grader is code; nothing is judged by a model.
 *
 * It never changes the production model. It recommends one, with the evidence,
 * and the owner decides (Settings → OLLAMA_MODEL).
 *
 * Safety: local models only (Ollama on this PC); refused while Gaming Mode is
 * on and stopped if a game starts; a model is skipped when it would not fit in
 * the free video memory plus free RAM with 4 GB to spare; each answer is capped
 * (1,500 tokens, 4 minutes); one run at a time. Results: data/agent/model-lab.json.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

import { GameMode } from "../utils/GameMode.js";
import { gpuLock } from "../utils/GpuLock.js";
import { Logger } from "../utils/Logger.js";
import { OLLAMA_URL } from "../utils/Ollama.js";
import { STANDARD, grade, type Challenge } from "./Evaluations.js";

const run = promisify(execFile);

export interface InstalledModel {
  name: string;
  sizeGB: number;
  family: string;
  parameters: string;
  quantization: string;
  /** The longest context the model was trained for, from its own metadata. */
  contextLength: number | null;
  /** Mixture of experts: only part of it works on each token. */
  moe: boolean;
}

export interface ModelCall {
  challenge: string;
  category: string;
  passed: boolean;
  detail: string;
  ttftMs: number | null;
  tokensPerSec: number | null;
  promptTokensPerSec: number | null;
  outputTokens: number;
  wallMs: number;
  error: string | null;
}

export interface ModelResult {
  model: string;
  state: "done" | "skipped" | "failed" | "stopped";
  reason: string | null;
  loadMs: number | null;
  /** How much of the loaded model is on the graphics card (the rest is in RAM, run by the CPU). */
  gpuPercent: number | null;
  loadedGB: number | null;
  peakVramMB: number | null;
  /** The most system RAM in use during its run (whole PC), and how much more than before it loaded. */
  peakRamUsedMB: number | null;
  ramIncreaseMB: number | null;
  calls: ModelCall[];
  score: number | null;
  byCategory: Record<string, number>;
  medianTokensPerSec: number | null;
  medianTtftMs: number | null;
  errors: number;
}

export interface LabRun {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  state: "running" | "done" | "stopped" | "failed";
  numCtx: number;
  challenges: string[];
  results: ModelResult[];
  recommendation: string | null;
}

const FILE = () => path.resolve(process.env.MODEL_LAB_PATH ?? "data/agent/model-lab.json");
const MAX_TOKENS = 1500;
const CALL_TIMEOUT_MS = 4 * 60_000;

// ── The lab's own challenges, each with a code grader ──────────────────────

type LabChallenge = Challenge | { id: string; category: string; title: string; prompt: string; check: (answer: string) => { passed: boolean; detail: string } };

const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
const jsonFrom = (text: string): unknown => {
  const body = stripThinking(text).replace(/^[\s\S]*?```(?:json)?\s*\n/i, "").replace(/```[\s\S]*$/, "").trim();
  const start = body.search(/[{[]/);
  return JSON.parse(start >= 0 ? body.slice(start) : body);
};

/** A long document with one fact in the middle (about 9,000 tokens), built the same way every time. */
const haystack = (): string => {
  const lines: string[] = [];
  for (let i = 0; i < 420; i++) lines.push(`Log entry ${i}: the night shift checked pump ${(i * 7) % 31} and valve ${(i * 13) % 47}; pressure was ${(i * 37) % 90 + 10} kPa and nothing unusual was noted.`);
  lines.splice(233, 0, "Log entry 233b: the supervisor changed the vault code to 7413-ALPHA and told nobody else.");
  return lines.join("\n");
};

export const LAB_CHALLENGES: LabChallenge[] = [
  {
    id: "lab-json",
    category: "structured",
    title: "Structured JSON output",
    prompt: `Bug report: "Clicking Save on the settings page does nothing in Firefox; Chrome works. Started after yesterday's release."\nReturn ONLY a JSON object with exactly these keys: "title" (string), "tags" (array of exactly 3 lowercase strings), "priority" (integer 1-5), "browser" (string). No prose.`,
    check: (answer) => {
      try {
        const value = jsonFrom(answer) as Record<string, unknown>;
        const keys = Object.keys(value).sort().join(",");
        const ok = keys === "browser,priority,tags,title" && typeof value.title === "string" && Array.isArray(value.tags) && value.tags.length === 3 && (value.tags as unknown[]).every((t) => typeof t === "string" && t === t.toLowerCase()) && Number.isInteger(value.priority) && (value.priority as number) >= 1 && (value.priority as number) <= 5 && /firefox/i.test(String(value.browser));
        return { passed: ok, detail: ok ? "valid, exact keys and types" : `wrong shape: keys ${keys}` };
      } catch {
        return { passed: false, detail: "not parseable JSON" };
      }
    }
  },
  {
    id: "lab-tool",
    category: "tool-use",
    title: "Chooses and calls the right tool",
    prompt: `You can call exactly one of these tools:\n- read_file {"path": string}\n- run_check {"name": "typecheck"|"build"|"test"}\n- search_web {"query": string}\nThe typecheck just failed with: src/game/physics.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.\nWhat is the first call to make? Reply with ONLY JSON: {"tool": "...", "args": {...}}`,
    check: (answer) => {
      try {
        const value = jsonFrom(answer) as { tool?: string; args?: { path?: string } };
        const ok = value.tool === "read_file" && /src\/game\/physics\.ts$/.test(value.args?.path ?? "");
        return { passed: ok, detail: ok ? "read_file on the failing file" : `called ${value.tool ?? "nothing"} ${JSON.stringify(value.args ?? {})}` };
      } catch {
        return { passed: false, detail: "not a JSON tool call" };
      }
    }
  },
  {
    id: "lab-long",
    category: "long-context",
    title: "Finds one fact in a long document",
    prompt: `${haystack()}\n\nQuestion: what is the vault code? Answer with the code only.`,
    check: (answer) => ({ passed: /7413-ALPHA/.test(answer), detail: /7413-ALPHA/.test(answer) ? "found it" : "missed the fact" })
  },
  {
    id: "lab-repair",
    category: "repair",
    title: "Repairs a buggy function",
    prompt: `This function should return the median of a list of numbers, but it fails for even-length lists and it reorders the caller's array:\nfunction median(xs) { xs.sort(); return xs[Math.floor(xs.length / 2)]; }\nWrite the corrected JavaScript function named median. Answer with the code only, no imports.`,
    grader: { kind: "code", name: "median", tests: `eq(median([3,1,2]),2); eq(median([4,1,3,2]),2.5); eq(median([10,9,100,1]),9.5); const a=[3,1,2]; median(a); eq(a,[3,1,2]); eq(median([-5,-1,-3]),-3);` }
  } as unknown as Challenge,
  {
    id: "lab-game",
    category: "game-dev",
    title: "A platformer's movement rule",
    prompt: `Write a JavaScript function named step(state, input, dt) for a 2D platformer. state = {x, y, vx, vy, onGround}; y grows downward; input = {left, right, jump}. Rules: horizontal speed is 200 when left or right is held (right wins if both), else 0; gravity adds 900*dt to vy; jumping sets vy to -400 only when onGround; then x += vx*dt and y += vy*dt; the ground is at y = 300: below it, clamp y to 300, set vy to 0 and onGround true, otherwise onGround false. Return a new object and do not change state. Answer with the code only.`,
    grader: { kind: "code", name: "step", tests: `const s={x:0,y:300,vx:0,vy:0,onGround:true}; const a=step(s,{right:true,jump:true},0.1); eq(s.x,0); eq(Math.round(a.x),20); eq(a.vy<0,true); eq(a.onGround,false); const b=step({x:0,y:299,vx:0,vy:50,onGround:false},{left:true},0.1); eq(Math.round(b.x),-20); eq(b.y,300); eq(b.vy,0); eq(b.onGround,true); const c=step({x:0,y:100,vx:0,vy:0,onGround:false},{jump:true},0.1); eq(c.vy>0,true);` }
  } as unknown as Challenge,
  {
    id: "lab-synthesis",
    category: "research",
    title: "Synthesis that cites and notices disagreement",
    prompt: `Sources:\n[1] A 2021 field study of 40 maize plots found intercropping with beans raised maize yield by 12%.\n[2] A 2023 meta-analysis of 210 trials found intercropping maize with legumes raised total land productivity by about 20%.\n[3] A 2022 trial in dry soils found maize yield fell 8% when intercropped with beans, because of competition for water.\nIn three sentences: does intercropping maize with beans help yield? Cite sources as [n] and say where they disagree.`,
    check: (answer) => {
      const text = stripThinking(answer);
      const cites = [1, 2, 3].filter((n) => text.includes(`[${n}]`)).length;
      const conflict = /disagree|conflict|contradict|however|but|whereas|in contrast|mixed|depends/i.test(text);
      const water = /water|dry|arid|drought/i.test(text);
      return { passed: cites === 3 && conflict && water, detail: `cites ${cites}/3${conflict ? ", notes the disagreement" : ", misses the disagreement"}${water ? ", names the dry-soil condition" : ""}` };
    }
  }
];

export const labChallenges = (): LabChallenge[] => [...STANDARD, ...LAB_CHALLENGES];

const gradeAny = async (challenge: LabChallenge, answer: string) => ("check" in challenge ? challenge.check(answer) : grade(challenge, answer));

// ── Measuring ───────────────────────────────────────────────────────────────

const ollama = async <T>(route: string, body?: unknown, timeoutMs = 30_000): Promise<T> => {
  const response = await fetch(`${OLLAMA_URL}${route}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Ollama answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  return (await response.json()) as T;
};

export const installedModels = async (): Promise<InstalledModel[]> => {
  const tags = await ollama<{ models: Array<{ name: string; size: number; details: { family?: string; parameter_size?: string; quantization_level?: string } }> }>("/api/tags");
  const out: InstalledModel[] = [];
  for (const m of tags.models) {
    let contextLength: number | null = null;
    try {
      const shown = await ollama<{ model_info?: Record<string, unknown> }>("/api/show", { model: m.name });
      const key = Object.keys(shown.model_info ?? {}).find((k) => k.endsWith(".context_length"));
      contextLength = key ? Number(shown.model_info![key]) : null;
    } catch {
      // older Ollama: unknown
    }
    out.push({ name: m.name, sizeGB: Math.round((m.size / 1e9) * 10) / 10, family: m.details.family ?? "", parameters: m.details.parameter_size ?? "", quantization: m.details.quantization_level ?? "", contextLength, moe: /moe/i.test(m.details.family ?? "") });
  }
  return out;
};

const unloadAll = async () => {
  const ps = await ollama<{ models?: Array<{ name: string }> }>("/api/ps").catch(() => ({ models: [] }));
  for (const m of ps.models ?? []) await ollama("/api/generate", { model: m.name, keep_alive: 0 }, 30_000).catch(() => undefined);
};

const vramUsedMB = async (): Promise<number | null> => {
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 8000 });
    return Number(stdout.trim().split(",")[0]);
  } catch {
    return null;
  }
};
const vramTotalMB = async (): Promise<number> => {
  try {
    const { stdout } = await run("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 8000 });
    return Number(stdout.trim());
  } catch {
    return 0;
  }
};
const ramUsedMB = () => Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);

/** Stream one answer, timing the first token; Ollama's own counters give the speeds. */
const ask = async (model: string, prompt: string, numCtx: number): Promise<{ text: string; ttftMs: number | null; tokensPerSec: number | null; promptTokensPerSec: number | null; outputTokens: number; wallMs: number }> => {
  const started = Date.now();
  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt, stream: true, think: false, keep_alive: "15m", options: { num_ctx: numCtx, temperature: 0.2, num_predict: MAX_TOKENS } }),
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS)
  });
  if (!response.ok || !response.body) throw new Error(`Ollama answered ${response.status}: ${(await response.text()).slice(0, 200)}`);
  let text = "";
  let ttftMs: number | null = null;
  let final: { eval_count?: number; eval_duration?: number; prompt_eval_count?: number; prompt_eval_duration?: number } = {};
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const part = JSON.parse(line) as { response?: string; done?: boolean; error?: string } & typeof final;
      if (part.error) throw new Error(part.error);
      if (part.response) {
        if (ttftMs === null) ttftMs = Date.now() - started;
        text += part.response;
      }
      if (part.done) final = part;
    }
  }
  const rate = (count?: number, ns?: number) => (count && ns ? Math.round((count / (ns / 1e9)) * 10) / 10 : null);
  return { text, ttftMs, tokensPerSec: rate(final.eval_count, final.eval_duration), promptTokensPerSec: rate(final.prompt_eval_count, final.prompt_eval_duration), outputTokens: final.eval_count ?? 0, wallMs: Date.now() - started };
};

const median = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
};

// ── Runs ────────────────────────────────────────────────────────────────────

const readRuns = (): LabRun[] => {
  try {
    return JSON.parse(fs.readFileSync(FILE(), "utf8")) as LabRun[];
  } catch {
    return [];
  }
};
const saveRun = (labRun: LabRun) => {
  fs.mkdirSync(path.dirname(FILE()), { recursive: true });
  fs.writeFileSync(FILE(), JSON.stringify([...readRuns().filter((r) => r.id !== labRun.id), labRun].slice(-30), null, 2));
};

let running: string | null = null;
let stopRequested = false;

/** The best model by score, then by speed, with the evidence; never acted on. */
export const recommend = (results: ModelResult[], production: string): string => {
  const done = results.filter((r) => r.state === "done" && r.score !== null);
  if (!done.length) return "No model finished the challenges.";
  const ranked = [...done].sort((a, b) => b.score! - a.score! || (b.medianTokensPerSec ?? 0) - (a.medianTokensPerSec ?? 0));
  const best = ranked[0];
  const base = done.find((r) => r.model === production);
  const line = (r: ModelResult) => `${r.model}: ${Math.round(r.score! * 100)}% of challenges, ${r.medianTokensPerSec ?? "?"} tokens/s, first token ${r.medianTtftMs ?? "?"} ms, ${r.gpuPercent ?? "?"}% on the GPU, load ${r.loadMs ? Math.round(r.loadMs / 1000) : "?"} s`;
  if (!base) return `Best: ${line(best)}. (The production model ${production} was not in this run, so there is no comparison.)`;
  if (best.model === production) return `Keep ${production}: no candidate beat it. ${ranked.slice(0, 3).map(line).join("; ")}.`;
  const gain = best.score! - base.score!;
  if (gain < 0.1) return `Keep ${production}: ${best.model} scored ${Math.round(gain * 100)} points higher, inside one run's noise (fewer than 10 points). ${line(best)}; ${line(base)}. Run again before switching.`;
  return `Recommend ${best.model} over ${production} (+${Math.round(gain * 100)} points): ${line(best)}; against ${line(base)}. Switching is your decision: Settings → OLLAMA_MODEL.`;
};

export const ModelLab = {
  runs: (): LabRun[] => readRuns().reverse(),
  latest: (): LabRun | null => readRuns().at(-1) ?? null,
  isRunning: () => running,
  stop: () => {
    stopRequested = true;
  },

  /**
   * Benchmark models one after another. Resolves when done; `await: false`
   * returns at once with the run (the API does that) and it goes on in the background.
   */
  async run(options: { models: string[]; only?: string[]; numCtx?: number; isGameRunning?: () => boolean }): Promise<LabRun> {
    if (running) throw Object.assign(new Error("A lab run is already going."), { status: 409 });
    if (GameMode.isOn()) throw Object.assign(new Error("Gaming Mode is on: the graphics card is yours. Resume first."), { status: 409 });
    // Taken at once, so a second request (and the API's answer) sees the run before the first await.
    running = "starting";
    const all = labChallenges();
    const challenges = options.only?.length ? all.filter((c) => options.only!.includes(c.id)) : all;
    let installed: InstalledModel[];
    try {
      installed = await installedModels();
    } catch (error) {
      running = null;
      throw error;
    }
    const numCtx = options.numCtx ?? Number(process.env.OLLAMA_NUM_CTX ?? 16384);
    const labRun: LabRun = { id: `lab_${Date.now().toString(36)}`, startedAt: new Date().toISOString(), finishedAt: null, state: "running", numCtx, challenges: challenges.map((c) => c.id), results: [], recommendation: null };
    running = labRun.id;
    stopRequested = false;
    saveRun(labRun);
    const totalVram = await vramTotalMB();
    try {
      for (const name of options.models) {
        const meta = installed.find((m) => m.name === name);
        const result: ModelResult = { model: name, state: "done", reason: null, loadMs: null, gpuPercent: null, loadedGB: null, peakVramMB: null, peakRamUsedMB: null, ramIncreaseMB: null, calls: [], score: null, byCategory: {}, medianTokensPerSec: null, medianTtftMs: null, errors: 0 };
        labRun.results.push(result);
        if (stopRequested || GameMode.isOn() || options.isGameRunning?.()) {
          Object.assign(result, { state: "stopped", reason: "stopped: Gaming Mode, a game, or a stop request" });
          labRun.state = "stopped";
          break;
        }
        if (!meta) {
          Object.assign(result, { state: "skipped", reason: "not installed" });
          continue;
        }
        await gpuLock.run(async () => {
          await unloadAll();
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const ramBefore = ramUsedMB();
          const vramBefore = (await vramUsedMB()) ?? 0;
          // The weights plus about 1 GB for the context window must fit in free video memory and
          // available RAM with SPARE left for the rest of the PC (Ollama maps the file, so the
          // weights in RAM are cache Windows can reclaim, but a model larger than this pages from disk).
          const spare = Number(process.env.MODEL_LAB_SPARE_GB ?? 3);
          const need = meta.sizeGB + 1;
          const room = (totalVram - vramBefore) / 1024 + os.freemem() / 1024 ** 3 - spare;
          if (need > room) {
            Object.assign(result, { state: "skipped", reason: `would not fit safely: needs about ${Math.round(need * 10) / 10} GB, ${Math.round(room * 10) / 10} GB free (video memory + available RAM, keeping ${spare} GB for the rest of the PC). Pause everything else (Quiet profile) and run it again.` });
            return;
          }
          // Load time: a one-token answer from cold.
          const loadStart = Date.now();
          const loaded = await ollama<{ load_duration?: number }>("/api/generate", { model: name, prompt: "Say OK.", stream: false, think: false, keep_alive: "15m", options: { num_ctx: numCtx, num_predict: 1 } }, 10 * 60_000);
          result.loadMs = loaded.load_duration ? Math.round(loaded.load_duration / 1e6) : Date.now() - loadStart;
          const ps = await ollama<{ models?: Array<{ name: string; size: number; size_vram: number }> }>("/api/ps").catch(() => ({ models: [] }));
          const entry = ps.models?.find((m) => m.name === name);
          if (entry) Object.assign(result, { gpuPercent: Math.round((entry.size_vram / entry.size) * 100), loadedGB: Math.round((entry.size / 1e9) * 10) / 10 });
          let peakVram = (await vramUsedMB()) ?? 0;
          let peakRam = ramUsedMB();
          const sampler = setInterval(() => {
            peakRam = Math.max(peakRam, ramUsedMB());
            void vramUsedMB().then((v) => {
              if (v !== null) peakVram = Math.max(peakVram, v);
            });
          }, 2000);
          try {
            for (const challenge of challenges) {
              if (stopRequested || GameMode.isOn() || options.isGameRunning?.()) {
                Object.assign(result, { state: "stopped", reason: "stopped part-way: Gaming Mode, a game, or a stop request" });
                break;
              }
              try {
                const answer = await ask(name, challenge.prompt, numCtx);
                const graded = await gradeAny(challenge, answer.text);
                result.calls.push({ challenge: challenge.id, category: challenge.category, passed: graded.passed, detail: graded.detail, ttftMs: answer.ttftMs, tokensPerSec: answer.tokensPerSec, promptTokensPerSec: answer.promptTokensPerSec, outputTokens: answer.outputTokens, wallMs: answer.wallMs, error: null });
              } catch (error) {
                result.errors += 1;
                result.calls.push({ challenge: challenge.id, category: challenge.category, passed: false, detail: "no answer", ttftMs: null, tokensPerSec: null, promptTokensPerSec: null, outputTokens: 0, wallMs: 0, error: (error as Error).message.slice(0, 200) });
              }
              saveRun(labRun);
            }
          } finally {
            clearInterval(sampler);
          }
          Object.assign(result, { peakVramMB: peakVram, peakRamUsedMB: peakRam, ramIncreaseMB: peakRam - ramBefore });
          const categories = new Map<string, boolean[]>();
          for (const call of result.calls) categories.set(call.category, [...(categories.get(call.category) ?? []), call.passed]);
          result.byCategory = Object.fromEntries([...categories].map(([c, v]) => [c, Math.round((v.filter(Boolean).length / v.length) * 100) / 100]));
          result.score = result.calls.length ? Math.round((result.calls.filter((c) => c.passed).length / result.calls.length) * 1000) / 1000 : null;
          result.medianTokensPerSec = median(result.calls.map((c) => c.tokensPerSec).filter((v): v is number => v !== null));
          result.medianTtftMs = median(result.calls.map((c) => c.ttftMs).filter((v): v is number => v !== null));
          await unloadAll();
        }, "background").catch((error: Error) => {
          Object.assign(result, { state: "failed", reason: error.message.slice(0, 300) });
        });
        saveRun(labRun);
        Logger.log("Model lab: a model finished", { model: name, state: result.state, score: result.score, tps: result.medianTokensPerSec });
      }
      if (labRun.state === "running") labRun.state = "done";
    } catch (error) {
      labRun.state = "failed";
      Logger.warn("Model lab run failed", { error: (error as Error).message });
    } finally {
      labRun.finishedAt = new Date().toISOString();
      labRun.recommendation = recommend(labRun.results, process.env.OLLAMA_MODEL ?? "qwen2.5-coder:14b");
      saveRun(labRun);
      running = null;
    }
    return labRun;
  }
};
