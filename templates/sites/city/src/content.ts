/**
 * Everything the game says and how it plays. Change this file to make it
 * someone else's: their name and colours, their prize, a bigger city,
 * more traffic. The sample business below is invented; replace every line of it.
 */
import type { Brand, Business, FormSettings } from "./lib/site";
import { DEFAULT_SETTINGS, type GameSettings } from "./game";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Night Shift Arcade",
    tagline: "Run the city. Beat the clock.",
    description: "An arcade bar on Long Street, Cape Town. Make enough deliveries in our city game and your next round is on us.",
    email: "hello@nightshift.example",
    whatsapp: "+27 82 555 0199",
    address: "201 Long Street, Cape Town",
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#0ea5e9",
    accent: "#38bdf8",
    background: "#05080f",
    surface: "#0c1424",
    text: "#ecfdf5",
    muted: "#9ca3af",
    radius: 14
  } satisfies Brand,

  hero: {
    eyebrow: "Open-world city",
    title: "Night Shift",
    subtitle: "Walk the streets, take any car, make deliveries against the clock and stay one step ahead of the police. Score 1 500 or more and claim a free round."
  },

  game: { ...DEFAULT_SETTINGS } satisfies GameSettings,

  howTo: [
    { title: "Move", text: "Arrows or WASD (or the pad on a phone) to walk, and to drive once you are in a car." },
    { title: "Drive", text: "Press E beside a car to get in. Parked cars are free; taking one from the traffic gets you wanted." },
    { title: "Deliver", text: "Follow the arrow to the green marker, collect the package and get it to the yellow one before time runs out." },
    { title: "Stay free", text: "Crimes bring the police. Stay out of their sight to lose your stars; if they catch you on foot, you are busted." }
  ],

  prize: {
    /** The score a player needs to claim the prize. */
    threshold: 1500,
    title: "Scored 1 500+? Claim your free round",
    text: "Tell us where to send your voucher. One per player, valid for 30 days.",
    submitLabel: "Claim my free round",
    successMessage: "Voucher on its way. See you on Long Street!"
  },

  /** Where claim forms go. Leave the endpoint empty to use the visitor's email app. */
  form: {} satisfies FormSettings
};
