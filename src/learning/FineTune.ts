/**
 * FineTune — trains the local model's weights on what the agents were rewarded for.
 *
 * Exports the dataset (Reinforcement.exportDataset), then runs
 * scripts/train/finetune.py in the training environment (TRAIN_PYTHON,
 * default E:/Tools/ab-train): QLoRA SFT on the best answers, then DPO on the
 * preference pairs. It needs the whole graphics card, so it holds the GPU lock
 * for the run (builds and research wait) and asks Ollama to unload its models
 * first. "Check the stack" runs a few real steps on a tiny model to prove the
 * pipeline trains without needing a dataset.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

import { gpuLock } from "../utils/GpuLock.js";
import { Logger } from "../utils/Logger.js";
import { Reinforcement } from "./Reinforcement.js";

export interface FineTuneJob {
  id: string;
  check: boolean;
  state: "running" | "done" | "failed" | "not-enough-data";
  startedAt: string;
  finishedAt: string | null;
  events: Array<Record<string, unknown>>;
  out: string | null;
  error: string | null;
}

const PYTHON = () => process.env.TRAIN_PYTHON ?? "E:/Tools/ab-train/Scripts/python.exe";
const SCRIPT = () => path.resolve("scripts", "train", "finetune.py");
const STATE = () => path.resolve("data", "rl", "finetune.json");

const read = (): FineTuneJob[] => {
  try {
    return JSON.parse(fs.readFileSync(STATE(), "utf8")) as FineTuneJob[];
  } catch {
    return [];
  }
};
const save = (job: FineTuneJob) => {
  const jobs = read().filter((j) => j.id !== job.id);
  jobs.unshift(job);
  fs.mkdirSync(path.dirname(STATE()), { recursive: true });
  fs.writeFileSync(STATE(), JSON.stringify(jobs.slice(0, 20), null, 2), "utf8");
};

/** Frees the graphics card: Ollama unloads whatever it has loaded. */
const unloadOllama = async () => {
  const base = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
  try {
    const ps = (await (await fetch(`${base}/api/ps`, { signal: AbortSignal.timeout(5000) })).json()) as { models?: Array<{ name: string }> };
    for (const m of ps.models ?? []) {
      await fetch(`${base}/api/generate`, { method: "POST", body: JSON.stringify({ model: m.name, keep_alive: 0 }), signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
    }
  } catch {
    // Ollama not running: nothing to unload
  }
};

let running: FineTuneJob | null = null;

export const FineTune = {
  ready(): { ready: boolean; detail: string } {
    if (!fs.existsSync(PYTHON())) return { ready: false, detail: `No training environment at ${PYTHON()} (TRAIN_PYTHON).` };
    return { ready: true, detail: `Training environment: ${PYTHON()}` };
  },

  status() {
    return { ...FineTune.ready(), running, jobs: read().slice(0, 10) };
  },

  start(check = false): FineTuneJob {
    if (running) throw new Error("A training run is already going.");
    const ready = FineTune.ready();
    if (!ready.ready) throw new Error(ready.detail);
    const exported = Reinforcement.exportDataset(0.8);
    const job: FineTuneJob = { id: `ft_${Date.now().toString(36)}`, check, state: "running", startedAt: new Date().toISOString(), finishedAt: null, events: [{ event: "exported", sft: exported.sft, dpo: exported.dpo }], out: null, error: null };
    running = job;
    save(job);

    void gpuLock.run(async () => {
      await unloadOllama();
      await new Promise<void>((resolve) => {
        const child = spawn(PYTHON(), [SCRIPT(), "--data", exported.dir, ...(check ? ["--check"] : [])], { cwd: process.cwd(), windowsHide: true, env: { ...process.env, PYTHONUNBUFFERED: "1", HF_HUB_DISABLE_TELEMETRY: "1" } });
        let tail = "";
        const onLine = (line: string) => {
          tail = `${tail}\n${line}`.slice(-4000);
          if (!line.startsWith("{")) return;
          try {
            const event = JSON.parse(line) as Record<string, unknown>;
            job.events.push(event);
            if (event.event === "done") job.out = String(event.out ?? "");
            if (event.event === "not-enough-data") job.state = "not-enough-data";
            if (event.event === "error") job.error = String(event.message ?? "");
            save(job);
          } catch {
            // a log line that only looks like JSON
          }
        };
        let pending = "";
        const take = (chunk: Buffer) => {
          pending += chunk.toString();
          const lines = pending.split(/\r?\n/);
          pending = lines.pop() ?? "";
          lines.forEach(onLine);
        };
        child.stdout.on("data", take);
        child.stderr.on("data", take);
        child.on("close", (code) => {
          if (job.state === "running") job.state = code === 0 ? "done" : "failed";
          if (job.state === "failed" && !job.error) job.error = tail.split("\n").filter(Boolean).slice(-6).join("\n");
          job.finishedAt = new Date().toISOString();
          save(job);
          Logger.log("Fine-tuning finished", { id: job.id, state: job.state, out: job.out });
          resolve();
        });
        child.on("error", (error) => {
          job.state = "failed";
          job.error = error.message;
          job.finishedAt = new Date().toISOString();
          save(job);
          resolve();
        });
      });
    }).finally(() => {
      running = null;
    });
    return job;
  }
};
