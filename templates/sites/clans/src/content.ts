/**
 * Everything the game says and how it plays. Change this file to make it
 * someone else's: their name and colours, their prize, more buildings,
 * tougher raids. The sample business below is invented; replace every line of it.
 */
import type { Brand, Business, FormSettings } from "./lib/site";
import { DEFAULT_SETTINGS, type GameSettings } from "./game";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Clanhall Gaming Lounge",
    tagline: "Build your village. Raid for glory.",
    description: "A gaming lounge in Braamfontein, Johannesburg. Earn 15 trophies in our village game and your next hour of play is on us.",
    email: "hello@clanhall.example",
    whatsapp: "+27 82 555 0188",
    address: "12 Juta Street, Braamfontein, Johannesburg",
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#d97706",
    accent: "#facc15",
    background: "#120d05",
    surface: "#21180b",
    text: "#ecfdf5",
    muted: "#9ca3af",
    radius: 14
  } satisfies Brand,

  hero: {
    eyebrow: "Village builder",
    title: "Clanhall",
    subtitle: "Grow your village, train an army and raid rival clans for gold and trophies. Score 1 500 or more and claim a free hour of play."
  },

  game: { ...DEFAULT_SETTINGS } satisfies GameSettings,

  howTo: [
    { title: "Build", text: "Pick a building and tap open ground. Mines make gold, collectors make elixir, cannons defend." },
    { title: "Upgrade", text: "Tap a building to upgrade it. Builders work against a timer; the town hall unlocks more of everything." },
    { title: "Train", text: "Barracks train barbarians, archers and giants into your army camps, paid in elixir." },
    { title: "Raid", text: "Tap Raid, then tap the edge of the rival village to send troops in. Half destroyed, the town hall, or all of it: a star each." }
  ],

  prize: {
    /** The score a player needs to claim the prize. */
    threshold: 1500,
    title: "Scored 1 500+? Claim your free hour",
    text: "Tell us where to send your voucher. One per player, valid for 30 days.",
    submitLabel: "Claim my free hour",
    successMessage: "Voucher on its way. See you at the lounge!"
  },

  /** Where claim forms go. Leave the endpoint empty to use the visitor's email app. */
  form: {} satisfies FormSettings
};
