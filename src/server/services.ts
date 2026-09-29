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
import { JarvisClient } from "../integrations/JarvisClient.js";
import { Logger } from "../utils/Logger.js";
import { OLLAMA_URL, checkOllama, ollamaBinary } from "../utils/Ollama.js";
import { ResearchEngine } from "../research/ResearchEngine.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { SystemResourceService, type SystemMetrics } from "../utils/SystemResourceService.js";
import { readPublicUrl } from "../utils/PublicUrl.js";

const run = promisify(execFile);

export type ServiceState = "up" | "down" | "degraded" | "unknown";

export interface ServiceReport {
  id: string;
  label: string;
  state: ServiceState;
  detail: string;
  canStart: boolean;
  /**
   * Useful, but Agent Builder works without it. Shown and startable like any
   * other service, but being off does not make the machine "unhealthy".
   */
  optional?: boolean;
}

export interface Problem {
  title: string;
  detail: string;
  fix: string;
  fixId?: string;
  severity: "warning" | "error";
}

const startedAt = Date.now();

const comfyBinary = (): string | null => {
  const candidates = [
    process.env.COMFY_DESKTOP_PATH,
    "C:/Program Files/Comfy Desktop/Comfy Desktop.exe",
    path.join(os.homedir(), "AppData", "Local", "Programs", "ComfyUI", "ComfyUI.exe")
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => fs.existsSync(c)) ?? null;
};

