import jwt, { type Secret, type SignOptions } from "jsonwebtoken";

const SECRET: Secret = process.env.JWT_SECRET || "dev-secret";
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
