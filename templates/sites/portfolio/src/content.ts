/**
 * Everything the portfolio says. Change this file to make it someone else's.
 * The sample person below is invented; replace all of it.
 */
import type { Brand, Business, FormSettings, NavLink } from "./lib/site";

export interface Project {
  id: string;
  title: string;
  client: string;
  year: number;
  tags: string[];
  summary: string;
  /** Paragraphs for the project's own page. */
  story: string[];
  outcome: string;
  emoji: string;
  link?: string;
}

export interface Role {
  start: number;
  /** null while it is the current role. */
  end: number | null;
  title: string;
  place: string;
  text: string;
}

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Lindiwe Mokoena",
    tagline: "Brand and product designer, Johannesburg.",
    description: "I design identities and digital products for South African start-ups and the people who back them.",
    email: "hello@lindiwe.example",
    whatsapp: "+27 84 555 0199",
    address: "Maboneng, Johannesburg",
    social: [
      { label: "LinkedIn", url: "https://linkedin.com" },
      { label: "Behance", url: "https://behance.net" },
      { label: "Dribbble", url: "https://dribbble.com" }
    ]
  } satisfies Business,

  brand: {
    primary: "#2563eb",
    accent: "#06b6d4",
    background: "#0b1020",
    surface: "#121a30",
    text: "#e8edf8",
    muted: "#9aa6c0",
    radius: 18
  } satisfies Brand,

  nav: [
    { label: "Work", href: "#/" },
    { label: "About", href: "#/about" },
    { label: "Contact", href: "#/contact" }
  ] satisfies NavLink[],

  hero: {
    greeting: "Hi, I'm Lindiwe.",
    title: "I make brands people remember and products people keep using.",
    availability: "Taking on two projects for the next quarter."
  },

  projects: [
    {
      id: "kasi-pay",
      title: "Kasi Pay",
      client: "Fintech start-up",
      year: 2025,
      tags: ["Product", "Mobile"],
      summary: "A payments app for spaza shops that works on a R900 phone.",
      story: [
        "Most payment apps assume a new phone and fast data. Our users had neither.",
        "We designed for 3G, big tap targets and Zulu, Sotho and English from day one, and tested every screen in real shops."
      ],
      outcome: "40 000 merchants in the first year.",
      emoji: "📱"
    },
    {
      id: "harvest",
      title: "Harvest Table",
      client: "Farm-to-table restaurant group",
      year: 2025,
      tags: ["Brand", "Print"],
      summary: "A rebrand for three restaurants that grow their own produce.",
      story: ["The old identity said 'fine dining'. The food said 'grandmother's kitchen'.", "We brought the two together with hand-drawn type and earthy colour."],
      outcome: "Weekday covers up 22% after the relaunch.",
      emoji: "🌾"
    },
    {
      id: "learnline",
      title: "LearnLine",
      client: "EdTech non-profit",
      year: 2024,
      tags: ["Product", "Web"],
      summary: "Homework help over WhatsApp for high-school learners.",
      story: ["Learners already live in WhatsApp, so we built the tutor there instead of asking them to download anything."],
      outcome: "Used by learners in 600 schools.",
      emoji: "📚"
    },
    {
      id: "ubuntu-coffee",
      title: "Ubuntu Coffee",
      client: "Roastery",
      year: 2024,
      tags: ["Brand", "Packaging"],
      summary: "Identity and bags for a Soweto micro-roastery.",
      story: ["Each origin got its own pattern, drawn from the fabric traditions of where the beans are grown."],
      outcome: "Now stocked in 40 stores nationally.",
      emoji: "☕"
    }
  ] satisfies Project[],

  experience: [
    { start: 2022, end: null, title: "Independent designer", place: "Self-employed", text: "Brand and product work for start-ups and non-profits." },
    { start: 2019, end: 2022, title: "Senior product designer", place: "A Johannesburg fintech", text: "Led design for the consumer app, 2 million users." },
    { start: 2016, end: 2019, title: "Designer", place: "A Cape Town agency", text: "Identities, campaigns and websites for retail brands." }
  ] satisfies Role[],

  skills: ["Brand identity", "Product design", "Design systems", "Prototyping", "Illustration", "Workshop facilitation"],

  about: [
    "I grew up in Polokwane drawing on the back of my mother's receipt books, and I still start every project on paper.",
    "My work sits where brand and product meet: making sure the thing people use every day feels like the company that made it."
  ],

  /** Where contact form messages go; see the README. */
  forms: {} as FormSettings
};

export type Site = typeof site;
