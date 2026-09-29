/**
 * Everything the shop says and sells. Change this file to make it someone else's.
 * The sample shop below is invented; replace every line of it.
 */
import type { Product, ShippingRule } from "./cart";
import type { Brand, Business, FormSettings, NavLink } from "./lib/site";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Fynbos & Co.",
    tagline: "Small-batch body care made with Cape botanicals.",
    description: "Soaps, oils and candles made by hand in Stellenbosch from fynbos we grow ourselves.",
    phone: "021 555 0188",
    email: "orders@fynbos.example",
    whatsapp: "+27 72 555 0188",
    address: "Unit 4, Oude Molen Village, Stellenbosch",
    hours: [{ days: "Orders ship", time: "Mon – Thu" }],
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#15803d",
    accent: "#f59e0b",
    background: "#fffdf8",
    surface: "#f3f1e8",
    text: "#1f2a1f",
    muted: "#5b6b5b",
    radius: 16
  } satisfies Brand,

  nav: [
    { label: "Shop", href: "#/" },
    { label: "About", href: "#/about" },
    { label: "Delivery", href: "#/delivery" }
  ] satisfies NavLink[],

  hero: {
    eyebrow: "Handmade in Stellenbosch",
    title: "Botanical care, grown and made at home.",
    subtitle: "Every bar, oil and candle is made in small batches from plants we grow on the farm. Free delivery on orders over R600."
  },

  categories: ["All", "Soap", "Oils", "Candles", "Gift sets"],

  products: [
    { id: "buchu-soap", name: "Buchu & Honey Soap", category: "Soap", price: 95, description: "Cold-process bar with buchu oil and raw honey. 120 g.", emoji: "🧼", stock: 40, tags: ["gentle", "honey"] },
    { id: "rooibos-soap", name: "Rooibos Exfoliating Bar", category: "Soap", price: 105, description: "Ground rooibos for a gentle scrub, with shea butter. 120 g.", emoji: "🍂", stock: 25, tags: ["scrub"] },
    { id: "marula-oil", name: "Marula Face Oil", category: "Oils", price: 320, compareAt: 380, description: "Cold-pressed marula with a drop of geranium. 30 ml.", emoji: "💧", stock: 18, tags: ["face", "glow"] },
    { id: "body-oil", name: "Fynbos Body Oil", category: "Oils", price: 260, description: "Sweet almond and jojoba infused with wild fynbos. 100 ml.", emoji: "🌿", stock: 22 },
    { id: "candle-large", name: "Protea Soy Candle", category: "Candles", price: 290, description: "Hand-poured soy wax, 45-hour burn, in a reusable jar.", emoji: "🕯️", stock: 12, tags: ["gift"] },
    { id: "candle-travel", name: "Travel Tin Candle", category: "Candles", price: 140, description: "The protea scent in a 15-hour tin for the road.", emoji: "🪔", stock: 30 },
    { id: "gift-trio", name: "The Garden Trio", category: "Gift sets", price: 595, compareAt: 675, description: "Buchu soap, body oil and travel candle in a linen bag.", emoji: "🎁", stock: 8, tags: ["gift", "bundle"] },
    { id: "gift-spa", name: "Weekend Spa Box", category: "Gift sets", price: 890, description: "Face oil, two soaps and the large candle, boxed.", emoji: "💝", stock: 5, tags: ["gift", "bundle"] }
  ] satisfies Product[],

  shipping: { flat: 85, freeFrom: 600 } satisfies ShippingRule,

  about: {
    title: "Grown on the farm, made in the kitchen",
    paragraphs: [
      "It started with a buchu bush by the back door and a stubborn eczema that nothing from the shops would settle.",
      "Today we grow six fynbos species on a quarter hectare outside Stellenbosch and make everything in batches of forty, so it is always fresh."
    ]
  },

  delivery: [
    { q: "How long does delivery take?", a: "2–4 working days to main centres with The Courier Guy, a little longer to outlying areas." },
    { q: "What does it cost?", a: "R85 anywhere in South Africa, and free on orders of R600 or more." },
    { q: "Can I return something?", a: "Unopened products can be returned within 14 days. Opened items can't be resold, but tell us if something is wrong and we will make it right." }
  ],

  /**
   * How a customer pays. With no payment link the order is sent to the shop
   * by email and paid by EFT; set `paymentUrl` to a PayFast, Yoco or SnapScan
   * payment page to send them straight there instead.
   */
  checkout: {
    paymentUrl: "",
    eftDetails: "FNB · Fynbos & Co. · Account 62 000 000 000 · Branch 250655 · Use your order number as reference."
  },

  forms: {} as FormSettings
};

export type Site = typeof site;
