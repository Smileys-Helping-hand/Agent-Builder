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
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";

/** Where the image engine's app is installed (Comfy Desktop runs ComfyUI on :8188), for starting it. */
export const comfyBinary = (): string | null => {
  const candidates = [
    process.env.COMFY_DESKTOP_PATH,
    "C:/Program Files/Comfy Desktop/Comfy Desktop.exe",
    path.join(os.homedir(), "AppData", "Local", "Programs", "ComfyUI", "ComfyUI.exe")
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

let starting: Promise<boolean> | null = null;

export type ArtKind = "sprite" | "background" | "icon" | "ui";

export interface ArtRequest {
  /** The file name without extension, also the key in the manifest: "hero", "goblin". */
  name: string;
  /** What it is, in a few words: "a knight in silver armour". */
  subject: string;
  kind: ArtKind;
  /** What to steer away from (an edit's overridden details: "a red roof"). */
  avoid?: string;
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
  const avoid = request.avoid?.trim() ? `(${request.avoid.trim()}:1.3), ` : "";
  if (request.kind === "background") {
    return {
      positive: `${request.subject}, wide game background, ${look}, no characters, no text, clean composition`,
      negative: `${avoid}text, watermark, logo, characters, people, user interface, frame, border, blurry`
    };
  }
  return {
    positive: `(one single object:1.4), ${request.subject}, isolated object, centered, full view, ${look}, plain white background`,
    negative: `${avoid}(multiple objects:1.5), crowd, village, town, tiles, map, pattern, grid, scenery, landscape, ground, text, watermark, logo, cropped, cut off, frame`
  };
};

/** The ComfyUI workflow (API format) that draws one picture and saves it. */
export interface WorkflowOptions {
  /** Start from this picture (its name in ComfyUI's input folder) instead of noise: an edit. */
  source?: string;
  /** How far an edit may move from its source, 0.2 (a touch) to 0.9 (nearly new). */
  denoise?: number;
}

export const artWorkflow = (request: ArtRequest, style: string, seed: number, prefix: string, options: WorkflowOptions = {}): Record<string, unknown> => {
  const size = SIZES[request.kind];
  const { positive, negative } = artPrompts(request, style);
  const nodes: Record<string, { class_type: string; inputs: Record<string, unknown> }> = {
    "1": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: CHECKPOINT() } },
    "2": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: positive } },
    "3": { class_type: "CLIPTextEncode", inputs: { clip: ["1", 1], text: negative } },
    "4": options.source
      ? { class_type: "VAEEncode", inputs: { pixels: ["13", 0], vae: ["1", 2] } }
      : { class_type: "EmptyLatentImage", inputs: { width: size.width, height: size.height, batch_size: 1 } },
    "5": {
      class_type: "KSampler",
      inputs: {
        model: ["1", 0],
        positive: ["2", 0],
        negative: ["3", 0],
        latent_image: ["4", 0],
        seed,
        steps: 22,
        cfg: 7,
        sampler_name: "dpmpp_2m",
        scheduler: "karras",
        denoise: options.source ? Math.max(0.15, Math.min(0.95, options.denoise ?? 0.55)) : 1
      }
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
  if (options.source) {
    // The source, scaled to the size the model draws at.
    nodes["14"] = { class_type: "LoadImage", inputs: { image: options.source } };
    nodes["13"] = { class_type: "ImageScale", inputs: { image: ["14", 0], upscale_method: "lanczos", width: size.width, height: size.height, crop: "center" } };
  }
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

  /**
   * The image engine answering, started if it is not: a picture asked for
   * (by the app, a build's art pass, or Jarvis) should be drawn, not refused
   * because nobody had opened Comfy Desktop. Not in game mode, which keeps the
   * card free on purpose. Concurrent callers share one start; it loads its
   * models in a minute or two.
   */
  async ensure(waitMs = Number(process.env.COMFY_START_WAIT_MS) || 600_000): Promise<boolean> {
    if (await ArtStudio.available()) return true;
    if (GameMode.isOn()) return false;
    if (starting) return starting;
    starting = (async () => {
      const binary = comfyBinary();
      if (!binary) {
        Logger.warn("The image engine is not running and Comfy Desktop is not installed where expected; set COMFY_DESKTOP_PATH or COMFY_URL");
        return false;
      }
      Logger.log("The image engine was not running; starting it for a picture", { binary });
      try {
        spawn(binary, [], { detached: true, stdio: "ignore", windowsHide: false }).unref();
      } catch (error) {
        Logger.error("Could not start the image engine", { error: error instanceof Error ? error.message : String(error) });
        return false;
      }
      for (let waited = 0; waited < waitMs; waited += 3000) {
        await sleep(3000);
        if (await ArtStudio.available()) {
          Logger.log("The image engine is up", { seconds: Math.round(waited / 1000) + 3 });
          return true;
        }
      }
      Logger.warn("The image engine did not answer after starting it", { waitedSeconds: Math.round(waitMs / 1000) });
      return false;
    })();
    try {
      return await starting;
    } finally {
      starting = null;
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

  /** Put a picture into the image engine's input folder, for an edit to start from. Returns its name there. */
  async upload(file: string): Promise<string> {
    const form = new FormData();
    form.append("image", new Blob([fs.readFileSync(file)], { type: "image/png" }), `agentbuilder-${Date.now()}-${path.basename(file)}`);
    form.append("overwrite", "true");
    const res = await fetch(`${COMFY()}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(30_000) });
    const body = (await res.json().catch(() => ({}))) as { name?: string; subfolder?: string };
    if (!res.ok || !body.name) throw new Error(`the image engine would not take the picture (${res.status})`);
    return body.subfolder ? `${body.subfolder}/${body.name}` : body.name;
  },

  /**
   * Run one drawing and return the finished PNG. Progress (step of steps) and
   * the image engine's preview frames come through its websocket as it draws,
   * for a live view; without the socket it still finishes, just silently.
   */
  async render(workflow: Record<string, unknown>, live: { onProgress?: (value: number, max: number) => void; onPreview?: (jpeg: Buffer) => void } = {}): Promise<Buffer> {
    const clientId = `agentbuilder-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    let socket: WebSocket | null = null;
    let promptId: string | null = null;
    try {
      if (typeof WebSocket !== "undefined" && (live.onProgress || live.onPreview)) {
        socket = new WebSocket(`${COMFY().replace(/^http/, "ws")}/ws?clientId=${clientId}`);
        socket.binaryType = "arraybuffer";
        socket.onmessage = (event) => {
          if (typeof event.data === "string") {
            try {
              const message = JSON.parse(event.data) as { type?: string; data?: { value?: number; max?: number; prompt_id?: string } };
              if (message.type === "progress" && (!promptId || message.data?.prompt_id === promptId)) live.onProgress?.(message.data?.value ?? 0, message.data?.max ?? 1);
            } catch {
              // Not for us.
            }
          } else if (event.data instanceof ArrayBuffer && event.data.byteLength > 8) {
            // A preview frame: 4 bytes event type (1), 4 bytes format (1 JPEG, 2 PNG), then the picture.
            const view = new DataView(event.data);
            if (view.getUint32(0) === 1) live.onPreview?.(Buffer.from(event.data.slice(8)));
          }
        };
        await new Promise<void>((resolve) => {
          const done = () => resolve();
          socket!.onopen = done;
          socket!.onerror = done;
          setTimeout(done, 3000);
        });
      }
      const queued = await fetch(`${COMFY()}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Preview frames whatever ComfyUI was started with (newer ComfyUI takes it per prompt).
        body: JSON.stringify({ prompt: workflow, client_id: clientId, extra_data: { preview_method: "auto" } }),
        signal: AbortSignal.timeout(30_000)
      });
      const body = (await queued.json().catch(() => ({}))) as { prompt_id?: string; error?: unknown; node_errors?: unknown };
      if (!queued.ok || !body.prompt_id) throw new Error(`the image engine refused the request: ${JSON.stringify(body.error ?? body.node_errors ?? queued.status).slice(0, 300)}`);
      promptId = body.prompt_id;
      // A picture takes ~40 s on this PC, longer when the model first loads.
      for (let waited = 0; waited < 10 * 60_000; waited += 1500) {
        await sleep(1500);
        const history = (await fetch(`${COMFY()}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) })
          .then((res) => res.json())
          .catch(() => ({}))) as Record<string, { outputs?: Record<string, { images?: Array<{ filename: string; subfolder: string; type: string }> }>; status?: { status_str?: string } }>;
        const entry = history[promptId];
        if (entry?.status?.status_str === "error") throw new Error("the image engine failed while drawing");
        const image = Object.values(entry?.outputs ?? {}).flatMap((output) => output.images ?? [])[0];
        if (!image) continue;
        const res = await fetch(`${COMFY()}/view?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(image.subfolder)}&type=${encodeURIComponent(image.type)}`, {
          signal: AbortSignal.timeout(30_000)
        });
        if (!res.ok) throw new Error(`could not fetch the picture (${res.status})`);
        return Buffer.from(await res.arrayBuffer());
      }
      throw new Error("the image engine took more than ten minutes");
    } finally {
      socket?.close();
    }
  },

  /** Draw one picture and save it into the project; returns its path relative to the project. */
  async draw(projectRoot: string, request: ArtRequest, style: string, seed = 1 + Math.floor(Math.random() * 1_000_000)): Promise<string> {
    const name = artName(request.name);
    const png = await ArtStudio.render(artWorkflow(request, style, seed, `agentbuilder/${path.basename(projectRoot)}-${name}`));
    const dir = path.join(projectRoot, "public", "assets");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.png`), png);
    return `assets/${name}.png`;
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
    if (!(await ArtStudio.ensure())) {
      return [...results, ...todo.map((request) => ({ name: artName(request.name), file: null, error: "the image engine (ComfyUI) is not running and could not be started" }))];
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
