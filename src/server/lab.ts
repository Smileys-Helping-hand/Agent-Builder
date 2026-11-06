/**
 * The Virtual Test Lab's API, and the live console's sockets.
 *
 *   GET    /api/lab                         backend, limits, VMs, ISOs, profiles, recent runs
 *   POST   /api/lab/vms                     create { name, iso?, cpus?, memoryMb?, diskGb?, network?, purpose?, projectId? }
 *   GET    /api/lab/vms/:id                 status: record, host CPU and memory, disk use
 *   PATCH  /api/lab/vms/:id                 hardware, ISO, network (while stopped)
 *   DELETE /api/lab/vms/:id
 *   POST   /api/lab/vms/:id/start|stop|pause|resume|restart|clone
 *   POST   /api/lab/vms/:id/snapshots       { name, note? }
 *   POST   /api/lab/vms/:id/snapshots/:name/restore
 *   DELETE /api/lab/vms/:id/snapshots/:name
 *   POST   /api/lab/vms/:id/keys            { text } | { combos } on its screen
 *   POST   /api/lab/vms/:id/mouse           { x, y, click? } (0..1)
 *   POST   /api/lab/vms/:id/screenshot      a picture now
 *   GET    /api/lab/vms/:id/serial?from=N   the serial console's log
 *   POST   /api/lab/vms/:id/serial          { text } typed on it
 *   GET    /api/lab/vms/:id/console         the signed socket addresses for the app's console
 *   POST   /api/lab/isos                    { url, sha256? } download an ISO (polled through GET /api/lab)
 *   POST   /api/lab/runs                    { vmId, profiles, login?, label?, task?, recordEverySec? } a test run
 *   GET    /api/lab/runs/:id
 *   POST   /api/lab/runs/:id/reproduce      the same hardware, ISO and profiles in a fresh VM; says what cannot be the same
 *   GET    /api/lab/vms/:id/read-screen     what the screen says, and where (OCR)
 *   POST   /api/lab/vms/:id/click-text      { text, double? } click a label on its screen
 *   POST   /api/lab/runs/:id/stop
 *   POST   /api/lab/runs/:id/feedback       { text, kind? }
 *   POST   /api/lab/profiles                a custom profile
 *   POST   /api/lab/stop-all                emergency stop of every VM
 *   GET    /lab/file/run/:id/:name?t=…      a run's screenshot or log
 *   GET    /lab/file/vm/:id/:name?t=…       a VM's screenshot
 *   WS     /lab/ws/:id/vnc?t=…              its screen (RFB, for noVNC)
 *   WS     /lab/ws/:id/serial?t=…           its serial console (for the terminal)
 *
 * A browser cannot send the agent key on a picture or a socket, so those carry
 * a token signed by this builder, for that one VM or run, for 12 hours.
 * Anything that takes a while answers within a minute and carries on; the app
 * polls. (Requests through the tunnel die at 100 s.)
 */
import crypto from "crypto";
import fs from "fs";
import type http from "http";
import net from "net";
import path from "path";

import type { Express, Request, Response } from "express";
import { WebSocketServer, type WebSocket } from "ws";

import { VmLab, type CreateVm } from "../lab/VmLab.js";
import { VmTests, profiles as allProfiles, FULL, type Step } from "../lab/VmTests.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";
import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { signLink } from "./previews.js";

const TOKEN_HOURS = 12;

const tokenFor = (scope: string): string => {
  const expires = Date.now() + TOKEN_HOURS * 3_600_000;
  return `${expires.toString(36)}.${signLink(`lab:${scope}:${expires}`)}`;
};

