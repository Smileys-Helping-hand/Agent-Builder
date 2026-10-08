/**
 * MediaGen — the owner's own media generator (mraaziqp/MYAIMEDIAGEN): a cloud
 * dashboard and gallery on Vercel, fed by a worker on this PC that drives
 * ComfyUI. The Studio uses it for what it adds: short video (SVD, made from a
 * picture), Flux and SDXL images queued in the cloud, and a gallery that stays
 * up when this PC is off. Its pictures can be brought into the Studio's
 * library to reuse in builds.
 *
 * Configured by MEDIAGEN_URL and MEDIAGEN_API_KEY (the app's MEDIA_API_KEY);
 * unset, the Studio works on its own and says MediaGen is not connected.
 */
import fs from "fs";
import path from "path";

export type MediaGenType = "image_fast" | "image_hd" | "video_short";

export interface MediaGenJob {
  id: string;
  prompt: string;
  modelType: string;
  mediaType: string;
  status: "queued" | "claimed" | "processing" | "completed" | "failed" | "interrupted";
  percentage: number;
  mediaUrl: string | null;
  error: string | null;
  etaSeconds: number | null;
  queuePosition?: number;
  workerOnline?: boolean;
  createdAt: string;
}

const base = () => (process.env.MEDIAGEN_URL ?? "").replace(/\/+$/, "");
const key = () => process.env.MEDIAGEN_API_KEY ?? "";

const call = async <T>(route: string, init: RequestInit = {}): Promise<T> => {
  if (!base() || !key()) throw new Error("MediaGen is not connected (set MEDIAGEN_URL and MEDIAGEN_API_KEY).");
  const res = await fetch(`${base()}${route}`, {
    ...init,
    headers: { Authorization: `Bearer ${key()}`, ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000)
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body?.error ?? `MediaGen answered ${res.status}`);
  return body;
};

export const MediaGen = {
  configured: (): boolean => Boolean(base() && key()),

  /** Whether it is set up, reachable, and whether its worker (this PC) is online. */
  async status(): Promise<{ configured: boolean; reachable: boolean; workerOnline: boolean | null; url: string | null; error?: string }> {
    if (!MediaGen.configured()) return { configured: false, reachable: false, workerOnline: null, url: null };
    try {
      const res = await fetch(`${base()}/api/system-stats`, { headers: { Authorization: `Bearer ${key()}` }, signal: AbortSignal.timeout(10_000) });
      if (res.status === 401) return { configured: true, reachable: true, workerOnline: null, url: base(), error: "MediaGen did not accept the key (is MEDIA_API_KEY set on it?)" };
      return { configured: true, reachable: true, workerOnline: res.ok, url: base() };
    } catch (error) {
      return { configured: true, reachable: false, workerOnline: null, url: base(), error: error instanceof Error ? error.message : String(error) };
    }
  },

  /**
   * Queue something on MediaGen. A video needs a picture to start from: give a
   * library file and it is sent inline (the worker's fetch reads data: URLs).
   */
  async queue(input: { prompt: string; type: MediaGenType; aspectRatio?: string; seed?: number; fromFile?: string }): Promise<MediaGenJob> {
    let referenceImage: string | undefined;
    if (input.fromFile) referenceImage = `data:image/png;base64,${fs.readFileSync(input.fromFile).toString("base64")}`;
    if (input.type === "video_short" && !referenceImage) throw new Error("A video starts from a picture: pick one from the library.");
    const body = await call<{ job: MediaGenJob }>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ prompt: input.prompt, mediaType: input.type, aspectRatio: input.aspectRatio ?? (input.type === "video_short" ? "16:9" : "1:1"), seed: input.seed, referenceImage })
    });
    return body.job;
  },

  job: (id: string): Promise<MediaGenJob> => call<MediaGenJob>(`/api/jobs/${encodeURIComponent(id)}`),

  /** Its gallery, newest first (optionally searched). */
  async gallery(q?: string, limit = 60): Promise<MediaGenJob[]> {
    const body = await call<{ records: MediaGenJob[] }>(`/api/jobs?${q ? `q=${encodeURIComponent(q)}` : `limit=${limit}`}`);
    return (body.records ?? []).filter((job) => job.status === "completed" && job.mediaUrl);
  },

  /** Download a finished item's file (image or video) to a folder; returns the file path. */
  async download(job: MediaGenJob, dir: string): Promise<string> {
    if (!job.mediaUrl) throw new Error("That item has no file yet.");
    const res = await fetch(job.mediaUrl, { signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`Could not download it (${res.status}).`);
    const type = res.headers.get("content-type") ?? "";
    const ext = /video\/mp4/.test(type) ? "mp4" : /webm/.test(type) ? "webm" : /gif/.test(type) ? "gif" : /jpe?g/.test(type) ? "jpg" : /webp/.test(type) ? "webp" : "png";
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `mediagen-${job.id}.${ext}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return file;
  }
};
