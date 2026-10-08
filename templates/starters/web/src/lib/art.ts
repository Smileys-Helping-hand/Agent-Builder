/**
 * Pictures drawn for this app by the builder's image engine, by name.
 *
 * Once a build passes, the builder draws what art.json lists into
 * public/assets/ and writes public/assets/manifest.json:
 *   { "assets": { "hero": { "file": "assets/hero.png" }, ... } }
 * Until then (and opened straight from a folder, where nothing can be fetched)
 * there are none, so the app draws each thing as a shape and swaps in its
 * picture when there is one.
 *
 *   const pictures = usePictures();
 *   if (pictures.hero) ctx.drawImage(pictures.hero, x, y, w, h); else ctx.fillRect(x, y, w, h);
 */
import { useEffect, useState } from "react";

export type Pictures = Record<string, HTMLImageElement>;

interface Manifest {
  assets?: Record<string, { file?: unknown }>;
}

/** Every picture the manifest lists that loads. Never throws: no manifest is no pictures. */
export async function loadPictures(base = ""): Promise<Pictures> {
  try {
    const response = await fetch(`${base}assets/manifest.json`);
    if (!response.ok) return {};
    const manifest = (await response.json()) as Manifest;
    const entries = Object.entries(manifest.assets ?? {}).filter((entry): entry is [string, { file: string }] => typeof entry[1]?.file === "string");
    const loaded = await Promise.all(
      entries.map(
        ([name, asset]) =>
          new Promise<[string, HTMLImageElement] | null>((resolve) => {
            const image = new Image();
            image.onload = () => resolve([name, image]);
            image.onerror = () => resolve(null);
            image.src = `${base}${asset.file}`;
          })
      )
    );
    return Object.fromEntries(loaded.filter((entry): entry is [string, HTMLImageElement] => entry !== null));
  } catch {
    return {};
  }
}

/** The pictures, for a component: empty at first, filled in once they have loaded. */
export function usePictures(base = ""): Pictures {
  const [pictures, setPictures] = useState<Pictures>({});
  useEffect(() => {
    let alive = true;
    void loadPictures(base).then((found) => {
      if (alive) setPictures(found);
    });
    return () => {
      alive = false;
    };
  }, [base]);
  return pictures;
}
