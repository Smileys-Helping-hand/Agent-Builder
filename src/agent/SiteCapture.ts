/**
 * SiteCapture — a live website as something the Reconstructor can study.
 *
 * When there is no code to read, what a site shows is the specification: its
 * pages, navigation, headings, forms and fields, buttons, pictures and text.
 * This walks a site from one address (same origin only, politely: one page at
 * a time, robots.txt respected, at most MAX_PAGES), renders each page in
 * headless Chrome/Edge when there is one (so a JavaScript app shows what a
 * visitor sees, not an empty <div id="root">), and writes what it found as
 * plain text files in a folder: README.md (the site at a glance) and
 * pages/NN-<page>.txt. Nothing of the site's code or pictures is kept.
 */
import fs from "fs";
import path from "path";

import { findBrowser, renderPage } from "../orchestrator/SiteAudit.js";

const MAX_PAGES = Number(process.env.SITE_CAPTURE_MAX_PAGES) || 20;
const MAX_BYTES = 3 * 1024 * 1024;
const NOT_A_PAGE = /\.(png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|json|xml|txt|pdf|zip|gz|mp3|mp4|webm|ogg|wav|woff2?|ttf|otf|eot)$/i;
const AGENT = "AgentBuilder-Reconstructor/1.0 (+studying a site to learn how to build one like it)";

export interface CapturedPage {
  url: string;
  title: string;
  headings: string[];
  links: Array<{ text: string; href: string }>;
  buttons: string[];
  forms: Array<{ action: string; fields: string[] }>;
  images: string[];
  text: string;
  /** What the page is built with, from its markup. */
  signals: string[];
}

const decode = (text: string) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)));
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => decode(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1] ?? "");

