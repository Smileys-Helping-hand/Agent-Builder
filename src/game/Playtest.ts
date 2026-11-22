/**
 * Playtest: plays a built web game in a real browser, with real key presses, and checks what happened.
 *
 * A screenshot of a canvas proves the game drew something, not that it plays. A playtest drives the game through a
 * scenario the game ships with (playtest.json at its root) and checks the game's own state after each input:
 * Wren moved when → was held, left the ground on Space and landed again, a lantern relit after F beside it, a life
 * went when the tide caught her, the game ended and started again on a key. The game exposes a read-only view of
 * itself on window (the scenario names it, e.g. "__lanternfall"); expectations are JavaScript expressions over it.
 *
 * Every step records whether it passed, what the view said, and how long it took; screenshots are taken where the
 * scenario asks; script errors and a frozen game (its frame counter stops) fail the playtest whatever the steps say.
 *
 * Scenario steps:
 *   { "label": "...", "press": "Enter" }                    one key down and up
 *   { "label": "...", "hold": "ArrowRight", "ms": 1200 }    a key held
 *   { "label": "...", "holdUntil": "ArrowRight", "until": "v.player.x >= 330", "timeoutMs": 4000 }
 *   { "label": "...", "wait": 500 }
 *   { "label": "...", "waitFor": "v.scene === 'play'", "timeoutMs": 8000 }
 *   { "label": "...", "expect": "v.state.lit.length === 1" }
 *   { "label": "...", "remember": { "x0": "v.player.x" } }   then mem.x0 in later expressions
 *   { "label": "...", "screenshot": "after-jump" }
 */
import { spawn } from "child_process";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import { WebSocket } from "ws";

import { findBrowser } from "../orchestrator/SiteAudit.js";

export interface PlaytestStep {
  label: string;
  press?: string;
  hold?: string;
  holdUntil?: string;
  until?: string;
  ms?: number;
  wait?: number;
  waitFor?: string;
  expect?: string;
  remember?: Record<string, string>;
  screenshot?: string;
  timeoutMs?: number;
}

export interface PlaytestScenario {
  /** The window property the game exposes its view on. */
  hook: string;
  /** The field of the view that counts frames (to catch a frozen game). */
  frameField?: string;
  steps: PlaytestStep[];
}

