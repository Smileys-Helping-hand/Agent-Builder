/**
 * An app's look outside the page: its icon in the brand's colour, made
 * without image tools, and the colour read from the project's content.
 * Shared by the phone/PC apps (AppBuilder) and the installable website
 * (Packager).
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";

/** A square PNG icon in the brand's colour with a light disc, made without image tools. */
export const iconPng = (accent: string, size = 1024): Buffer => {
  const hex = /^#?([0-9a-f]{6})$/i.exec(accent.trim())?.[1] ?? "2563eb";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const o = y * (size * 4 + 1) + 1 + x * 4;
      const d = Math.hypot(x - size / 2, y - size / 2);
      const disc = d < size * 0.3;
      raw[o] = disc ? 255 : r;
      raw[o + 1] = disc ? 255 : g;
      raw[o + 2] = disc ? 255 : b;
      raw[o + 3] = 255;
    }
  }
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const v of buf) c = table[(c ^ v) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
};

/** The brand colour in a project's content module, when it has one. */
export const accentOf = (sourceDir: string): string => {
  for (const name of ["src/content.ts", "src/content.tsx"]) {
    try {
      const text = fs.readFileSync(path.join(sourceDir, name), "utf8");
      const found = /\baccent\s*:\s*["'](#[0-9a-fA-F]{6})["']/.exec(text)?.[1] ?? /\bprimary\s*:\s*["'](#[0-9a-fA-F]{6})["']/.exec(text)?.[1];
      if (found) return found;
    } catch {
      // No content module.
    }
  }
  return "#2563eb";
};

