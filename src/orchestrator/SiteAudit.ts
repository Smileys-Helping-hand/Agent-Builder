/**
 * Site audit: what a person would trip over on a built site, found by reading
 * it rather than by asking a model. It is run on the folder a preview serves
 * (dist/ or a plain static folder) and complements the Verifier, which says
 * whether the project installs, typechecks, builds and passes its tests.
 *
 * Every finding says what is wrong, where, and why it matters, in words that
 * also work as an instruction to the next build pass ("Fix these").
 */
import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

export type AuditSeverity = "error" | "warning" | "info";

export interface AuditFinding {
  severity: AuditSeverity;
  check: string;
  message: string;
  file?: string;
}

const MAX_FILES = 60;
const HEAVY_SCRIPT_BYTES = 600 * 1024;
const HEAVY_IMAGE_BYTES = 800 * 1024;
const SKIP = new Set(["node_modules", ".git"]);

const walk = (root: string): string[] => {
  const found: string[] = [];
  const visit = (dir: string) => {
    if (found.length > 2000) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else found.push(full);
    }
  };
  visit(root);
  return found;
};

/** Text of an element without its tags, for "is this button empty?". */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

const attr = (tag: string, name: string): string | null => {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? match[2] ?? match[3] ?? match[4] ?? "" : null;
};

