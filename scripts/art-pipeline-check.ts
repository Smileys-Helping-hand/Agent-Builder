/**
 * The art routes Jarvis's pipeline uses, on a throwaway copy: draw (Enhance,
 * Surprise words only — the engine is not started), deliver and import.
 *
 *   npx tsx scripts/art-pipeline-check.ts <copy of data/art>
 *
 * Run it from an empty folder: it makes its own data/users.db and agent key there.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import express from "express";

const artDir = path.resolve(process.argv[2] ?? "");
if (!fs.existsSync(path.join(artDir, "library.json"))) throw new Error("Pass a copy of data/art (with library.json).");
process.env.ART_DIR = artDir;

const { AgentKeyModel } = await import("../src/models/AgentKeyModel.js");
const { registerArtRoutes } = await import("../src/server/art.js");

const app = express();
app.use("/api/art/import", express.json({ limit: "18mb" }));
app.use(express.json());
registerArtRoutes(app);
const server = app.listen(0);
const port = (server.address() as { port: number }).port;
const { secret: readKey } = AgentKeyModel.issue("check-read", ["read"]);
const { secret: writeKey } = AgentKeyModel.issue("check-write", ["read", "write"]);

const call = async (method: string, route: string, key: string, body?: unknown) => {
  const res = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { "x-agent-key": key, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

try {
  const library = JSON.parse(fs.readFileSync(path.join(artDir, "library.json"), "utf8")) as Array<{ id: string; name: string }>;
  const ids = library.map((item) => item.id);

  // Deliver: the bytes of real pictures, PNG sizes read from the file.
  const delivered = await call("POST", "/api/art/deliver", readKey, { ids: [...ids, "art-missing"], jobs: ["job-gone"] });
  assert.equal(delivered.status, 200);
  assert.ok(delivered.body.images.length >= 1, "at least one picture comes back");
  const first = delivered.body.images[0];
  assert.equal(first.mime, "image/png");
  assert.ok(first.width > 0 && first.height > 0);
  assert.equal(Buffer.from(first.base64, "base64").subarray(1, 4).toString("ascii"), "PNG");
  const total = delivered.body.images.reduce((n: number, i: { base64: string }) => n + i.base64.length, 0);
  assert.ok(delivered.body.images.length === 1 || total <= 3_000_000, "one delivery stays small enough for the cloud");
  assert.equal(delivered.body.images.length + delivered.body.rest.length, ids.length);
  assert.equal(delivered.body.failed.length, 2, "the missing picture and the lost job are named");
  console.log(`ok  deliver: ${delivered.body.images.length} sent (${Math.round(total / 1024)} kB), ${delivered.body.rest.length} for next time, ${delivered.body.failed.length} named as gone`);

  // Import: a picture from Jarvis into the library, as a sprite.
  const before = library.length;
  const imported = await call("POST", "/api/art/import", writeKey, { base64: first.base64, subject: "a picture Jarvis sent", kind: "sprite", tags: ["r12-1"] });
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.item.kind, "sprite");
  assert.deepEqual(imported.body.item.tags, ["jarvis", "r12-1"]);
  const after = JSON.parse(fs.readFileSync(path.join(artDir, "library.json"), "utf8")) as unknown[];
  assert.equal(after.length, before + 1);
  console.log(`ok  import: kept as "${imported.body.item.name}" (${imported.body.item.bytes} bytes)`);

  // Import refuses what is not a picture, and a read-only key.
  assert.equal((await call("POST", "/api/art/import", writeKey, { base64: Buffer.from("not a picture at all, just words".repeat(10)).toString("base64") })).status, 400);
  assert.equal((await call("POST", "/api/art/import", readKey, { base64: first.base64 })).status, 403);
  console.log("ok  import refuses text, and a read-only key");

  // A big picture (over 100 kB) gets through the route's own body limit.
  const big = Buffer.concat([Buffer.from(first.base64, "base64"), Buffer.alloc(400_000)]).toString("base64");
  assert.equal((await call("POST", "/api/art/import", writeKey, { base64: big, name: "big one" })).status, 200);
  console.log("ok  import takes a picture bigger than the default 100 kB body");
} finally {
  server.close();
}
