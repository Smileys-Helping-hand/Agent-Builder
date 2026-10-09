/**
 * The Studio's API: draw, watch, edit, find, download and reuse pictures.
 *
 *   GET    /api/art/status                  is the image engine up, and is MediaGen connected
 *   POST   /api/art/draw                    { subject, name?, kind?, style?, seed?, count? } → jobs
 *   POST   /api/art/:id/edit                { change, strength? } → job
 *   GET    /api/art/jobs                    recent jobs, newest first
 *   GET    /api/art/jobs/:id                one job: state, progress, the finished picture
 *   GET    /api/art/jobs/:id/preview        the latest preview frame while it draws (JPEG)
 *   GET    /api/art                         the library (?q= words, ?kind=)
 *   GET    /api/art/:id                     one picture's details
 *   PATCH  /api/art/:id                     { name?, tags? }
 *   DELETE /api/art/:id
 *   POST   /api/art/:id/link                a signed hour-long link to the PNG (for <img> and downloads)
 *   GET    /api/art/:id/image?t=            the PNG
 *   POST   /api/art/pack                    { ids } → a signed link to a game asset pack zip (PNGs + manifest.json)
 *   POST   /api/art/use                     { buildId, ids } → copied into that build's public/assets
 *
 * Drawing and editing need the execute scope (they use the GPU); looking needs read.
 */
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";

import type { Express, Request, Response } from "express";

import { ArtLibrary } from "../media/ArtLibrary.js";
import { ArtStudio, type ArtKind } from "../media/ArtStudio.js";
import { MediaGen } from "../media/MediaGen.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { signLink, verifyLink } from "../utils/SignedLinks.js";
import { authenticateAgent } from "./agentAuth.js";

const run = promisify(execFile);
const KINDS: ArtKind[] = ["sprite", "background", "icon", "ui"];
const kindOf = (value: unknown): ArtKind | undefined => (KINDS.includes(value as ArtKind) ? (value as ArtKind) : undefined);

