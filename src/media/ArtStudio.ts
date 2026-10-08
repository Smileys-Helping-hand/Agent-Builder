/**
 * ArtStudio — the pictures a game or app needs, made on this PC.
 *
 * A game drawn with coloured rectangles looks like a placeholder however well
 * it plays. ArtStudio turns a list of named pictures ("hero", "barracks",
 * "background") into transparent PNG sprites in the project's public/assets,
 * with a manifest the game reads, so the code links real art by name.
 *
 * It drives a local image model through ComfyUI's API (SDXL to draw, BiRefNet
 * to cut the background out, scaled down so a phone loads it fast). ComfyUI
 * is the engine today; this module is the only place that knows, so swapping
 * it for a built-in generator later changes nothing else.
 *
 * The 8 GB graphics card cannot hold the coding model and the image model at
 * once: the coding model is unloaded before drawing, and ComfyUI is asked to
 * free its memory after, so the next build step starts on a clear card.
 */
import fs from "fs";
import path from "path";

import { Logger } from "../utils/Logger.js";

export type ArtKind = "sprite" | "background" | "icon" | "ui";

export interface ArtRequest {
  /** The file name without extension, also the key in the manifest: "hero", "goblin". */
  name: string;
  /** What it is, in a few words: "a knight in silver armour". */
  subject: string;
  kind: ArtKind;
}

export interface ArtResult {
  name: string;
  file: string | null;
  error: string | null;
}

export interface ArtManifest {
  /** The look every picture shares, so they belong to one game. */
  style: string;
  assets: Record<string, { file: string; kind: ArtKind; subject: string }>;
}

const COMFY = () => (process.env.COMFY_URL ?? process.env.LOCAL_MEDIA_API ?? "http://127.0.0.1:8188").replace(/\/+$/, "");
const OLLAMA = () => (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/+$/, "");
const CHECKPOINT = () => process.env.ART_CHECKPOINT ?? "sd_xl_base_1.0.safetensors";

/** Sizes that suit each kind of picture on a phone: small sprites, wide backgrounds. */
const SIZES: Record<ArtKind, { width: number; height: number; out: number; cutout: boolean }> = {
  sprite: { width: 1024, height: 1024, out: 256, cutout: true },
  icon: { width: 1024, height: 1024, out: 192, cutout: true },
  ui: { width: 1024, height: 1024, out: 256, cutout: true },
  background: { width: 1344, height: 768, out: 1024, cutout: false }
};

/** A name safe as a file and a manifest key. */
export const artName = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "art";

/**
 * The words that keep SDXL on one object, cleanly cut out: asked for an
 * "isometric game asset" it drew a whole village; asked for "one single
 * building, isolated object" with a negative for villages, it drew one.
 */
export const artPrompts = (request: ArtRequest, style: string): { positive: string; negative: string } => {
  const look = style.trim() || "stylized mobile game art, vibrant colours";
  if (request.kind === "background") {
    return {
      positive: `${request.subject}, wide game background, ${look}, no characters, no text, clean composition`,
      negative: "text, watermark, logo, characters, people, user interface, frame, border, blurry"
    };
  }
  return {
    positive: `(one single object:1.4), ${request.subject}, isolated object, centered, full view, ${look}, plain white background`,
    negative: "(multiple objects:1.5), crowd, village, town, tiles, map, pattern, grid, scenery, landscape, ground, text, watermark, logo, cropped, cut off, frame"
  };
};

