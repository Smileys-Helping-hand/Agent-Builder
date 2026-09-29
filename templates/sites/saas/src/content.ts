/**
 * Everything the product says, and the sample data the dashboard shows.
 * Change this file to make it someone else's. The product, customers and team
 * below are invented; replace all of it.
 */
import type { Customer, Member, MonthPoint, Role } from "./data";
import type { Brand, Business, FormSettings, NavLink } from "./lib/site";

export const site = {
  /** Shows the "template preview" ribbon. Set to false for a real customer. */
  demo: true,

  business: {
    name: "Ledgerly",
    tagline: "Subscription analytics for South African SaaS.",
    description: "See revenue, churn and growth in one place, in rand, updated every hour.",
    email: "hello@ledgerly.example",
    social: [{ label: "LinkedIn", url: "https://linkedin.com" }]
  } satisfies Business,

  brand: {
    primary: "#4f46e5",
    accent: "#22d3ee",
    background: "#f8fafc",
    surface: "#ffffff",
    text: "#0f172a",
    muted: "#64748b",
    radius: 12
  } satisfies Brand,

  nav: [
    { label: "Features", href: "#features" },
    { label: "Pricing", href: "#pricing" }
  ] satisfies NavLink[],

  hero: {
    eyebrow: "Built for rand, not dollars",
    title: "Know your numbers without a spreadsheet.",
    subtitle: "Connect your billing and see MRR, churn and cohorts in minutes. Free for 14 days, no card needed."
  },

  features: [
    { icon: "📊", title: "Live MRR", text: "Revenue by plan, updated every hour from your billing provider." },
    { icon: "🔁", title: "Churn you can act on", text: "See who is about to leave, and why, before they go." },
    { icon: "👥", title: "Roles and teams", text: "Give finance, sales and the board exactly the access they need." },
    { icon: "🇿🇦", title: "Local payments", text: "Works with PayFast, Paystack and debit orders out of the box." }
  ],

  plans: [
    { name: "Starter", price: 490, features: ["Up to 100 customers", "Core metrics", "1 seat"] },
    { name: "Growth", price: 1490, features: ["Up to 2 000 customers", "Cohorts & churn alerts", "5 seats"], featured: true },
    { name: "Scale", price: 3990, features: ["Unlimited customers", "API & exports", "Unlimited seats"] }
  ],

  /**
   * Demo sign-ins for the preview. There are no passwords: this is a static
   * template, so signing in only chooses whose view to show. A real build
   * replaces it with an auth provider and checks roles on the server.
   */
  demoAccounts: [
    { email: "owner@demo.example", name: "Demo owner", role: "owner" as Role },
    { email: "member@demo.example", name: "Demo member", role: "member" as Role },
    { email: "viewer@demo.example", name: "Demo viewer", role: "viewer" as Role }
  ],

  team: [
    { email: "owner@demo.example", name: "Demo owner", role: "owner" },
    { email: "finance@demo.example", name: "Finance lead", role: "admin" },
    { email: "member@demo.example", name: "Demo member", role: "member" },
    { email: "viewer@demo.example", name: "Demo viewer", role: "viewer" }
  ] satisfies Member[],

  /** Past months' MRR. The last entry should match the active customers below. */
  history: [
    { month: "Apr", mrr: 8400 },
    { month: "May", mrr: 9600 },
    { month: "Jun", mrr: 10800 },
    { month: "Jul", mrr: 12100 },
    { month: "Aug", mrr: 11900 },
    { month: "Sep", mrr: 13900 },
    { month: "Oct", mrr: 15600 },
    { month: "Nov", mrr: 17420 }
  ] satisfies MonthPoint[],

  customers: [
    { id: "c1", name: "Acacia Logistics", plan: "Scale", mrr: 3990, status: "active", joined: "2025-03-02" },
    { id: "c2", name: "Baobab Health", plan: "Growth", mrr: 1490, status: "active", joined: "2025-05-19" },
    { id: "c3", name: "Cederberg Outdoor", plan: "Starter", mrr: 490, status: "active", joined: "2025-06-11" },
    { id: "c4", name: "Drakensberg Dental", plan: "Growth", mrr: 1490, status: "trial", joined: "2025-11-01" },
    { id: "c5", name: "Elands Engineering", plan: "Scale", mrr: 3990, status: "active", joined: "2024-12-08" },
    { id: "c6", name: "Fynbos Finance", plan: "Growth", mrr: 1490, status: "churned", joined: "2025-01-15" },
    { id: "c7", name: "Gariep Grains", plan: "Starter", mrr: 490, status: "active", joined: "2025-08-23" },
    { id: "c8", name: "Hantam Hotels", plan: "Growth", mrr: 1490, status: "active", joined: "2025-04-04" },
    { id: "c9", name: "Isipingo Imports", plan: "Starter", mrr: 490, status: "trial", joined: "2025-11-12" },
    { id: "c10", name: "Jozi Jewellers", plan: "Scale", mrr: 3990, status: "active", joined: "2025-02-27" },
    { id: "c11", name: "Kalahari Kitchens", plan: "Starter", mrr: 490, status: "churned", joined: "2025-03-30" },
    { id: "c12", name: "Limpopo Legal", plan: "Growth", mrr: 1490, status: "active", joined: "2025-07-07" }
  ] satisfies Customer[],

  /** Where demo requests go; see the README. */
  forms: {} as FormSettings
};

export type Site = typeof site;