const auditHtml = (root: string, file: string, findings: AuditFinding[], rendered?: string) => {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  // The page as it looks after its scripts ran, when a browser could render it;
  // a React or Vite app is an empty shell until then.
  const html = rendered ?? fs.readFileSync(file, "utf8");
  const add = (severity: AuditSeverity, check: string, message: string) => findings.push({ severity, check, message, file: relative });

  if (!/<title>[^<]+<\/title>/i.test(html)) add("warning", "title", "The page has no <title>, so browser tabs and search results show nothing useful.");
  if (!/<meta[^>]+name=["']viewport["']/i.test(html)) add("error", "mobile", "No viewport meta tag, so phones show a zoomed-out desktop page.");
  if (!/<html[^>]+lang=/i.test(html)) add("info", "language", "The <html> tag has no lang attribute; screen readers guess the language.");
  if (!/<meta[^>]+name=["']description["']/i.test(html)) add("info", "seo", "No meta description, so search engines write their own summary.");

  // A single-page app draws itself with script; judge its markup only once it has any.
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const scriptOnly = textOf(body.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")).length === 0;

  // Elements are looked for in the markup only: bundled script and styles
  // contain "<a", "<img" and the like as text.
  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  for (const tag of markup.match(/<img\b[^>]*>/gi) ?? []) {
    if (attr(tag, "alt") === null) add("warning", "images", `An image has no alt text (${attr(tag, "src") ?? "no src"}); screen readers skip it.`);
  }
  for (const match of markup.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    if (!textOf(match[2]) && attr(`<b ${match[1]}>`, "aria-label") === null && attr(`<b ${match[1]}>`, "title") === null) {
      add("warning", "buttons", "A button has no text or aria-label, so nobody using a screen reader knows what it does.");
    }
  }
  for (const tag of markup.match(/<input\b[^>]*>/gi) ?? []) {
    const type = (attr(tag, "type") ?? "text").toLowerCase();
    if (["hidden", "submit", "button", "reset", "image"].includes(type)) continue;
    const id = attr(tag, "id");
    const labelled = attr(tag, "aria-label") !== null || attr(tag, "aria-labelledby") !== null || (id && new RegExp(`<label[^>]+for=["']${id}["']`, "i").test(markup));
    const wrapped = new RegExp(`<label\\b[^>]*>(?:(?!</label>)[\\s\\S])*${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(markup);
    if (!labelled && !wrapped && attr(tag, "placeholder") === null) {
      add("warning", "forms", `A form field (${attr(tag, "name") ?? type}) has no label; people cannot tell what to type.`);
    }
  }
  if (!scriptOnly) {
    const h1s = (markup.match(/<h1\b/gi) ?? []).length;
    if (h1s === 0) add("info", "headings", "The page has no <h1> main heading.");
    if (h1s > 1) add("info", "headings", `The page has ${h1s} <h1> headings; one main heading reads better and ranks better.`);
  }
  for (const match of markup.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(`<a ${match[1]}>`, "href");
    if (href === null || href === "" || href === "#") add("warning", "links", `A link ("${textOf(match[2]).slice(0, 40) || "no text"}") goes nowhere.`);
  }

  // Everything the page loads from its own folder must be there.
  // Script tags stay (their src must exist); only what is inside them goes.
  const tagsOnly = html.replace(/<script\b([^>]*)>[\s\S]*?<\/script>/gi, "<script$1></script>").replace(/<style\b[\s\S]*?<\/style>/gi, "");
  for (const match of tagsOnly.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)) {
    const target = match[1];
    if (/^(https?:|mailto:|tel:|data:|#|\/\/|javascript:)/i.test(target)) continue;
    const clean = decodeURIComponent(target.split(/[?#]/)[0]);
    if (!clean) continue;
    // Files the build itself emitted are checked from the markup on disk; a
    // rendered page also references blob: and preview-server paths.
    if (rendered && /^\/preview\//.test(clean)) continue;
    const resolved = clean.startsWith("/") ? path.join(root, clean) : path.resolve(path.dirname(file), clean);
    if (!fs.existsSync(resolved)) {
      add(
        clean.startsWith("/src/") ? "error" : "error",
        "missing",
        clean.startsWith("/src/")
          ? `The page loads ${clean} straight from the source folder, so it is blank until built.`
          : `The page points at ${target}, which is not there.`
      );
    }
  }
};

/* ---------------- rendering in a real browser ---------------- */

/** A Chrome or Edge on this machine, for rendering pages the way a visitor sees them. */
export const findBrowser = (): string | null => {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    path.join(os.homedir(), "AppData/Local/Google/Chrome/Application/chrome.exe"),
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter((candidate): candidate is string => Boolean(candidate));
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (found) return found;
  // Playwright's bundled Chromium, where one is installed.
  const bundled = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (bundled && fs.existsSync(bundled)) {
    for (const entry of fs.readdirSync(bundled)) {
      const chrome = path.join(bundled, entry, "chrome-linux", "chrome");
      if (/^chromium-\d+$/.test(entry) && fs.existsSync(chrome)) return chrome;
    }
  }
  return null;
};

export interface RenderedPage {
  dom: string;
  /** Script errors and console.error output while it loaded. */
  errors: string[];
}

/**
 * Load a page in headless Chrome/Edge, let its scripts run for a few seconds,
 * and return the page as it then is, with any errors it logged on the way.
 */
export const renderPage = (browser: string, url: string): Promise<RenderedPage | null> =>
  new Promise((resolve) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ab-audit-"));
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      "--enable-logging=stderr",
      "--v=0",
      "--virtual-time-budget=6000",
      "--window-size=1280,900",
      ...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []),
      "--dump-dom",
      url
    ];
    execFile(browser, args, { timeout: 45_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (error, stdout, stderr) => {
      fs.rm(profile, { recursive: true, force: true }, () => undefined);
      if (!stdout && error) return resolve(null);
      const errors: string[] = [];
      for (const line of String(stderr).split(/\r?\n/)) {
        // Chrome and Edge write these as CONSOLE(12)] or CONSOLE:12] depending on version.
        const console = line.match(/CONSOLE[(:]\d+\)?\]\s+"(.+?)",\s+source:\s+(\S*)\s+\((\d+)\)/);
        if (!console) continue;
        const [, message, sourceUrl, lineNumber] = console;
        const source = sourceUrl.split("?")[0].split("/").pop() || "page";
        // The preview's own reporter echoes nothing to the console; everything here is the page's.
        if (/^(Uncaught|Error|TypeError|ReferenceError|SyntaxError|Failed to load)/i.test(message) || /error/i.test(message)) {
          errors.push(`${message} (${source}:${lineNumber})`);
        }
      }
      resolve({ dom: String(stdout), errors: [...new Set(errors)].slice(0, 20) });
    });
  });

/** Audit a built site. `root` is the folder that is served. */
export const auditSite = (
  root: string,
  rendered: Map<string, string> = new Map()
): { findings: AuditFinding[]; pages: number; files: number } => {
  const findings: AuditFinding[] = [];
  const files = walk(root);
  const pages = files.filter((file) => file.endsWith(".html")).slice(0, MAX_FILES);
  if (pages.length === 0) findings.push({ severity: "error", check: "pages", message: "There is no HTML page to show." });
  for (const page of pages) {
    try {
      auditHtml(root, page, findings, rendered.get(page));
    } catch (error) {
      findings.push({ severity: "warning", check: "read", message: `Could not read ${path.basename(page)}: ${String(error)}` });
    }
  }
  for (const file of files) {
    const size = fs.statSync(file).size;
    const relative = path.relative(root, file).replace(/\\/g, "/");
    if (/\.(m?js)$/.test(file) && size > HEAVY_SCRIPT_BYTES) {
      findings.push({ severity: "warning", check: "speed", message: `${relative} is ${Math.round(size / 1024)} KB of script; phones on mobile data will wait for it.`, file: relative });
    }
    if (/\.(png|jpe?g|gif|webp)$/i.test(file) && size > HEAVY_IMAGE_BYTES) {
      findings.push({ severity: "warning", check: "speed", message: `${relative} is a ${Math.round(size / 1024)} KB image; resize or compress it.`, file: relative });
    }
  }
  // The same problem on every page reads as one finding.
  const seen = new Set<string>();
  const unique = findings.filter((finding) => {
    const key = `${finding.check}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const order: Record<AuditSeverity, number> = { error: 0, warning: 1, info: 2 };
  return { findings: unique.sort((a, b) => order[a.severity] - order[b.severity]), pages: pages.length, files: files.length };
};
