/**
 * Services API — "is everything running, and if not, turn it on".
 *
 * This is what the remote app's power button talks to. The API itself has to be
 * up for any of this to work (it is the thing answering), so what it manages is
 * everything *around* it: the local model server, the research loop, the
 * ecosystem sweep. Starting the API when the machine is cold is the desktop
 * app's job, not something a phone can do over HTTP.
 *
 * Troubleshooting returns problems in plain language with the command that
 * fixes each one, because the person reading it is on a phone.
 */
import { execFile, spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { Express, Request, Response } from "express";

import { authenticateAgent } from "./agentAuth.js";
import { EcosystemLoop } from "../ecosystem/EcosystemLoop.js";
import { EcosystemStore } from "../ecosystem/EcosystemStore.js";
import { GitHubClient } from "../ecosystem/GitHubClient.js";
import { Logger } from "../utils/Logger.js";
import { ResearchEngine } from "../research/ResearchEngine.js";
import { ResearchStore } from "../research/ResearchStore.js";

const run = promisify(execFile);

export type ServiceState = "up" | "down" | "degraded" | "unknown";

export interface ServiceReport {
  id: string;
  label: string;
  state: ServiceState;
  detail: string;
  canStart: boolean;
}

export interface Problem {
  title: string;
  detail: string;
  fix: string;
  severity: "warning" | "error";
}

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434";
const startedAt = Date.now();

/** Where Ollama is installed, for starting it when it is not running. */
const ollamaBinary = (): string | null => {
  const candidates = [
    process.env.OLLAMA_PATH,
    path.join(os.homedir(), "AppData", "Local", "Programs", "Ollama", "ollama.exe"),
    "C:/Program Files/Ollama/ollama.exe",
    "/usr/local/bin/ollama",
    "/usr/bin/ollama"
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

const checkOllama = async (): Promise<{ state: ServiceState; detail: string; models: string[] }> => {
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) return { state: "degraded", detail: `Answered ${response.status}`, models: [] };
    const body = (await response.json()) as { models?: Array<{ name: string }> };
    const models = (body.models ?? []).map((model) => model.name);
    return {
      state: models.length > 0 ? "up" : "degraded",
      detail: models.length > 0 ? `${models.length} model(s) available` : "Running, but no models are installed",
      models
    };
  } catch {
    return { state: "down", detail: "Not reachable", models: [] };
  }
};

const gpuSummary = async (): Promise<string> => {
  try {
    const { stdout } = await run(
      "nvidia-smi",
      ["--query-gpu=name,memory.used,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 5000, windowsHide: true }
    );
    const [name, used, total] = stdout.trim().split(",").map((part) => part.trim());
    return `${name}: ${used} / ${total} MB VRAM in use`;
  } catch {
    return "No NVIDIA GPU detected (the model will run on CPU)";
  }
};

const diskSummary = (): { freeGb: number; detail: string } => {
  try {
    const stats = fs.statfsSync(process.cwd());
    const freeGb = (stats.bavail * stats.bsize) / 1024 ** 3;
    return { freeGb, detail: `${freeGb.toFixed(1)} GB free` };
  } catch {
    return { freeGb: Number.POSITIVE_INFINITY, detail: "unknown" };
  }
};

const researchSummary = () => {
  const topics = ResearchStore.listTopics();
  const running = topics.filter((topic) => topic.status === "running");
  const findings = topics.reduce((total, topic) => total + topic.findingCount, 0);
  return { topics, running: running.length, findings };
};

const collectStatus = async () => {
  const ollama = await checkOllama();
  const research = researchSummary();
  const ecosystem = EcosystemLoop.status();
  const counts = EcosystemStore.counts();
  const disk = diskSummary();

  const services: ServiceReport[] = [
    {
      id: "api",
      label: "Agent Builder API",
      state: "up",
      detail: `Running for ${Math.round((Date.now() - startedAt) / 60000)} min`,
      canStart: false
    },
    {
      id: "ollama",
      label: "Local model (Ollama)",
      state: ollama.state,
      detail: ollama.detail,
      canStart: ollama.state !== "up" && Boolean(ollamaBinary())
    },
    {
      id: "research",
      label: "Continuous research",
      state: research.topics.length === 0 ? "unknown" : research.running > 0 ? "up" : "down",
      detail:
        research.topics.length === 0
          ? "No topics yet"
          : `${research.running} of ${research.topics.length} topic(s) running, ${research.findings} findings`,
      canStart: research.topics.length > 0 && research.running < research.topics.length
    },
    {
      id: "ecosystem",
      label: "Project watch",
      state: counts.projects > 0 ? "up" : "unknown",
      detail:
        counts.projects > 0
          ? `${counts.projects} project(s), ${counts.openIssues} open issue(s)${ecosystem.lastSweepAt ? `, last swept ${ecosystem.lastSweepAt}` : ""}`
          : "No projects scanned yet",
      canStart: true
    }
  ];

  return {
    services,
    gpu: await gpuSummary(),
    disk: disk.detail,
    host: os.hostname(),
    counts,
    research: { running: research.running, topics: research.topics.length, findings: research.findings },
    healthy: services.every((service) => service.state === "up" || service.state === "unknown")
  };
};

const findProblems = async (): Promise<Problem[]> => {
  const problems: Problem[] = [];
  const ollama = await checkOllama();

  if (ollama.state === "down") {
    problems.push({
      severity: "error",
      title: "The local model is not running",
      detail: "Nothing can be built, repaired or researched without it.",
      fix: ollamaBinary() ? 'Press "Switch everything on", or run: ollama serve' : "Install Ollama from ollama.com, then run: ollama serve"
    });
  } else if (ollama.models.length === 0) {
    problems.push({
      severity: "error",
      title: "Ollama has no models installed",
      detail: "It is running but has nothing to think with.",
      fix: "Run: ollama pull qwen2.5-coder:7b"
    });
  }

  const research = researchSummary();
  if (research.topics.length > 0 && research.running === 0) {
    problems.push({
      severity: "warning",
      title: "Research is paused",
      detail: `${research.topics.length} topic(s) exist but none are running.`,
      fix: 'Press "Switch everything on" to resume them.'
    });
  }

  const counts = EcosystemStore.counts();
  if (counts.projects === 0) {
    problems.push({
      severity: "warning",
      title: "No projects have been scanned",
      detail: "The app does not know what is on this machine yet.",
      fix: 'Press "Switch everything on", which runs a scan.'
    });
  }
  if (counts.errors > 0) {
    problems.push({
      severity: "warning",
      title: `${counts.errors} project(s) have errors`,
      detail: "Something reported a failure that has not been resolved.",
      fix: "Open Issues and run Diagnose, then Repair."
    });
  }

  const disk = diskSummary();
  if (disk.freeGb < 5) {
    problems.push({
      severity: "error",
      title: "The disk is nearly full",
      detail: `${disk.detail} — builds install dependencies and will fail.`,
      fix: "Free up space on this drive."
    });
  }

  if (!(await GitHubClient.isAvailable())) {
    problems.push({
      severity: "warning",
      title: "GitHub is not connected",
      detail: "Issues, pull requests and CI status will be missing from briefings.",
      fix: "Run: gh auth login (or set GITHUB_TOKEN)."
    });
  }

  return problems;
};

export const registerServiceRoutes = (app: Express) => {
  app.get("/api/services/status", authenticateAgent("read"), async (_req: Request, res: Response) => {
    try {
      res.json(await collectStatus());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  /** The power button: bring up whatever is not already running. */
  app.post("/api/services/start", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const steps: Array<{ service: string; action: string; ok: boolean }> = [];

    const ollama = await checkOllama();
    if (ollama.state === "down") {
      const binary = ollamaBinary();
      if (binary) {
        try {
          // Detached: it must outlive this request, and its output is its own business.
          const child = spawn(binary, ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
          child.unref();
          // Wait for it to actually answer rather than assuming. A cold start
          // takes a few seconds, and reporting failure before then made the
          // step list contradict the service list on the same screen.
          let now = await checkOllama();
          for (let waited = 0; waited < 15000 && now.state !== "up"; waited += 750) {
            await new Promise((resolve) => setTimeout(resolve, 750));
            now = await checkOllama();
          }
          steps.push({
            service: "ollama",
            action: now.state === "up" ? `started — ${now.detail}` : "started, but it is not answering yet",
            ok: now.state === "up"
          });
        } catch (error) {
          steps.push({ service: "ollama", action: `could not start: ${error instanceof Error ? error.message : String(error)}`, ok: false });
        }
      } else {
        steps.push({ service: "ollama", action: "not installed on this machine", ok: false });
      }
    } else {
      steps.push({ service: "ollama", action: "already running", ok: true });
    }

    try {
      const resumed = ResearchEngine.getInstance().resumeAll();
      steps.push({ service: "research", action: `${resumed} topic(s) resumed`, ok: true });
    } catch (error) {
      steps.push({ service: "research", action: `failed: ${error instanceof Error ? error.message : String(error)}`, ok: false });
    }

    // The sweep is slow; kick it off and report the state as it stands now.
    void EcosystemLoop.sweepNow();
    steps.push({ service: "ecosystem", action: "project scan started", ok: true });

    Logger.log("Services started from the remote app", { steps });
    res.json({ steps, status: await collectStatus() });
  });

  app.get("/api/services/troubleshoot", authenticateAgent("read"), async (_req: Request, res: Response) => {
    const problems = await findProblems();
    res.json({ problems, healthy: problems.length === 0, checkedAt: new Date().toISOString() });
  });

  /** A single feed of what has been happening, newest first. */
  app.get("/api/services/feed", authenticateAgent("read"), (req: Request, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 40, 200);
    const events = EcosystemStore.listEvents(limit).map((event) => ({
      id: `eco-${event.id}`,
      at: event.createdAt,
      kind: event.kind,
      message: event.message,
      projectId: event.projectId
    }));

    const research = ResearchStore.listTopics().flatMap((topic) =>
      ResearchStore.recentActivity(topic.id, 10).map((entry) => ({
        id: `res-${entry.id}`,
        at: entry.createdAt,
        kind: entry.kind,
        message: `${topic.title}: ${entry.message}`,
        projectId: null as string | null
      }))
    );

    const feed = [...events, ...research]
      .sort((a, b) => (a.at < b.at ? 1 : -1))
      .slice(0, limit);

    res.json({ feed });
  });

  Logger.log("Service control routes registered");
};
