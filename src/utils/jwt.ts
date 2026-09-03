import crypto from "crypto";
import fs from "fs";
import path from "path";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

const SECRET_PATH = path.resolve("data/jwt-secret.key");
const KNOWN_INSECURE_DEFAULTS = new Set(["dev-secret", "super-secret-key", "changeme", "secret"]);

const resolveSecret = (): Secret => {
  const fromEnv = process.env.JWT_SECRET;
  if (fromEnv && !KNOWN_INSECURE_DEFAULTS.has(fromEnv)) {
    return fromEnv;
  }

  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  if (fs.existsSync(SECRET_PATH)) {
    return fs.readFileSync(SECRET_PATH, "utf8").trim();
  }

  const generated = crypto.randomBytes(48).toString("hex");
  fs.writeFileSync(SECRET_PATH, generated, { mode: 0o600 });
  console.warn(
    "[auth] JWT_SECRET was missing or left at an insecure default. Generated a random secret at data/jwt-secret.key. " +
    "Existing sessions and tokens are now invalid; set JWT_SECRET in .env to pin your own."
  );
  return generated;
};

const SECRET: Secret = resolveSecret();
const ACCESS_TTL = process.env.JWT_ACCESS_TTL || "30m";
const REFRESH_TTL = process.env.JWT_REFRESH_TTL || "7d";

export type JwtPayload = {
  id: number;
  email: string;
  role: string;
  exp?: number;
  iat?: number;
};

const signToken = (payload: JwtPayload, expiresIn: string) =>
  jwt.sign(payload, SECRET, { expiresIn } as SignOptions);

export const JWT = {
  sign(user: { id: number; email: string; role: string }) {
    return this.signAccess(user);
  },

  signAccess(user: { id: number; email: string; role: string }) {
    return signToken({ id: user.id, email: user.email, role: user.role }, ACCESS_TTL);
  },

  signRefresh(user: { id: number; email: string; role: string }) {
    return signToken({ id: user.id, email: user.email, role: user.role }, REFRESH_TTL);
  },

  verify(token: string) {
    try {
      return jwt.verify(token, SECRET) as JwtPayload;
    } catch {
      return null;
    }
  }
};

export default JWT;
