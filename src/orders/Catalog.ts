/**
 * Catalog — what this builder can make, and the one list everything reads:
 * the phone app's Templates screen, the build prompt for an order, and the
 * "Ready to build" section on the ordering site, which gets it by being sent it
 * (see OrderPipeline.publish).
 *
 * The built-in list lives here. To add, change or hide an item without touching
 * code, put entries in data/catalog.json — an array of items merged by id:
 *
 *   [
 *     { "id": "invitation", "name": "Digital Invitation", "kind": "template",
 *       "category": "Events", "description": "…", "price": 1500, "features": ["RSVP"] },
 *     { "id": "blog", "price": 8000 },
 *     { "id": "restaurant", "hidden": true }
 *   ]
 */
import fs from "fs";
import path from "path";
import { Logger } from "../utils/Logger.js";

export type CatalogKind = "website" | "app" | "template";

export interface TemplateDefinition {
  id: string;
  name: string;
  kind: CatalogKind;
  category: string;
  description: string;
  price: number;
  currency: string;
  timeframe: string;
  icon: string;
  features: string[];
  techStack?: string[];
  /** A finished example people can open. */
  previewUrl?: string;
  /** Other words a customer might use for this, so the site can match payments to it. */
  keywords?: string[];
  /** Extra direction for the build, beyond the customer's brief. Never published. */
  buildNotes?: string;
  /**
   * A folder holding the template's actual code. When set, a customer's build
   * starts from a copy of it and tailors it to their brief, instead of
   * generating from nothing. Never published.
   */
  sourcePath?: string;
  /** Kept out of every list, including the site's. */
  hidden?: boolean;
}

/**
 * Where the templates' code lives: one folder per catalogue id, each a
 * complete Vite + React + TypeScript project that installs, builds and passes
 * its tests on its own (npm run verify:templates proves it). A customer's
 * build starts from a copy of the folder instead of from nothing.
 */
const TEMPLATES_DIR = path.resolve(process.env.TEMPLATES_DIR ?? "templates/sites");

/** Live previews of every template, built by templates/sites/build-previews.mjs. */
const PREVIEWS_URL = (process.env.TEMPLATE_PREVIEWS_URL ?? "https://templates.arpcloudsolutions.co.za").replace(/\/+$/, "");

/**
 * How to tailor a template. Every template keeps what a visitor sees in
 * src/content.ts, so most of a customer's order is editing one file.
 */
const TAILORING = [
  "How this template is organised: everything a visitor sees — business name, colours, text, prices, hours, contact details — is in src/content.ts.",
  "Start there: replace every sample detail with the customer's, and set `demo: false` so the 'template preview' ribbon goes.",
  "Add anything else they asked for as new components; keep pages on hash routes (#/…) so the site works on any static host.",
  "Keep every test in src/*.test.tsx passing. Change a test only when the content it checks has changed on purpose, and add tests for new logic.",
  "Do not edit src/lib/site.tsx or src/styles/base.css unless the change must apply to every page."
].join(" ");

