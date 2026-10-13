/**
 * Screens: see and use this PC and the laptop from the phone.
 *
 *   GET  /api/screens                  which machines, and whether each can be controlled
 *   GET  /api/screens/:machine/frame   a JPEG of its screen (ETag; 304 when unchanged)
 *   POST /api/screens/:machine/input   { events: [...] } clicks, scrolls, keys, text
 *
 * "pc" is this machine, captured here (machine/WindowsScreen.ts). "laptop" is
 * relayed to the laptop's Jarvis (/api/jarvis/screen and /screen/input), which
 * captures and replays there; it needs the laptop's Jarvis key in .env:
 *
 *   LAPTOP_JARVIS_KEY=…   the JARVIS_MASTER_KEY from the laptop's .env.local
 *   LAPTOP_JARVIS_URL=…   defaults to JARVIS_CLOUD_URL (its Tailscale address)
 *
 * The owner's own keys only: the phone app or a signed-in owner. Jarvis's keys
 * are refused, since a screen is not something the model should be reading;
 * he shows this PC through his own paired-device link instead. SCREEN_CONTROL=off
 * keeps this PC view-only. Taking control is written to the activity log, at
 * most once per ten minutes; what is typed never is.
 */
import { spawn } from "child_process";
import type { Express, Request, Response } from "express";
import fs from "fs";
import os from "os";
import path from "path";

import { MAX_TEXT, WindowsScreen, validateEvent, type ScreenEvent } from "../machine/WindowsScreen.js";
import { AgentActivity } from "../state/AgentActivity.js";
import { setEnvValues } from "../utils/EnvFile.js";
import { Logger } from "../utils/Logger.js";
import { authenticateAgent, type AgentRequest } from "./agentAuth.js";

type Machine = "pc" | "laptop";
const MACHINES: Machine[] = ["pc", "laptop"];

const laptopUrl = (): string | null => (process.env.LAPTOP_JARVIS_URL?.trim() || process.env.JARVIS_CLOUD_URL?.trim() || "").replace(/\/+$/, "") || null;
const laptopKey = (): string | null => process.env.LAPTOP_JARVIS_KEY?.trim() || null;
/** Jarvis's tray app on this PC (his paired-device link). */
const jarvisDeviceInstalled = (): boolean => Boolean(process.env.LOCALAPPDATA) && fs.existsSync(path.join(process.env.LOCALAPPDATA ?? "", "JarvisDevice", "config.json"));
const pcControl = (): boolean => (process.env.SCREEN_CONTROL ?? "on").toLowerCase() !== "off";

const LAPTOP_SETUP =
  "To see the laptop here, copy JARVIS_MASTER_KEY from the laptop's .env.local into E:\\Projects\\Agent-Builder\\.env as LAPTOP_JARVIS_KEY=…, then restart Agent Builder.";

/** Jarvis's keys may not read screens; the owner's phone and a signed-in owner may. */
const ownerOnly = (req: Request, res: Response): boolean => {
  const name = (req as AgentRequest).agent?.name ?? "";
  if (/^jarvis/i.test(name)) {
    res.status(403).json({ error: "Screens are for the owner's phone, not Jarvis's key. Jarvis shows this PC through his paired-device link." });
    return false;
  }
  return true;
};

const machineOf = (req: Request): Machine | null => (MACHINES.includes(req.params.machine as Machine) ? (req.params.machine as Machine) : null);

const audited: Record<Machine, number> = { pc: 0, laptop: 0 };
const auditControl = (req: Request, machine: Machine) => {
  if (Date.now() - audited[machine] < 10 * 60_000) return;
  audited[machine] = Date.now();
  const who = (req as AgentRequest).agent?.name ?? (req as AgentRequest).actor ?? "owner";
  AgentActivity.record({ direction: "in", agent: who, method: "SCREEN", path: machine, status: 200, summary: `Took control of the ${machine === "pc" ? "PC" : "laptop"} from the phone` });
  Logger.log("Screen control taken", { machine, by: who });
};

