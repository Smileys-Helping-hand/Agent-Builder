/**
 * Which photographs a website's content points at, and what each is of.
 *
 * Our templates name a picture from their content: a dish `{ photo:
 * "line-fish", name: "Line fish of the day", … }`, a product by its id
 * `{ id: "buchu-soap", name: …, price: … }`. After a customer's content is
 * written, those names are theirs: the dish is "Bunny chow", the key may be
 * "bunny-chow". The art pass draws each picture as the item the site now
 * shows, and draws a new one for a key no picture has yet.
 */
import type { ArtRequest } from "./ArtStudio.js";

export interface ContentPhoto {
  /** The picture's name: its file is src/images/<key>.webp. */
  key: string;
  /** What it is on the site: "Bunny chow — Soft, steamed bread filled with…". */
  item: string;
}

const field = (object: string, names: string): string | undefined =>
  new RegExp(`\\b(?:${names})\\s*:\\s*(["'\`])((?:(?!\\1).){2,300})\\1`).exec(object)?.[2];

/** The object literal around a position: from its "{" to its "}". */
const objectAround = (source: string, at: number): string => {
  const open = source.lastIndexOf("{", at);
  const close = source.indexOf("}", at);
  return open >= 0 && close > at ? source.slice(open, close + 1) : "";
};

export function contentPhotos(source: string): ContentPhoto[] {
  const found = new Map<string, ContentPhoto>();
  const describe = (object: string) => [field(object, "name|title|caption"), field(object, "description|summary|text")].filter(Boolean).join(" — ");
  // { photo: "line-fish", name: … }
  for (const match of source.matchAll(/\bphoto\s*:\s*["']([a-z0-9][a-z0-9-]{0,60})["']/g)) {
    if (!found.has(match[1])) found.set(match[1], { key: match[1], item: describe(objectAround(source, match.index ?? 0)) });
  }
  // A product: { id: "buchu-soap", name: …, price: … }
  for (const match of source.matchAll(/\bid\s*:\s*["']([a-z0-9][a-z0-9-]{0,60})["']/g)) {
    const object = objectAround(source, match.index ?? 0);
    if (!/\bprice\s*:/.test(object) || found.has(match[1])) continue;
    found.set(match[1], { key: match[1], item: describe(object) });
  }
  return [...found.values()];
}

/**
 * The art list with the content folded in: each picture told what it is on
 * the site now, and a square photograph added for every key the content
 * names that the list does not. Only for photo lists.
 */
export function withContentPhotos(pictures: ArtRequest[], source: string | null): Array<ArtRequest & { onSite?: string }> {
  if (!source) return pictures;
  const named = contentPhotos(source);
  const byKey = new Map(named.map((photo) => [photo.key, photo.item]));
  const listed = pictures.map((picture) => ({ ...picture, ...(byKey.get(picture.name) ? { onSite: byKey.get(picture.name) } : {}) }));
  const known = new Set(pictures.map((picture) => picture.name));
  const added = named
    .filter((photo) => !known.has(photo.key))
    .map((photo) => ({
      name: photo.key,
      subject: photo.item || photo.key.replace(/-/g, " "),
      kind: "photo" as const,
      size: "square" as const,
      file: `src/images/${photo.key}.webp`,
      onSite: photo.item || undefined
    }));
  return [...listed, ...added];
}