const BUILT_IN_ITEMS: TemplateDefinition[] = [
  {
    id: "landing",
    name: "Business Landing Page",
    kind: "website",
    category: "Website",
    description: "A one-page site that turns visitors into enquiries: hero, services, how it works, pricing, reviews, FAQ and a quote form.",
    price: 4500,
    currency: "ZAR",
    timeframe: "1-2 weeks",
    icon: "🏠",
    features: [
      "Mobile-first design in your colours",
      "Services, process and pricing sections",
      "Reviews and FAQ",
      "Quote form that emails you (or posts to your CRM)",
      "WhatsApp chat button",
      "2 rounds of revisions"
    ],
    techStack: ["React", "TypeScript", "Vite"],
    keywords: ["landing", "starter", "one page", "business website", "website"]
  },
  {
    id: "ecommerce",
    name: "E-Commerce Store",
    kind: "website",
    category: "Online Shop",
    description: "An online shop with search, categories, product pages, a cart that remembers itself, delivery rules and checkout by payment link or EFT.",
    price: 18000,
    currency: "ZAR",
    timeframe: "3-6 weeks",
    icon: "🛒",
    features: [
      "Product catalogue with search and categories",
      "Product pages and sale prices",
      "Cart with stock limits and free-delivery threshold",
      "Checkout with PayFast, Yoco or SnapScan link, or EFT",
      "Orders emailed to you with a reference number",
      "Delivery and returns pages"
    ],
    techStack: ["React", "TypeScript", "Vite"],
    keywords: ["ecommerce", "e-commerce", "store", "shop", "online shop", "products"]
  },
  {
    id: "restaurant",
    name: "Restaurant / Hospitality",
    kind: "app",
    category: "Web App",
    description: "A restaurant site with a filterable menu, a QR-code menu for each table, gallery, reservation requests and a map.",
    price: 9500,
    currency: "ZAR",
    timeframe: "2-4 weeks",
    icon: "🍽️",
    features: [
      "Menu with vegan, vegetarian, gluten-free and spicy filters",
      "QR-code menu per table",
      "Reservations with your days, times and group limits",
      "Photo gallery",
      "Google Maps and opening hours",
      "WhatsApp chat button"
    ],
    techStack: ["React", "TypeScript", "Vite"],
    keywords: ["restaurant", "menu", "cafe", "hospitality", "reservations"]
  },
  {
    id: "saas",
    name: "SaaS Dashboard",
    kind: "app",
    category: "SaaS",
    description: "A product website plus a working dashboard: sign-in with roles, revenue metrics and chart, customer table, billing and team management.",
    price: 35000,
    currency: "ZAR",
    timeframe: "6-12 weeks",
    icon: "📊",
    features: [
      "Marketing site with pricing",
      "Sign-in with owner, admin, member and viewer roles",
      "Revenue, churn and growth metrics with chart",
      "Searchable, sortable customer table",
      "Billing and team pages that follow permissions",
      "Connected to your real auth and data as part of the build"
    ],
    techStack: ["React", "TypeScript", "Vite"],
    keywords: ["saas", "dashboard", "web app", "platform", "portal", "software"],
    buildNotes:
      "The template's sign-in is a demo with no passwords, and its data is sample data. A customer build must connect a real auth provider and data source, and enforce the roles in src/data.ts on the server as well as in the page."
  },
  {
    id: "portfolio",
    name: "Portfolio / Personal Site",
    kind: "website",
    category: "Portfolio",
    description: "A personal site with filterable work, a page for each project, an about page with a career timeline, and an enquiry form.",
    price: 3500,
    currency: "ZAR",
    timeframe: "1-2 weeks",
    icon: "✨",
    features: [
      "Work gallery with filters",
      "A page for each project with its outcome",
      "About page with skills and career timeline",
      "Enquiry form with budget and timing",
      "Links to LinkedIn, Behance and more"
    ],
    techStack: ["React", "TypeScript", "Vite"],
    keywords: ["portfolio", "personal", "resume", "cv", "showcase"]
  },
  {
    id: "booking",
    name: "Booking & Scheduling",
    kind: "app",
    category: "Web App",
    description: "Online booking that only offers real free times: services and prices, opening hours, breaks, existing bookings and notice periods.",
    price: 16000,
    currency: "ZAR",
    timeframe: "3-6 weeks",
    icon: "📅",
    features: [
      "Services with prices and durations",
      "Availability from your hours, breaks and bookings",
      "Day and time picker that never double-books",
      "Booking confirmation by email",
      "Team and policies sections",
      "WhatsApp chat button"
    ],
    techStack: ["React", "TypeScript", "Vite"],
    keywords: ["booking", "appointments", "scheduling", "calendar", "salon", "clinic"],
    buildNotes:
      "The template remembers bookings in the visitor's browser only. If the customer needs one calendar shared across everyone, connect the booking form to a real calendar or database as part of the build."
  },
  {
    id: "blog",
    name: "Blog / Content Platform",
    kind: "website",
    category: "Content",
    description: "A publication with posts written in Markdown, search, tags, reading times, related articles and a newsletter sign-up.",
    price: 7000,
    currency: "ZAR",
    timeframe: "2-3 weeks",
    icon: "📝",
    features: [
      "Posts written in simple Markdown",
      "Search and tags",
      "Reading times and related articles",
      "Newsletter sign-up",
      "Fast static pages"
    ],
    techStack: ["React", "TypeScript", "Vite"],
    keywords: ["blog", "content", "news", "magazine", "articles", "newsletter"]
  },
  {
    id: "game",
    name: "Arcade Promo Game",
    kind: "app",
    category: "Games",
    description: "A branded browser game that brings people back: a neon brick-breaker with levels, touch and keyboard controls, high scores, and a prize form that turns players into leads.",
    price: 6500,
    currency: "ZAR",
    timeframe: "1-2 weeks",
    icon: "🎮",
    features: [
      "Playable on phones, tablets and desktops",
      "Levels, lives and a saved high score",
      "Your name, colours and prize",
      "Prize claim form that captures leads",
      "Opens from a single file: host it anywhere"
    ],
    techStack: ["React", "TypeScript", "Canvas", "Vite"],
    keywords: ["game", "arcade", "promo", "competition", "gamification", "fun", "play"]
  },
  {
    id: "shooter",
    name: "Space Shooter Game",
    kind: "app",
    category: "Games",
    description: "A fast action game in your brand: waves of invaders, power-ups (rapid fire, shields, extra lives), lives and a high score, played with touch or keys, plus a prize form for top scorers.",
    price: 7500,
    currency: "ZAR",
    timeframe: "1-2 weeks",
    icon: "🚀",
    features: [
      "Arcade action on phones, tablets and desktops",
      "Waves of enemies, power-ups and boss-tough tanks",
      "Your name, colours, waves and prize",
      "Prize claim form that captures leads",
      "Opens from a single file: host it anywhere"
    ],
    techStack: ["React", "TypeScript", "Canvas", "Vite"],
    keywords: ["shooter", "shoot", "space", "invaders", "action", "arcade", "waves", "spaceship", "blaster", "game"]
  },
  {
    id: "strategy",
    name: "Tower Defense Strategy Game",
    kind: "app",
    category: "Games",
    description: "A strategy game people come back to: build and upgrade towers along a road to stop waves of raiders, manage gold and lives, and chase a high score, plus a prize form for the best defenders.",
    price: 8500,
    currency: "ZAR",
    timeframe: "2-3 weeks",
    icon: "🏰",
    features: [
      "Three tower types to build, upgrade and sell",
      "Five waves that get harder, gold and lives to manage",
      "Your name, colours, map and prize",
      "Prize claim form that captures leads",
      "Plays on phones, tablets and desktops"
    ],
    techStack: ["React", "TypeScript", "Canvas", "Vite"],
    keywords: ["strategy", "tower", "defense", "defence", "td", "towers", "waves", "build", "castle", "game"]
  },
  {
    id: "rpg",
    name: "Fantasy RPG Adventure",
    kind: "app",
    category: "Games",
    description: "A role-playing adventure in your brand: explore a dungeon, fight turn-based battles, level up, collect potions and gold, and defeat the boss, plus a prize form for heroes who win.",
    price: 9500,
    currency: "ZAR",
    timeframe: "2-3 weeks",
    icon: "⚔️",
    features: [
      "Three dungeon floors to explore",
      "Turn-based battles, experience, levels and a boss",
      "Your name, colours, hero, monsters and prize",
      "Prize claim form that captures leads",
      "Keyboard and on-screen controls for phones"
    ],
    techStack: ["React", "TypeScript", "Canvas", "Vite"],
    keywords: ["rpg", "role-playing", "roleplaying", "adventure", "dungeon", "quest", "fantasy", "hero", "battle", "turn-based", "game"]
  },
  {
    id: "event",
    name: "Event & Invitation",
    kind: "template",
    category: "Events",
    description: "An invitation site for a wedding, launch or party: a live countdown, the day's schedule, a venue map with directions, RSVP, add-to-calendar and FAQ.",
    price: 2500,
    currency: "ZAR",
    timeframe: "3-5 days",
    icon: "💌",
    features: [
      "Live countdown to the day",
      "RSVP form with dietary needs",
      "Schedule, venue map and directions",
      "Add to calendar in one tap",
      "Dress code, gifts and FAQ"
    ],
    techStack: ["React", "TypeScript", "Vite"],
    keywords: ["wedding", "invitation", "invite", "event", "rsvp", "party", "launch", "birthday"]
  }
];

