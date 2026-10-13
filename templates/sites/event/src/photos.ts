/**
 * The site's photographs: every picture in src/images, by its file name
 * ("hero.webp" is photos.hero, "line-fish.webp" is photos["line-fish"]).
 * Drawn for this business by the image engine and built into the page.
 * A customer build draws its own (see art.json), and a dish or product the
 * content names a photo for gets one drawn under that name.
 */
const files = import.meta.glob<string>("./images/*.webp", { eager: true, import: "default" });

export const photos: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([file, url]) => [file.replace(/^\.\/images\//, "").replace(/\.webp$/, ""), url])
);