export interface PlaytestResult {
  passed: boolean;
  steps: Array<{ label: string; passed: boolean; detail: string; ms: number }>;
  errors: string[];
  frozen: boolean;
  screenshots: string[];
  durationMs: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const KEYS: Record<string, { code: string; keyCode: number; key: string; text?: string }> = {
  ArrowLeft: { code: "ArrowLeft", keyCode: 37, key: "ArrowLeft" },
  ArrowUp: { code: "ArrowUp", keyCode: 38, key: "ArrowUp" },
  ArrowRight: { code: "ArrowRight", keyCode: 39, key: "ArrowRight" },
  ArrowDown: { code: "ArrowDown", keyCode: 40, key: "ArrowDown" },
  Space: { code: "Space", keyCode: 32, key: " ", text: " " },
  Enter: { code: "Enter", keyCode: 13, key: "Enter", text: "\r" },
  Shift: { code: "ShiftLeft", keyCode: 16, key: "Shift" },
  Escape: { code: "Escape", keyCode: 27, key: "Escape" }
};
const keyOf = (name: string) => KEYS[name] ?? (/^[A-Z]$/i.test(name) ? { code: `Key${name.toUpperCase()}`, keyCode: name.toUpperCase().charCodeAt(0), key: name.toLowerCase(), text: name.toLowerCase() } : null);

/** A static server for a built game folder, on a free port. */
const serve = (root: string): Promise<{ url: string; close: () => void }> =>
  new Promise((resolve) => {
    const types: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".wav": "audio/wav", ".mp3": "audio/mpeg" };
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent((req.url ?? "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
      const file = path.resolve(root, rel);
      if (!file.startsWith(path.resolve(root)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}/`, close: () => server.close() }));
  });

export const Playtest = {
  /** Read a game's scenario (playtest.json at its root), or null. */
  scenarioOf(projectDir: string): PlaytestScenario | null {
    try {
      return JSON.parse(fs.readFileSync(path.join(projectDir, "playtest.json"), "utf8")) as PlaytestScenario;
    } catch {
      return null;
    }
  },

  /** Play the built game in `distDir` through `scenario`. Screenshots go to `outDir`. */
  async run(distDir: string, scenario: PlaytestScenario, outDir = path.join(os.tmpdir(), "playtest")): Promise<PlaytestResult> {
    const started = Date.now();
    const browser = findBrowser();
    if (!browser) throw new Error("No Chrome or Edge on this PC to playtest with.");
    fs.mkdirSync(outDir, { recursive: true });
    const site = await serve(distDir);
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "playtest-"));
    const port = 9700 + Math.floor(Math.random() * 250);
    const chrome = spawn(browser, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1280,760", "--autoplay-policy=no-user-gesture-required", "--no-first-run", "about:blank"], { stdio: "ignore", windowsHide: true });
    const result: PlaytestResult = { passed: false, steps: [], errors: [], frozen: false, screenshots: [], durationMs: 0 };
    try {
      let target: { webSocketDebuggerUrl: string } | undefined;
      for (let i = 0; i < 60 && !target; i++) {
        await sleep(500);
        target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json() as Promise<Array<{ type: string; webSocketDebuggerUrl: string }>>).then((list) => list.find((t) => t.type === "page")).catch(() => undefined);
      }
      if (!target) throw new Error("The browser did not start.");
      const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
      await new Promise((resolve, reject) => {
        ws.once("open", resolve);
        ws.once("error", reject);
      });
      let id = 0;
      const waiting = new Map<number, (m: { result?: Record<string, unknown> }) => void>();
      ws.on("message", (raw) => {
        const message = JSON.parse(String(raw)) as { id?: number; method?: string; params?: Record<string, any>; result?: Record<string, unknown> };
        if (message.id && waiting.has(message.id)) {
          waiting.get(message.id)!(message);
          waiting.delete(message.id);
        }
        if (message.method === "Runtime.exceptionThrown") result.errors.push(`script error: ${message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text}`.slice(0, 300));
        if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") result.errors.push(`console.error: ${(message.params?.args ?? []).map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" ")}`.slice(0, 300));
      });
      const send = (method: string, params: Record<string, unknown> = {}) =>
        new Promise<{ result?: Record<string, any> }>((resolve) => {
          const n = ++id;
          waiting.set(n, resolve);
          ws.send(JSON.stringify({ id: n, method, params }));
        });
      const hook = scenario.hook;
      const evaluate = async <T>(expression: string): Promise<T> => {
        const wrapped = `(() => { const v = window[${JSON.stringify(hook)}]; const mem = (window.__playtestMem ||= {}); try { return (${expression}); } catch (e) { return "__error__: " + e.message; } })()`;
        const out = await send("Runtime.evaluate", { expression: wrapped, returnByValue: true });
        return out.result?.result?.value as T;
      };
      const key = async (name: string, type: "keyDown" | "keyUp") => {
        const k = keyOf(name);
        if (!k) throw new Error(`Unknown key "${name}"`);
        await send("Input.dispatchKeyEvent", { type, key: k.key, code: k.code, windowsVirtualKeyCode: k.keyCode, nativeVirtualKeyCode: k.keyCode, ...(type === "keyDown" && k.text ? { text: k.text } : {}) });
      };
      const frameExpr = `v && v.${scenario.frameField ?? "frame"}`;
      await send("Runtime.enable");
      await send("Page.enable");
      await send("Page.navigate", { url: site.url });
      await sleep(1500);
      // No click to "focus" the page: key events reach it anyway, and a click is a tap the game would answer
      // (the first run's click started the game behind the title screen's back).
      await send("Page.bringToFront").catch(() => undefined);

      for (const step of scenario.steps) {
        const t0 = Date.now();
        let passed = true;
        let detail = "";
        const timeout = step.timeoutMs ?? 8000;
        if (step.press) {
          await key(step.press, "keyDown");
          await sleep(80);
          await key(step.press, "keyUp");
          detail = `pressed ${step.press}`;
        } else if (step.hold) {
          await key(step.hold, "keyDown");
          await sleep(step.ms ?? 500);
          await key(step.hold, "keyUp");
          detail = `held ${step.hold} ${step.ms ?? 500} ms`;
        } else if (step.holdUntil && step.until) {
          await key(step.holdUntil, "keyDown");
          let ok = false;
          for (const deadline = Date.now() + timeout; Date.now() < deadline; ) {
            if ((await evaluate<unknown>(step.until)) === true) {
              ok = true;
              break;
            }
            await sleep(50);
          }
          await key(step.holdUntil, "keyUp");
          passed = ok;
          detail = ok ? `held ${step.holdUntil} until ${step.until}` : `held ${step.holdUntil} ${timeout} ms; never ${step.until}`;
        } else if (step.wait) {
          await sleep(step.wait);
          detail = `waited ${step.wait} ms`;
        } else if (step.waitFor) {
          let ok = false;
          for (const deadline = Date.now() + timeout; Date.now() < deadline; ) {
            if ((await evaluate<unknown>(step.waitFor)) === true) {
              ok = true;
              break;
            }
            await sleep(100);
          }
          passed = ok;
          detail = ok ? `${step.waitFor}` : `not within ${timeout} ms: ${step.waitFor}`;
        } else if (step.expect) {
          const value = await evaluate<unknown>(step.expect);
          passed = value === true;
          detail = passed ? step.expect : `${step.expect} → ${JSON.stringify(value)}`;
        } else if (step.remember) {
          for (const [name, expression] of Object.entries(step.remember)) await evaluate(`(mem[${JSON.stringify(name)}] = ${expression}, true)`);
          detail = `remembered ${Object.keys(step.remember).join(", ")}`;
        }
        if (step.screenshot) {
          const shot = await send("Page.captureScreenshot", { format: "png" });
          const file = path.join(outDir, `${step.screenshot}.png`);
          fs.writeFileSync(file, Buffer.from(String(shot.result?.data), "base64"));
          result.screenshots.push(file);
        }
        if (!passed) detail += ` (view: ${JSON.stringify(await evaluate(`v && { scene: v.scene, player: v.player, state: v.state }`)).slice(0, 300)})`;
        result.steps.push({ label: step.label, passed, detail, ms: Date.now() - t0 });
        if (!passed) break;
      }
      // A frozen game: the frame counter does not move in a second.
      const a = await evaluate<number>(frameExpr);
      await sleep(1000);
      const b = await evaluate<number>(frameExpr);
      result.frozen = !(typeof a === "number" && typeof b === "number" && b > a);
      ws.close();
    } finally {
      chrome.kill();
      site.close();
      await sleep(800);
      // Chrome can hold its profile a moment after exiting; a leftover temp folder never fails the playtest.
      try {
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
      } catch {
        // left in the temp folder
      }
    }
    result.durationMs = Date.now() - started;
    result.passed = result.steps.length === scenario.steps.length && result.steps.every((s) => s.passed) && !result.errors.length && !result.frozen;
    return result;
  }
};
