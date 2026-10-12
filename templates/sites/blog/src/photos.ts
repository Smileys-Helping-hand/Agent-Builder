/**
 * The blog's photographs: every picture in src/images, by its file name.
 * Posts take the covers in order (posts[0] the first); a post past the last
 * shows its emoji. A customer build draws its own (see art.json).
 */
const files = import.meta.glob<string>("./images/*.webp", { eager: true, import: "default" });

const byName: Record<string, string> = Object.fromEntries(
  Object.entries(files).map(([file, url]) => [file.replace(/^\.\/images\//, "").replace(/\.webp$/, ""), url])
);

export const photos = {
  hero: byName.hero,
  posts: ["provisional-tax", "pricing", "cash-flow"].map((name) => byName[name]).filter(Boolean) as string[]
};
