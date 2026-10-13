/**
 * Jarvis's library: what the bridge records, and how answers become ids.
 *
 *   npm run test:jarvis-library
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ab-library-"));
process.env.KNOWLEDGE_DB_PATH = path.join(tmp, "knowledge.db");

const { JarvisLibrary, idsIn } = await import("../src/state/JarvisLibrary.js");

// Ids, wherever a route puts them.
assert.deepEqual(idsIn({ buildId: "build_1" }), ["build_1"]);
assert.deepEqual(idsIn({ build: { buildId: "build_2" } }), ["build_2"]);
assert.deepEqual(idsIn({ jobs: [{ id: "a" }, { id: "b" }] }), ["a", "b"]);
assert.deepEqual(idsIn({ job: { id: "m1" } }), ["m1"]);
assert.deepEqual(idsIn({ idea: { id: "idea-1" } }), ["idea-1"]);
assert.deepEqual(idsIn({ id: 7 }), ["7"]);
assert.deepEqual(idsIn(null), []);

// Only requests that make something are kept.
assert.equal(JarvisLibrary.makes("art.draw"), true);
assert.equal(JarvisLibrary.makes("builds"), false);
assert.equal(JarvisLibrary.record("builds", {}, 200, { builds: [] }), null);

const build = JarvisLibrary.record("build", { title: "Bakery site", message: "A site for a bakery with an order form" }, 200, { buildId: "build_9" });
assert.ok(build);
assert.equal(build.kind, "build");
assert.equal(build.title, "Bakery site");
assert.equal(build.request, "A site for a bakery with an order form");
assert.deepEqual(build.refs, ["build_9"]);

const drawing = JarvisLibrary.record("art.draw", { subject: "a red dragon sprite", kind: "sprite" }, 200, { jobs: [{ id: "j1" }, { id: "j2" }] });
assert.equal(drawing?.kind, "picture");
assert.equal(drawing?.title, "a red dragon sprite");
assert.deepEqual(drawing?.refs, ["j1", "j2"]);

// An app answer does not repeat the build id: it comes from what was asked.
const app = JarvisLibrary.record("app.make", { buildId: "build_9", platform: "android" }, 200, { state: "building" });
assert.deepEqual(app?.refs, ["build_9"]);
assert.equal(app?.platform, "android");

// A refusal is kept with its reason.
const refused = JarvisLibrary.record("media.generate", { prompt: "a sunset" }, 400, { error: "MediaGen is not set up" });
assert.equal(refused?.error, "MediaGen is not set up");

// Newest first, by kind, results saved, removable.
assert.deepEqual(JarvisLibrary.list().map((entry) => entry.action), ["media.generate", "app.make", "art.draw", "build"]);
assert.equal(JarvisLibrary.list({ kind: "picture" }).length, 1);
JarvisLibrary.saveResults(drawing!.id, ["pic1", "pic2"]);
assert.deepEqual(JarvisLibrary.get(drawing!.id)?.results, ["pic1", "pic2"]);
assert.ok(JarvisLibrary.buildRefs().has("build_9"));
assert.equal(JarvisLibrary.remove(refused!.id), true);
assert.equal(JarvisLibrary.list().length, 3);

try {
  fs.rmSync(tmp, { recursive: true, force: true });
} catch {
  // The database is still open on Windows; left in the temp folder.
}
console.log("jarvis library: all checks passed");
