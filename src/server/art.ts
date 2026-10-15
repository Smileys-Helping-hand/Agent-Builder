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
import { PromptCraft } from "../media/PromptCraft.js";
import { MediaGen } from "../media/MediaGen.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { signLink, verifyLink } from "../utils/SignedLinks.js";
import { authenticateAgent } from "./agentAuth.js";

const run = promisify(execFile);
const KINDS: ArtKind[] = ["sprite", "background", "icon", "ui", "image", "photo"];
const SHAPES = ["wide", "square", "tall"] as const;
const kindOf = (value: unknown): ArtKind | undefined => (KINDS.includes(value as ArtKind) ? (value as ArtKind) : undefined);

/** One delivery's pictures: few enough, and small enough together, for Jarvis's cloud to take in one request. */
const DELIVER_COUNT = 4;
const DELIVER_CHARS = 3_000_000;

/** What a picture's bytes are, from their first bytes rather than a name. */
const mimeOf = (bytes: Buffer): string =>
  bytes[0] === 0x89 && bytes.toString("ascii", 1, 4) === "PNG"
    ? "image/png"
    : bytes[0] === 0xff && bytes[1] === 0xd8
      ? "image/jpeg"
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
        ? "image/webp"
        : "application/octet-stream";

/** A PNG's width and height (its IHDR); unknown for the rest. */
const sizeOf = (bytes: Buffer): { width: number | null; height: number | null } =>
  mimeOf(bytes) === "image/png" && bytes.length > 24 ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : { width: null, height: null };

export const registerArtRoutes = (app: Express) => {
  app.get("/api/art/status", authenticateAgent("read"), async (_req: Request, res: Response) => {
    res.json({ engine: await ArtStudio.state(), mediagen: await MediaGen.status() });
  });

  // Better words from a few ("a dragon" → a picture), and an idea when there is none.
  app.post("/api/art/enhance", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      res.json(await PromptCraft.enhance(String(body.subject ?? ""), kindOf(body.kind) ?? "image"));
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/art/idea", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      res.json(await PromptCraft.surprise(kindOf(body.kind) ?? "image"));
    } catch (error) {
      res.status(503).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.post("/api/art/draw", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      // From a request in a few words (Jarvis in chat): an idea when there is
      // none (surprise), richer words when asked (enhance). Both answer at once.
      const kind = kindOf(body.kind) ?? "sprite";
      let subject = String(body.subject ?? body.prompt ?? "").trim();
      let wording: "model" | "instant" | null = null;
      if (!subject && (body.surprise === true || body.surprise === "true")) ({ subject, by: wording } = await PromptCraft.surprise(kind));
      else if (subject && (body.enhance === true || body.enhance === "true")) ({ subject, by: wording } = await PromptCraft.enhance(subject, kind));
      const jobs = ArtLibrary.draw({
        subject,
        name: typeof body.name === "string" ? body.name : undefined,
        kind: kindOf(body.kind),
        style: typeof body.style === "string" ? body.style : undefined,
        seed: Number.isFinite(Number(body.seed)) && body.seed !== undefined && body.seed !== "" ? Number(body.seed) : undefined,
        count: Number(body.count) || 1,
        size: SHAPES.includes(body.size as (typeof SHAPES)[number]) ? (body.size as (typeof SHAPES)[number]) : undefined
      });
      res.json({ jobs, subject, ...(wording ? { wording } : {}) });
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

  // The pictures themselves, for Jarvis: he keeps his own copy (his media, his
  // chat). As many as fit in one answer his cloud accepts; the rest are named
  // in `rest` for the next request. A job still drawing is counted as pending.
  app.post("/api/art/deliver", authenticateAgent("read"), (req: Request, res: Response) => {
    const list = (value: unknown) => (Array.isArray(value) ? (value as unknown[]).map(String).slice(0, 40) : []);
    const ids = list(req.body?.ids);
    let pending = 0;
    const failed: string[] = [];
    for (const jobId of list(req.body?.jobs)) {
      const job = ArtLibrary.job(jobId);
      if (!job) failed.push(`${jobId}: not on this PC (lost in a restart)`);
      else if (job.state === "failed") failed.push(job.error ?? "the drawing failed");
      else if (job.item) ids.push(job.item.id);
      else pending += 1;
    }
    const images: Array<{ id: string; name: string; kind: ArtKind; subject: string; mime: string; width: number | null; height: number | null; base64: string }> = [];
    const rest: string[] = [];
    let total = 0;
    for (const id of [...new Set(ids)]) {
      const item = ArtLibrary.get(id);
      const file = item ? ArtLibrary.fileOf(item) : "";
      if (!item || !fs.existsSync(file)) {
        failed.push(`${id}: removed from the library`);
        continue;
      }
      const bytes = fs.readFileSync(file);
      const base64 = bytes.toString("base64");
      if (images.length >= DELIVER_COUNT || total + base64.length > DELIVER_CHARS) {
        // One too big on its own still goes, alone.
        if (images.length > 0) {
          rest.push(id);
          continue;
        }
      }
      total += base64.length;
      images.push({ id: item.id, name: item.name, kind: item.kind, subject: item.subject, mime: mimeOf(bytes), ...sizeOf(bytes), base64 });
    }
    res.json({ images, rest, pending, failed });
  });

  // A picture from Jarvis (his media: a texture, a picture ComfyUI made for
  // him, one he was sent) into the library, so a build can use it.
  app.post("/api/art/import", authenticateAgent("write"), (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const bytes = Buffer.from(String(body.base64 ?? "").replace(/\s+/g, ""), "base64");
    const mime = mimeOf(bytes);
    if (bytes.length < 100 || mime === "application/octet-stream") return res.status(400).json({ error: "That is not a PNG, JPEG or WebP picture." });
    if (bytes.length > 12 * 1024 * 1024) return res.status(413).json({ error: "That picture is bigger than 12 MB." });
    const subject = String(body.subject ?? "").trim().slice(0, 600);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "art-import-"));
    try {
      const file = path.join(tmp, `picture${mime === "image/jpeg" ? ".jpg" : mime === "image/webp" ? ".webp" : ".png"}`);
      fs.writeFileSync(file, bytes);
      const tags = Array.isArray(body.tags) ? (body.tags as unknown[]).map(String).filter(Boolean).slice(0, 8) : [];
      const item = ArtLibrary.importFile(file, {
        name: String(body.name ?? "").trim() || subject.split(/[,.]/)[0].split(/\s+/).slice(0, 3).join(" ") || "picture",
        subject: subject || String(body.name ?? "a picture"),
        kind: kindOf(body.kind) ?? "image",
        tags: [...new Set(["jarvis", ...tags])]
      });
      res.json({ item });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
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
