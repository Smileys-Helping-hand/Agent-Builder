/**
 * Where this machine can be reached from outside — the address the phone app
 * and the ordering site's "Open Agent Builder" use.
 *
 * An explicit REMOTE_URL or PUBLIC_URL wins; otherwise it is whatever the
 * launcher found and wrote to data/remote-url.txt (a Cloudflare tunnel, or the
 * Tailscale address). Null when nothing has been set up.
 */
import fs from "fs";
import path from "path";

export const readPublicUrl = (): string | null => {
  if (process.env.REMOTE_URL?.startsWith("http")) return process.env.REMOTE_URL.trim();
  if (process.env.PUBLIC_URL?.startsWith("http")) return process.env.PUBLIC_URL.trim();
  try {
    const file = path.resolve("data/remote-url.txt");
    if (!fs.existsSync(file)) return null;
    // PowerShell may have written it with a byte-order mark.
    const value = fs.readFileSync(file, "utf8").replace(/^﻿/, "").trim();
    return value.startsWith("http") ? value : null;
  } catch {
    return null;
  }
};
