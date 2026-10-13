/**
 * Screens: input checking, and the routes with real keys (on Windows the PC's
 * screen is captured for real; nothing is clicked or typed).
 *
 *   npm run test:screens
 */
import assert from "node:assert/strict";
import express from "express";
import fs from "fs";
import http from "http";
import type { AddressInfo } from "net";
import os from "os";
import path from "path";

// A temp folder: its .env and key database, never the real ones.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-screens-"));
fs.mkdirSync(path.join(tmp, "data"), { recursive: true });
process.chdir(tmp);
delete process.env.LAPTOP_JARVIS_KEY;
delete process.env.LAPTOP_JARVIS_URL;

// A stand-in laptop: its screen route knows one key.
const GOOD = "jl_" + "k".repeat(40);
const laptop = http.createServer((req, res) => {
  const ok = req.headers.authorization === `Bearer ${GOOD}`;
  res.writeHead(ok ? 503 : 401, { "content-type": "application/json" });
  res.end(JSON.stringify(ok ? { waiting: true, error: "Asking the laptop for its screen" } : { error: "Owner only." }));
});
laptop.listen(0, "127.0.0.1");
await new Promise((resolve) => laptop.once("listening", resolve));
process.env.JARVIS_CLOUD_URL = `http://127.0.0.1:${(laptop.address() as AddressInfo).port}`;
const { validateEvent, WindowsScreen } = await import("../src/machine/WindowsScreen.js");
const { registerScreenRoutes } = await import("../src/server/screens.js");
const { AgentKeyModel } = await import("../src/models/AgentKeyModel.js");

// Input, checked the way Jarvis checks it.
assert.deepEqual(validateEvent({ kind: "click", x: 0.5, y: 0.25 }), { ok: true, event: { kind: "click", x: 0.5, y: 0.25, button: "left", double: false } });
assert.equal(validateEvent({ kind: "click", x: 1.5, y: 0 }).ok, false, "outside the screen");
assert.equal(validateEvent({ kind: "scroll", x: 0.5, y: 0.5, dy: 40 }).ok, false, "too far a scroll");
assert.equal(validateEvent({ kind: "key", key: "ctrl+alt+Delete" }).ok, true);
assert.equal(validateEvent({ kind: "key", key: "ctrl+ctrl+c" }).ok, false, "a modifier twice");
assert.equal(validateEvent({ kind: "key", key: "format c:" }).ok, false);
assert.equal(validateEvent({ kind: "type", text: "x".repeat(501) }).ok, false, "too much text at once");
const typed = validateEvent({ kind: "type", text: "héllo\r\nwörld\u0007" });
assert.ok(typed.ok && typed.event.kind === "type" && typed.event.text === "héllo\nwörld", "newlines kept, bells dropped");
assert.equal(validateEvent({ kind: "format" }).ok, false);

// The routes, with the owner's key and with one of Jarvis's.
const owner = AgentKeyModel.issue("screens-test-phone", ["read", "write", "execute"]).secret;
const jarvis = AgentKeyModel.issue("jarvis-screens-test", ["read", "write", "execute"]).secret;
const app = express();
app.use(express.json());
registerScreenRoutes(app);
const server = app.listen(0, "127.0.0.1");
await new Promise((resolve) => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const call = (path: string, key: string, init: RequestInit = {}) =>
  fetch(`${base}${path}`, { ...init, headers: { "x-agent-key": key, "content-type": "application/json", ...((init.headers as Record<string, string>) ?? {}) } });

const list = await call("/api/screens", owner);
assert.equal(list.status, 200);
const { machines } = (await list.json()) as { machines: Array<{ id: string; available: boolean; note: string | null }> };
assert.deepEqual(machines.map((m) => m.id), ["pc", "laptop"]);
assert.equal(machines[1].available, false, "no laptop key yet");
assert.match(machines[1].note ?? "", /LAPTOP_JARVIS_KEY/);

assert.equal((await call("/api/screens", jarvis)).status, 403, "Jarvis's keys may not read screens");
assert.equal((await call("/api/screens/pc/frame", jarvis)).status, 403);
assert.equal((await call("/api/screens/pc/input", jarvis, { method: "POST", body: JSON.stringify({ events: [{ kind: "release" }] }) })).status, 403);
assert.equal((await call("/api/screens/tv/frame", owner)).status, 404);
assert.equal((await call("/api/screens/pc/input", owner, { method: "POST", body: JSON.stringify({ events: [{ kind: "key", key: "rm" }] }) })).status, 400);
assert.equal((await call("/api/screens/laptop/frame", owner)).status, 409, "the laptop says what it needs");

if (process.platform === "win32") {
  const frame = await call("/api/screens/pc/frame?w=800", owner);
  assert.equal(frame.status, 200, await frame.clone().text().catch(() => ""));
  assert.equal(frame.headers.get("content-type"), "image/jpeg");
  const jpeg = Buffer.from(await frame.arrayBuffer());
  assert.equal(jpeg[0], 0xff, "a JPEG");
  const etag = frame.headers.get("etag")!;
  const again = await call("/api/screens/pc/frame?w=800", owner, { headers: { "If-None-Match": etag } });
  assert.ok(again.status === 304 || again.status === 200, `unchanged is 304 (got ${again.status})`);
  const input = await call("/api/screens/pc/input", owner, { method: "POST", body: JSON.stringify({ events: [{ kind: "release" }] }) });
  assert.equal(input.status, 200);
  WindowsScreen.stop("test done");
}

// Jarvis connects the laptop: a wrong key is refused, a good one kept (and used at once), a foreign address refused.
const link = (body: unknown) => call("/api/screens/link", jarvis, { method: "POST", body: JSON.stringify(body) });
assert.equal((await link({ key: "jl_" + "x".repeat(40), pairPc: false })).status, 400, "the laptop refused it");
assert.equal((await link({ key: GOOD, url: "https://evil.example.com", pairPc: false })).status, 400, "not the laptop's address");
const linked = await link({ key: GOOD, pairPc: false });
assert.equal(linked.status, 200, await linked.clone().text());
assert.equal(process.env.LAPTOP_JARVIS_KEY, GOOD, "in use at once");
assert.match(fs.readFileSync(path.join(tmp, ".env"), "utf8"), /^LAPTOP_JARVIS_KEY=jl_k+$/m, "kept in .env");
const after = (await (await call("/api/screens", owner)).json()) as { machines: Array<{ id: string; available: boolean }> };
assert.equal(after.machines[1].available, true, "the Laptop tab is ready");
assert.equal((await call("/api/screens/laptop/frame", owner)).status, 503, "relayed: the laptop is still waking its screen");
assert.equal((await call("/api/screens/link", jarvis, { method: "DELETE" })).status, 200);
assert.equal(process.env.LAPTOP_JARVIS_KEY, undefined, "unlinked");

laptop.close();
server.close();
AgentKeyModel.revoke("screens-test-phone");
AgentKeyModel.revoke("jarvis-screens-test");
console.log("screens: all checks passed");
process.exit(0);
