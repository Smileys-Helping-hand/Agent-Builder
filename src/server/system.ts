/**
 * The PC as one system: what it is doing, its storage, and the resource modes.
 *
 *   GET  /api/system/status                 mode, profiles, workloads, the watcher, the last measurements (read)
 *   GET  /api/system/telemetry[?fresh=1]     a measurement, with plain findings (read)
 *   GET  /api/system/why                     "why is my computer slow?" — findings with culprits (read)
 *   GET  /api/system/storage                 the storage inventory and its recommendations (read)
 *   POST /api/system/storage/refresh         take the inventory again (execute; 202, runs in the background)
 *   POST /api/system/storage/measure {id}    measure one known location's size (execute; 202)
 *   POST /api/system/storage/benchmark {letter}  a drive's write speed (execute; refused while it is busy)
 *   POST /api/system/mode {profile}          switch a profile on: gaming-balanced, gaming-max, rendering, quiet, ai-research, development (execute; 202, ?wait=1)
 *   POST /api/system/resume                  Resume All / normal operation (execute; 202, ?wait=1)
 *   POST /api/system/hold {on}               stop new background jobs until further notice, or release that (execute)
 *   POST /api/system/resume/retry {id}       retry one failed resume step (execute)
 *   GET  /api/system/gaming                  game detection: settings and what it sees (read)
 *   PUT  /api/system/gaming                  change its settings (execute)
 *   POST /api/system/gaming/answer {yes}     answer its question (switch on / resume, or dismiss) (execute)
 *   POST /api/system/model/unload            drop the AI model out of video memory now (execute)
 *   GET  /api/system/audit                   who switched what, when (read)
 *   GET  /api/system/backlog                 the implementation backlog (docs/IMPLEMENTATION_BACKLOG.md) (read)
 *   GET  /api/system/ai-policy               where AI runs: local only, research online or offline (read)
 *
 * All of it is behind the agent key or a signed-in role, on the builder's own
 * address; nothing here runs arbitrary commands: every action is one of the
 * workloads' own named operations.
 */
import fs from "fs";
import path from "path";
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { GameMode } from "../utils/GameMode.js";
import { checkOllama } from "../utils/Ollama.js";
import { GameWatcher, writeSettings, type GamingSettings } from "../system/GameWatcher.js";
import { NORMAL, PROFILES, audit, freed, readAudit, recoverOnStart, resumeAll, retryStep, setHold, startSwitch, switchState } from "../system/ResourceModes.js";
import { StorageInventory, recommend, rolesByLetter, tierLabel } from "../system/StorageInventory.js";
import { Telemetry, explain } from "../system/Telemetry.js";
import { WORKLOADS, PROTECTED, unloadModels } from "../system/Workloads.js";
import { aiPolicy } from "../tools/LocalOnly.js";

const actorOf = (req: Request): string => {
  const request = req as AgentRequest;
  return request.actor ?? (request.agent ? `agent key "${request.agent.name}"` : "the app");
};

const fail = (res: Response, error: unknown) => res.status((error as { status?: number }).status ?? 500).json({ error: error instanceof Error ? error.message : String(error) });

let storageJob: { what: string; since: string } | null = null;
let storageError: string | null = null;

const runStorageJob = (what: string, job: () => Promise<unknown>) => {
  if (storageJob) throw Object.assign(new Error(`Already busy: ${storageJob.what}.`), { status: 409 });
  storageJob = { what, since: new Date().toISOString() };
  storageError = null;
  void job()
    .catch((error) => {
      storageError = error instanceof Error ? error.message : String(error);
    })
    .finally(() => {
      storageJob = null;
    });
};

/** The status everything else shows: one object for the app and for Jarvis. */
export const systemStatus = async (options: { workloads?: boolean } = {}) => {
  const mode = GameMode.read();
  const last = Telemetry.last();
  const workloads = options.workloads
    ? await Promise.all(
        WORKLOADS.map(async (w) => {
          const seen = await w.detect().catch((error: Error) => ({ running: false, detail: `could not tell: ${error.message}` }));
          return { id: w.id, label: w.label, kind: w.kind, ...seen };
        })
      )
    : null;
  return {
    mode: { ...mode, freed: mode.report ? freed(mode.report) : "" },
    ...switchState(),
    profiles: [...PROFILES.map(({ id, label, about, gpuToUser, hold }) => ({ id, label, about, gpuToUser, hold })), NORMAL],
    protected: PROTECTED,
    workloads,
    watcher: GameWatcher.state(),
    telemetry: last,
    findings: last ? explain(last, { roles: rolesByLetter(StorageInventory.cached()) }) : [],
    modelServer: (await checkOllama()).state,
    ai: aiPolicy()
  };
};

