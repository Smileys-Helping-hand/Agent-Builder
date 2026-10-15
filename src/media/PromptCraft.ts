/**
 * PromptCraft — better words for the image engine, from a few.
 *
 * "a dragon" draws a dragon; "a young emerald dragon curled on a mossy rock in
 * a misty forest clearing, morning light through the trees, three-quarter
 * view" draws a picture. Enhance turns the person's idea into the second kind
 * of description, keeping what they asked for; Surprise invents an idea for
 * the kind of picture chosen.
 *
 * They are buttons, so they answer at once. With the graphics card free, a
 * small fast model writes the words (PROMPT_MODEL, llama3.2:3b). While a build
 * has the card — its 14B answers can take minutes, and the small model would
 * wait behind them (an Enhance took longer than six minutes) — or if the model
 * has not answered in 25 seconds, the words come from here instead: detail
 * that suits the kind of picture, and ideas put together from curated parts.
 */
import { ModelRouter } from "../tools/ModelRouter.js";
import { gpuLock } from "../utils/GpuLock.js";
import { WorkloadCoordinator } from "../utils/WorkloadCoordinator.js";
import type { ArtKind } from "./ArtStudio.js";

const MODEL = () => process.env.PROMPT_MODEL ?? "llama3.2:3b";
const MODEL_WAIT_MS = Number(process.env.PROMPT_MODEL_WAIT_MS ?? 25_000);

const pick = <T>(list: T[], n = 1): T[] => [...list].sort(() => Math.random() - 0.5).slice(0, n);
const one = <T>(list: T[]): T => list[Math.floor(Math.random() * list.length)];

/** The model, if the card is free and it answers soon; otherwise null. */
const askModel = async (prompt: string): Promise<string | null> => {
  if (gpuLock.busy || WorkloadCoordinator.isBuildActive()) return null;
  const answer = ModelRouter.generate(prompt, { model: MODEL() }).catch(() => null);
  return Promise.race([answer, new Promise<null>((resolve) => setTimeout(() => resolve(null), MODEL_WAIT_MS))]);
};

