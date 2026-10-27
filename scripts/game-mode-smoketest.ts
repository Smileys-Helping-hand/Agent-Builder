/**
 * Smoke test for game mode, against a throwaway Ollama the test starts on its
 * own port (default 11436), so the real one is never touched.
 *
 *   npm run test:game-mode
 */
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";

const port = process.env.GAME_MODE_TEST_PORT ?? "11436";
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-game-mode-"));
process.env.OLLAMA_HOST = `127.0.0.1:${port}`;
process.env.OLLAMA_BASE_URL = `http://127.0.0.1:${port}`;
process.env.GAME_MODE_PATH = path.join(dir, "game-mode.json");
process.env.KNOWLEDGE_DB_PATH = path.join(dir, "knowledge.db");
process.env.BUILDS_DB_PATH = path.join(dir, "builds.json");
process.env.MODEL_PROVIDER = "ollama";
// A Host Manager that is not there: the pause must never stop the real Jarvis or SaveState from a test.
process.env.HOST_MANAGER_URL = "http://127.0.0.1:9";
process.env.HOST_MANAGER_KEY = "hm_test_key_for_the_game_mode_smoketest";

const { ollamaBinary, checkOllama, ensureOllama } = await import("../src/utils/Ollama.js");
const { GameMode } = await import("../src/utils/GameMode.js");
const { ModelRouter } = await import("../src/tools/ModelRouter.js");
const { enterGameMode, exitGameMode } = await import("../src/server/gameMode.js");
const { ResearchStore } = await import("../src/research/ResearchStore.js");

const binary = ollamaBinary();
assert.ok(binary, "Ollama must be installed to run this test");
const server = spawn(binary, ["serve"], { stdio: "ignore", windowsHide: true, env: process.env });
for (let i = 0; i < 40 && (await checkOllama()).state === "down"; i++) await new Promise((r) => setTimeout(r, 500));
assert.notEqual((await checkOllama()).state, "down", "throwaway Ollama came up");

// A running research topic (created directly, so no cycle is scheduled).
const topic = ResearchStore.createTopic("Game mode test topic", "Does game mode pause running research?");

const on = await enterGameMode();
assert.deepEqual(on.pausedTopics, [topic.id], "the running topic was paused");
assert.equal(ResearchStore.getTopic(topic.id)?.status, "paused");
assert.equal(on.on, true, "game mode is on");
assert.equal(on.modelServerStopped, true, "the throwaway model server was stopped");
assert.deepEqual(on.stoppedServices, [], "without a Host Manager no other service is touched, and the pause still works");
assert.equal(GameMode.isOn(), true);
assert.equal(JSON.parse(fs.readFileSync(process.env.GAME_MODE_PATH!, "utf8")).on, true, "state is on disk for the launcher");
await assert.rejects(() => ModelRouter.generate("hello"), /Game mode is on/, "model calls are refused");
assert.equal(await ensureOllama(2000), false, "nothing can start the model server behind your back");
assert.equal((await checkOllama()).state, "down", "it stayed down");

const off = await exitGameMode();
assert.deepEqual(off.resumedTopics, [topic.id], "the same topic was resumed");
assert.equal(ResearchStore.getTopic(topic.id)?.status, "running");
ResearchStore.setStatus(topic.id, "stopped");
assert.equal(off.on, false, "game mode is off");
assert.equal(off.modelServerUp, true, "the model server is back");
assert.equal(GameMode.isOn(), false);

// With a (stand-in) Host Manager: the pause stops the PC's other running services and resume starts them,
// except the image engine, which starts by itself when a picture is drawn.
const calls: string[] = [];
const fakeHost = http.createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  if (req.headers["x-host-key"] !== process.env.HOST_MANAGER_KEY) return res.writeHead(401).end("{}");
  if (req.url?.startsWith("/api/status")) {
    return res.end(JSON.stringify({ services: [{ id: "jarvis", state: "up" }, { id: "image-engine", state: "up" }, { id: "savestate", state: "stopped" }, { id: "agent-builder", state: "up" }] }));
  }
  calls.push(`${req.method} ${req.url}`);
  res.end(JSON.stringify({ ok: true }));
});
await new Promise<void>((r) => fakeHost.listen(0, "127.0.0.1", () => r()));
process.env.HOST_MANAGER_URL = `http://127.0.0.1:${(fakeHost.address() as { port: number }).port}`;
const paused = await enterGameMode();
assert.deepEqual(paused.stoppedServices, ["jarvis", "image-engine"], "only the services that were running are stopped");
assert.deepEqual(calls, ["POST /api/services/jarvis/stop", "POST /api/services/image-engine/stop"], "Agent Builder and stopped services are left alone");
const resumed = await exitGameMode();
assert.deepEqual(resumed.startedServices, ["jarvis"], "resume starts Jarvis again; the image engine waits until it is needed");
assert.equal(calls.at(-1), "POST /api/services/jarvis/start");
fakeHost.close();
process.env.HOST_MANAGER_URL = "http://127.0.0.1:9";

// Leave nothing running: stop the throwaway server again.
await enterGameMode();
GameMode.off();
server.kill();
console.log("game mode: all checks passed");
process.exit(0);