export const registerSystemRoutes = (app: Express) => {
  // Measurements for the scheduler; game detection; a resume a restart cut short.
  Telemetry.startSampler();
  const switcher = (to: string, by: string) => startSwitch(to, by);
  if (!StorageInventory.cached()) void StorageInventory.take().then(() => GameWatcher.restart()).catch(() => undefined);
  GameWatcher.start(switcher);
  setTimeout(recoverOnStart, 30_000).unref?.();

  app.get("/api/system/status", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json(await systemStatus({ workloads: req.query.workloads !== "0" }));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/system/telemetry", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      const t = await Telemetry.sample(req.query.fresh === "1" ? 0 : 15_000);
      res.json({ telemetry: t, findings: explain(t, { roles: rolesByLetter(StorageInventory.cached()) }) });
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/system/why", authenticateAgent("read"), async (_req: Request, res: Response) => {
    try {
      const t = await Telemetry.sample(15_000);
      const findings = explain(t, { roles: rolesByLetter(StorageInventory.cached()) });
      const answer = findings.map((f) => `${f.text}${f.culprits.length ? ` Most of it: ${f.culprits.join(", ")}.` : ""}`).join("\n");
      res.json({ answer, findings, measuredAt: t.at });
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/system/storage", authenticateAgent("read"), async (_req: Request, res: Response) => {
    const inventory = StorageInventory.cached();
    if (!inventory && !storageJob) runStorageJob("taking the storage inventory", () => StorageInventory.take());
    res.json({
      inventory,
      recommendations: inventory ? recommend(inventory) : [],
      tiers: inventory ? Object.fromEntries(inventory.volumes.map((v) => [v.letter, tierLabel(v.tier)])) : {},
      job: storageJob,
      error: storageError
    });
  });

  app.post("/api/system/storage/refresh", authenticateAgent("execute"), (_req: Request, res: Response) => {
    try {
      runStorageJob("taking the storage inventory", async () => {
        await StorageInventory.take();
        GameWatcher.restart();
      });
      res.status(202).json({ job: storageJob });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/system/storage/measure", authenticateAgent("execute"), (req: Request, res: Response) => {
    const id = String((req.body as { id?: unknown })?.id ?? "");
    if (!/^[a-z-]{2,30}$/.test(id)) return res.status(400).json({ error: "Say which location (its id)." });
    try {
      runStorageJob(`measuring ${id}`, () => StorageInventory.measure(id));
      res.status(202).json({ job: storageJob });
    } catch (error) {
      fail(res, error);
    }
  });

  app.post("/api/system/storage/benchmark", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      const letter = String((req.body as { letter?: unknown })?.letter ?? "");
      const t = await Telemetry.sample(15_000);
      const disk = t.disks.find((d) => d.letters.includes(letter.toUpperCase()));
      const result = await StorageInventory.benchmark(letter, disk ? disk.idlePercent : null);
      res.json(result);
    } catch (error) {
      fail(res, error);
    }
  });

  const respondSwitch = async (req: Request, res: Response, to: string) => {
    try {
      const done = startSwitch(to, actorOf(req));
      if (req.query.wait === "1") return res.json(done ? await done : GameMode.read());
      done?.catch(() => undefined);
      return res.status(202).json({ ...GameMode.read(), ...switchState() });
    } catch (error) {
      return fail(res, error);
    }
  };

  app.post("/api/system/mode", authenticateAgent("execute"), (req: Request, res: Response) => {
    const to = String((req.body as { profile?: unknown })?.profile ?? "gaming-balanced");
    GameWatcher.dismiss();
    void respondSwitch(req, res, to);
  });

  app.post("/api/system/resume", authenticateAgent("execute"), (req: Request, res: Response) => {
    GameWatcher.dismiss();
    void respondSwitch(req, res, "normal");
  });

  app.post("/api/system/hold", authenticateAgent("execute"), (req: Request, res: Response) => {
    const on = (req.body as { on?: unknown })?.on;
    if (typeof on !== "boolean") return res.status(400).json({ error: 'Send { "on": true } or { "on": false }.' });
    res.json(setHold(on, actorOf(req)));
  });

  app.post("/api/system/resume/retry", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      res.json(await retryStep(String((req.body as { id?: unknown })?.id ?? ""), actorOf(req)));
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/system/gaming", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(GameWatcher.state());
  });

  app.put("/api/system/gaming", authenticateAgent("execute"), (req: Request, res: Response) => {
    const settings = writeSettings((req.body ?? {}) as Partial<GamingSettings>);
    GameWatcher.restart();
    res.json({ ...GameWatcher.state(), settings });
  });

  app.post("/api/system/gaming/answer", authenticateAgent("execute"), (req: Request, res: Response) => {
    const prompt = GameWatcher.state().prompt;
    const yes = (req.body as { yes?: unknown })?.yes === true;
    GameWatcher.dismiss();
    if (!prompt || !yes) return res.json({ dismissed: true });
    const settings = GameWatcher.state().settings;
    void respondSwitch(req, res, prompt.kind === "activate" ? settings.profile : "normal");
  });

  app.post("/api/system/model/unload", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      const unloaded = await unloadModels();
      audit({ actor: actorOf(req), action: "unload the model", detail: unloaded.join(", ") || "nothing was loaded", ok: true });
      res.json({ unloaded, detail: unloaded.length ? `Unloaded ${unloaded.join(", ")}; it loads again when next asked.` : "No model was loaded." });
    } catch (error) {
      fail(res, error);
    }
  });

  app.get("/api/system/audit", authenticateAgent("read"), (req: Request, res: Response) => {
    res.json({ entries: readAudit(Math.min(500, Number(req.query.limit ?? 100) || 100)) });
  });

  app.get("/api/system/backlog", authenticateAgent("read"), (_req: Request, res: Response) => {
    try {
      res.type("text/markdown").send(fs.readFileSync(path.resolve("docs/IMPLEMENTATION_BACKLOG.md"), "utf8"));
    } catch {
      res.status(404).json({ error: "No backlog file." });
    }
  });

  app.get("/api/system/ai-policy", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json(aiPolicy());
  });
};

export { resumeAll };
