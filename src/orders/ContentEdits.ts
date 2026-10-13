/**
 * A customer's edits to their finished site, made exactly in its
 * src/content.ts — no model involved, nothing else touched.
 *
 * Edits come as paths the template's editor offers ("business.name",
 * "hero.title", "brand.primary", "brand.font") and a section layout. Each
 * value replaces the string literal at that path inside `export const site =
 * { … }`; a property the template does not have yet (a font it never set) is
 * added to its object. The layout is kept as `layout: { order, hidden }` on
 * the site, which the kit applies when the page loads.
 */

/** The paths a customer may change; the hub checks the same list (site-edits.ts). */
export const EDITABLE_PATHS = new Set([
  "business.name",
  "business.tagline",
  "hero.title",
  "hero.subtitle",
  "business.phone",
  "business.email",
  "brand.primary",
  "brand.accent",
  "brand.background",
  "brand.surface",
  "brand.text",
  "brand.font"
]);

interface Span {
  start: number;
  end: number;
}

/** Index just past a string literal or comment starting at i, or i when there is none. */
const skip = (source: string, i: number): number => {
  const ch = source[i];
  if (ch === "/" && source[i + 1] === "/") {
    const end = source.indexOf("\n", i);
    return end === -1 ? source.length : end;
  }
  if (ch === "/" && source[i + 1] === "*") {
    const end = source.indexOf("*/", i + 2);
    return end === -1 ? source.length : end + 2;
  }
  if (ch === '"' || ch === "'" || ch === "`") {
    let j = i + 1;
    while (j < source.length && source[j] !== ch) j += source[j] === "\\" ? 2 : 1;
    return j + 1;
  }
  return i;
};

/** The span of the object literal whose "{" is at `open` (inclusive of both braces). */
const objectAt = (source: string, open: number): Span | null => {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const next = skip(source, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    const ch = source[i];
    if (ch === "{" || ch === "[" || ch === "(") depth++;
    else if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      if (depth === 0) return { start: open, end: i + 1 };
    }
  }
  return null;
};

/**
 * Where a property's value starts inside an object span, at that object's own
 * level (not inside a nested object). Returns the index of the value's first
 * character, or null.
 */
const propertyValue = (source: string, object: Span, key: string): number | null => {
  let depth = 0;
  for (let i = object.start; i < object.end; i++) {
    const next = skip(source, i);
    if (next !== i) {
      i = next - 1;
      continue;
    }
    const ch = source[i];
    if (ch === "{" || ch === "[" || ch === "(") {
      depth++;
      continue;
    }
    if (ch === "}" || ch === "]" || ch === ")") {
      depth--;
      continue;
    }
    if (depth !== 1) continue;
    // A key at this level: `key:` or `"key":`, preceded by "{", "," or whitespace.
    const match = new RegExp(`^(?:${key}|"${key}"|'${key}')\\s*:\\s*`).exec(source.slice(i, i + key.length + 40));
    if (match && /[\s{,]/.test(source[i - 1] ?? "")) return i + match[0].length;
  }
  return null;
};

/** The `export const site = { … }` object. */
const siteObject = (source: string): Span | null => {
  const at = /export\s+const\s+site\s*(?::[^=]+)?=\s*\{/.exec(source);
  return at ? objectAt(source, at.index + at[0].length - 1) : null;
};

const quote = (value: string): string => JSON.stringify(value);

/** One path ("brand.primary") set to a string value; null when the content has no such object to put it in. */
export function setContentPath(source: string, path: string, value: string): string | null {
  const [objectKey, field] = path.split(".");
  const site = siteObject(source);
  if (!site || !objectKey || !field) return null;
  const objectStart = propertyValue(source, site, objectKey);
  if (objectStart === null || source[objectStart] !== "{") return null;
  const object = objectAt(source, objectStart);
  if (!object) return null;
  const valueAt = propertyValue(source, object, field);
  if (valueAt !== null) {
    const ch = source[valueAt];
    if (ch !== '"' && ch !== "'" && ch !== "`") return null; // Not a plain string: leave it alone.
    const end = skip(source, valueAt);
    return source.slice(0, valueAt) + quote(value) + source.slice(end);
  }
  // Not there yet: add it at the top of the object.
  return source.slice(0, object.start + 1) + `\n    ${field}: ${quote(value)},` + source.slice(object.start + 1);
}

/** Keep a section layout on the site object, replacing any earlier one. */
export function setLayout(source: string, layout: { order: string[]; hidden: string[] }): string | null {
  const site = siteObject(source);
  if (!site) return null;
  const literal = `{ order: ${JSON.stringify(layout.order)}, hidden: ${JSON.stringify(layout.hidden)} }`;
  const valueAt = propertyValue(source, site, "layout");
  if (valueAt !== null && source[valueAt] === "{") {
    const old = objectAt(source, valueAt);
    if (!old) return null;
    return source.slice(0, valueAt) + literal + source.slice(old.end);
  }
  return source.slice(0, site.start + 1) + `\n  /** Section order and the ones left out, as the owner set them in their dashboard. */\n  layout: ${literal},` + source.slice(site.start + 1);
}

/** Every edit at once. Returns the new source and what changed, or why it could not. */
export function applyContentEdits(
  source: string,
  patch: Record<string, string>,
  sections?: { order: string[]; hidden: string[] } | null
): { source: string; changed: string[]; skipped: string[] } {
  let out = source;
  const changed: string[] = [];
  const skipped: string[] = [];
  for (const [path, value] of Object.entries(patch)) {
    if (!EDITABLE_PATHS.has(path) || typeof value !== "string") {
      skipped.push(path);
      continue;
    }
    const next = setContentPath(out, path, value);
    if (next === null) skipped.push(path);
    else {
      out = next;
      changed.push(path);
    }
  }
  if (sections && (sections.order.length || sections.hidden.length)) {
    const next = setLayout(out, sections);
    if (next === null) skipped.push("layout");
    else {
      out = next;
      changed.push("layout");
    }
  }
  return { source: out, changed, skipped };
}