async function laptopFetch(pathname: string, init: RequestInit & { headers?: Record<string, string> }, timeoutMs: number) {
  const url = laptopUrl();
  const key = laptopKey();
  if (!url || !key) return null;
  return fetch(`${url}${pathname}`, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(timeoutMs) });
}

/** The laptop's address: one already configured here, or on the tailnet. */
const trustedLaptopUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    const known = [process.env.JARVIS_CLOUD_URL, process.env.LAPTOP_JARVIS_URL, process.env.JARVIS_HOST, process.env.SECOND_BRAIN_HOST]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .map((value) => {
        try {
          return new URL(value).origin;
        } catch {
          return null;
        }
      });
    return known.includes(parsed.origin) || parsed.hostname.endsWith(".ts.net");
  } catch {
    return false;
  }
};

/**
 * Put this PC on Jarvis's dashboard: ask the laptop for his Windows tray app
 * made for this PC (his paired-device link: no admin rights) and run it here.
 * The installer carries its own key and is deleted once it has unpacked.
 */
async function pairPcWithJarvis(req: Request, again: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!WindowsScreen.available()) return { status: 501, body: { error: "This is for Windows PCs." } };
  if (jarvisDeviceInstalled() && !again) return { status: 200, body: { ok: true, already: true, message: "Jarvis can already see this PC (its tray icon is installed)." } };
  try {
    const answer = await laptopFetch("/api/jarvis/devices/windows", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: os.hostname() }) }, 60_000);
    if (!answer) return { status: 409, body: { error: LAPTOP_SETUP, setup: true } };
    if (!answer.ok) {
      const body = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
      return { status: 502, body: { error: String(body.error ?? `The laptop answered ${answer.status}.`) } };
    }
    const installer = path.join(os.tmpdir(), `Jarvis-Setup-${process.pid}.cmd`);
    fs.writeFileSync(installer, Buffer.from(await answer.arrayBuffer()));
    const child = spawn("cmd.exe", ["/c", installer], { detached: true, stdio: "ignore", windowsHide: true });
    child.unref();
    setTimeout(() => fs.rmSync(installer, { force: true }), 5 * 60_000).unref();
    Logger.log("Paired this PC with Jarvis", { deviceId: answer.headers.get("x-device-id") });
    AgentActivity.record({ direction: "in", agent: (req as AgentRequest).agent?.name ?? "owner", method: "SCREEN", path: "pair", status: 200, summary: "Let Jarvis see this PC (installed his tray app)" });
    return {
      status: 200,
      body: { ok: true, deviceId: answer.headers.get("x-device-id"), message: "Jarvis's tray app is installing on this PC: it shows on his dashboard in a minute, and fetches its video helpers (about 120 MB) in the background." }
    };
  } catch (error) {
    return { status: 504, body: { error: `The laptop did not answer: ${error instanceof Error ? error.message : String(error)}` } };
  }
}

