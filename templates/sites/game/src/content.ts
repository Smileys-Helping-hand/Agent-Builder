/**
 * Everything the game says and how it plays. Change this file to make it
 * someone else's: their name and colours, their prize, harder or easier
 * levels. The sample business below is invented; replace every line of it.
 */
import type { Brand, Business, FormSettings } from "./lib/site";
import type { GameSettings } from "./game";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Bean There Coffee",
    tagline: "Play the game, win a coffee.",
    description: "A neighbourhood coffee bar in Woodstock, Cape Town. Beat the high score and your next flat white is on us.",
    email: "hello@beanthere.example",
    whatsapp: "+27 82 555 0199",
    address: "88 Albert Road, Woodstock, Cape Town",
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#8b5cf6",
    accent: "#22d3ee",
    background: "#0b0718",
    surface: "#150f2b",
    text: "#f5f3ff",
    muted: "#a5a1c2",
    radius: 16
  } satisfies Brand,

  hero: {
    eyebrow: "Arcade challenge",
    title: "Neon Breakout",
    subtitle: "Clear every brick in three levels. Score 1 500 or more and claim a free coffee."
  },

  game: {
    width: 640,
    height: 480,
    lives: 3,
    speed: 320,
    speedUpPerLevel: 0.12,
    colors: ["#22d3ee", "#a855f7", "#f472b6"],
    levels: [
      { name: "Warm-up", rows: ["11111111", "11111111", "11111111"] },
      { name: "Double shot", rows: ["22222222", "21111112", "11111111", "1.1..1.1"] },
      { name: "Espresso rush", rows: ["33333333", "2.2222.2", "22111122", "1.1111.1", "11111111"] }
    ]
  } satisfies GameSettings,

  howTo: [
    { title: "Move", text: "Drag, slide your finger, or use ← → on a keyboard." },
    { title: "Launch", text: "Tap the board or press Space to send the ball." },
    { title: "Pause", text: "Press P or tap Pause. The game waits for you." },
    { title: "Score", text: "Tougher bricks and later levels are worth more." }
  ],

  prize: {
    /** The score a player needs to claim the prize. */
    threshold: 1500,
    title: "Scored 1 500+? Claim your free coffee",
    text: "Tell us where to send your voucher. One per person, redeemable at the counter within 30 days.",
    submitLabel: "Claim my coffee",
    successMessage: "Voucher on its way. Show it at the counter — see you soon!"
  },

  /** Where claim forms go. Leave the endpoint empty to use the visitor's email app. */
  form: {} satisfies FormSettings
};
