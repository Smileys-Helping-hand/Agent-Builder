/**
 * Smoke test for game mode, against a throwaway Ollama the test starts on its
 * own port (default 11436), so the real one is never touched.
 *
 *   npm run test:game-mode
 */
import { spawn } from "node:child_process";
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

// Leave nothing running: stop the throwaway server again.
await enterGameMode();
GameMode.off();
server.kill();
console.log("game mode: all checks passed");
process.exit(0);
