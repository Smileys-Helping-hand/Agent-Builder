/**
 * A VM's screen as a picture: QEMU writes PPM screendumps, these become PNGs
 * (encoded here, no dependency), with a measure of whether anything is shown.
 */
import zlib from "zlib";

export interface Picture {
  width: number;
  height: number;
  /** RGB, 3 bytes a pixel. */
  rgb: Buffer;
}

/** A binary PPM (P6) file, as QEMU's screendump writes. */
export const readPpm = (data: Buffer): Picture => {
  let offset = 0;
  const token = (): string => {
    // Skip whitespace and comments.
    for (;;) {
      while (offset < data.length && /\s/.test(String.fromCharCode(data[offset]))) offset++;
      if (data[offset] === 0x23) {
        while (offset < data.length && data[offset] !== 0x0a) offset++;
        continue;
      }
      break;
    }
    const start = offset;
    while (offset < data.length && !/\s/.test(String.fromCharCode(data[offset]))) offset++;
    return data.subarray(start, offset).toString("ascii");
  };
  if (token() !== "P6") throw new Error("Not a P6 PPM picture.");
  const width = Number(token());
  const height = Number(token());
  const max = Number(token());
  offset += 1;
  if (!width || !height || max !== 255) throw new Error("Unsupported PPM picture.");
  return { width, height, rgb: data.subarray(offset, offset + width * height * 3) };
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const chunk = (type: string, body: Buffer): Buffer => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};

export const toPng = (picture: Picture): Buffer => {
  const { width, height, rgb } = picture;
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
};

/**
 * How much the screen shows: the share of sampled pixels that differ from the
 * most common colour, and how many distinct colours there are. A black boot
 * screen is ~0; text on a console a few percent; a desktop far more.
 */
export const screenContent = (picture: Picture): { coverage: number; colours: number } => {
  const counts = new Map<number, number>();
  let samples = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((picture.width * picture.height) / 20_000)));
  for (let y = 0; y < picture.height; y += step) {
    for (let x = 0; x < picture.width; x += step) {
      const i = (y * picture.width + x) * 3;
      // 4 bits a channel: close colours count as one.
      const key = ((picture.rgb[i] >> 4) << 8) | ((picture.rgb[i + 1] >> 4) << 4) | (picture.rgb[i + 2] >> 4);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      samples++;
    }
  }
  const top = Math.max(0, ...counts.values());
  return { coverage: samples ? Math.round(((samples - top) / samples) * 1000) / 1000 : 0, colours: counts.size };
};

/** How different two screens are (share of sampled pixels that changed), for before/after comparisons. */
export const screenDifference = (a: Picture, b: Picture): number => {
  if (a.width !== b.width || a.height !== b.height) return 1;
  let changed = 0;
  let samples = 0;
  const step = Math.max(1, Math.floor(Math.sqrt((a.width * a.height) / 20_000)));
  for (let y = 0; y < a.height; y += step) {
    for (let x = 0; x < a.width; x += step) {
      const i = (y * a.width + x) * 3;
      if (Math.abs(a.rgb[i] - b.rgb[i]) + Math.abs(a.rgb[i + 1] - b.rgb[i + 1]) + Math.abs(a.rgb[i + 2] - b.rgb[i + 2]) > 48) changed++;
      samples++;
    }
  }
  return samples ? Math.round((changed / samples) * 1000) / 1000 : 0;
};
