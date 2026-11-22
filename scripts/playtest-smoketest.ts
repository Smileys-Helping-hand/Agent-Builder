/**
 * The playtest engine, on a tiny fixture game: real key presses reach the game, expectations pass and fail
 * honestly, a frozen game is caught, script errors are caught.
 *
 *   npm run test:playtest
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Playtest } from "../src/game/Playtest.js";

const game = (frozen: boolean, broken: boolean) => `<!doctype html><html><body><canvas id="c" width="200" height="100"></canvas><script>
  const v = { scene: "title", frame: 0, x: 0, jumps: 0 };
  window.__fixture = v;
  const held = new Set();
  addEventListener("keydown", (e) => { held.add(e.key); if (e.key === "Enter") v.scene = "play"; if (e.key === " ") v.jumps++; });
  addEventListener("keyup", (e) => held.delete(e.key));
  ${broken ? 'setTimeout(() => { throw new Error("boom in the game loop"); }, 300);' : ""}
  const loop = () => { if (!${frozen}) { v.frame++; if (v.scene === "play" && held.has("ArrowRight")) v.x += 4; } requestAnimationFrame(loop); };
  loop();
</script></body></html>`;

const make = (name: string, frozen = false, broken = false) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ab-playtest-${name}-`));
  fs.writeFileSync(path.join(dir, "index.html"), game(frozen, broken));
  return dir;
};

const scenario = (extra: object[] = []) => ({
  hook: "__fixture",
  steps: [
    { label: "title", waitFor: "v && v.scene === 'title'", timeoutMs: 8000 },
    { label: "start", press: "Enter" },
    { label: "playing", waitFor: "v.scene === 'play'", timeoutMs: 3000 },
    { label: "note x", remember: { x0: "v.x" } },
    { label: "run", hold: "ArrowRight", ms: 600 },
    { label: "moved", expect: "v.x > mem.x0 + 20" },
    { label: "jump", press: "Space" },
    { label: "jumped", expect: "v.jumps === 1" },
    ...extra
  ]
});

let passed = 0;
const check = async (name: string, fn: () => Promise<void>) => {
  await fn();
  passed++;
  console.log(`[PASS] ${name}`);
};

await check("a game that responds to keys passes its scenario", async () => {
  const result = await Playtest.run(make("ok"), scenario());
  assert.equal(result.passed, true, JSON.stringify(result.steps.filter((s) => !s.passed)));
  assert.equal(result.steps.length, 8);
  assert.equal(result.frozen, false);
});

await check("an expectation that is not met fails the playtest, and it stops there with what the game said", async () => {
  const result = await Playtest.run(make("fail"), scenario([{ label: "won", expect: "v.scene === 'won'" }]));
  assert.equal(result.passed, false);
  const failed = result.steps.at(-1)!;
  assert.equal(failed.label, "won");
  assert.match(failed.detail, /→ false/);
});

await check("a frozen game fails even when every step passes", async () => {
  const result = await Playtest.run(make("frozen", true), { hook: "__fixture", steps: [{ label: "title", waitFor: "v && v.scene === 'title'", timeoutMs: 8000 }] });
  assert.equal(result.frozen, true);
  assert.equal(result.passed, false);
});

await check("a script error in the game fails the playtest", async () => {
  const result = await Playtest.run(make("broken", false, true), { hook: "__fixture", steps: [{ label: "title", waitFor: "v && v.scene === 'title'", timeoutMs: 8000 }, { label: "let it run", wait: 800 }] });
  assert.ok(result.errors.some((e) => /boom in the game loop/.test(e)), JSON.stringify(result.errors));
  assert.equal(result.passed, false);
});

console.log(`\nAll ${passed} playtest checks passed.`);
process.exit(0);
