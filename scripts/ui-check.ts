/**
 * Opens the real app in headless Chrome/Edge against the live builder and checks
 * it the way you would: signs it in with the phone key, visits the pages, clicks
 * through, and saves screenshots. Reports script errors and failed requests. No
 * dependency: it drives the browser over the DevTools protocol.
 *
 *   npx tsx scripts/ui-check.ts [outDir]
 *
 * With a running VM it opens the Lab's console and checks the screen really draws.
 */
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { WebSocket } from "ws";

import { findBrowser } from "../src/orchestrator/SiteAudit.js";

const BASE = process.env.UI_BASE ?? "http://127.0.0.1:4000";
const KEY = fs.readFileSync(path.resolve("data/phone-key.txt"), "utf8").trim();
const OUT = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "ui-check"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const main = async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = findBrowser();
  if (!browser) throw new Error("No Chrome or Edge here.");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ui-check-"));
  const port = 9300 + Math.floor(Math.random() * 400);
  const chrome = spawn(browser, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1500,1000", "--no-first-run", "about:blank"], { stdio: "ignore", windowsHide: true });
  let exitCode = 0;
  try {
    let target: { webSocketDebuggerUrl: string } | undefined;
    for (let i = 0; i < 60 && !target; i++) {
      await sleep(500);
      target = await fetch(`http://127.0.0.1:${port}/json`).then((r) => r.json() as Promise<Array<{ type: string; webSocketDebuggerUrl: string }>>).then((list) => list.find((t) => t.type === "page")).catch(() => undefined);
    }
    if (!target) throw new Error("The browser did not start.");
    const ws = new WebSocket(target.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    let id = 0;
    const waiting = new Map<number, (value: { result?: Record<string, unknown>; error?: unknown }) => void>();
    const problems: string[] = [];
    let page = "";
    ws.on("message", (raw) => {
      const message = JSON.parse(String(raw)) as { id?: number; method?: string; params?: Record<string, any>; result?: Record<string, unknown>; error?: unknown };
      if (message.id && waiting.has(message.id)) {
        waiting.get(message.id)!(message);
        waiting.delete(message.id);
      }
      if (message.method === "Runtime.exceptionThrown") problems.push(`[${page}] script error: ${message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text}`.slice(0, 300));
      if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") problems.push(`[${page}] console.error: ${(message.params?.args ?? []).map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(" ")}`.slice(0, 300));
      if (message.method === "Network.responseReceived" && message.params?.response?.status >= 500) problems.push(`[${page}] ${message.params.response.status} ${message.params.response.url}`.slice(0, 200));
    });
    const send = (method: string, params: Record<string, unknown> = {}) =>
      new Promise<{ result?: Record<string, any>; error?: unknown }>((resolve) => {
        const n = ++id;
        waiting.set(n, resolve);
        ws.send(JSON.stringify({ id: n, method, params }));
      });
    const evaluate = async <T>(expression: string): Promise<T> => {
      const out = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      return out.result?.result?.value as T;
    };
    const shot = async (name: string) => {
      const out = await send("Page.captureScreenshot", { format: "png" });
      fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(String(out.result?.data), "base64"));
    };
    const visit = async (name: string, url: string, settleMs = 5000) => {
      page = name;
      await send("Page.navigate", { url: `${BASE}${url}` });
      await sleep(settleMs);
    };
    const clickText = (text: string, selector = "button, a, summary") =>
      evaluate<boolean>(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
    const textOf = () => evaluate<string>("document.body.innerText");

    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");

    // Signed in, as the phone is.
    await visit("sign in", "/");
    await evaluate(`localStorage.setItem("agent-builder.address", ${JSON.stringify(BASE)}); localStorage.setItem("agent-builder.key", ${JSON.stringify(KEY)})`);

    const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
    const check = (name: string, ok: boolean, detail = "") => {
      checks.push({ name, ok, detail });
      console.log(`${ok ? "[PASS]" : "[FAIL]"} ${name}${detail ? `: ${detail}` : ""}`);
      if (!ok) exitCode = 1;
    };

    await visit("Lab", "/lab/", 9000);
    let body = await textOf();
    check("Lab page loads and is signed in", /Virtual Test Lab/.test(body) && /Virtual machines/i.test(body), body.slice(0, 120).replace(/\n/g, " "));
    await shot("lab");
    const opened = await clickText("Open console");
    if (opened) {
      await sleep(12_000);
      await shot("lab-console");
      const canvas = await evaluate<{ width: number; height: number; drawn: number } | null>(`(() => { const c = document.querySelector("canvas"); if (!c) return null; const x = c.getContext("2d"); let drawn = 0; try { const d = x.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4000) if (d[i] + d[i+1] + d[i+2] > 30) drawn++; } catch {} return { width: c.width, height: c.height, drawn }; })()`);
      check("The live console draws the VM's screen", Boolean(canvas && canvas.width > 300 && canvas.drawn > 5), JSON.stringify(canvas));
      const status = await evaluate<string>("document.body.innerText.match(/Connected[^\\n]*|Connecting…|The connection dropped|Disconnected|could not load[^\\n]*/)?.[0] || ''");
      check("The console says it is connected", /Connected/.test(status), status);
      await clickText("Terminal");
      await sleep(5000);
      await shot("lab-terminal");
      const terminal = await evaluate<string>("document.querySelector('.xterm-rows')?.innerText || document.querySelector('.xterm')?.innerText || ''");
      check("The terminal shows the serial console", terminal.trim().length > 0, terminal.trim().slice(-80).replace(/\n/g, " | "));
    } else console.log("[skip] no running VM to open a console on");

    for (const [tab, label, expect] of [
      ["overview", "Overview", /Working now/],
      ["continuous", "Agent Builder", /Improve itself/],
      ["iterations", "Iterations", /iterations/i],
      ["simulation", "Simulation Lab", /Computed experiments/],
      ["learning", "Learning Centre", /Knowledge/],
      ["evaluations", "Evaluations", /fixed challenges/],
      ["activity", "Agent Activity", /newest first/],
      ["graph", "Knowledge Graph", /records connect/]
    ] as Array<[string, string, RegExp]>) {
      await visit(label, `/agent/?tab=${tab}`, 8000);
      body = await textOf();
      check(`${label} tab`, expect.test(body), expect.test(body) ? "" : body.slice(0, 160).replace(/\n/g, " "));
      await shot(`agent-${tab}`);
    }
    await visit("Iterations", "/agent/?tab=iterations", 8000);
    const session = await evaluate<boolean>(`(() => { const el = [...document.querySelectorAll(".small")].find((e) => /milestones/.test(e.textContent)); if (!el) return false; el.click(); return true; })()`);
    if (session) {
      await sleep(5000);
      const row = await evaluate<boolean>(`(() => { const el = [...document.querySelectorAll(".small")].find((e) => /^(#\\d+)/.test(e.textContent.trim()) || /#\\d+/.test(e.textContent)); if (!el) return false; el.click(); return true; })()`);
      await sleep(5000);
      body = await textOf();
      check("An iteration opens", row && /Changes ·/.test(body), "");
      await shot("iteration-open");
    }
    await visit("Research", "/research/", 8000);
    body = await textOf();
    check("Research shows the investigations", /Deep investigation/.test(body));
    await shot("research");
    await visit("Games", "/gamemaker/", 8000);
    body = await textOf();
    check("Games shows keep building", /Keep building a game/.test(body));
    await shot("games");

    console.log(`\nScreenshots in ${OUT}`);
    const unique = [...new Set(problems)];
    console.log(unique.length ? `Problems seen in the browser (${unique.length}):\n${unique.slice(0, 25).join("\n")}` : "No script errors or server errors in the browser.");
    if (unique.some((p) => /script error/.test(p))) exitCode = 1;
    ws.close();
  } finally {
    chrome.kill();
    await sleep(500);
    fs.rmSync(profile, { recursive: true, force: true });
  }
  process.exit(exitCode);
};

main().catch((error) => {
  console.error("UI check failed:", error?.message ?? error);
  process.exit(1);
});
