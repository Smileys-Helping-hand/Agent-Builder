/**
 * Live customising: the site the ordering page shows can be restyled on the
 * spot — colours, font, the business's name and headline, which sections show
 * and in what order — so a customer sees their own site before they buy it.
 *
 * The page showing this site (the shop's "Customise" panel) sends
 *   { type: "arp-customize", patch, sections }
 * and the site applies it by changing its own content and drawing itself
 * again. Nothing is saved here: the choices travel with the order, and the
 * build makes them permanent in src/content.ts.
 *
 * Only pages on our own domains may do this, and only when this site is
 * inside one of them; a site opened on its own ignores every message.
 */

/** Where a customiser may run from. */
const TRUSTED = [
  /^https:\/\/(www\.)?arpcloudsolutions\.co\.za$/,
  /^https:\/\/[a-z0-9-]+\.arpcloudsolutions\.co\.za$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  // The builder's own app, reached through the tunnel or over Tailscale.
  /^https:\/\/([a-z0-9-]+\.)?savestate\.co\.za$/,
  /^http:\/\/100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(:\d+)?$/
];

/** The fields a customer may change, and nothing else. */
export const EDITABLE_FIELDS = [
  { path: "business.name", label: "Business name", kind: "text" },
  { path: "business.tagline", label: "Tagline", kind: "text" },
  { path: "hero.title", label: "Headline", kind: "text" },
  { path: "hero.subtitle", label: "Sub-headline", kind: "textarea" },
  { path: "business.phone", label: "Phone", kind: "text" },
  { path: "business.email", label: "Email", kind: "text" },
  { path: "brand.primary", label: "Main colour", kind: "color" },
  { path: "brand.accent", label: "Accent colour", kind: "color" },
  { path: "brand.background", label: "Background", kind: "color" },
  { path: "brand.surface", label: "Panels", kind: "color" },
  { path: "brand.text", label: "Text colour", kind: "color" },
  { path: "brand.font", label: "Font", kind: "font" }
] as const;

/** Fonts every device already has, so nothing needs loading. */
export const FONT_CHOICES = [
  { label: "Modern sans", value: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { label: "Classic serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Book serif", value: "Charter, 'Iowan Old Style', Georgia, serif" },
  { label: "Rounded", value: "'Trebuchet MS', 'Segoe UI', sans-serif" },
  { label: "Mono", value: "ui-monospace, Consolas, monospace" }
];

export interface SectionInfo {
  id: string;
  title: string;
}

export interface CustomizeMessage {
  type: "arp-customize";
  /** Editable path -> new value, e.g. { "hero.title": "…", "brand.primary": "#0a7" }. */
  patch?: Record<string, string>;
  sections?: { order?: string[]; hidden?: string[] };
}

type Content = Record<string, unknown>;

const allowed = new Set<string>(EDITABLE_FIELDS.map((field) => field.path));

const read = (content: Content, path: string): unknown =>
  path.split(".").reduce<unknown>((node, key) => (node && typeof node === "object" ? (node as Content)[key] : undefined), content);

/** Apply a patch to the content object in place, touching only editable fields. */
export function applyPatch(content: Content, patch: Record<string, string>): string[] {
  const changed: string[] = [];
  for (const [path, value] of Object.entries(patch)) {
    if (!allowed.has(path) || typeof value !== "string") continue;
    const clean = path.startsWith("brand.") && path !== "brand.font" ? (/^#[0-9a-fA-F]{3,8}$/.test(value) ? value : null) : value.slice(0, 300);
    if (clean === null) continue;
    const keys = path.split(".");
    const parent = keys.slice(0, -1).reduce<Content | undefined>((node, key) => (node?.[key] as Content | undefined), content);
    if (!parent || typeof parent !== "object") continue;
    parent[keys[keys.length - 1]] = clean;
    changed.push(path);
  }
  return changed;
}

/** The current value of every editable field this template actually has. */
export function describeFields(content: Content) {
  return EDITABLE_FIELDS.filter((field) => typeof read(content, field.path) === "string").map((field) => ({
    ...field,
    value: read(content, field.path) as string
  }));
}

/**
 * Section order and visibility, done with CSS so no template has to be
 * rewritten: the page's main area becomes a column whose children are
 * ordered by id. Sections in `all` but not in `order` follow the named ones
 * in their page order, so a partial order never pulls them above it.
 */
export function layoutCss(order: string[] = [], hidden: string[] = [], all: string[] = []): string {
  const safe = (id: string) => /^[a-z0-9-]+$/i.test(id);
  const rules = ["main { display: flex; flex-direction: column; }"];
  const full = order.length ? [...order, ...all.filter((id) => !order.includes(id))] : [];
  full.filter(safe).forEach((id, index) => rules.push(`#${id} { order: ${100 + index}; }`));
  hidden.filter(safe).forEach((id) => rules.push(`#${id} { display: none !important; }`));
  return rules.join("\n");
}

/** The sections on the page right now that can be moved or hidden. */
export function listSections(root: ParentNode = document): SectionInfo[] {
  return Array.from(root.querySelectorAll("main section[id]")).map((element) => ({
    id: element.id,
    title: element.querySelector("h2")?.textContent?.trim() || element.id
  }));
}

/**
 * Start listening. `redraw` is called after content changes. Returns a
 * function that stops listening. Does nothing when the site is not framed.
 */
export function enableLiveCustomizing(content: Content, redraw: () => void): () => void {
  if (typeof window === "undefined" || window.parent === window) return () => undefined;

  const style = document.createElement("style");
  style.id = "arp-customize-layout";
  document.head.appendChild(style);

  let parentOrigin: string | null = null;
  const announce = () => {
    if (!parentOrigin) return;
    window.parent.postMessage(
      { type: "arp-customize-ready", fields: describeFields(content), sections: listSections(), fonts: FONT_CHOICES },
      parentOrigin
    );
  };

  const onMessage = (event: MessageEvent) => {
    if (event.source !== window.parent || !TRUSTED.some((pattern) => pattern.test(event.origin))) return;
    const message = event.data as CustomizeMessage | { type: "arp-customize-hello" };
    if (message?.type === "arp-customize-hello") {
      parentOrigin = event.origin;
      announce();
      return;
    }
    if (message?.type !== "arp-customize") return;
    parentOrigin = event.origin;
    if (message.patch && applyPatch(content, message.patch).length) redraw();
    if (message.sections) style.textContent = layoutCss(
        message.sections.order,
        message.sections.hidden,
        listSections().map((section) => section.id)
      );
  };

  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}
