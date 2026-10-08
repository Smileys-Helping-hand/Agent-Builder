/**
 * The Studio's library without the image engine: bring pictures in, find,
 * rename and tag them, pack them as a game asset pack, put them in a build,
 * delete them. Drawing itself needs ComfyUI and is tried by hand.
 *
 *   npm run test:art
 */
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ab-art-"));
process.env.ART_DIR = path.join(dir, "art");
const { ArtLibrary } = await import("../src/media/ArtLibrary.js");

// A 1×1 PNG stands in for a drawing.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const source = path.join(dir, "in.png");
fs.writeFileSync(source, png);

const barracks = ArtLibrary.importFile(source, { name: "Stone Barracks!", subject: "a stone barracks with a red roof", kind: "sprite", tags: ["building"] });
const sky = ArtLibrary.importFile(source, { name: "sky", subject: "a sunset sky", kind: "background" });
assert.equal(barracks.name, "stone-barracks", "names are file-safe");
assert.ok(fs.existsSync(ArtLibrary.fileOf(barracks)));
assert.equal(ArtLibrary.list().length, 2);
assert.deepEqual(ArtLibrary.list({ q: "red roof" }).map((i) => i.id), [barracks.id], "searched by its prompt");
assert.deepEqual(ArtLibrary.list({ kind: "background" }).map((i) => i.id), [sky.id], "filtered by kind");
assert.deepEqual(ArtLibrary.list({ q: "building" }).map((i) => i.id), [barracks.id], "searched by tag");

const renamed = ArtLibrary.update(barracks.id, { name: "Barracks", tags: ["army", " ", "x".repeat(50)] });
assert.equal(renamed?.name, "barracks");
assert.deepEqual(renamed?.tags, ["army", "x".repeat(30)], "blank tags dropped, long ones cut");

// An asset pack: PNGs under their names plus the manifest games read; two of one name both kept.
const twin = ArtLibrary.importFile(source, { name: "barracks", subject: "another barracks", kind: "sprite" });
const packDir = path.join(dir, "pack");
const { files, manifest } = ArtLibrary.pack([barracks.id, twin.id, sky.id, "missing"], packDir);
assert.deepEqual(files.sort(), ["barracks-2.png", "barracks.png", "manifest.json", "sky.png"]);
assert.deepEqual(Object.keys((manifest as { assets: object }).assets).sort(), ["barracks", "barracks-2", "sky"]);
assert.equal(JSON.parse(fs.readFileSync(path.join(packDir, "manifest.json"), "utf8")).assets.sky.file, "assets/sky.png");

// Into a build: merged into the manifest it already has.
const project = path.join(dir, "project");
fs.mkdirSync(path.join(project, "public", "assets"), { recursive: true });
fs.writeFileSync(path.join(project, "public", "assets", "manifest.json"), JSON.stringify({ style: "pixel", assets: { hero: { file: "assets/hero.png" } } }));
assert.deepEqual(ArtLibrary.useIn(project, [sky.id, "missing"]), ["sky"]);
const merged = JSON.parse(fs.readFileSync(path.join(project, "public", "assets", "manifest.json"), "utf8"));
assert.deepEqual(Object.keys(merged.assets).sort(), ["hero", "sky"], "the build's own pictures stay");
assert.equal(merged.style, "pixel");
assert.ok(fs.existsSync(path.join(project, "public", "assets", "sky.png")));

// Drawing refuses an empty prompt and caps variations, before any engine is called.
assert.throws(() => ArtLibrary.draw({ subject: "   " }), /Say what to draw/);
assert.throws(() => ArtLibrary.edit(sky.id, " "), /Say what to change/);
assert.throws(() => ArtLibrary.edit("missing", "blue"), /No such picture/);

// An edit's prompt leads with the change and drops what it overrides.
const { editPrompt } = await import("../src/media/ArtLibrary.js");
assert.deepEqual(editPrompt("a medieval stone barracks with a red roof and banners", "make the roof blue"), { subject: "(blue roof:1.4), a medieval stone barracks, banners", avoid: "a red roof" });
assert.deepEqual(editPrompt("a red sports car seen from above", "turn the car green"), { subject: "(green car:1.4), a sports car seen from above", avoid: "red" });
assert.deepEqual(editPrompt("a knight in silver armour, full body", "add a red cape"), { subject: "(a red cape:1.4), a knight in silver armour, full body", avoid: "" }, "adding keeps the colours there are");

assert.equal(ArtLibrary.remove(sky.id), true);
assert.equal(ArtLibrary.remove(sky.id), false);
assert.ok(!fs.existsSync(ArtLibrary.fileOf(sky)), "its file goes too");
assert.equal(ArtLibrary.list().length, 2);

// MediaGen, against a stand-in that answers the way its API does.
const http = await import("http");
const seen: { method: string; url: string; auth: string; body: Record<string, unknown> | null }[] = [];
const mock = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    seen.push({ method: req.method ?? "", url: req.url ?? "", auth: String(req.headers.authorization ?? ""), body: raw ? JSON.parse(raw) : null });
    res.setHeader("Content-Type", "application/json");
    if (req.headers.authorization !== "Bearer test-media-key-0123456789abcdef") return res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" }));
    if (req.url === "/api/system-stats") return res.end(JSON.stringify({ online: false, status: "OFFLINE" }));
    if (req.url?.startsWith("/api/jobs?")) {
      return res.end(JSON.stringify({ records: [{ id: "j1", prompt: "a fox", status: "completed", mediaType: "image", mediaUrl: "http://x/a.png" }, { id: "j2", prompt: "b", status: "processing", mediaUrl: null }] }));
    }
    if (req.method === "POST" && req.url === "/api/jobs") return res.end(JSON.stringify({ success: true, job: { id: "j3", status: "queued" } }));
    res.writeHead(404).end("{}");
  });
});
await new Promise<void>((resolve) => mock.listen(0, "127.0.0.1", resolve));
const port = (mock.address() as { port: number }).port;
const { MediaGen } = await import("../src/media/MediaGen.js");
assert.equal(MediaGen.configured(), false);
assert.deepEqual(await MediaGen.status(), { configured: false, reachable: false, workerOnline: null, url: null });
process.env.MEDIAGEN_URL = `http://127.0.0.1:${port}/`;
process.env.MEDIAGEN_API_KEY = "wrong-key";
assert.match((await MediaGen.status()).error ?? "", /did not accept the key/);
process.env.MEDIAGEN_API_KEY = "test-media-key-0123456789abcdef";
const mgStatus = await MediaGen.status();
assert.equal(mgStatus.reachable, true);
assert.equal(mgStatus.workerOnline, false, "read from its online flag, not the 200");
assert.deepEqual((await MediaGen.gallery()).map((j) => j.id), ["j1"], "only finished items with a file");
await assert.rejects(MediaGen.queue({ prompt: "x", type: "video_short" }), /starts from a picture/);
const queued = await MediaGen.queue({ prompt: "a barracks", type: "video_short", fromFile: ArtLibrary.fileOf(barracks) });
assert.equal(queued.id, "j3");
const posted = seen.find((s) => s.method === "POST")!.body!;
assert.equal(posted.mediaType, "video_short");
assert.match(String(posted.referenceImage), /^data:image\/png;base64,/, "the picture travels inline");
mock.close();

fs.rmSync(dir, { recursive: true, force: true });
console.log("art library: all checks passed");
