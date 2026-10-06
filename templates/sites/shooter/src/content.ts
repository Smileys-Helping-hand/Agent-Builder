/**
 * Everything the game says and how it plays. Change this file to make it
 * someone else's: their name and colours, their prize, harder or easier
 * waves. The sample business below is invented; replace every line of it.
 */
import type { Brand, Business, FormSettings } from "./lib/site";
import { DEFAULT_SETTINGS, type GameSettings } from "./game";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Orbit Gaming Lounge",
    tagline: "Beat the waves, win a free hour.",
    description: "An esports and arcade lounge in Braamfontein, Johannesburg. Top the leaderboard and your next hour of play is on us.",
    email: "play@orbitlounge.example",
    whatsapp: "+27 82 555 0144",
    address: "12 De Korte Street, Braamfontein, Johannesburg",
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#0ea5e9",
    accent: "#22d3ee",
    background: "#030712",
    surface: "#0b1220",
    text: "#e0f2fe",
    muted: "#94a3b8",
    radius: 16
  } satisfies Brand,

  hero: {
    eyebrow: "Arcade challenge",
    title: "Orbit Defender",
    subtitle: "Hold off three waves of invaders. Score 4 000 or more and claim a free hour at the lounge."
  },

  game: { ...DEFAULT_SETTINGS } satisfies GameSettings,

  howTo: [
    { title: "Move", text: "Drag, slide your finger, or use ← → (or A / D) on a keyboard." },
    { title: "Fire", text: "Hold Space, or keep a finger on the board to keep firing." },
    { title: "Power-ups", text: "R is rapid fire, S is a shield, + is an extra life. Fly into them." },
    { title: "Score", text: "Tanks take two hits, aces fire fast — both are worth more. Later waves score extra." }
  ],

  prize: {
    /** The score a player needs to claim the prize. */
    threshold: 4000,
    title: "Scored 4 000+? Claim your free hour",
    text: "Tell us where to send your voucher. One per person, valid for 30 days.",
    submitLabel: "Claim my free hour",
    successMessage: "Voucher on its way. See you at the lounge!"
  },

  /** Where claim forms go. Leave the endpoint empty to use the visitor's email app. */
  form: {} satisfies FormSettings
};
