/**
 * Everything the booking site says and offers. Change this file to make it
 * someone else's. The sample business below is invented; replace all of it.
 */
import type { Brand, Business, FormSettings, NavLink } from "./lib/site";
import type { DayHours, Service } from "./slots";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Studio Nova Hair",
    tagline: "Cuts, colour and care in the heart of Sea Point.",
    description: "A small, friendly salon with three stylists. Book online in under a minute.",
    phone: "021 555 0167",
    email: "book@studionova.example",
    whatsapp: "+27 83 555 0167",
    address: "82 Regent Road, Sea Point, Cape Town",
    hours: [
      { days: "Tue – Fri", time: "09:00 – 18:00" },
      { days: "Saturday", time: "08:00 – 14:00" },
      { days: "Sun – Mon", time: "Closed" }
    ],
    social: [{ label: "Instagram", url: "https://instagram.com" }]
  } satisfies Business,

  brand: {
    primary: "#7c3aed",
    accent: "#ec4899",
    background: "#ffffff",
    surface: "#f7f3ff",
    text: "#1e1b2e",
    muted: "#5d5873",
    radius: 16
  } satisfies Brand,

  nav: [
    { label: "Services", href: "#services" },
    { label: "Team", href: "#team" },
    { label: "Book", href: "#book" }
  ] satisfies NavLink[],

  hero: {
    eyebrow: "Book online, any time",
    title: "Hair you'll love, booked in a minute.",
    subtitle: "Pick a service and a time that suits you. We'll confirm by email and send a reminder the day before.",
    art: "💇"
  },

  services: [
    { id: "cut", name: "Cut & blow-dry", minutes: 60, price: 450, description: "Consultation, wash, cut and style." },
    { id: "blowdry", name: "Blow-dry", minutes: 30, price: 250, description: "Wash and a smooth or voluminous finish." },
    { id: "colour", name: "Full colour", minutes: 120, price: 950, description: "Root-to-tip colour with a gloss treatment." },
    { id: "highlights", name: "Highlights", minutes: 150, price: 1250, description: "Foils or balayage, toner and blow-dry." },
    { id: "treatment", name: "Repair treatment", minutes: 45, price: 380, description: "Bond-building mask and scalp massage." }
  ] satisfies Service[],

  /** 0 is Sunday. Leave a day out to close it. */
  openingHours: [
    { day: 2, open: "09:00", close: "18:00", breakFrom: "13:00", breakTo: "13:30" },
    { day: 3, open: "09:00", close: "18:00", breakFrom: "13:00", breakTo: "13:30" },
    { day: 4, open: "09:00", close: "18:00", breakFrom: "13:00", breakTo: "13:30" },
    { day: 5, open: "09:00", close: "18:00", breakFrom: "13:00", breakTo: "13:30" },
    { day: 6, open: "08:00", close: "14:00" }
  ] satisfies DayHours[],

  /** How far ahead people can book, in open days. */
  bookingWindowDays: 14,
  /** Minimum notice for a same-day booking, in minutes. */
  leadMinutes: 90,

  team: [
    { name: "Stylist one", role: "Senior stylist · colour specialist", emoji: "👩🏽‍🦱" },
    { name: "Stylist two", role: "Stylist · cuts and curly hair", emoji: "🧑🏻‍🦰" },
    { name: "Stylist three", role: "Junior stylist · blow-dries", emoji: "👩🏾" }
  ],

  policies: [
    "Please arrive five minutes early for colour appointments.",
    "Cancel or move a booking up to 24 hours before at no charge.",
    "A 50% deposit applies to colour services of R900 and more."
  ],

  /**
   * Where bookings go. With an endpoint set they are posted there; without it
   * the customer's email app opens with the booking filled in.
   */
  forms: {} as FormSettings
};

export type Site = typeof site;
