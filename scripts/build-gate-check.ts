/**
 * BuildGate: a paused build waits at its next model call; practice waits while
 * someone's build runs; both carry on the moment that changes.
 *
 *   npx tsx scripts/build-gate-check.ts
 */
import assert from "node:assert/strict";

import { BuildGate, buildGateEvents } from "../src/utils/BuildGate.js";

const settled = async (promise: Promise<void>, ms = 50): Promise<boolean> =>
  Promise.race([promise.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms))]);

const events: string[] = [];
buildGateEvents.on("waiting", ({ buildId, why }: { buildId: string; why: string | null }) => events.push(`${buildId}:${why ?? "go"}`));

// Nothing registered: never held.
assert.ok(await settled(BuildGate.wait("anything")));
assert.ok(await settled(BuildGate.wait(undefined)));

// Practice alone runs.
BuildGate.register("practice", "background");
assert.ok(await settled(BuildGate.wait("practice")));
console.log("ok  practice alone is never held");

// Someone's build starts: practice waits, theirs does not.
BuildGate.register("mine", "foreground");
const practiceCall = BuildGate.wait("practice");
assert.equal(await settled(practiceCall), false, "practice is held while someone's build runs");
assert.ok(await settled(BuildGate.wait("mine")), "the person's build goes straight through");
console.log("ok  practice yields the graphics card to someone's build");

// Pausing theirs lets practice through; resuming holds practice again.
BuildGate.setPaused("mine", true);
assert.ok(await settled(practiceCall), "practice goes on while theirs is paused");
assert.equal(await settled(BuildGate.wait("mine")), false, "a paused build is held at its next model call");
console.log("ok  a paused build stops at its next model call (and practice uses the time)");

BuildGate.setPaused("mine", false);
const again = BuildGate.wait("practice");
assert.equal(await settled(again), false);
BuildGate.release("mine");
assert.ok(await settled(again), "practice carries on the moment theirs ends");
console.log("ok  practice carries on the moment the person's build ends");

assert.ok(events.includes("practice:yielding") && events.includes("mine:paused"), events.join(" "));
BuildGate.reset();
console.log("\nall gate checks passed");
process.exit(0);