const tokenOk = (scope: string, token: unknown): boolean => {
  if (typeof token !== "string") return false;
  const [stamp, signature] = token.split(".");
  const expires = parseInt(stamp ?? "", 36);
  if (!expires || expires < Date.now() || !signature) return false;
  const expected = Buffer.from(signLink(`lab:${scope}:${expires}`));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const downloads = new Map<string, { url: string; state: "running" | "done" | "failed"; error: string | null; at: string }>();

/** Answer within a minute with the result; slower work carries on, and the app polls. */
const soon = async (res: Response, work: () => Promise<unknown>) => {
  let answered = false;
  const timer = setTimeout(() => {
    answered = true;
    res.status(202).json({ pending: true, note: "Still working on it; it carries on." });
  }, 60_000);
  try {
    const result = await work();
    clearTimeout(timer);
    if (!answered) res.json(result ?? { ok: true });
  } catch (error) {
    clearTimeout(timer);
    if (answered) Logger.warn("Lab action failed after answering", { error: message(error) });
    else res.status(/Unknown VM|Unknown test run/.test(message(error)) ? 404 : 409).json({ error: message(error) });
  }
};

const withLinks = (runId: string) => {
  const run = VmTests.get(runId);
  if (!run) return null;
  const token = tokenFor(`run:${runId}`);
  return { ...run, fileToken: token };
};

export const registerLabRoutes = (app: Express, server: http.Server) => {
  app.get("/api/lab", authenticateAgent("read"), async (_req: Request, res: Response) => {
    try {
      const backend = await VmLab.backend.available();
      res.json({
        backend: { name: VmLab.backend.name, ...backend },
        limits: VmLab.limits(),
        vms: VmLab.list(),
        isos: VmLab.isos(),
        downloads: [...downloads.values()].slice(-5),
        profiles: allProfiles().map((p) => ({ id: p.id, name: p.name, about: p.about, builtIn: Boolean(p.builtIn), steps: p.steps.length })),
        full: FULL,
        runs: VmTests.list(30).map((r) => ({ id: r.id, vmId: r.vmId, vmName: r.vmName, build: r.build, profiles: r.profiles, state: r.state, agent: r.agent, task: r.task, startedAt: r.startedAt, finishedAt: r.finishedAt, counts: r.counts }))
      });
    } catch (error) {
      res.status(500).json({ error: message(error) });
    }
  });

  app.post("/api/lab/vms", authenticateAgent("execute"), (req: Request, res: Response) => soon(res, async () => ({ vm: await VmLab.create((req.body ?? {}) as CreateVm) })));

  app.get("/api/lab/vms/:id", authenticateAgent("read"), (req: Request, res: Response) => soon(res, () => VmLab.status(req.params.id)));

  app.patch("/api/lab/vms/:id", authenticateAgent("execute"), (req: Request, res: Response) => soon(res, async () => ({ vm: await VmLab.update(req.params.id, req.body ?? {}) })));

  app.delete("/api/lab/vms/:id", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => {
      await VmLab.remove(req.params.id);
      return { ok: true };
    })
  );

  const actions: Record<string, (id: string, body: Record<string, unknown>) => Promise<unknown>> = {
    start: (id) => VmLab.start(id),
    stop: (id, body) => VmLab.stop(id, body.force === true),
    pause: (id) => VmLab.pause(id),
    resume: (id) => VmLab.resume(id),
    restart: (id) => VmLab.restart(id),
    clone: (id, body) => VmLab.clone(id, typeof body.name === "string" ? body.name : undefined)
  };
  app.post("/api/lab/vms/:id/:action(start|stop|pause|resume|restart|clone)", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => ({ vm: await actions[req.params.action](req.params.id, (req.body ?? {}) as Record<string, unknown>) }))
  );

  app.post("/api/lab/vms/:id/snapshots", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => ({ vm: await VmLab.snapshot(req.params.id, String(req.body?.name ?? ""), typeof req.body?.note === "string" ? req.body.note : null) }))
  );
  app.post("/api/lab/vms/:id/snapshots/:name/restore", authenticateAgent("execute"), (req: Request, res: Response) => soon(res, async () => ({ vm: await VmLab.restore(req.params.id, req.params.name) })));
  app.delete("/api/lab/vms/:id/snapshots/:name", authenticateAgent("execute"), (req: Request, res: Response) => soon(res, async () => ({ vm: await VmLab.deleteSnapshot(req.params.id, req.params.name) })));

  app.post("/api/lab/vms/:id/keys", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => {
      if (Array.isArray(req.body?.combos)) await VmLab.sendKeys(req.params.id, req.body.combos as string[][]);
      if (typeof req.body?.text === "string") await VmLab.typeText(req.params.id, req.body.text);
      return { ok: true };
    })
  );
  app.post("/api/lab/vms/:id/mouse", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => {
      await VmLab.mouse(req.params.id, Number(req.body?.x), Number(req.body?.y), req.body?.click === "left" || req.body?.click === "right" ? req.body.click : null);
      return { ok: true };
    })
  );

  app.post("/api/lab/vms/:id/screenshot", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => {
      const shot = await VmLab.screenshot(req.params.id);
      return { url: `/lab/file/vm/${req.params.id}/${path.basename(shot.file)}?t=${tokenFor(`vm:${req.params.id}`)}`, width: shot.width, height: shot.height, coverage: shot.coverage, colours: shot.colours };
    })
  );

  app.get("/api/lab/vms/:id/serial", authenticateAgent("read"), (req: Request, res: Response) => {
    if (!VmLab.get(req.params.id)) return res.status(404).json({ error: "Unknown VM." });
    res.json(VmLab.serialLog(req.params.id, Number(req.query.from) || 0));
  });
  app.post("/api/lab/vms/:id/serial", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => {
      await VmLab.writeSerial(req.params.id, String(req.body?.text ?? ""));
      return { ok: true };
    })
  );

  app.get("/api/lab/vms/:id/console", authenticateAgent("execute"), (req: Request, res: Response) => {
    const vm = VmLab.get(req.params.id);
    if (!vm) return res.status(404).json({ error: "Unknown VM." });
    const token = tokenFor(`console:${vm.id}`);
    res.json({ vnc: `/lab/ws/${vm.id}/vnc?t=${token}`, serial: `/lab/ws/${vm.id}/serial?t=${token}`, state: vm.state });
  });

  app.post("/api/lab/isos", authenticateAgent("execute"), (req: Request, res: Response) => {
    const url = String(req.body?.url ?? "");
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: "Give the ISO's https address." });
    }
    if (parsed.protocol !== "https:" || !/\.(iso|img)$/i.test(parsed.pathname)) return res.status(400).json({ error: "Give an https address ending in .iso or .img." });
    const record = { url, state: "running" as "running" | "done" | "failed", error: null as string | null, at: new Date().toISOString() };
    downloads.set(url, record);
    void VmLab.downloadIso(url, typeof req.body?.sha256 === "string" ? req.body.sha256 : undefined)
      .then(() => {
        record.state = "done";
      })
      .catch((error) => {
        record.state = "failed";
        record.error = message(error);
      });
    res.json({ started: true });
  });

  app.post("/api/lab/runs", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const run = VmTests.start({
        vmId: String(body.vmId ?? ""),
        profiles: Array.isArray(body.profiles) ? (body.profiles as string[]) : [],
        agent: (req as AgentRequest).actor ?? "owner",
        task: typeof body.task === "string" ? body.task : null,
        label: typeof body.label === "string" ? body.label : null,
        login: (body.login ?? undefined) as { user?: string; password?: string } | undefined,
        recordEverySec: Number(body.recordEverySec) || 0
      });
      res.json({ run: withLinks(run.id) });
    } catch (error) {
      res.status(409).json({ error: message(error) });
    }
  });
  app.get("/api/lab/runs/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const run = withLinks(req.params.id);
    if (!run) return res.status(404).json({ error: "Unknown test run." });
    res.json({ run });
  });
  app.post("/api/lab/runs/:id/reproduce", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => {
      const run = await VmTests.reproduce(req.params.id, (req as AgentRequest).actor ?? "owner");
      return { run: withLinks(run.id) };
    })
  );
  app.get("/api/lab/vms/:id/read-screen", authenticateAgent("read"), (req: Request, res: Response) =>
    soon(res, async () => {
      const screen = await VmLab.readScreen(req.params.id);
      return { text: screen.text, words: screen.words, width: screen.width, height: screen.height, url: `/lab/file/vm/${req.params.id}/${path.basename(screen.file)}?t=${tokenFor(`vm:${req.params.id}`)}` };
    })
  );
  app.post("/api/lab/vms/:id/click-text", authenticateAgent("execute"), (req: Request, res: Response) =>
    soon(res, async () => {
      const found = await VmLab.findOnScreen(req.params.id, String(req.body?.text ?? ""));
      if (!found) throw new Error(`"${String(req.body?.text ?? "")}" is not on the screen.`);
      await VmLab.mouse(req.params.id, found.x, found.y, "left", req.body?.double === true ? 2 : 1);
      return { clicked: found.text, x: found.x, y: found.y };
    })
  );
  app.post("/api/lab/runs/:id/stop", authenticateAgent("execute"), (req: Request, res: Response) => {
    if (!VmTests.stop(req.params.id)) return res.status(404).json({ error: "Unknown test run." });
    res.json({ run: withLinks(req.params.id) });
  });
  app.post("/api/lab/runs/:id/feedback", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      VmTests.feedback(req.params.id, { text: String(req.body?.text ?? ""), kind: typeof req.body?.kind === "string" ? req.body.kind : undefined, by: (req as AgentRequest).actor ?? "owner" });
      res.json({ run: withLinks(req.params.id) });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });

  app.post("/api/lab/profiles", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      res.json({ profile: VmTests.saveProfile({ id: req.body?.id, name: String(req.body?.name ?? ""), about: req.body?.about, steps: (req.body?.steps ?? []) as Step[] }) });
    } catch (error) {
      res.status(400).json({ error: message(error) });
    }
  });

  app.post("/api/lab/stop-all", authenticateAgent("execute"), (_req: Request, res: Response) => soon(res, async () => ({ stopped: await VmLab.stopAll() })));

  // Pictures and logs, by signed link.
  app.get("/lab/file/run/:id/:name", (req: Request, res: Response) => {
    if (!tokenOk(`run:${req.params.id}`, req.query.t)) return res.status(404).send("Not found");
    const file = VmTests.file(req.params.id, req.params.name);
    if (!file) return res.status(404).send("Not found");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.sendFile(file);
  });
  app.get("/lab/file/vm/:id/:name", (req: Request, res: Response) => {
    if (!tokenOk(`vm:${req.params.id}`, req.query.t) || !/^[\w.-]+\.png$/.test(req.params.name)) return res.status(404).send("Not found");
    const file = path.join(path.dirname(VmLab.serialLogFile(req.params.id)), "screens", req.params.name);
    if (!fs.existsSync(file)) return res.status(404).send("Not found");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.sendFile(file);
  });

  /* The live console: the screen (raw RFB bridged to the VM's VNC port) and the serial console. */
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "", "http://local");
    const match = /^\/lab\/ws\/([\w-]+)\/(vnc|serial)$/.exec(url.pathname);
    if (!match) return;
    const [, id, kind] = match;
    const vm = VmLab.get(id);
    if (!vm || !tokenOk(`console:${id}`, url.searchParams.get("t")) || !vm.ports) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => (kind === "vnc" ? bridgeVnc(ws, vm.ports!.vnc) : void bridgeSerial(ws, id)));
  });

  const bridgeVnc = (ws: WebSocket, port: number) => {
    const tcp = net.connect(port, "127.0.0.1");
    tcp.on("data", (chunk) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
    });
    tcp.on("close", () => ws.close());
    tcp.on("error", () => ws.close());
    ws.on("message", (data) => tcp.write(data as Buffer));
    ws.on("close", () => tcp.destroy());
    ws.on("error", () => tcp.destroy());
  };

  const bridgeSerial = async (ws: WebSocket, id: string) => {
    // What has been on the console so far, then live.
    const backlog = VmLab.serialLog(id, 0, 64 * 1024).text;
    if (backlog) ws.send(backlog);
    let stop: (() => void) | null = null;
    try {
      stop = await VmLab.onSerial(id, (chunk) => {
        if (ws.readyState === ws.OPEN) ws.send(chunk.toString("utf8"));
      });
    } catch (error) {
      ws.send(`\r\n[${message(error)}]\r\n`);
      ws.close();
      return;
    }
    ws.on("message", (data) => void VmLab.writeSerial(id, String(data)).catch(() => undefined));
    ws.on("close", () => stop?.());
    ws.on("error", () => stop?.());
  };

  // VMs still running from before a restart are found again; time limits and leftovers are kept in check.
  void VmLab.reconnectAll().catch((error) => Logger.warn("VmLab: could not check running VMs", { error: message(error) }));
  setInterval(() => void VmLab.sweep().catch(() => undefined), 5 * 60_000).unref();

  // "Pause everything": VMs pause with the rest, and only the ones it paused carry on after.
  const pausedForGame = new Set<string>();
  setInterval(() => {
    const on = GameMode.isOn();
    for (const vm of VmLab.list()) {
      if (on && vm.state === "running") {
        pausedForGame.add(vm.id);
        void VmLab.pause(vm.id).catch(() => pausedForGame.delete(vm.id));
      } else if (!on && vm.state === "paused" && pausedForGame.has(vm.id)) {
        pausedForGame.delete(vm.id);
        void VmLab.resume(vm.id).catch(() => undefined);
      }
    }
  }, 30_000).unref();
};