/** The ComfyUI workflow (API format) that draws one picture and saves it. */
export const artWorkflow = (request: ArtRequest, style: string, seed: number, prefix: string): Record<string, unknown> => {
  const size = SIZES[request.kind];
  const { positive, negative } = artPrompts(request, style);
  const nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CHECKPOINT() } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: positive } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negative } },
    "4": { class_type: "EmptyLatentImage", inputs: { width: size.width, height: size.height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: { model: ["1", 0], positive: ["2", 0], negative: ["3", 0], latent_image: ["4", 0], seed, steps: 22, cfg: 7, sampler_name: "dpmpp_2m", scheduler: "karras", denoise: 1 }
    },
    "6": { class_type: "VAEDecode", inputs: { samples: ["5", 0], vae: ["1", 2] } }
  };
  let image: [string, number] = ["6", 0];
  if (size.cutout) {
    nodes["7"] = { class_type: "LoadBackgroundRemovalModel", inputs: { bg_removal_name: process.env.ART_BG_MODEL ?? "birefnet.safetensors" } };
    nodes["8"] = { class_type: "RemoveBackground", inputs: { bg_removal_model: ["7", 0], image } };
    // The remover's mask says what to keep; ComfyUI's alpha join reads a mask as
    // how transparent, so without the flip the object vanished and the white
    // background stayed (measured: the opaque pixels averaged 248,248,248).
    nodes["12"] = { class_type: "InvertMask", inputs: { mask: ["8", 0] } };
    nodes["9"] = { class_type: "JoinImageWithAlpha", inputs: { image, alpha: ["12", 0] } };
    image = ["9", 0];
  }
  // Small enough for a phone to load quickly; a 1024 px sprite is 2 MB.
  nodes["10"] = {
    class_type: "ImageScale",
    inputs: { image, upscale_method: "lanczos", width: size.out, height: Math.round((size.out * size.height) / size.width), crop: "disabled" }
  };
  nodes["11"] = { class_type: "SaveImage", inputs: { images: ["10", 0], filename_prefix: prefix } };
  return nodes;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const ArtStudio = {
  /** Whether the image engine answers. */
  async available(): Promise<boolean> {
    try {
      const res = await fetch(`${COMFY()}/system_stats`, { signal: AbortSignal.timeout(4000) });
      return res.ok;
    } catch {
      return false;
    }
  },

  /** Free the graphics card for drawing: the coding model goes (it reloads on its next call). */
  async clearCardForArt(): Promise<void> {
    const model = process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";
    await fetch(`${OLLAMA()}/api/generate`, { method: "POST", body: JSON.stringify({ model, keep_alive: 0 }), signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
  },

  /** Hand the card back: ComfyUI unloads its models. */
  async clearCardForCode(): Promise<void> {
    await fetch(`${COMFY()}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: AbortSignal.timeout(30_000)
    }).catch(() => undefined);
  },

  /** Draw one picture and save it into the project; returns its path relative to the project. */
  async draw(projectRoot: string, request: ArtRequest, style: string, seed = 1 + Math.floor(Math.random() * 1_000_000)): Promise<string> {
    const name = artName(request.name);
    const prefix = `agentbuilder/${path.basename(projectRoot)}-${name}`;
    const queued = await fetch(`${COMFY()}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: artWorkflow(request, style, seed, prefix) }),
      signal: AbortSignal.timeout(30_000)
    });
    const body = (await queued.json().catch(() => ({}))) as { prompt_id?: string; error?: unknown; node_errors?: unknown };
    if (!queued.ok || !body.prompt_id) throw new Error(`the image engine refused the request: ${JSON.stringify(body.error ?? body.node_errors ?? queued.status).slice(0, 300)}`);
    // A picture takes ~40 s on this PC, longer when the model first loads.
    for (let waited = 0; waited < 10 * 60_000; waited += 3000) {
      await sleep(3000);
      const history = (await fetch(`${COMFY()}/history/${body.prompt_id}`, { signal: AbortSignal.timeout(10_000) })
        .then((res) => res.json())
        .catch(() => ({}))) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>; status?: { status_str?: string } }>;
      const entry = history[body.prompt_id];
      if (entry?.status?.status_str === "error") throw new Error("the image engine failed while drawing");
      const image = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])[0];
      if (!image) continue;
      const res = await fetch(`${COMFY()}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`, {
        signal: AbortSignal.timeout(30_000)
      });
      if (!res.ok) throw new Error(`could not fetch the picture (${res.status})`);
      const dir = path.join(projectRoot, "public", "assets");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${name}.png`);
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return `assets/${name}.png`;
    }
    throw new Error("the image engine took more than ten minutes");
  },

  /**
   * Draw every picture a project asks for and write public/assets/manifest.json.
   * Pictures already there are kept (an upgrade only draws what is new).
   */
  async drawAll(projectRoot: string, requests: ArtRequest[], style: string, onProgress?: (done: number, total: number, name: string) => void): Promise<ArtResult[]> {
    const manifestPath = path.join(projectRoot, "public", "assets", "manifest.json");
    let manifest: ArtManifest = { style, assets: {} };
    try {
      manifest = { ...manifest, ...JSON.parse(fs.readFileSync(manifestPath, "utf8")) };
    } catch {
      // A first drawing.
    }
    const todo = requests.filter((request) => !manifest.assets[artName(request.name)] || !fs.existsSync(path.join(projectRoot, "public", manifest.assets[artName(request.name)].file)));
    const results: ArtResult[] = requests.filter((request) => !todo.includes(request)).map((request) => ({ name: artName(request.name), file: manifest.assets[artName(request.name)].file, error: null }));
    if (todo.length === 0) return results;
    if (!(await ArtStudio.available())) {
      return [...results, ...todo.map((request) => ({ name: artName(request.name), file: null, error: "the image engine (ComfyUI) is not running" }))];
    }
    await ArtStudio.clearCardForArt();
    try {
      for (const [index, request] of todo.entries()) {
        onProgress?.(index, todo.length, request.name);
        try {
          const file = await ArtStudio.draw(projectRoot, request, manifest.style || style);
          manifest.assets[artName(request.name)] = { file, kind: request.kind, subject: request.subject };
          results.push({ name: artName(request.name), file, error: null });
          fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
          fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          Logger.warn("Could not draw a picture", { name: request.name, error: message });
          results.push({ name: artName(request.name), file: null, error: message });
        }
      }
    } finally {
      await ArtStudio.clearCardForCode();
    }
    return results;
  }
};
