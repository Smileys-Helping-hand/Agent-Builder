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

const BUILT_IN: TemplateDefinition[] = [
  {
    id: "landing",
    name: "Business Landing Page",
    kind: "website",
    category: "Website",
    description: "High-converting landing page with hero, services, testimonials, and contact form.",
    price: 4500,
    currency: "ZAR",
    timeframe: "1-2 weeks",
    icon: "🏠",
    features: ["Mobile-first responsive design", "SEO optimized", "Contact form", "Google Analytics", "2 rounds of revisions"],
    keywords: ["landing", "starter", "one page", "business website", "website"]
  },
  {
    id: "ecommerce",
    name: "E-Commerce Store",
    kind: "website",
    category: "Online Shop",
    description: "Full online store with catalog, shopping cart, PayFast & Stripe checkout, and admin panel.",
    price: 18000,
    currency: "ZAR",
    timeframe: "3-6 weeks",
    icon: "🛒",
    features: ["Product catalog & categories", "PayFast South African payments", "Order management", "Inventory tracking", "Email receipts"],
    keywords: ["ecommerce", "e-commerce", "store", "shop", "online shop", "products"]
  },
  {
    id: "restaurant",
    name: "Restaurant / Hospitality",
    kind: "app",
    category: "Web App",
    description: "QR menus, online reservation system, food gallery, and table management.",
    price: 9500,
    currency: "ZAR",
    timeframe: "2-4 weeks",
    icon: "🍽️",
    features: ["Online booking system", "Digital QR menus", "Gallery & social feed", "Google Maps", "SMS confirmations"],
    keywords: ["restaurant", "menu", "cafe", "hospitality", "reservations"]
  },
  {
    id: "saas",
    name: "SaaS Dashboard",
    kind: "app",
    category: "SaaS",
    description: "Custom web app with user authentication, role-based access, analytics charts, and billing.",
    price: 35000,
    currency: "ZAR",
    timeframe: "6-12 weeks",
    icon: "📊",
    features: ["User authentication & roles", "Custom analytics dashboard", "Subscription billing", "API integrations", "Cloud deployment"],
    keywords: ["saas", "dashboard", "web app", "platform", "portal", "software"]
  },
  {
    id: "portfolio",
    name: "Portfolio / Personal Site",
    kind: "website",
    category: "Portfolio",
    description: "Personal brand showcase with interactive project gallery, resume, blog, and booking.",
    price: 3500,
    currency: "ZAR",
    timeframe: "1-2 weeks",
    icon: "✨",
    features: ["Interactive animated design", "Project showcase gallery", "Blog/article system", "Booking form", "Social media integration"],
    keywords: ["portfolio", "personal", "resume", "cv", "showcase"]
  },
  {
    id: "booking",
    name: "Booking & Scheduling",
    kind: "app",
    category: "Web App",
    description: "Calendar-based appointment system with PayFast payments, reminders, and customer portal.",
    price: 16000,
    currency: "ZAR",
    timeframe: "3-6 weeks",
    icon: "📅",
    features: ["Real-time availability calendar", "Email & SMS reminders", "Online payments", "Client portal", "Admin panel"],
    keywords: ["booking", "appointments", "scheduling", "calendar", "salon", "clinic"]
  },
  {
    id: "blog",
    name: "Blog / Content Platform",
    kind: "website",
    category: "Content",
    description: "SEO-powered publication with headless CMS, newsletter subscriptions, and analytics.",
    price: 7000,
    currency: "ZAR",
    timeframe: "2-3 weeks",
    icon: "📝",
    features: ["Easy markdown/CMS editing", "Newsletter capture", "SEO & OpenGraph cards", "Reading time & tags", "Fast static delivery"],
    keywords: ["blog", "content", "news", "magazine", "articles", "newsletter"]
  }
];

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
