/**
 * DiskGuard — work that writes a lot waits while the disk is nearly full.
 *
 * A full disk took the whole builder down: npm installs failed half-written, logs
 * could not be written, and the launcher restarted it in a loop. Builds, installs,
 * releases and the continuous builder's steps now ask first, and while less than
 * DISK_MIN_FREE_GB (3 GB) is free they wait and say why, instead of failing.
 */
import fs from "fs";
import path from "path";

const MIN_FREE_BYTES = (Number(process.env.DISK_MIN_FREE_GB) || 3) * 1024 ** 3;

export const DiskGuard = {
  /** Free bytes on the disk holding `dir`; null when it cannot be told. */
  freeBytes(dir = process.cwd()): number | null {
    try {
      const stats = fs.statfsSync(path.resolve(dir));
      return Number(stats.bavail) * Number(stats.bsize);
    } catch {
      return null;
    }
  },

  freeGb(dir?: string): number | null {
    const free = DiskGuard.freeBytes(dir);
    return free === null ? null : Math.round((free / 1024 ** 3) * 10) / 10;
  },

  /** True when there is too little room for heavy work. Unknown is not low. */
  low(dir?: string): boolean {
    const free = DiskGuard.freeBytes(dir);
    return free !== null && free < MIN_FREE_BYTES;
  },

  /** Why work is waiting, in words. */
  reason(dir?: string): string {
    return `the disk is nearly full (${DiskGuard.freeGb(dir) ?? "?"} GB free; heavy work waits until there are ${MIN_FREE_BYTES / 1024 ** 3} GB)`;
  }
};
