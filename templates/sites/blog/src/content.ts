/**
 * Everything the blog says, including the posts. Change this file to make it
 * someone else's. The sample publication and posts are invented; replace them.
 *
 * Posts are written in Markdown: ## headings, - lists, > quotes, **bold**,
 * *italic*, `code` and [links](https://example.com).
 */
import type { Brand, Business, FormSettings, NavLink } from "./lib/site";
import type { Post } from "./posts";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "The Karoo Ledger",
    tagline: "Plain-language money writing for small South African businesses.",
    description: "Guides on tax, cash flow and pricing for people who run a business rather than an accounts department.",
    email: "editor@karooledger.example",
    social: [
      { label: "LinkedIn", url: "https://linkedin.com" },
      { label: "X", url: "https://x.com" }
    ]
  } satisfies Business,

  brand: {
    primary: "#0f766e",
    accent: "#eab308",
    background: "#fcfcf9",
    surface: "#f1f0ea",
    text: "#1a1d1c",
    muted: "#5f6664",
    radius: 10,
    font: "Charter, 'Iowan Old Style', Georgia, serif"
  } satisfies Brand,

  nav: [
    { label: "Articles", href: "#/" },
    { label: "About", href: "#/about" },
    { label: "Newsletter", href: "#newsletter" }
  ] satisfies NavLink[],

  hero: {
    eyebrow: "New every Tuesday",
    title: "Money, made simple for people who run things.",
    subtitle: "No jargon, no upsell. Just what you need to know to keep more of what you earn."
  },

  about: [
    "We started The Karoo Ledger because every guide to running a small business in South Africa seemed to be written by someone selling software.",
    "Everything here is checked by a registered tax practitioner before it goes out, and updated when the rules change."
  ],

  posts: [
    {
      slug: "provisional-tax-explained",
      title: "Provisional tax, explained without the headache",
      date: "2026-02-24",
      author: "Sample author",
      tags: ["Tax", "Getting started"],
      cover: "🧾",
      excerpt: "Twice a year, if you earn outside a salary. Here is what it is, when it's due, and how to avoid the penalty.",
      body: `If you earn money that isn't a salary with PAYE taken off, SARS wants some of it **in advance**. That is provisional tax.

## Who has to pay it

- Sole proprietors and freelancers
- Anyone with rental or investment income over the threshold
- Directors who earn more than their PAYE covers

## When it is due

1. The first payment, six months into the tax year.
2. The second, at the end of February.
3. An optional top-up seven months after year-end.

> Underestimating by more than 20% on the second payment attracts a penalty, so estimate generously.

Keep a separate account and move a percentage of every invoice into it the day it is paid. See the [SARS guide](https://www.sars.gov.za) for the current thresholds.`
    },
    {
      slug: "price-your-work",
      title: "How to price your work so you actually profit",
      date: "2026-02-17",
      author: "Sample author",
      tags: ["Pricing"],
      cover: "🏷️",
      excerpt: "Most small businesses underprice by forgetting three costs. Here's a simple way to find your real floor.",
      body: `The price you charge has to cover more than the hours you bill.

## The three forgotten costs

- **Unbillable time** — quoting, admin, chasing invoices
- **Tools** — software, data, equipment wear
- **Tax** — income tax and, if registered, VAT

Add those up for a month, divide by the hours you actually bill, and add that to your hourly rate. That number is your *floor*, not your price.`
    },
    {
      slug: "cash-flow-weekly",
      title: "A fifteen-minute weekly cash-flow habit",
      date: "2026-02-10",
      author: "Sample author",
      tags: ["Cash flow", "Getting started"],
      cover: "📈",
      excerpt: "Businesses rarely fail from lack of profit. They fail from lack of cash. One small weekly routine fixes most of it.",
      body: `Every Monday, before email, answer three questions:

1. What money is coming in over the next four weeks?
2. What must go out?
3. Where is the gap?

If there is a gap, you have weeks to fix it instead of days. Send reminders, move a supplier payment, or ask for a deposit on the next job.`
    }
  ] satisfies Post[],

  /** Where newsletter sign-ups go; see the README. */
  forms: {} as FormSettings
};

export type Site = typeof site;