/** One clean line: no quotes, labels or "Here is…" around it. */
export const cleanLine = (reply: string): string =>
  reply
    .replace(/```[\s\S]*?```/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^(here(?:'s| is)|sure|okay|prompt:?$|description:?$)/i.test(line))
    .join(" ")
    .replace(/^(?:prompt|description|idea)\s*:\s*/i, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

const WHAT: Record<ArtKind, string> = {
  sprite: "a single game character or object, shown whole, on its own",
  icon: "a simple, bold symbol for an app or an item",
  ui: "a game interface piece: a button, panel or badge",
  background: "a wide scene for a game, with no characters in it",
  image: "a picture: an illustration, a poster, a scene or a portrait",
  photo: "a realistic photograph"
};

/* ─── the instant words ─── */

/** Detail that suits each kind of picture; a few are chosen each time, so two enhances differ. */
const DETAIL: Record<ArtKind, string[]> = {
  image: ["rich detail", "thoughtful composition", "soft volumetric light", "a sense of depth", "vibrant but balanced colours", "a clear focal point", "gentle atmosphere", "golden-hour glow", "fine texture"],
  photo: ["natural light", "sharp focus on the subject", "shallow depth of field", "true-to-life colour", "shot on a 50mm lens", "soft background blur", "eye-level view", "candid moment", "clean, uncluttered frame"],
  sprite: ["full body", "clear silhouette", "centred", "crisp clean edges", "readable at a small size", "three-quarter view", "distinct colours", "expressive pose"],
  icon: ["bold simple shapes", "centred", "strong contrast", "readable at a small size", "one clear symbol", "smooth rounded edges", "limited colour palette"],
  ui: ["clean edges", "centred", "consistent lighting", "subtle bevel", "clear readable shape", "polished finish"],
  background: ["wide establishing view", "layered depth", "atmospheric perspective", "a clear horizon", "inviting light", "room for characters in the foreground", "rich environmental detail"]
};

export const instantEnhance = (idea: string, kind: ArtKind): string => {
  const base = idea.trim().replace(/[.,;\s]+$/, "");
  // What the person already said stays; only what is missing is added.
  const extra = pick(DETAIL[kind], 4).filter((d) => !base.toLowerCase().includes(d.split(" ").slice(-1)[0].toLowerCase()));
  return `${base}, ${extra.slice(0, 3).join(", ")}`;
};

const SUBJECTS: Record<ArtKind, string[]> = {
  image: ["a lighthouse keeper's cottage", "a floating market on a river", "an old library with spiral stairs", "a fox reading by candlelight", "a mountain village at dawn", "a greenhouse full of glowing plants", "a train crossing a stone viaduct", "a tiny robot tending a garden", "a jazz club on a rainy night", "a desert caravan under the stars"],
  photo: ["a handmade ceramic mug", "a bowl of fresh berries", "a barista pouring latte art", "a vintage bicycle against a brick wall", "a stack of hardcover books", "a potter's hands shaping clay", "a sunlit reading nook", "a bouquet of wildflowers", "a craftsman's workbench", "a city street café"],
  sprite: ["a brave knight", "a mischievous goblin", "a friendly dragon pet", "a treasure chest", "a wizard's tower", "a hover car", "a sleepy cat warrior", "a crystal golem", "a pirate captain", "a magic potion"],
  icon: ["a golden key", "a glowing heart", "a lightning bolt", "a shield with a star", "a rocket", "a crown", "a leaf", "a compass", "a gem", "a speech bubble"],
  ui: ["a wooden play button", "a stone health bar", "a parchment dialogue panel", "a golden achievement badge", "a sci-fi settings panel", "a candy-coloured shop button"],
  background: ["an enchanted forest", "a neon cyberpunk alley", "a snowy mountain pass", "a sunken temple", "a cosy tavern interior", "a floating sky island", "a desert canyon", "a candy land meadow"]
};
const SETTINGS = ["at sunrise", "in the rain", "under a starry sky", "in autumn", "on a misty morning", "at golden hour", "in a snowfall", "by lantern light", "on a summer afternoon"];
const MOODS = ["cosy", "mysterious", "playful", "epic", "serene", "whimsical", "dramatic", "nostalgic", "cheerful"];

export const instantIdea = (kind: ArtKind): string => {
  const subject = one(SUBJECTS[kind]);
  // A thing on its own (cut out) has no setting; a scene has one.
  if (kind === "sprite" || kind === "icon" || kind === "ui") return `${subject}, with a ${one(MOODS)} look`;
  return `${subject} ${one(SETTINGS)}, with a ${one(MOODS)} mood`;
};

/* ─── the buttons ─── */

export const PromptCraft = {
  async enhance(subject: string, kind: ArtKind): Promise<{ subject: string; by: "model" | "instant" }> {
    const idea = subject.trim().slice(0, 300);
    if (!idea) throw new Error("Say what to draw first.");
    const reply = await askModel(`Rewrite this idea for an image generator as one vivid description (25-60 words).
It is ${WHAT[kind]}. Keep everything the person asked for and do not change what it is.
Add concrete detail: what it looks like, pose or arrangement, setting${kind === "sprite" || kind === "icon" || kind === "ui" ? " (but nothing behind it: it will be cut out)" : ""}, lighting, colours, viewpoint.
No art-style words (the style is chosen separately), no text or lettering, no quotes.

Idea: ${idea}

Reply with only the description.`);
    const line = reply ? cleanLine(reply) : "";
    // A reply that lost the idea, or none in time, gives the instant words.
    return line.length >= Math.min(20, idea.length) ? { subject: line, by: "model" } : { subject: instantEnhance(idea, kind), by: "instant" };
  },

  async surprise(kind: ArtKind): Promise<{ subject: string; by: "model" | "instant" }> {
    const reply = await askModel(`Invent one original idea for ${WHAT[kind]}, with a ${one(MOODS)} feel.
Describe it in one sentence of 12-30 words, concrete and visual. No art-style words, no text or lettering, no quotes.
Reply with only the sentence.`);
    const line = reply ? cleanLine(reply) : "";
    return line.length >= 10 ? { subject: line, by: "model" } : { subject: instantIdea(kind), by: "instant" };
  }
};
