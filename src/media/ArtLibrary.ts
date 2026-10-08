/**
 * ArtLibrary — every picture made on this PC, kept to be found and used again.
 *
 * The Studio tab, Jarvis and the API all draw through here: a job per
 * picture (one at a time, the card is shared with the coding model), live
 * progress and the image engine's preview frames while it draws, and each
 * finished picture saved with what it was asked for, so it can be edited
 * ("make the roof blue"), drawn again in variations, downloaded, packed as a
 * game asset pack (the same manifest the game boards read), or dropped
 * straight into a build's public/assets.
 *
 * Stored in data/art: one PNG per picture and library.json.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

import { Logger } from "../utils/Logger.js";
import { ArtStudio, artName, artWorkflow, type ArtKind } from "./ArtStudio.js";

export interface ArtItem {
  id: string;
  /** A short name, also its key in a game's manifest: "barracks". */
  name: string;
  subject: string;
  style: string;
  kind: ArtKind;
  seed: number;
  /** The picture it was edited from, if any. */
  parent: string | null;
  /** The change asked for, for an edit. */
  edit: string | null;
  file: string;
  bytes: number;
  createdAt: string;
  tags: string[];
}

export interface ArtJob {
  id: string;
  state: "queued" | "drawing" | "done" | "failed";
  request: { name: string; subject: string; style: string; kind: ArtKind; seed: number; parent: string | null; edit: string | null; strength: number | null };
  /** Steps done of steps, while drawing. */
  progress: { value: number; max: number };
  /** The latest preview frame has come in (fetch it from the preview route). */
  hasPreview: boolean;
  item: ArtItem | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const DIR = () => path.resolve(process.env.ART_DIR ?? "data/art");
const INDEX = () => path.join(DIR(), "library.json");

const jobs = new Map<string, ArtJob>();
const previews = new Map<string, Buffer>();
let queue: Promise<unknown> = Promise.resolve();

const readIndex = (): ArtItem[] => {
  try {
    return JSON.parse(fs.readFileSync(INDEX(), "utf8")) as ArtItem[];
  } catch {
    return [];
  }
};

const writeIndex = (items: ArtItem[]) => {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(INDEX(), JSON.stringify(items, null, 2));
};

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`;

const run = (job: ArtJob) => {
  queue = queue.then(async () => {
    job.state = "drawing";
    try {
      const { request } = job;
      let source: string | undefined;
      if (request.parent) {
        const parent = ArtLibrary.get(request.parent);
        if (!parent) throw new Error("the picture to edit is gone");
        source = await ArtStudio.upload(ArtLibrary.fileOf(parent));
      }
      // The coding model steps aside while the picture is drawn, and gets the card back after.
      await ArtStudio.clearCardForArt();
      let png: Buffer;
      try {
        png = await ArtStudio.render(
          artWorkflow(
            { name: request.name, subject: request.edit ? `${request.subject}, ${request.edit}` : request.subject, kind: request.kind },
            request.style,
            request.seed,
            `agentbuilder/library-${artName(request.name)}`,
            { source, denoise: request.strength ?? undefined }
          ),
          {
            onProgress: (value, max) => (job.progress = { value, max }),
            onPreview: (jpeg) => {
              previews.set(job.id, jpeg);
              job.hasPreview = true;
            }
          }
        );
      } finally {
        await ArtStudio.clearCardForCode();
      }
      const id = newId("art");
      const file = `${id}.png`;
      fs.mkdirSync(DIR(), { recursive: true });
      fs.writeFileSync(path.join(DIR(), file), png);
      const item: ArtItem = {
        id,
        name: artName(request.name),
        subject: request.subject,
        style: request.style,
        kind: request.kind,
        seed: request.seed,
        parent: request.parent,
        edit: request.edit,
        file,
        bytes: png.length,
        createdAt: new Date().toISOString(),
        tags: []
      };
      writeIndex([item, ...readIndex()]);
      Object.assign(job, { state: "done", item, finishedAt: new Date().toISOString(), progress: { value: job.progress.max || 1, max: job.progress.max || 1 } });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      Object.assign(job, { state: "failed", error: message.slice(0, 400), finishedAt: new Date().toISOString() });
      Logger.warn("A picture could not be drawn", { job: job.id, error: message });
    } finally {
      // Old jobs and their previews go after a while.
      for (const [id, old] of jobs) {
        if (old.finishedAt && Date.now() - Date.parse(old.finishedAt) > 6 * 3600_000) {
          jobs.delete(id);
          previews.delete(id);
        }
      }
    }
  });
};

export interface DrawRequest {
  subject: string;
  name?: string;
  kind?: ArtKind;
  style?: string;
  seed?: number;
  /** How many to draw (variations), at most 4. */
  count?: number;
}

export const ArtLibrary = {
  /** Everything in the library, newest first; optionally only what matches words or a kind. */
  list(filter: { q?: string; kind?: ArtKind; limit?: number } = {}): ArtItem[] {
    const words = (filter.q ?? "").toLowerCase().split(/\s+/).filter(Boolean);
    return readIndex()
      .filter((item) => !filter.kind || item.kind === filter.kind)
      .filter((item) => words.every((w) => `${item.name} ${item.subject} ${item.style} ${item.tags.join(" ")}`.toLowerCase().includes(w)))
      .slice(0, filter.limit ?? 500);
  },

  get(id: string): ArtItem | null {
    return readIndex().find((item) => item.id === id) ?? null;
  },

  /** The picture's file on disk. */
  fileOf(item: ArtItem): string {
    return path.join(DIR(), path.basename(item.file));
  },

  /** Start drawing one picture, or up to four variations. Returns the jobs. */
  draw(request: DrawRequest): ArtJob[] {
    const subject = request.subject.trim().slice(0, 600);
    if (!subject) throw new Error("Say what to draw.");
    const count = Math.max(1, Math.min(4, request.count ?? 1));
    const base = request.seed ?? Math.floor(Math.random() * 1_000_000_000);
    return Array.from({ length: count }, (_, i) => {
      const job: ArtJob = {
        id: newId("job"),
        state: "queued",
        request: {
          name: request.name?.trim() || subject.split(/[,.]/)[0].split(/\s+/).slice(0, 4).join(" "),
          subject,
          style: (request.style ?? "").trim().slice(0, 300),
          kind: request.kind ?? "sprite",
          seed: base + i,
          parent: null,
          edit: null,
          strength: null
        },
        progress: { value: 0, max: 22 },
        hasPreview: false,
        item: null,
        error: null,
        createdAt: new Date().toISOString(),
        finishedAt: null
      };
      jobs.set(job.id, job);
      run(job);
      return job;
    });
  },

  /** Start an edit: the picture redrawn with a change, as much as `strength` (0.2 a touch, 0.9 nearly new) allows. */
  edit(id: string, change: string, strength = 0.55): ArtJob {
    const parent = ArtLibrary.get(id);
    if (!parent) throw new Error("No such picture.");
    if (!change.trim()) throw new Error("Say what to change.");
    const job: ArtJob = {
      id: newId("job"),
      state: "queued",
      request: { name: parent.name, subject: parent.subject, style: parent.style, kind: parent.kind, seed: parent.seed + 1, parent: parent.id, edit: change.trim().slice(0, 300), strength },
      progress: { value: 0, max: 22 },
      hasPreview: false,
      item: null,
      error: null,
      createdAt: new Date().toISOString(),
      finishedAt: null
    };
    jobs.set(job.id, job);
    run(job);
    return job;
  },

  job(id: string): ArtJob | null {
    return jobs.get(id) ?? null;
  },

  jobs(): ArtJob[] {
    return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  },

  preview(id: string): Buffer | null {
    return previews.get(id) ?? null;
  },

  /** Bring a picture made elsewhere (MediaGen, an upload) into the library. */
  importFile(file: string, meta: { name: string; subject: string; style?: string; kind?: ArtKind; tags?: string[] }): ArtItem {
    const id = newId("art");
    const ext = path.extname(file).toLowerCase() || ".png";
    const stored = `${id}${ext}`;
    fs.mkdirSync(DIR(), { recursive: true });
    fs.copyFileSync(file, path.join(DIR(), stored));
    const item: ArtItem = {
      id,
      name: artName(meta.name),
      subject: meta.subject.slice(0, 600),
      style: meta.style ?? "",
      kind: meta.kind ?? "background",
      seed: 0,
      parent: null,
      edit: null,
      file: stored,
      bytes: fs.statSync(path.join(DIR(), stored)).size,
      createdAt: new Date().toISOString(),
      tags: meta.tags ?? []
    };
    writeIndex([item, ...readIndex()]);
    return item;
  },

  /** Rename or tag a picture. */
  update(id: string, patch: { name?: string; tags?: string[] }): ArtItem | null {
    const items = readIndex();
    const item = items.find((i) => i.id === id);
    if (!item) return null;
    if (patch.name?.trim()) item.name = artName(patch.name);
    if (Array.isArray(patch.tags)) item.tags = patch.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 12);
    writeIndex(items);
    return item;
  },

  remove(id: string): boolean {
    const items = readIndex();
    const item = items.find((i) => i.id === id);
    if (!item) return false;
    fs.rmSync(ArtLibrary.fileOf(item), { force: true });
    writeIndex(items.filter((i) => i.id !== id));
    return true;
  },

  /**
   * Pictures as a game asset pack: each PNG under its name plus the
   * manifest.json every game board reads. Drop the folder into a project's
   * public/assets and the game draws them.
   */
  pack(ids: string[], dir: string): { files: string[]; manifest: Record<string, unknown> } {
    const chosen = ids.map((id) => ArtLibrary.get(id)).filter((item): item is ArtItem => Boolean(item));
    fs.mkdirSync(dir, { recursive: true });
    const assets: Record<string, { file: string; kind: ArtKind; subject: string }> = {};
    const files: string[] = [];
    for (const item of chosen) {
      let name = item.name;
      for (let n = 2; assets[name]; n++) name = `${item.name}-${n}`;
      fs.copyFileSync(ArtLibrary.fileOf(item), path.join(dir, `${name}.png`));
      assets[name] = { file: `assets/${name}.png`, kind: item.kind, subject: item.subject };
      files.push(`${name}.png`);
    }
    const manifest = { style: chosen[0]?.style ?? "", assets };
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return { files: [...files, "manifest.json"], manifest };
  },

  /** Put pictures into a project's public/assets (merged into its manifest): reuse in a build. */
  useIn(projectRoot: string, ids: string[]): string[] {
    const assetsDir = path.join(projectRoot, "public", "assets");
    const manifestPath = path.join(assetsDir, "manifest.json");
    let manifest: { style: string; assets: Record<string, unknown> } = { style: "", assets: {} };
    try {
      manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
    } catch {
      // A first set of pictures.
    }
    const added: string[] = [];
    for (const id of ids) {
      const item = ArtLibrary.get(id);
      if (!item) continue;
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.copyFileSync(ArtLibrary.fileOf(item), path.join(assetsDir, `${item.name}.png`));
      manifest.assets[item.name] = { file: `assets/${item.name}.png`, kind: item.kind, subject: item.subject };
      added.push(item.name);
    }
    if (added.length) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    return added;
  }
};