/** What a page shows, from its HTML (rendered when possible). */
export const extractPage = (url: string, html: string): CapturedPage => {
  const body = html.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const headings = [...body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => `${"#".repeat(Number(m[1]))} ${textOf(m[2])}`).filter((h) => h.length > 2);
  const links = [...body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)]
    .map((m) => ({ text: textOf(m[2]) || attr(m[1], "aria-label"), href: attr(m[1], "href") }))
    .filter((l) => l.href && !/^(javascript:|#$)/i.test(l.href));
  const buttons = [
    ...[...body.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].map((m) => textOf(m[2]) || attr(m[1], "aria-label")),
    ...[...body.matchAll(/<input\b[^>]*type=["'](?:submit|button)["'][^>]*>/gi)].map((m) => attr(m[0], "value"))
  ].filter(Boolean);
  const forms = [...body.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)].map((m) => ({
    action: attr(m[1], "action") || "(this page)",
    fields: [...m[2].matchAll(/<(input|select|textarea)\b[^>]*>/gi)]
      .map((f) => {
        const type = f[1].toLowerCase() === "input" ? attr(f[0], "type") || "text" : f[1].toLowerCase();
        if (/^(hidden|submit|button)$/.test(type)) return "";
        const label = attr(f[0], "placeholder") || attr(f[0], "aria-label") || attr(f[0], "name") || attr(f[0], "id");
        return `${label || "(unnamed)"} [${type}${/\srequired\b/i.test(f[0]) ? ", required" : ""}]`;
      })
      .filter(Boolean)
  }));
  const images = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => attr(m[0], "alt")).filter(Boolean);
  const signals = [
    /__NEXT_DATA__|\/_next\//.test(html) ? "Next.js" : "",
    /data-reactroot|react-dom|__REACT/.test(html) ? "React" : "",
    /\sng-version=|ng-app/.test(html) ? "Angular" : "",
    /data-v-[0-9a-f]{6,}|__VUE__|\/_nuxt\//.test(html) ? "Vue/Nuxt" : "",
    /svelte-[a-z0-9]{5,}/.test(html) ? "Svelte" : "",
    /wp-content|wp-includes/.test(html) ? "WordPress" : "",
    /cdn\.shopify\.com|Shopify\.theme/.test(html) ? "Shopify" : "",
    /tailwind|class="[^"]*\b(?:flex|grid) [^"]*\b(?:px|py|mt|mb)-\d/.test(html) ? "Tailwind-style utility classes" : "",
    /<canvas\b/i.test(html) ? "canvas" : "",
    /serviceWorker|manifest\.webmanifest|rel=["']manifest/.test(html) ? "installable (PWA)" : ""
  ].filter(Boolean);
  return {
    url,
    title: textOf(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? ""),
    headings: [...new Set(headings)].slice(0, 40),
    links: links.slice(0, 80),
    buttons: [...new Set(buttons)].slice(0, 40),
    forms: forms.slice(0, 10),
    images: [...new Set(images)].slice(0, 30),
    text: textOf(body.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ")).slice(0, 3000),
    signals
  };
};

/** robots.txt's Disallow lines for every crawler (User-agent: *). */
const disallowedBy = async (origin: string): Promise<string[]> => {
  try {
    const response = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": AGENT }, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return [];
    const rules: string[] = [];
    let applies = false;
    for (const raw of (await response.text()).split(/\r?\n/)) {
      const line = raw.replace(/#.*/, "").trim();
      const [key, ...rest] = line.split(":");
      const value = rest.join(":").trim();
      if (/^user-agent$/i.test(key)) applies = value === "*";
      else if (applies && /^disallow$/i.test(key) && value) rules.push(value);
    }
    return rules;
  } catch {
    return [];
  }
};

const fetchHtml = async (url: string): Promise<{ html: string; finalUrl: string } | null> => {
  try {
    const response = await fetch(url, { headers: { "user-agent": AGENT, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    if (!response.ok || !/text\/html|application\/xhtml/i.test(response.headers.get("content-type") ?? "")) return null;
    const html = await response.text();
    return { html: html.slice(0, MAX_BYTES), finalUrl: response.url || url };
  } catch {
    return null;
  }
};

const pageText = (page: CapturedPage) =>
  [
    `URL: ${page.url}`,
    `Title: ${page.title}`,
    page.signals.length ? `Built with: ${page.signals.join(", ")}` : "",
    page.headings.length ? `\nHeadings:\n${page.headings.join("\n")}` : "",
    page.buttons.length ? `\nButtons: ${page.buttons.join(" | ")}` : "",
    ...page.forms.map((form, i) => `\nForm ${i + 1} (sends to ${form.action}): ${form.fields.join(", ") || "(no fields)"}`),
    page.images.length ? `\nPictures: ${page.images.join(" | ")}` : "",
    page.links.length ? `\nLinks:\n${page.links.map((l) => `- ${l.text || "(no text)"} -> ${l.href}`).join("\n")}` : "",
    `\nText:\n${page.text}`
  ]
    .filter(Boolean)
    .join("\n");

export const SiteCapture = {
  /** Walk the site from `start` and write what it shows into `dir`. */
  async capture(start: string, dir: string, options: { maxPages?: number; render?: boolean } = {}): Promise<{ title: string; pages: CapturedPage[] }> {
    const first = new URL(start);
    if (!/^https?:$/.test(first.protocol)) throw new Error("Give the site's http(s) address.");
    const origin = first.origin;
    const blocked = await disallowedBy(origin);
    const allowed = (url: URL) => !blocked.some((rule) => url.pathname.startsWith(rule));
    const browser = options.render === false || process.env.SITE_CAPTURE_RENDER === "off" ? null : findBrowser();
    const max = options.maxPages ?? MAX_PAGES;

    const seen = new Set<string>();
    const queue = [first.href.split("#")[0]];
    const pages: CapturedPage[] = [];
    while (queue.length && pages.length < max) {
      const next = queue.shift()!;
      if (seen.has(next)) continue;
      seen.add(next);
      const url = new URL(next);
      if (url.origin !== origin || !allowed(url) || NOT_A_PAGE.test(url.pathname)) continue;
      const fetched = await fetchHtml(next);
      if (!fetched || new URL(fetched.finalUrl).origin !== origin) continue;
      // Rendered, when a JavaScript app would otherwise be an empty shell.
      const rendered = browser ? await renderPage(browser, fetched.finalUrl).catch(() => null) : null;
      const html = rendered?.dom && rendered.dom.length > fetched.html.length / 3 ? rendered.dom : fetched.html;
      const page = extractPage(fetched.finalUrl, html);
      pages.push(page);
      for (const link of page.links) {
        try {
          const target = new URL(link.href, fetched.finalUrl);
          target.hash = "";
          if (target.origin === origin && !seen.has(target.href)) queue.push(target.href);
        } catch {
          // Not an address.
        }
      }
    }
    if (!pages.length) throw new Error(`Could not read any page of ${origin}${blocked.includes("/") ? " (its robots.txt asks crawlers to stay out)" : ""}.`);

    fs.mkdirSync(path.join(dir, "pages"), { recursive: true });
    pages.forEach((page, i) => {
      const name = (new URL(page.url).pathname.replace(/^\/|\/$/g, "").replace(/[^A-Za-z0-9]+/g, "-") || "home").slice(0, 50);
      fs.writeFileSync(path.join(dir, "pages", `${String(i + 1).padStart(2, "0")}-${name}.txt`), `${pageText(page)}\n`, "utf8");
    });
    const title = pages[0].title || first.hostname;
    const signals = [...new Set(pages.flatMap((p) => p.signals))];
    fs.writeFileSync(
      path.join(dir, "README.md"),
      `# ${title}\n\nA live website, studied from what it shows (${origin}); there is no code here, only what each page shows,
in pages/.${signals.length ? `\n\nBuilt with: ${signals.join(", ")}.` : ""}\n\nPages (${pages.length}):\n${pages
        .map((p) => `- ${new URL(p.url).pathname} — ${p.title || "(untitled)"}${p.forms.length ? ` (${p.forms.length} form${p.forms.length === 1 ? "" : "s"})` : ""}`)
        .join("\n")}\n`,
      "utf8"
    );
    return { title, pages };
  }
};
