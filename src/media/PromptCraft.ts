/**
 * PromptCraft — better words for the image engine, from a few.
 *
 * "a dragon" draws a dragon; "a young emerald dragon curled on a mossy rock in
 * a misty forest clearing, morning light through the trees, three-quarter
 * view" draws a picture. Enhance turns the person's idea into the second
 * kind of description, keeping what they asked for; Surprise invents an idea
 * for the kind of picture chosen. Both use a small fast model (PROMPT_MODEL,
 * llama3.2:3b by default), falling back to the builder's own.
 */
import { ModelRouter } from "../tools/ModelRouter.js";
import type { ArtKind } from "./ArtStudio.js";

const MODEL = () => process.env.PROMPT_MODEL ?? "llama3.2:3b";

const ask = async (prompt: string): Promise<string> => {
  try {
    return await ModelRouter.generate(prompt, { model: MODEL() });
  } catch {
    return ModelRouter.generate(prompt);
  }
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

export const PromptCraft = {
  async enhance(subject: string, kind: ArtKind): Promise<string> {
    const idea = subject.trim().slice(0, 300);
    if (!idea) throw new Error("Say what to draw first.");
    const reply = await ask(`Rewrite this idea for an image generator as one vivid description (25-60 words).
It is ${WHAT[kind]}. Keep everything the person asked for and do not change what it is.
Add concrete detail: what it looks like, pose or arrangement, setting${kind === "sprite" || kind === "icon" || kind === "ui" ? " (but nothing behind it: it will be cut out)" : ""}, lighting, colours, viewpoint.
No art-style words (the style is chosen separately), no text or lettering, no quotes.

Idea: ${idea}

Reply with only the description.`);
    const line = cleanLine(reply);
    // A reply that lost the idea is worse than the idea.
    return line.length >= Math.min(20, idea.length) ? line : idea;
  },

  async surprise(kind: ArtKind): Promise<string> {
    const themes = ["cosy", "mysterious", "playful", "epic", "serene", "retro", "futuristic", "whimsical", "dramatic", "tiny and cute"];
    const theme = themes[Math.floor(Math.random() * themes.length)];
    const reply = await ask(`Invent one original idea for ${WHAT[kind]}, with a ${theme} feel.
Describe it in one sentence of 12-30 words, concrete and visual. No art-style words, no text or lettering, no quotes.
Reply with only the sentence.`);
    const line = cleanLine(reply);
    if (line.length < 10) throw new Error("No idea came back; try again.");
    return line;
  }
};
