/**
 * InviteStudio — this PC as the design studio for ARP Invites.
 *
 * The invites app runs on Vercel and cannot reach this machine, so the work
 * comes the other way: every few seconds, when the GPU is free and game mode
 * is off, the studio asks the app for a job (POST /api/studio/claim), does it
 * with the local models and posts the result back. Nothing here is exposed to
 * the internet.
 *
 *   copy      a few ways to word a line of an invitation      (local model, JSON)
 *   template  whole templates from a brief, with cover art     (local model + ComfyUI)
 *   imageSet  artwork in a celebration's colours               (ComfyUI)
 *
 * Templates are data — a TemplateSpec the app validates — so the local model
 * fills a JSON Schema the app publishes (GET /api/studio/schema) rather than
 * writing code, and Ollama is constrained to that schema. Pictures are drawn
 * by ArtStudio and uploaded straight to the NAS through the app's media
 * gateway. Studio templates never go live on their own: they wait in the
 * app's admin review queue.
 *
 * Configured by INVITES_URL and INVITES_STUDIO_KEY (the app's STUDIO_KEY).
 * INVITES_STUDIO=off stops it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Agent, fetch as undiciFetch } from "undici";

import { ArtStudio, type ArtRequest } from "../media/ArtStudio.js";
import { GameMode } from "../utils/GameMode.js";
import { gpuLock } from "../utils/GpuLock.js";
import { Logger } from "../utils/Logger.js";
import { JarvisClient } from "./JarvisClient.js";

type JobKind = "copy" | "template" | "imageSet";

interface Job {
  id: string;
  kind: JobKind;
  input: Record<string, unknown>;
  attempts: number;
}

interface Palette {
  bg: string;
  surface: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  onAccent: string;
}

const base = () => (process.env.INVITES_URL ?? "").replace(/\/+$/, "");
const key = () => process.env.INVITES_STUDIO_KEY ?? "";
const configured = () => Boolean(base() && key()) && process.env.INVITES_STUDIO !== "off";
const worker = () => `agent-builder@${os.hostname()}`;
const model = () => process.env.INVITES_STUDIO_MODEL ?? process.env.OLLAMA_MODEL ?? process.env.MODEL ?? "qwen2.5:14b";
const ollamaUrl = () => (process.env.OLLAMA_BASE_URL ?? process.env.OLLAMA_URL ?? "http://localhost:11434").replace(/\/+$/, "");

/** Ollama answers nothing until the model is loaded and has read the prompt; that can take minutes. */
const patient = new Agent({ headersTimeout: 20 * 60_000, bodyTimeout: 20 * 60_000, connectTimeout: 30_000 });

let timer: NodeJS.Timeout | null = null;
let busy = false;
let schemaCache: { templateSpec: unknown; templateMeta: unknown } | null = null;
const state = { lastClaimAt: null as string | null, lastJob: null as null | { id: string; kind: JobKind; ok: boolean; at: string; detail: string }, done: 0, failed: 0 };

