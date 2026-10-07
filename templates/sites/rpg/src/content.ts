/**
 * Everything the game says and how it plays. Change this file to make it
 * someone else's: their name and colours, their prize, a different hero,
 * new monsters or floors. The sample business below is invented; replace
 * every line of it.
 */
import type { Brand, Business, FormSettings } from "./lib/site";
import { DEFAULT_SETTINGS, type GameSettings } from "./game";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "The Wandering Quill Bookshop",
    tagline: "Slay the dragon, win a book.",
    description: "A fantasy and comics bookshop in Durban North. Reach the bottom of the dungeon and beat the dragon, and a book of your choice is on us.",
    email: "quest@wanderingquill.example",
    whatsapp: "+27 82 555 0122",
    address: "7 Adelaide Tambo Drive, Durban North",
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#b45309",
    accent: "#f59e0b",
    background: "#0c0a09",
    surface: "#1c1917",
    text: "#fafaf9",
    muted: "#a8a29e",
    radius: 12
  } satisfies Brand,

  hero: {
    eyebrow: "Dungeon quest",
    title: "The Dragon of the Deep",
    subtitle: "Fight your way down three floors, grow stronger, and slay the dragon. Score 1 800 or more and claim a free book."
  },

  game: { ...DEFAULT_SETTINGS, hero: { ...DEFAULT_SETTINGS.hero, name: "Quill" } } satisfies GameSettings,

  howTo: [
    { title: "Explore", text: "Arrow keys, WASD or the on-screen pad. Chests hold gold, pink flasks are potions, golden steps go down." },
    { title: "Fight", text: "Walk into a monster to battle it. Attack (1), drink a potion (2) or try to flee (3)." },
    { title: "Level up", text: "Every win earns experience. Each level gives more health, attack and defence." },
    { title: "Win", text: "The dragon waits on the last floor, and you cannot run from it. Come prepared." }
  ],

  prize: {
    /** The score a player needs to claim the prize. */
    threshold: 1800,
    title: "Scored 1 800+? Claim your free book",
    text: "Tell us where to send your voucher. One per person, valid for 30 days.",
    submitLabel: "Claim my free book",
    successMessage: "Voucher on its way, hero. See you at the shop!"
  },

  /** Where claim forms go. Leave the endpoint empty to use the visitor's email app. */
  form: {} satisfies FormSettings
};
