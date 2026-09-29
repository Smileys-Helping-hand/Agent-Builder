/**
 * Change settings in .env from the app, and have them take effect at once.
 *
 * .env is loaded before anything else (server.ts), so .env.dynamic — which only
 * fills in what .env left unset — cannot change a value .env already has. This
 * edits .env itself: each named line is replaced in place (or added at the
 * end), every other line — comments, order, other secrets — is left exactly as
 * it was, and the file is swapped in atomically so a crash mid-write cannot
 * leave it half-written. process.env is updated too, so nothing needs a restart.
 */
import fs from "fs";
import path from "path";

const ENV_PATH = path.resolve(".env");

/** Values with spaces, quotes or # need quoting in a .env file. */
const format = (value: string): string => (/[\s"'#=]/.test(value) ? `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : value);

/** Set (or, with null, remove) keys in .env and in the running process. */
export function setEnvValues(values: Record<string, string | null>): void {
  for (const key of Object.keys(values)) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Not a setting name: ${key}`);
  }

  const original = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original ? original.split(/\r?\n/) : [];
  const pending = new Map(Object.entries(values));

  const out: string[] = [];
  for (const line of lines) {
    const match = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/.exec(line);
    if (match && pending.has(match[1])) {
      const value = pending.get(match[1])!;
      pending.delete(match[1]);
      if (value !== null) out.push(`${match[1]}=${format(value)}`);
      continue;
    }
    out.push(line);
  }
  // Keep a trailing blank line where the file had one, then append new keys.
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [key, value] of pending) if (value !== null) out.push(`${key}=${format(value)}`);

  const temp = `${ENV_PATH}.tmp-${process.pid}`;
  fs.writeFileSync(temp, out.join(newline) + newline, { mode: 0o600 });
  fs.renameSync(temp, ENV_PATH);

  for (const [key, value] of Object.entries(values)) {
    if (value === null) delete process.env[key];
    else process.env[key] = value;
  }
}