async function app<T>(route: string, body?: unknown, method = body === undefined ? "GET" : "POST", timeoutMs = 60_000): Promise<T> {
  const res = await fetch(`${base()}${route}`, {
    method,
    headers: { "x-studio-key": key(), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? `the invites app answered ${res.status}`);
  return json;
}

/**
 * A JSON Schema llama.cpp's grammar converter accepts. The app's schemas come
 * from Zod and carry what the converter chokes on — regex patterns, length
 * bounds, $schema and "oneOf" with consts — none of which shape the answer
 * enough to matter, because the app validates the result exactly anyway.
 */
export function grammarSafe(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(grammarSafe);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (["$schema", "pattern", "format", "minLength", "maxLength", "minItems", "maxItems", "default", "exclusiveMinimum", "exclusiveMaximum", "$id"].includes(k)) continue;
    out[k === "oneOf" ? "anyOf" : k] = grammarSafe(v);
  }
  if ("const" in out && !("type" in out)) {
    out.enum = [out.const];
    delete out.const;
  }
  return out;
}

const isGrammarError = (text: string) => /grammar|sampler|schema/i.test(text);

type JsonSchema = { type?: string | string[]; properties?: Record<string, JsonSchema>; items?: JsonSchema; anyOf?: JsonSchema[]; oneOf?: JsonSchema[]; maxLength?: number; maxItems?: number; const?: unknown; enum?: unknown[] };

/**
 * Bring a model's answer within the limits the grammar could not enforce:
 * strings and lists trimmed to their maximums, each union member (a section)
 * checked against the branch its "type" names. What still fails, the app's
 * own validation reports.
 */
export function fitToSchema(value: unknown, schema: JsonSchema | undefined): unknown {
  if (!schema || value === null || value === undefined) return value;
  const branches = schema.anyOf ?? schema.oneOf;
  if (branches) {
    const tag = value && typeof value === "object" && "type" in value ? (value as { type: unknown }).type : undefined;
    const branch = branches.find((b) => b.properties?.type && (b.properties.type.const === tag || b.properties.type.enum?.includes(tag))) ?? branches.find((b) => b.type === (Array.isArray(value) ? "array" : typeof value)) ?? branches[0];
    return fitToSchema(value, branch);
  }
  if (typeof value === "string") return schema.maxLength !== undefined ? value.slice(0, schema.maxLength) : value;
  if (Array.isArray(value)) {
    const list = value.map((v) => fitToSchema(v, schema.items));
    return schema.maxItems !== undefined ? list.slice(0, schema.maxItems) : list;
  }
  if (typeof value === "object" && schema.properties) {
    const out: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const [k, sub] of Object.entries(schema.properties)) if (k in out) out[k] = fitToSchema(out[k], sub);
    return out;
  }
  return value;
}

/**
 * One JSON answer from the local model, constrained to a schema. When even the
 * simplified schema cannot become a grammar, the model answers in plain JSON
 * mode with the schema in the prompt instead.
 */
