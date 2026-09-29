/**
 * Links that work without a key, for one thing, for a while.
 *
 * A download or a preview opens in a browser tab or an <iframe>, which cannot
 * send the x-agent-key header — and putting the key itself in the URL leaks it
 * into every proxy and tunnel log it passes. Instead the address carries a
 * signature over exactly what it is for and when it stops working.
 *
 * The secret lives in data/link-secret.key and is made on first use; deleting
 * it invalidates every link ever handed out.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";

const SECRET_PATH = path.resolve("data/link-secret.key");

let secret: Buffer | null = null;
const getSecret = (): Buffer => {
  if (secret) return secret;
  try {
    secret = Buffer.from(fs.readFileSync(SECRET_PATH, "utf8").trim(), "hex");
    if (secret.length < 32) throw new Error("short");
  } catch {
    secret = crypto.randomBytes(32);
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, secret.toString("hex"), { mode: 0o600 });
  }
  return secret;
};

const mac = (purpose: string, subject: string, expires: number): string =>
  crypto.createHmac("sha256", getSecret()).update(`${purpose}\n${subject}\n${expires}`).digest("base64url");

/** A token for `purpose` on `subject` (an order id, a build id), valid for `ttlMs`. */
export function signLink(purpose: string, subject: string, ttlMs: number): string {
  const expires = Date.now() + ttlMs;
  return `${expires.toString(36)}.${mac(purpose, subject, expires)}`;
}

/** Whether a token is genuine, unexpired, and for this purpose and subject. */
export function verifyLink(purpose: string, subject: string, token: unknown): boolean {
  if (typeof token !== "string") return false;
  const [expiresPart, signature] = token.split(".");
  const expires = parseInt(expiresPart ?? "", 36);
  if (!signature || !Number.isFinite(expires) || expires < Date.now()) return false;
  const expected = Buffer.from(mac(purpose, subject, expires));
  const given = Buffer.from(signature);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}
