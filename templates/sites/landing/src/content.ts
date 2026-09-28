/**
 * Everything the site says. Change this file to make the site someone else's.
 * The sample business below is invented; replace every line of it.
 */
import type { Brand, Business, FormSettings, NavLink } from "./lib/site";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Brightline Solar",
    tagline: "Solar power for Cape Town homes, installed in a day.",
    description:
      "We design, install and maintain rooftop solar and backup systems for homes and small businesses across the Western Cape.",
    phone: "021 555 0142",
    email: "hello@brightline.example",
    whatsapp: "+27 82 555 0142",
    address: "14 Harbour Road, Paarden Eiland, Cape Town",
    hours: [
      { days: "Mon – Fri", time: "08:00 – 17:00" },
      { days: "Saturday", time: "09:00 – 13:00" }
    ],
    social: [
      { label: "Facebook", url: "https://facebook.com" },
      { label: "Instagram", url: "https://instagram.com" }
    ]
  } satisfies Business,

  brand: {
    primary: "#ea580c",
    accent: "#facc15",
    background: "#ffffff",
    surface: "#fff7ed",
    text: "#1c1917",
    muted: "#57534e",
    radius: 14
  } satisfies Brand,

  nav: [
    { label: "Services", href: "#services" },
    { label: "How it works", href: "#process" },
    { label: "Pricing", href: "#pricing" },
    { label: "FAQ", href: "#faq" }
  ] satisfies NavLink[],

  hero: {
    eyebrow: "Load-shedding, solved",
    title: "Keep the lights on. Cut the bill.",
    subtitle:
      "A properly sized solar and battery system, installed by certified electricians, with a free assessment before you commit to anything.",
    primaryCta: { label: "Get a free quote", href: "#contact" },
    secondaryCta: { label: "See pricing", href: "#pricing" },
    art: "☀️"
  },

  stats: [
    { value: "1 200+", label: "homes installed" },
    { value: "4.9★", label: "average rating" },
    { value: "1 day", label: "typical install" },
    { value: "10 yr", label: "workmanship warranty" }
  ],

  services: [
    { icon: "🔆", title: "Rooftop solar", text: "Tier-1 panels sized to your actual usage, not a sales target." },
    { icon: "🔋", title: "Battery backup", text: "Lithium batteries that carry you through stage 6 without noticing." },
    { icon: "📱", title: "App monitoring", text: "See what you generate, store and use from your phone, live." },
    { icon: "🛠️", title: "Maintenance", text: "Yearly cleaning and inspection plans that keep output at its best." }
  ],

  process: [
    { title: "Free assessment", text: "We look at your bills, roof and backup needs — on site or from photos." },
    { title: "A clear quote", text: "One fixed price, with the expected payback period in writing." },
    { title: "Installation", text: "Most homes are done in a single day, with a compliance certificate." },
    { title: "Aftercare", text: "Monitoring, warranty support and a real person to call." }
  ],

  pricing: [
    {
      name: "Backup",
      price: 38500,
      note: "Inverter + battery",
      features: ["5 kW inverter", "5 kWh lithium battery", "Lights, Wi-Fi, TV and fridge", "Installed in half a day"]
    },
    {
      name: "Hybrid",
      price: 89000,
      note: "Most popular",
      featured: true,
      features: ["8 kW inverter", "10 kWh battery", "8 × 550 W panels", "Cuts most bills by 60–80%"]
    },
    {
      name: "Off-grid ready",
      price: 165000,
      note: "Whole-home",
      features: ["12 kW inverter", "20 kWh battery", "14 × 550 W panels", "Runs the whole house"]
    }
  ],

  testimonials: [
    { quote: "Installed on a Tuesday, and we slept through stage 6 that Friday. The team left the place spotless.", name: "Sample customer", place: "Durbanville" },
    { quote: "The quote was exactly what we paid. Our bill went from R3 200 to under R900.", name: "Sample customer", place: "Tokai" },
    { quote: "They sized it for what we actually use instead of upselling us. Refreshing.", name: "Sample customer", place: "Milnerton" }
  ],

  faq: [
    { q: "Do I need permission from the City?", a: "Yes, and we handle the SSEG registration for you as part of every grid-tied install." },
    { q: "How long does installation take?", a: "Most homes are finished in one day. Larger systems can take two." },
    { q: "Can I add more panels later?", a: "Yes. We size inverters with room to grow so adding panels later is simple." },
    { q: "Do you offer finance?", a: "We work with two lenders offering 24–60 month terms. Ask us for a finance quote." }
  ],

  contact: {
    title: "Get a free quote",
    intro: "Tell us a little about your home and we will get back to you within one working day."
  },

  /** Set `endpoint` to receive submissions directly; see the README. */
  forms: {} as FormSettings
};

export type Site = typeof site;
