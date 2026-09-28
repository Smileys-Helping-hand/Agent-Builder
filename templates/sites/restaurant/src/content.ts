/**
 * Everything the restaurant site says and serves. Change this file to make it
 * someone else's. The sample restaurant below is invented; replace all of it.
 */
import type { Brand, Business, FormSettings, NavLink } from "./lib/site";
import type { MenuSection, ReservationRules } from "./menu";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Salt & Ember",
    tagline: "Fire-cooked food from the Cape coast.",
    description: "A neighbourhood grill in Kalk Bay cooking over open flame, with a wine list from small local farms.",
    phone: "021 555 0133",
    email: "table@saltandember.example",
    whatsapp: "+27 71 555 0133",
    address: "11 Main Road, Kalk Bay, Cape Town",
    hours: [
      { days: "Tue – Thu", time: "17:30 – 22:00" },
      { days: "Fri – Sat", time: "12:00 – 23:00" },
      { days: "Sunday", time: "12:00 – 16:00" }
    ],
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#c2410c",
    accent: "#fbbf24",
    background: "#16110d",
    surface: "#211a14",
    text: "#f6ede4",
    muted: "#b6a795",
    radius: 12,
    font: "Georgia, 'Times New Roman', serif"
  } satisfies Brand,

  nav: [
    { label: "Menu", href: "#menu" },
    { label: "Gallery", href: "#gallery" },
    { label: "Find us", href: "#visit" }
  ] satisfies NavLink[],

  hero: {
    eyebrow: "Kalk Bay · since 2019",
    title: "Coals, catch of the day, and a good table.",
    subtitle: "Line fish from the harbour across the road, cooked over vine cuttings. Book a table or just walk in."
  },

  menu: [
    {
      title: "To start",
      dishes: [
        { name: "Charred bread & smoked butter", description: "Sourdough from the coals, whipped butter, sea salt.", price: 65, diet: ["vegetarian"] },
        { name: "Calamari", description: "Flash-grilled, chilli, lemon and garlic oil.", price: 110, diet: ["gluten-free", "spicy"] },
        { name: "Roast beetroot", description: "Labneh, dukkah, honey and thyme.", price: 95, diet: ["vegetarian", "gluten-free"] }
      ]
    },
    {
      title: "From the fire",
      note: "All mains come with a side of your choice.",
      dishes: [
        { name: "Line fish of the day", description: "Whatever came in this morning, with braaied lemon and caper butter.", price: 245, diet: ["gluten-free"], badge: "Chef's pick" },
        { name: "Sirloin 300 g", description: "Dry-aged, with chimichurri.", price: 285, diet: ["gluten-free"] },
        { name: "Peri-peri half chicken", description: "Marinated overnight, basted on the coals.", price: 195, diet: ["gluten-free", "spicy"] },
        { name: "Coal-roasted cauliflower", description: "Whole head, tahini, pomegranate and herbs.", price: 165, diet: ["vegan", "vegetarian", "gluten-free"] }
      ]
    },
    {
      title: "Sides",
      dishes: [
        { name: "Fire-roasted potatoes", description: "Rosemary and garlic.", price: 45, diet: ["vegan", "vegetarian", "gluten-free"] },
        { name: "Green salad", description: "House vinaigrette.", price: 45, diet: ["vegan", "vegetarian", "gluten-free"] },
        { name: "Pap & chakalaka", description: "Soft pap and our slow-cooked relish.", price: 50, diet: ["vegan", "vegetarian", "spicy"] }
      ]
    },
    {
      title: "Something sweet",
      dishes: [
        { name: "Malva pudding", description: "With vanilla custard.", price: 85, diet: ["vegetarian"] },
        { name: "Ember-baked peaches", description: "Coconut cream and toasted almonds.", price: 80, diet: ["vegan", "vegetarian", "gluten-free"] }
      ]
    }
  ] satisfies MenuSection[],

  gallery: [
    { emoji: "🔥", caption: "The grill at full tilt" },
    { emoji: "🐟", caption: "Morning catch" },
    { emoji: "🍷", caption: "Local wines" },
    { emoji: "🌅", caption: "Harbour sunsets" },
    { emoji: "🥩", caption: "Dry-aged cuts" },
    { emoji: "🍑", caption: "Dessert from the embers" }
  ],

  reservations: {
    minParty: 1,
    maxParty: 10,
    times: ["12:00", "12:30", "13:00", "13:30", "17:30", "18:00", "18:30", "19:00", "19:30", "20:00", "20:30"],
    closedDays: [1]
  } satisfies ReservationRules,

  /** Where reservation requests go; see the README. */
  forms: {} as FormSettings
};

export type Site = typeof site;