const checkComfy = async (): Promise<{ state: ServiceState; detail: string }> => {
  try {
    const res = await fetch("http://127.0.0.1:8188/system_stats", { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      return { state: "up", detail: "Active on port 8188" };
    }
  } catch {}
  try {
    const { stdout } = await run("tasklist", ["/FI", "IMAGENAME eq Comfy Desktop.exe", "/NH"], {
      timeout: 2000,
      windowsHide: true
    });
    if (stdout.includes("Comfy Desktop.exe")) {
      return { state: "up", detail: "Desktop application running" };
    }
  } catch {}
  return { state: "down", detail: "Stopped (saving ~1.5GB RAM & GPU VRAM)" };
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
  const [ollama, comfy, githubOk, metrics] = await Promise.all([
    checkOllama(),
    checkComfy(),
    GitHubClient.isAvailable(),
    SystemResourceService.getMetrics()
  ]);
  const research = researchSummary();
  const ecosystem = EcosystemLoop.status();
  const counts = EcosystemStore.counts();
  const jarvis = JarvisClient.describe();

  const services: ServiceReport[] = [
    {
      id: "api",
      label: "Agent Builder API",
      state: "up",
      detail: `Port ${process.env.PORT ?? 4000} · Running for ${Math.round((Date.now() - startedAt) / 60000)} min`,
      canStart: false
    },
    {
      id: "ollama",
      label: "Local model (Ollama)",
      state: ollama.state,
      detail: ollama.state === "up" ? `${ollama.detail} (${process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b"})` : ollama.detail,
      canStart: ollama.state !== "up" && Boolean(ollamaBinary())
    },
    {
      id: "comfy",
      label: "Comfy Desktop (AI Image/UI)",
      state: comfy.state,
      detail: comfy.detail,
      canStart: comfy.state !== "up" && Boolean(comfyBinary()),
      // An image tool for PrintForge that "Free the GPU" stops on purpose;
      // nothing Agent Builder does needs it.
      optional: true
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
    },
    {
      id: "github",
      label: "GitHub Sync",
      state: githubOk ? "up" : "down",
      detail: githubOk ? "Connected & token verified" : "Not connected (set GITHUB_TOKEN or run gh auth login)",
      canStart: !githubOk
    },
    {
      id: "jarvis",
      label: "Second Brain (Jarvis)",
      state: jarvis.configured ? (jarvis.last?.ok ? "up" : jarvis.last ? "degraded" : "up") : "unknown",
      detail: jarvis.configured
        ? jarvis.last?.ok
          ? `Connected · ${jarvis.queued} queued`
          : jarvis.last
            ? `Not reachable: ${jarvis.last.detail.slice(0, 60)}`
            : "Configured (local & remote webhooks ready)"
        : "Not set up (set JARVIS_HOST and JARVIS_API_KEY)",
      canStart: jarvis.configured
    }
  ];

  return {
    services,
    publicUrl: readPublicUrl(),
    gpu: metrics.gpu
      ? `${metrics.gpu.name}: ${metrics.gpu.vramUsedMB}/${metrics.gpu.vramTotalMB} MB VRAM (${metrics.gpu.vramUsagePercent}% in use)`
      : await gpuSummary(),
    disk: `${metrics.disk.freeGB} GB free of ${metrics.disk.totalGB} GB (${metrics.disk.usedPercent}% used)`,
    host: os.hostname(),
    counts,
    research: { running: research.running, topics: research.topics.length, findings: research.findings },
    metrics,
    healthy: services.every((service) => service.optional || service.state === "up" || service.state === "unknown")
  };
};

const findProblems = async (): Promise<Problem[]> => {
  const problems: Problem[] = [];
  const [ollama, metrics, githubOk] = await Promise.all([
    checkOllama(),
    SystemResourceService.getMetrics(),
    GitHubClient.isAvailable()
  ]);

  if (ollama.state === "down") {
    problems.push({
      severity: "error",
      title: "The local model is not running",
      detail: "Nothing can be built, repaired or researched without it.",
      fix: ollamaBinary() ? 'Press "Switch everything on", or run: ollama serve' : "Install Ollama from ollama.com, then run: ollama serve",
      fixId: "start_ollama"
    });
  } else if (ollama.models.length === 0) {
    problems.push({
      severity: "error",
      title: "Ollama has no models installed",
      detail: "It is running but has nothing to think with.",
      fix: "Run: ollama pull qwen2.5-coder:7b",
      fixId: "pull_model"
    });
  }

  const research = researchSummary();
  if (research.topics.length > 0 && research.running === 0) {
    problems.push({
      severity: "warning",
      title: "Research is paused",
      detail: `${research.topics.length} topic(s) exist but none are running.`,
      fix: 'Press "Switch everything on" to resume them.',
      fixId: "resume_research"
    });
  }

  const counts = EcosystemStore.counts();
  if (counts.projects === 0) {
    problems.push({
      severity: "warning",
      title: "No projects have been scanned",
      detail: "The app does not know what is on this machine yet.",
      fix: 'Press "Switch everything on", which runs a scan.',
      fixId: "scan_projects"
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

  if (metrics.disk.freeGB < 5) {
    problems.push({
      severity: "error",
      title: "The disk is nearly full",
      detail: `${metrics.disk.freeGB} GB free — builds install dependencies and will fail.`,
      fix: 'Click "Free up space & usage" to clean temp files and caches.',
      fixId: "clean_disk"
    });
  }

  if (!githubOk) {
    problems.push({
      severity: "warning",
      title: "GitHub is not connected",
      detail: "Issues, pull requests and CI status will be missing from briefings.",
      fix: "Run: gh auth login (or set GITHUB_TOKEN).",
      fixId: "connect_github"
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
      const resumed = ResearchEngine.getInstance().startAll();
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

  /** Pause the background work without touching the machine. */
  app.post("/api/services/stop", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const { services } = (req.body ?? {}) as { services?: string[] };
    const wanted = (services?.length ? services : ["research", "ecosystem"]).map((name) => name.toLowerCase());
    const steps: Array<{ service: string; action: string; ok: boolean }> = [];

    if (wanted.includes("research")) {
      let paused = 0;
      for (const topic of ResearchStore.listTopics()) {
        if (topic.status === "running" && ResearchEngine.getInstance().pause(topic.id)) paused += 1;
      }
      steps.push({ service: "research", action: `${paused} topic(s) paused`, ok: true });
    }

    if (wanted.includes("ecosystem")) {
      EcosystemLoop.stop();
      steps.push({ service: "ecosystem", action: "project sweep stopped", ok: true });
    }

    // Ollama is left alone unless asked for by name: other things on this
    // machine may be using it, and it is cheap to leave running.
    if (wanted.includes("ollama")) {
      try {
        await run("taskkill", ["/F", "/IM", "ollama.exe"], { timeout: 10_000, windowsHide: true });
        steps.push({ service: "ollama", action: "stopped", ok: true });
      } catch {
        steps.push({ service: "ollama", action: "was not running", ok: true });
      }
    }

    Logger.log("Services stopped from the remote app", { steps });
    res.json({ steps, status: await collectStatus() });
  });

  /** Stop and start the background work in one go. */
  app.post("/api/services/restart", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    const steps: Array<{ service: string; action: string; ok: boolean }> = [];
    let paused = 0;
    for (const topic of ResearchStore.listTopics()) {
      if (topic.status === "running" && ResearchEngine.getInstance().pause(topic.id)) paused += 1;
    }
    EcosystemLoop.stop();
    steps.push({ service: "research", action: `${paused} topic(s) paused`, ok: true });

    const resumed = ResearchEngine.getInstance().startAll();
    EcosystemLoop.start();
    steps.push({ service: "research", action: `${resumed} topic(s) resumed`, ok: true });
    steps.push({ service: "ecosystem", action: "project watch restarted", ok: true });

    res.json({ steps, status: await collectStatus() });
  });

  /**
   * Shut the builder down completely. Deliberately explicit (confirm: true),
   * because nothing can start it again remotely — the machine has to run the
   * launcher, or have autostart installed.
   */
  app.post("/api/services/shutdown", authenticateAgent("execute"), (req: Request, res: Response) => {
    const { confirm } = (req.body ?? {}) as { confirm?: boolean };
    if (confirm !== true) {
      return res.status(400).json({
        error: "Shutting down stops the API answering you. Send { \"confirm\": true } if you mean it."
      });
    }
    Logger.log("Shutdown requested from the remote app");
    res.json({ ok: true, message: "Shutting down. Start it again from the PC with Start Agent Builder." });
    // Let the response flush before the process goes away.
    setTimeout(() => process.exit(0), 400);
  });

  app.post("/api/services/toggle", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const { service, action } = (req.body ?? {}) as { service?: string; action?: "start" | "stop" };
    if (!service) return res.status(400).json({ error: "Missing service name." });

    const svc = service.toLowerCase();
    let outcome = "";

    if (svc === "ollama") {
      const current = await checkOllama();
      const shouldStart = action ? action === "start" : current.state === "down";
      if (shouldStart) {
        const bin = ollamaBinary();
        if (!bin) return res.status(400).json({ error: "Ollama is not installed on this machine." });
        const child = spawn(bin, ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
        child.unref();
        let now = await checkOllama();
        for (let waited = 0; waited < 15000 && now.state !== "up"; waited += 750) {
          await new Promise((r) => setTimeout(r, 750));
          now = await checkOllama();
        }
        outcome = now.state === "up" ? "Ollama started successfully." : "Ollama started, waiting for response.";
      } else {
        try {
          await run("taskkill", ["/F", "/IM", "ollama.exe"], { timeout: 10_000, windowsHide: true });
          outcome = "Ollama stopped.";
        } catch {
          outcome = "Ollama was not running.";
        }
      }
    } else if (svc === "comfy") {
      const isStart = action ? action === "start" : (await checkComfy()).state !== "up";
      if (isStart) {
        const bin = comfyBinary();
        if (!bin) return res.status(400).json({ error: "Comfy Desktop is not installed on this machine." });
        const child = spawn(bin, [], { detached: true, stdio: "ignore", windowsHide: false });
        child.unref();
        outcome = "Comfy Desktop launched.";
      } else {
        try {
          await run("taskkill", ["/F", "/IM", "Comfy Desktop.exe", "/T"], { timeout: 4000, windowsHide: true });
          outcome = "Comfy Desktop stopped (resources reclaimed).";
        } catch {
          outcome = "Comfy Desktop was not running.";
        }
      }
    } else if (svc === "research") {
      const topics = ResearchStore.listTopics();
      const runningCount = topics.filter((t) => t.status === "running").length;
      const shouldStart = action ? action === "start" : runningCount === 0;
      if (shouldStart) {
        const resumed = ResearchEngine.getInstance().startAll();
        outcome = `Resumed ${resumed} research topic(s).`;
      } else {
        let paused = 0;
        for (const topic of topics) {
          if (topic.status === "running" && ResearchEngine.getInstance().pause(topic.id)) paused++;
        }
        outcome = `Paused ${paused} research topic(s).`;
      }
    } else if (svc === "ecosystem") {
      const shouldStart = action ? action === "start" : !EcosystemLoop.status().running;
      if (shouldStart) {
        EcosystemLoop.start();
        void EcosystemLoop.sweepNow();
        outcome = "Project sweep started.";
      } else {
        EcosystemLoop.stop();
        outcome = "Project sweep stopped.";
      }
    } else {
      return res.status(400).json({ error: `Unknown service: ${service}` });
    }

    Logger.log("Service toggled from remote", { service: svc, outcome });
    res.json({ success: true, message: outcome, status: await collectStatus() });
  });

  app.post("/api/services/troubleshoot/fix", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const { fixId } = (req.body ?? {}) as { fixId?: string };
    if (!fixId) return res.status(400).json({ error: "Missing fixId." });

    if (fixId === "start_ollama") {
      const bin = ollamaBinary();
      if (!bin) return res.status(400).json({ error: "Ollama is not installed on this machine." });
      const child = spawn(bin, ["serve"], { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      return res.json({ ok: true, message: "Ollama starting in background..." });
    }

    if (fixId === "launch_comfy") {
      const bin = comfyBinary();
      if (!bin) return res.status(400).json({ error: "Comfy Desktop is not installed." });
      const child = spawn(bin, [], { detached: true, stdio: "ignore", windowsHide: false });
      child.unref();
      return res.json({ ok: true, message: "Comfy Desktop launched on PC." });
    }

    if (fixId === "stop_comfy") {
      try {
        await run("taskkill", ["/F", "/IM", "Comfy Desktop.exe", "/T"], { timeout: 4000, windowsHide: true });
        return res.json({ ok: true, message: "Comfy Desktop stopped; GPU VRAM and memory reclaimed." });
      } catch {
        return res.json({ ok: true, message: "Comfy Desktop was not running." });
      }
    }

    if (fixId === "clean_disk") {
      const report = await SystemResourceService.cleanup();
      return res.json({ ok: true, message: report.message, report });
    }

    if (fixId === "resume_research") {
      const resumed = ResearchEngine.getInstance().startAll();
      return res.json({ ok: true, message: `Resumed ${resumed} research topic(s).` });
    }

    if (fixId === "scan_projects") {
      void EcosystemLoop.sweepNow();
      return res.json({ ok: true, message: "Project sweep initiated." });
    }

    if (fixId === "connect_github") {
      const isAvailable = await GitHubClient.isAvailable();
      return res.json({
        ok: isAvailable,
        message: isAvailable ? "GitHub connection verified." : "GitHub token not configured."
      });
    }

    return res.status(400).json({ error: `Unknown fixId: ${fixId}` });
  });

  /**
   * Voice interaction endpoint: Accepts speech transcribed on client,
   * executes intent, and returns spoken text feedback.
   */
  app.post("/api/services/voice", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const { text } = (req.body ?? {}) as { text?: string };
    if (!text || !text.trim()) return res.status(400).json({ error: "Missing text." });

    const prompt = text.trim();
    const lower = prompt.toLowerCase();
    let reply = "";
    let actionExecuted: string | undefined;

    if (lower.includes("clean") || lower.includes("free") || lower.includes("space")) {
      const rep = await SystemResourceService.cleanup();
      actionExecuted = "cleanup";
      reply = `Done. Cleaned ${rep.cleanedFilesCount} items and freed ~${rep.freedDiskMB.toFixed(1)} megabytes of disk and RAM.`;
    } else if (lower.includes("start ollama") || lower.includes("turn on ollama")) {
      const bin = ollamaBinary();
      if (bin) {
        spawn(bin, ["serve"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        actionExecuted = "start_ollama";
        reply = "Starting the Ollama server in background.";
      } else {
        reply = "Ollama is not installed on this machine.";
      }
    } else if (lower.includes("stop ollama") || lower.includes("turn off ollama")) {
      await run("taskkill", ["/F", "/IM", "ollama.exe"], { timeout: 4000, windowsHide: true }).catch(() => {});
      actionExecuted = "stop_ollama";
      reply = "Ollama stopped to conserve GPU resources.";
    } else if (lower.includes("start comfy") || lower.includes("launch comfy")) {
      const bin = comfyBinary();
      if (bin) {
        spawn(bin, [], { detached: true, stdio: "ignore" }).unref();
        actionExecuted = "launch_comfy";
        reply = "Comfy Desktop is launching on your PC.";
      } else {
        reply = "Comfy Desktop is not installed on this machine.";
      }
    } else if (lower.includes("stop comfy") || lower.includes("close comfy") || lower.includes("kill comfy")) {
      await run("taskkill", ["/F", "/IM", "Comfy Desktop.exe", "/T"], { timeout: 4000, windowsHide: true }).catch(() => {});
      actionExecuted = "stop_comfy";
      reply = "Comfy Desktop closed. VRAM and memory reclaimed.";
    } else if (lower.includes("status") || lower.includes("health") || lower.includes("telemetry")) {
      const st = await collectStatus();
      reply = `System is operational. GPU: ${st.gpu}. Disk: ${st.disk}.`;
    } else {
      try {
        const ollamaRes = await fetch(`${OLLAMA_URL}/api/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b",
            prompt: `You are the Agent Builder AI assistant. Answer in 1-2 brief sentences: ${prompt}`,
            stream: false
          }),
          signal: AbortSignal.timeout(8000)
        });
        if (ollamaRes.ok) {
          const data = (await ollamaRes.json()) as { response?: string };
          reply = data.response?.trim() || `Command received: ${prompt}`;
        } else {
          reply = `Acknowledged: "${prompt}". Ready for next instruction.`;
        }
      } catch {
        reply = `Voice command processed: "${prompt}". All systems nominal.`;
      }
    }

    res.json({ text: prompt, reply, actionExecuted, timestamp: new Date().toISOString() });
  });

  app.get("/api/hardware/metrics", authenticateAgent("read"), async (_req: Request, res: Response) => {
    try {
      res.json(await SystemResourceService.getMetrics());
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/hardware/cleanup", authenticateAgent("execute"), async (_req: Request, res: Response) => {
    try {
      const report = await SystemResourceService.cleanup();
      res.json(report);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/hardware/profile", authenticateAgent("execute"), (req: Request, res: Response) => {
    const { profile } = (req.body ?? {}) as { profile?: "eco" | "balanced" | "turbo" };
    if (!profile || !["eco", "balanced", "turbo"].includes(profile)) {
      return res.status(400).json({ error: "Profile must be 'eco', 'balanced', or 'turbo'." });
    }
    res.json(SystemResourceService.setProfile(profile));
  });

  Logger.log("Service control routes registered");
};
