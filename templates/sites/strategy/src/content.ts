/**
 * Everything the game says and how it plays. Change this file to make it
 * someone else's: their name and colours, their prize, a different road,
 * tougher waves. The sample business below is invented; replace every line of it.
 */
import type { Brand, Business, FormSettings } from "./lib/site";
import { DEFAULT_SETTINGS, type GameSettings } from "./game";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Castle & Dice Board Game Café",
    tagline: "Hold the castle, win a table.",
    description: "A board game café in Observatory, Cape Town. Survive every wave and your group's next table is free.",
    email: "hello@castleanddice.example",
    whatsapp: "+27 82 555 0177",
    address: "41 Lower Main Road, Observatory, Cape Town",
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#16a34a",
    accent: "#facc15",
    background: "#06110a",
    surface: "#0d1f14",
    text: "#ecfdf5",
    muted: "#9ca3af",
    radius: 14
  } satisfies Brand,

  hero: {
    eyebrow: "Strategy challenge",
    title: "Hold the Pass",
    subtitle: "Build towers along the road and stop five waves of raiders. Score 6 000 or more and claim a free table."
  },

  game: { ...DEFAULT_SETTINGS } satisfies GameSettings,

  howTo: [
    { title: "Build", text: "Pick a tower, then tap open ground beside the road. Archers are cheap, cannons hit groups, frost slows." },
    { title: "Send a wave", text: "Press Space or tap Send wave when your defences are ready." },
    { title: "Upgrade", text: "Tap a tower to raise it up to three stars, or sell it for half its cost." },
    { title: "Score", text: "Every raider stopped pays gold and points. Clearing a wave with lives to spare scores extra." }
  ],

  prize: {
    /** The score a player needs to claim the prize. */
    threshold: 6000,
    title: "Scored 6 000+? Claim your free table",
    text: "Tell us where to send your voucher. One per group, valid for 30 days.",
    submitLabel: "Claim my free table",
    successMessage: "Voucher on its way. Bring your friends!"
  },

  /** Where claim forms go. Leave the endpoint empty to use the visitor's email app. */
  form: {} satisfies FormSettings
};