async function askJson<T>(system: string, prompt: string, schema: unknown, temperature = 0.8): Promise<T> {
  const call = async (format: unknown, userPrompt: string) =>
    undiciFetch(`${ollamaUrl()}/api/chat`, {
      dispatcher: patient,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model(),
        stream: false,
        format,
        // A schema-shaped answer needs no visible reasoning first, and thinking models are much slower with it.
        think: false,
        keep_alive: process.env.OLLAMA_KEEP_ALIVE ?? "30m",
        options: { temperature, num_ctx: 16384, num_predict: 6000 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: userPrompt }
        ]
      })
    });
  return gpuLock.run(async () => {
    let res = await call(grammarSafe(schema), prompt);
    if (res.status === 400) {
      const detail = await res.text();
      if (!isGrammarError(detail)) throw new Error(`the local model answered 400: ${detail.slice(0, 200)}`);
      res = await call("json", `${prompt}\n\nAnswer with one JSON object that follows this JSON Schema exactly:\n${JSON.stringify(grammarSafe(schema))}`);
    }
    if (!res.ok) throw new Error(`the local model answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { message?: { content?: string } };
    return JSON.parse(body.message?.content ?? "{}") as T;
  });
}

/* ---------- colour care: the model's palette, made readable ---------- */

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (a: string, b: string, t: number) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
};
const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v);

/** Nudge text towards black or white until it reads on its background; pick readable button text. */
export function readablePalette(p: Palette): Palette {
  const out = { ...p };
  const towards = (fg: string, bg: string, need: number) => {
    const target = contrast("#000000", bg) > contrast("#ffffff", bg) ? "#000000" : "#ffffff";
    let c = fg;
    for (let t = 0.15; contrast(c, bg) < need && t <= 1; t += 0.15) c = mix(fg, target, t);
    return c;
  };
  out.ink = towards(out.ink, out.bg, 4.5);
  out.muted = towards(out.muted, out.bg, 3);
  out.accent = towards(out.accent, out.bg, 2.4);
  out.onAccent = contrast("#ffffff", out.accent) >= contrast("#111111", out.accent) ? "#ffffff" : "#111111";
  return out;
}

/* ---------- jobs ---------- */

const GUIDE = `You design wedding and event invitation templates as JSON for an invitations app.
A template is data: a theme (palette, fonts, ornament, texture, radius, motion) and an ordered list of sections.
Rules:
- The first section is a "hero" whose title is "{{hosts}}", eyebrow "[[headline]]" and subtitle "[[invite]]" unless the brief calls for set wording.
- Then, as fits the occasion: greeting ("Dear {{guestName}},"), text, divider, countdown, events, story, dressCode, rsvp (text mentioning {{deadline}}), registry, faq, wishes, photoWall; the last section is a "footer".
- Placeholders in double braces ({{hosts}}, {{guestName}}, {{deadline}}, {{date}}, {{venue}}) are filled per guest; keep them exactly.
- Section ids are short, unique, lowercase with dashes (e.g. "hero-1", "events-1").
- The palette must read well: ink on bg and on surface clearly readable, muted softer but legible, accent a strong colour used for headings and buttons.
- Choose fonts that suit the mood: a script for names (greatVibes, pinyon, parisienne, allura), a display or serif for headings, a clean body face.
- meta.id is lowercase-with-dashes and unique to the idea; meta.tier is "premium" unless the brief says free; meta.rank 200.
Write warm, natural South African English. Do not invent venue names or dates; the app fills them.`;

async function doCopy(job: Job) {
  const { field, current, eventType, tone } = job.input as { field: string; current: string; eventType: string; tone: string };
  const answer = await askJson<{ suggestions: string[] }>(
    "You write invitation wording. Answer only with JSON.",
    `Write three alternative versions of the "${field}" line on a ${eventType} invitation. Tone: ${tone}. Keep each about as long as the original and keep any {{placeholders}} exactly.\nOriginal: ${current || "(empty — write a fitting line)"}`,
    { type: "object", properties: { suggestions: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 3 } }, required: ["suggestions"] },
    0.9
  );
  return { suggestions: (answer.suggestions ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 3) };
}

/** Draw pictures into a scratch folder and send each to the NAS through the app; returns public URLs. */
async function drawAndUpload(jobId: string, requests: ArtRequest[], style: string, celebrationId?: string, onEach?: (i: number) => void): Promise<{ name: string; url: string }[]> {
  if (!(await ArtStudio.ensure())) throw new Error("the image engine (ComfyUI) is not running and could not be started");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `invite-studio-${jobId}-`));
  const out: { name: string; url: string }[] = [];
  await ArtStudio.clearCardForArt();
  try {
    for (const [i, request] of requests.entries()) {
      onEach?.(i);
      const rel = await ArtStudio.draw(dir, request, style);
      const bytes = fs.readFileSync(path.join(dir, "public", rel));
      const slot = await app<{ put: string; url: string; headers: Record<string, string> }>("/api/studio/upload", { contentType: "image/png", bytes: bytes.length, celebrationId });
      const put = await fetch(slot.put, { method: "PUT", headers: slot.headers, body: bytes, signal: AbortSignal.timeout(120_000) });
      if (!put.ok) throw new Error(`the media gateway refused the picture (${put.status})`);
      out.push({ name: request.name, url: slot.url });
    }
  } finally {
    await ArtStudio.clearCardForCode();
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return out;
}

async function doTemplate(job: Job, progress: (p: number, m: string) => Promise<void>) {
  const { brief, eventTypes, culture, variants = 3, images = true } = job.input as { brief: string; eventTypes: string[]; culture?: string; variants?: number; images?: boolean };
  schemaCache ??= await app<{ templateSpec: unknown; templateMeta: unknown }>("/api/studio/schema");
  const schema = { type: "object", properties: { meta: schemaCache.templateMeta, spec: schemaCache.templateSpec }, required: ["meta", "spec"] };
  const templates: { meta: Record<string, unknown>; spec: Record<string, any> }[] = [];
  for (let i = 0; i < variants; i++) {
    await progress(Math.round((i / variants) * 70), `Designing variant ${i + 1} of ${variants}`);
    const made = await askJson<{ meta: Record<string, unknown>; spec: Record<string, any> }>(
      GUIDE,
      `Brief: ${brief}\nOccasions: ${eventTypes.join(", ")}${culture ? `\nCulture: ${culture}` : ""}\nThis is variant ${i + 1} of ${variants}: make it clearly different from the others (palette, ornament, layout) while fitting the brief.${templates.length ? `\nAlready made: ${templates.map((t) => `${t.meta.name} (${t.spec?.theme?.ornament}, ${t.spec?.theme?.palette?.accent})`).join("; ")}` : ""}`,
      schema
    );
    const fitted = fitToSchema(made, schema as JsonSchema) as typeof made;
    const p = fitted.spec?.theme?.palette as Palette | undefined;
    if (p && Object.values(p).every(isHex)) fitted.spec.theme.palette = readablePalette(p);
    fitted.spec.version = 1;
    const slug = String(fitted.meta?.id ?? fitted.meta?.name ?? `studio-${job.id}-${i + 1}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    fitted.meta = { ...fitted.meta, id: slug.length >= 3 ? slug : `studio-${i + 1}`, eventTypes, culture: culture || undefined, tier: fitted.meta?.tier === "free" ? "free" : "premium", rank: 200 };
    templates.push(fitted);
  }
  if (images) {
    // One cover picture per template, in its own colours, placed in an arched frame on the cover.
    await progress(75, "Drawing cover art");
    const requests: ArtRequest[] = templates.map((t, i) => ({
      name: `cover-${i + 1}`,
      kind: "image",
      size: "tall",
      subject: `${brief}. Elegant invitation cover artwork, no text, no letters, soft decorative illustration in ${Object.values((t.spec?.theme?.palette ?? {}) as Record<string, string>).slice(0, 5).join(", ")}`
    }));
    try {
      const art = await drawAndUpload(job.id, requests, "refined stationery illustration, delicate, high detail");
      art.forEach((a, i) => {
        const hero = templates[i]?.spec?.sections?.find((s: { type: string }) => s.type === "hero");
        if (hero) {
          hero.variant = "arch";
          hero.image = { url: a.url, alt: "" };
        }
      });
    } catch (error) {
      // Templates without art are still worth reviewing.
      Logger.warn("Invite studio could not draw cover art", { error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { templates };
}

async function doImageSet(job: Job, progress: (p: number, m: string) => Promise<void>) {
  const { celebrationId, brief, palette, shots } = job.input as { celebrationId: string; brief: string; palette: string[]; shots: string[] };
  const shape: Record<string, Pick<ArtRequest, "kind" | "size">> = {
    cover: { kind: "image", size: "tall" },
    background: { kind: "background" },
    monogram: { kind: "icon" },
    divider: { kind: "ui" },
    share: { kind: "image", size: "wide" }
  };
  const requests: ArtRequest[] = shots.map((shot) => ({ name: shot, ...(shape[shot] ?? { kind: "image", size: "square" }), subject: `${brief}. Invitation ${shot} artwork, no text, colours ${palette.join(", ")}` }));
  const art = await drawAndUpload(job.id, requests, "refined stationery illustration", celebrationId, (i) => void progress(Math.round((i / requests.length) * 100), `Drawing ${requests[i].name}`));
  return { images: art.map((a) => ({ shot: a.name, url: a.url })) };
}

async function run(job: Job) {
  const progress = async (p: number, message: string) => {
    await app(`/api/studio/jobs/${job.id}/progress`, { worker: worker(), progress: p, message }).catch(() => undefined);
  };
  const started = Date.now();
  try {
    const result = job.kind === "copy" ? await doCopy(job) : job.kind === "template" ? await doTemplate(job, progress) : await doImageSet(job, progress);
    // Minutes of GPU work are not lost to one slow answer: the result is sent with a long wait, and once more if that fails.
    const send = () => app<{ accepted: boolean }>(`/api/studio/jobs/${job.id}/complete`, { worker: worker(), result }, "POST", 5 * 60_000);
    const { accepted } = await send().catch(async () => {
      await new Promise((r) => setTimeout(r, 10_000));
      return send();
    });
    state.done++;
    state.lastJob = { id: job.id, kind: job.kind, ok: accepted, at: new Date().toISOString(), detail: accepted ? `done in ${Math.round((Date.now() - started) / 1000)}s` : "the app did not accept the result; it will be retried" };
    if (accepted && job.kind === "template") {
      await JarvisClient.send({ type: "build", severity: "notice", subject: "New invitation templates to review", body: `The studio finished ${(result as { templates: unknown[] }).templates.length} templates. They are waiting in the invites admin review queue.`, url: `${base()}/admin` }).catch(() => undefined);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.failed++;
    state.lastJob = { id: job.id, kind: job.kind, ok: false, at: new Date().toISOString(), detail: message };
    Logger.warn("Invite studio job failed", { job: job.id, kind: job.kind, error: message });
    await app(`/api/studio/jobs/${job.id}/fail`, { worker: worker(), error: message }).catch(() => undefined);
  }
}

async function tick() {
  if (busy || !configured()) return;
  // Game mode: the GPU belongs to whoever is playing. The job waits in the app's queue.
  if (GameMode.isOn()) return;
  busy = true;
  try {
    // Wording only needs the language model; pictures need ComfyUI too, so take them when it can run.
    const kinds: JobKind[] = ["copy", "template", "imageSet"];
    const { job } = await app<{ job: Job | null }>("/api/studio/claim", { worker: worker(), kinds });
    state.lastClaimAt = new Date().toISOString();
    if (job) await run(job);
  } catch (error) {
    Logger.warn("Invite studio could not reach the app", { error: error instanceof Error ? error.message : String(error) });
  } finally {
    busy = false;
  }
}

export const InviteStudio = {
  configured,

  start(intervalMs = Number(process.env.INVITES_STUDIO_TICK_MS) || 15_000): void {
    if (timer || !configured()) return;
    timer = setInterval(() => void tick(), intervalMs);
    timer.unref?.();
    Logger.log(`Invite studio working for ${base()}`);
  },

  stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  },

  status() {
    return { configured: configured(), app: base() || null, worker: worker(), model: model(), busy, ...state };
  },

  /** Queue new templates from a brief (admin review follows in the app). */
  async generate(input: { brief: string; eventTypes: string[]; culture?: string; variants?: number; images?: boolean }) {
    if (!configured()) throw new Error("The invites studio is not connected (set INVITES_URL and INVITES_STUDIO_KEY).");
    return app<{ job: { id: string; status: string } }>("/api/studio/enqueue", input);
  },

  /** Where the invites platform stands, from its ops briefing (needs INVITES_OPS_KEY). */
  async platform(format: "json" | "markdown" = "json") {
    const opsKey = process.env.INVITES_OPS_KEY;
    if (!base() || !opsKey) throw new Error("Set INVITES_URL and INVITES_OPS_KEY to read the invites briefing.");
    const res = await fetch(`${base()}/api/ops/handoff${format === "markdown" ? "?format=markdown" : ""}`, { headers: { Authorization: `Bearer ${opsKey}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`the invites app answered ${res.status}`);
    return format === "markdown" ? { markdown: await res.text() } : await res.json();
  }
};