export const registerArtRoutes = (app: Express) => {
  app.get("/api/art/status", authenticateAgent("read"), async (_req: Request, res: Response) => {
    res.json({ engine: (await ArtStudio.available()) ? "ready" : "offline", mediagen: await MediaGen.status() });
  });

  app.post("/api/art/draw", authenticateAgent("execute"), (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const jobs = ArtLibrary.draw({
        subject: String(body.subject ?? body.prompt ?? ""),
        name: typeof body.name === "string" ? body.name : undefined,
        kind: kindOf(body.kind),
        style: typeof body.style === "string" ? body.style : undefined,
        seed: Number.isFinite(Number(body.seed)) && body.seed !== undefined && body.seed !== "" ? Number(body.seed) : undefined,
        count: Number(body.count) || 1
      });
      res.json({ jobs });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/art/jobs", authenticateAgent("read"), (_req: Request, res: Response) => res.json({ jobs: ArtLibrary.jobs() }));

  app.get("/api/art/jobs/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const job = ArtLibrary.job(req.params.id);
    if (!job) return res.status(404).json({ error: "No such job (they are kept for six hours)." });
    res.json(job);
  });

  app.get("/api/art/jobs/:id/preview", authenticateAgent("read"), (req: Request, res: Response) => {
    const frame = ArtLibrary.preview(req.params.id);
    if (!frame) return res.status(404).end();
    res.setHeader("Content-Type", frame[0] === 0x89 ? "image/png" : "image/jpeg");
    res.setHeader("Cache-Control", "no-store");
    res.end(frame);
  });

  app.get("/api/art", authenticateAgent("read"), (req: Request, res: Response) => {
    // Each with a signed hour-long link, so the Studio shows thumbnails with plain <img> tags.
    const items = ArtLibrary.list({ q: typeof req.query.q === "string" ? req.query.q : undefined, kind: kindOf(req.query.kind), limit: Number(req.query.limit) || undefined });
    res.json({
      items: items.map((item) => ({ ...item, url: `/api/art/${encodeURIComponent(item.id)}/image?t=${encodeURIComponent(signLink("art-image", item.id, 60 * 60 * 1000))}` }))
    });
  });

  app.post("/api/art/pack", authenticateAgent("read"), async (req: Request, res: Response) => {
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String).slice(0, 200) : [];
    if (ids.length === 0) return res.status(400).json({ error: "Pick the pictures to pack." });
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), "art-pack-"));
    try {
      const { files } = ArtLibrary.pack(ids, path.join(staging, "assets"));
      fs.writeFileSync(
        path.join(staging, "README.txt"),
        "A game asset pack from Agent Builder.\r\n\r\nPut the assets folder in your project's public/ folder (public/assets/...).\r\nGames made by Agent Builder read assets/manifest.json and draw every picture it names.\r\n"
      );
      const packs = path.resolve("data/packages");
      fs.mkdirSync(packs, { recursive: true });
      const zip = path.join(packs, `art-pack-${Date.now()}.zip`);
      const systemTar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : "tar";
      await run(fs.existsSync(systemTar) ? systemTar : "tar", ["-a", "-c", "-f", zip, "-C", staging, "."], { windowsHide: true, timeout: 120_000 });
      const token = signLink("art-pack", path.basename(zip), 60 * 60 * 1000);
      res.json({ path: `/api/art/pack/${encodeURIComponent(path.basename(zip))}?t=${encodeURIComponent(token)}`, files: files.length, expiresInMinutes: 60 });
    } catch (error) {
      res.status(500).json({ error: `Could not pack them: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  });

  app.get("/api/art/pack/:file", (req: Request, res: Response) => {
    if (!/^art-pack-\d+\.zip$/.test(req.params.file) || !verifyLink("art-pack", req.params.file, req.query.t)) return res.status(403).json({ error: "That link has expired." });
    const zip = path.resolve("data/packages", req.params.file);
    if (!fs.existsSync(zip)) return res.status(404).json({ error: "That pack is gone." });
    res.download(zip, "asset-pack.zip");
  });

  app.post("/api/art/use", authenticateAgent("execute"), (req: Request, res: Response) => {
    const build = BuildService.view(String(req.body?.buildId ?? ""));
    if (!build?.outputDir || !fs.existsSync(build.outputDir)) return res.status(404).json({ error: "Unknown build, or its folder is gone." });
    const ids = Array.isArray(req.body?.ids) ? (req.body.ids as unknown[]).map(String) : [];
    const added = ArtLibrary.useIn(path.resolve(build.outputDir), ids);
    res.json({ added, note: added.length ? "In the build's public/assets and its manifest; the game draws them after its next build." : "Nothing was added." });
  });

  // MediaGen: video from a picture, cloud-queued images, and its gallery.
  app.post("/api/art/mediagen/queue", authenticateAgent("execute"), async (req: Request, res: Response) => {
    try {
      const type = ["image_fast", "image_hd", "video_short"].includes(req.body?.type) ? req.body.type : "image_fast";
      const from = req.body?.fromId ? ArtLibrary.get(String(req.body.fromId)) : null;
      const job = await MediaGen.queue({ prompt: String(req.body?.prompt ?? from?.subject ?? ""), type, aspectRatio: req.body?.aspectRatio, fromFile: from ? ArtLibrary.fileOf(from) : undefined });
      res.json({ job });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/art/mediagen/jobs/:id", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json(await MediaGen.job(req.params.id));
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/art/mediagen/gallery", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json({ items: await MediaGen.gallery(typeof req.query.q === "string" ? req.query.q : undefined) });
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/art/mediagen/import", authenticateAgent("write"), async (req: Request, res: Response) => {
    try {
      const job = await MediaGen.job(String(req.body?.jobId ?? ""));
      if (job.status !== "completed") return res.status(409).json({ error: "That item is not finished yet." });
      if (job.mediaType === "video") return res.status(400).json({ error: "Videos stay in MediaGen; download them from there.", mediaUrl: job.mediaUrl });
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mediagen-"));
      try {
        const file = await MediaGen.download(job, tmp);
        res.json({ item: ArtLibrary.importFile(file, { name: job.prompt.split(/[,.]/)[0].slice(0, 40), subject: job.prompt, kind: "background", tags: ["mediagen", job.modelType] }) });
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    } catch (error) {
      res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/art/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const item = ArtLibrary.get(req.params.id);
    if (!item) return res.status(404).json({ error: "No such picture." });
    res.json(item);
  });

  app.patch("/api/art/:id", authenticateAgent("write"), (req: Request, res: Response) => {
    const item = ArtLibrary.update(req.params.id, { name: req.body?.name, tags: req.body?.tags });
    if (!item) return res.status(404).json({ error: "No such picture." });
    res.json(item);
  });

  app.delete("/api/art/:id", authenticateAgent("write"), (req: Request, res: Response) => {
    if (!ArtLibrary.remove(req.params.id)) return res.status(404).json({ error: "No such picture." });
    res.json({ ok: true });
  });

  app.post("/api/art/:id/edit", authenticateAgent("execute"), (req: Request, res: Response) => {
    try {
      const strength = Number(req.body?.strength);
      res.json({ job: ArtLibrary.edit(req.params.id, String(req.body?.change ?? ""), Number.isFinite(strength) && strength > 0 ? strength : undefined) });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/art/:id/link", authenticateAgent("read"), (req: Request, res: Response) => {
    const item = ArtLibrary.get(req.params.id);
    if (!item) return res.status(404).json({ error: "No such picture." });
    const token = signLink("art-image", item.id, 60 * 60 * 1000);
    res.json({ path: `/api/art/${encodeURIComponent(item.id)}/image?t=${encodeURIComponent(token)}`, expiresInMinutes: 60 });
  });

  app.get(
    "/api/art/:id/image",
    (req: Request, res: Response, next) => {
      if (!verifyLink("art-image", req.params.id, req.query.t)) return authenticateAgent("read")(req, res, next);
      next();
    },
    (req: Request, res: Response) => {
      const item = ArtLibrary.get(req.params.id);
      if (!item || !fs.existsSync(ArtLibrary.fileOf(item))) return res.status(404).json({ error: "No such picture." });
      res.setHeader("Cache-Control", "private, max-age=3600");
      if (req.query.download) res.download(ArtLibrary.fileOf(item), `${item.name}.png`);
      else res.sendFile(ArtLibrary.fileOf(item));
    }
  );
};