const BUILT_IN: TemplateDefinition[] = BUILT_IN_ITEMS.map((item) => {
  // Attach each template's code and preview when its folder is present. A
  // missing folder (a machine without the templates checked out) just means
  // builds start from scratch, as they did before.
  const folder = path.join(TEMPLATES_DIR, item.id);
  const hasCode = fs.existsSync(path.join(folder, "package.json"));
  return {
    ...item,
    sourcePath: hasCode ? folder : undefined,
    previewUrl: `${PREVIEWS_URL}/${item.id}/`,
    buildNotes: [hasCode ? TAILORING : "", item.buildNotes ?? ""].filter(Boolean).join(" ") || undefined
  };
});

const OVERRIDES_PATH = path.resolve("./data/catalog.json");
const KINDS: CatalogKind[] = ["website", "app", "template"];

let cache: { mtimeMs: number; items: TemplateDefinition[] } | null = null;

/** data/catalog.json, re-read whenever it changes on disk. A broken file is logged and ignored. */
const readOverrides = (): Partial<TemplateDefinition>[] => {
  try {
    const raw = fs.readFileSync(OVERRIDES_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as Partial<TemplateDefinition>[]) : [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      Logger.error("data/catalog.json could not be read; using the built-in catalogue", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    return [];
  }
};

const merged = (): TemplateDefinition[] => {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(OVERRIDES_PATH).mtimeMs;
  } catch {
    // No overrides file.
  }
  if (cache && cache.mtimeMs === mtimeMs) return cache.items;

  const byId = new Map(BUILT_IN.map((item) => [item.id, { ...item }]));
  for (const entry of readOverrides()) {
    if (!entry?.id || typeof entry.id !== "string") continue;
    const base = byId.get(entry.id);
    if (base) {
      byId.set(entry.id, { ...base, ...entry } as TemplateDefinition);
    } else if (entry.name) {
      // A new item needs at least a name; everything else has a sensible default.
      byId.set(entry.id, {
        kind: "website",
        category: "Website",
        description: "",
        price: 0,
        currency: "ZAR",
        timeframe: "",
        icon: "🧩",
        features: [],
        ...entry
      } as TemplateDefinition);
    }
  }

  const items = [...byId.values()].map((item) => ({
    ...item,
    kind: KINDS.includes(item.kind) ? item.kind : "website"
  }));
  cache = { mtimeMs, items };
  return items;
};

/** Fields the app may set on an item. Anything else in a request is ignored. */
const EDITABLE: (keyof TemplateDefinition)[] = [
  "name", "kind", "category", "description", "price", "currency", "timeframe", "icon",
  "features", "techStack", "previewUrl", "keywords", "buildNotes", "sourcePath", "hidden"
];

const cleanPatch = (input: Record<string, unknown>): Partial<TemplateDefinition> => {
  const patch: Record<string, unknown> = {};
  for (const key of EDITABLE) {
    if (!(key in input)) continue;
    const value = input[key];
    if (key === "features" || key === "techStack" || key === "keywords") {
      const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n|,/) : [];
      patch[key] = list.map((entry) => String(entry).trim()).filter(Boolean).slice(0, 30);
    } else if (key === "price") {
      const price = Number(value);
      patch.price = Number.isFinite(price) && price >= 0 ? Math.round(price) : 0;
    } else if (key === "hidden") {
      patch.hidden = Boolean(value);
    } else if (key === "kind") {
      patch.kind = KINDS.includes(value as CatalogKind) ? value : "website";
    } else if (key === "sourcePath") {
      const folder = typeof value === "string" ? value.trim() : "";
      if (folder && !fs.existsSync(folder)) throw new Error(`Source folder ${folder} does not exist.`);
      patch.sourcePath = folder || undefined;
    } else if (key === "previewUrl") {
      const url = typeof value === "string" ? value.trim() : "";
      if (url && !/^https?:\/\//.test(url)) throw new Error("The example link must start with http:// or https://.");
      patch.previewUrl = url || undefined;
    } else {
      patch[key] = typeof value === "string" ? value.trim().slice(0, key === "description" || key === "buildNotes" ? 4000 : 120) : value;
    }
  }
  return patch as Partial<TemplateDefinition>;
};

const writeOverrides = (entries: Partial<TemplateDefinition>[]): void => {
  fs.mkdirSync(path.dirname(OVERRIDES_PATH), { recursive: true });
  fs.writeFileSync(OVERRIDES_PATH, JSON.stringify(entries, null, 2));
  cache = null;
};

const idFrom = (name: string): string =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

export const Catalog = {
  /** Everything that is not hidden. */
  list(): TemplateDefinition[] {
    return merged().filter((item) => !item.hidden);
  },

  get(id: string | null | undefined): TemplateDefinition | null {
    if (!id) return null;
    return this.list().find((item) => item.id === id) ?? null;
  },

  /**
   * The template an order clearly asks for when it does not name one. The
   * site's quote form sends only a service type and the customer's words, so
   * every order was built from nothing, the path a small model gets wrong
   * most, while a matching template is tested code that scores 100 before a
   * line is changed. Words that fit every template ("website", "game", "app")
   * do not count on their own; a tie or no specific word means no template,
   * and the order is built from the brief as before. Only templates with code.
   */
  match(text: string | null | undefined): TemplateDefinition | null {
    const words = ` ${(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
    const generic = new Set(["website", "game", "web app", "app", "fun", "play", "build", "launch", "content", "personal", "software", "platform", "starter", "products", "waves", "action", "arcade", "menu", "calendar", "portal", "hero", "battle", "party"]);
    const scored = this.list()
      .filter((item) => item.sourcePath && fs.existsSync(item.sourcePath))
      .map((item) => {
        const hits = (item.keywords ?? []).filter((keyword) => words.includes(` ${keyword.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `));
        const specific = hits.filter((keyword) => !generic.has(keyword.toLowerCase()));
        return { item, specific: specific.length, all: hits.length };
      })
      .sort((a, b) => b.specific - a.specific || b.all - a.all);
    const pick = (pool: typeof scored) => {
      const found = pool.filter((entry) => entry.specific > 0);
      if (found.length === 0) return null;
      if (found[1] && found[1].specific === found[0].specific && found[1].all === found[0].all) return null;
      return found[0].item;
    };
    // A game is a game: "a fun game for my shop" is not an online shop.
    if (/ (game|games|gaming|play|arcade) /.test(words)) {
      const games = scored.filter((entry) => entry.item.category === "Games");
      return pick(games) ?? games.find((entry) => entry.item.id === "game")?.item ?? null;
    }
    // A plain website for a business with no kind named is the business-website template.
    return pick(scored) ?? (/ (website|site|web page|webpage|landing page) /.test(words) ? scored.find((entry) => entry.item.id === "landing")?.item ?? null : null);
  },

  /** Everything, hidden included, for the app's template editor. */
  all(): TemplateDefinition[] {
    return merged();
  },

  isBuiltIn(id: string): boolean {
    return BUILT_IN.some((item) => item.id === id);
  },

  /** A new item. Its id comes from its name unless one is given. */
  create(input: Record<string, unknown>): TemplateDefinition {
    const patch = cleanPatch(input);
    if (!patch.name) throw new Error("A template needs a name.");
    const id = idFrom(typeof input.id === "string" && input.id.trim() ? input.id : patch.name);
    if (!id) throw new Error("Could not make an id from that name.");
    if (merged().some((item) => item.id === id)) throw new Error(`There is already a template with the id "${id}".`);
    writeOverrides([...readOverrides(), { ...patch, id }]);
    return this.all().find((item) => item.id === id)!;
  },

  /** Change an item; only the fields given are touched. */
  update(id: string, input: Record<string, unknown>): TemplateDefinition {
    if (!merged().some((item) => item.id === id)) throw new Error(`No template "${id}".`);
    const patch = cleanPatch(input);
    const entries = readOverrides();
    const index = entries.findIndex((entry) => entry.id === id);
    if (index >= 0) entries[index] = { ...entries[index], ...patch, id };
    else entries.push({ ...patch, id });
    writeOverrides(entries);
    return this.all().find((item) => item.id === id)!;
  },

  /** Remove an item you added; a built-in one is hidden instead, so it can come back. */
  remove(id: string): { removed: boolean; hidden: boolean } {
    if (this.isBuiltIn(id)) {
      this.update(id, { hidden: true });
      return { removed: false, hidden: true };
    }
    const entries = readOverrides();
    if (!entries.some((entry) => entry.id === id)) throw new Error(`No template "${id}".`);
    writeOverrides(entries.filter((entry) => entry.id !== id));
    return { removed: true, hidden: false };
  },

  /** What the ordering site is sent: no build notes, nothing hidden. */
  forSite() {
    return this.list().map((item) => ({
      id: item.id,
      name: item.name,
      kind: item.kind,
      category: item.category,
      summary: item.description,
      features: item.features,
      techStack: item.techStack ?? [],
      priceFromZAR: item.currency === "ZAR" && item.price > 0 ? item.price : null,
      timeframe: item.timeframe || null,
      previewUrl: item.previewUrl ?? null,
      keywords: item.keywords ?? []
    }));
  }
};