export const registerScreenRoutes = (app: Express) => {
  app.get("/api/screens", authenticateAgent("write"), (req: Request, res: Response) => {
    if (!ownerOnly(req, res)) return;
    res.json({
      machines: [
        {
          id: "pc",
          label: os.hostname(),
          kind: "This PC",
          available: WindowsScreen.available(),
          control: WindowsScreen.available() && pcControl(),
          note: WindowsScreen.available() ? (pcControl() ? null : "View only: SCREEN_CONTROL=off in .env.") : "Seeing the screen works on Windows only."
        },
        {
          id: "laptop",
          label: "Laptop",
          kind: "Through Jarvis",
          available: Boolean(laptopUrl() && laptopKey()),
          control: null,
          note: laptopUrl() && laptopKey() ? null : LAPTOP_SETUP
        }
      ],
      maxText: MAX_TEXT
    });
  });

  app.get("/api/screens/:machine/frame", authenticateAgent("write"), async (req: Request, res: Response) => {
    if (!ownerOnly(req, res)) return;
    const machine = machineOf(req);
    if (!machine) return res.status(404).json({ error: "No such machine." });
    res.setHeader("Cache-Control", "no-store");
    const ifNoneMatch = req.headers["if-none-match"];

    if (machine === "pc") {
      if (!WindowsScreen.available()) return res.status(501).json({ error: "Seeing the screen works on Windows only." });
      const width = Math.max(320, Math.min(2560, Number(req.query.w) || 1280));
      const quality = Math.max(20, Math.min(90, Number(req.query.q) || 55));
      try {
        const frame = await WindowsScreen.capture(width, quality);
        const etag = `"${frame.etag}"`;
        res.setHeader("ETag", etag);
        res.setHeader("X-Screen-Size", `${frame.width}x${frame.height}`);
        res.setHeader("X-Control", pcControl() ? "on" : "off");
        if (ifNoneMatch === etag) return res.status(304).end();
        res.type("image/jpeg").send(frame.jpeg);
      } catch (error) {
        res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }

    try {
      const answer = await laptopFetch("/api/jarvis/screen", { headers: typeof ifNoneMatch === "string" ? { "If-None-Match": ifNoneMatch } : {} }, 30_000);
      if (!answer) return res.status(409).json({ error: LAPTOP_SETUP, setup: true });
      for (const header of ["etag", "x-control", "x-captured-at"]) {
        const value = answer.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      if (answer.status === 304) return res.status(304).end();
      if (answer.status === 401) return res.status(502).json({ error: "The laptop refused the key in LAPTOP_JARVIS_KEY. Copy its JARVIS_MASTER_KEY again." });
      const type = answer.headers.get("content-type") ?? "";
      if (answer.ok && type.startsWith("image/")) return res.type(type).send(Buffer.from(await answer.arrayBuffer()));
      const body = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
      res.status(answer.status >= 400 ? answer.status : 502).json({ error: body.error ?? `The laptop answered ${answer.status}.`, waiting: body.waiting === true });
    } catch (error) {
      res.status(504).json({ error: `The laptop did not answer: it may be asleep or off Tailscale (${error instanceof Error ? error.message : String(error)}).` });
    }
  });

  /**
   * Let Jarvis see this PC: asks the laptop for the Windows app made for this
   * PC (his paired-device link: a tray icon, no admin rights) and runs it here.
   * The installer carries its own key; it is not kept once it has run.
   */
  app.get("/api/screens/pc/jarvis", authenticateAgent("write"), (req: Request, res: Response) => {
    if (!ownerOnly(req, res)) return;
    res.json({ paired: jarvisDeviceInstalled(), canPair: Boolean(laptopUrl() && laptopKey()) && WindowsScreen.available() });
  });

  app.post("/api/screens/pc/jarvis", authenticateAgent("execute"), async (req: Request, res: Response) => {
    if (!ownerOnly(req, res)) return;
    const result = await pairPcWithJarvis(req, req.body?.again === true);
    res.status(result.status).json(result.body);
  });

  /**
   * Jarvis connects the two: "connect the builder to the laptop". He mints a
   * screens-only key on the laptop and hands it here through his bridge, and
   * it is checked against the laptop before it is kept (in .env, at once,
   * no restart). With pairPc, this PC then goes on his dashboard too. Jarvis's
   * keys may call this route and the one below: the key is his laptop's to give.
   */
  app.post("/api/screens/link", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const key = typeof req.body?.key === "string" ? req.body.key.trim() : "";
    if (!/^[A-Za-z0-9_.~-]{20,400}$/.test(key)) return res.status(400).json({ error: "Send the laptop's key in key." });
    const url = typeof req.body?.url === "string" && req.body.url.trim() ? req.body.url.trim().replace(/\/+$/, "") : laptopUrl();
    if (!url || !trustedLaptopUrl(url)) return res.status(400).json({ error: "That is not the laptop's address (Tailscale, or JARVIS_CLOUD_URL)." });
    try {
      const probe = await fetch(`${url}/api/jarvis/screen`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000) });
      if (probe.status === 401 || probe.status === 403) return res.status(400).json({ error: "The laptop refused that key." });
    } catch (error) {
      return res.status(504).json({ error: `The laptop did not answer at ${url}: ${error instanceof Error ? error.message : String(error)}` });
    }
    setEnvValues({ LAPTOP_JARVIS_KEY: key, LAPTOP_JARVIS_URL: url === (process.env.JARVIS_CLOUD_URL ?? "").trim().replace(/\/+$/, "") ? null : url });
    const who = (req as AgentRequest).agent?.name ?? "owner";
    AgentActivity.record({ direction: "in", agent: who, method: "SCREEN", path: "link", status: 200, summary: "Connected the laptop's screen to the builder" });
    Logger.log("The laptop's screen is connected", { by: who });
    const pc = req.body?.pairPc === false ? null : await pairPcWithJarvis(req, false);
    res.json({
      ok: true,
      laptop: "connected",
      pc: pc ? (pc.status < 400 ? (pc.body.already ? "already" : "installing") : "failed") : "skipped",
      message: [
        "Agent Builder can now see and use the laptop (phone app > Screens > Laptop).",
        pc ? String(pc.body.message ?? pc.body.error ?? "") : ""
      ]
        .filter(Boolean)
        .join(" ")
    });
  });

  app.delete("/api/screens/link", authenticateAgent("execute"), (req: Request, res: Response) => {
    setEnvValues({ LAPTOP_JARVIS_KEY: null, LAPTOP_JARVIS_URL: null });
    AgentActivity.record({ direction: "in", agent: (req as AgentRequest).agent?.name ?? "owner", method: "SCREEN", path: "unlink", status: 200, summary: "Disconnected the laptop's screen from the builder" });
    res.json({ ok: true, message: "Agent Builder no longer has the laptop's key." });
  });

  app.post("/api/screens/:machine/input", authenticateAgent("execute"), async (req: Request, res: Response) => {
    if (!ownerOnly(req, res)) return;
    const machine = machineOf(req);
    if (!machine) return res.status(404).json({ error: "No such machine." });
    const raw = Array.isArray(req.body?.events) ? (req.body.events as unknown[]) : [];
    if (raw.length === 0 || raw.length > 40) return res.status(400).json({ error: "Send 1 to 40 inputs at a time." });
    const events: ScreenEvent[] = [];
    for (const item of raw) {
      const checked = validateEvent(item);
      if (!checked.ok) return res.status(400).json({ error: checked.error });
      events.push(checked.event);
    }

    if (machine === "pc") {
      if (!WindowsScreen.available()) return res.status(501).json({ error: "Control works on Windows only." });
      if (!pcControl()) return res.status(403).json({ error: "This PC is view-only (SCREEN_CONTROL=off in .env)." });
      auditControl(req, "pc");
      try {
        await WindowsScreen.input(events);
        return res.json({ ok: true, done: events.length });
      } catch (error) {
        return res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
      }
    }

    try {
      const answer = await laptopFetch("/api/jarvis/screen/input", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events }) }, 20_000);
      if (!answer) return res.status(409).json({ error: LAPTOP_SETUP, setup: true });
      auditControl(req, "laptop");
      const body = (await answer.json().catch(() => ({}))) as Record<string, unknown>;
      res.status(answer.status).json(answer.ok ? { ok: true, ...body } : { error: body.error ?? `The laptop answered ${answer.status}.` });
    } catch (error) {
      res.status(504).json({ error: `The laptop did not answer: ${error instanceof Error ? error.message : String(error)}` });
    }
  });
};
