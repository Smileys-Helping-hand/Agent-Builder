import type { NextFunction, Request, Response } from "express";
import express from "express";
import { AuditLogModel } from "../models/AuditLogModel.js";
import { RefreshTokenModel } from "../models/RefreshTokenModel.js";
import { UserModel, type UserRecord } from "../models/UserModel.js";
import { Hash } from "../utils/hash.js";
import { JWT, type JwtPayload } from "../utils/jwt.js";

export type Role = "owner" | "admin" | "developer" | "viewer" | "editor";

export type TeamRole = {
  teamId: string;
  teamName: string;
  role: Role;
};

export type SanitizedUser = {
  id: string;
  email: string;
  role: Role;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
  teams: TeamRole[];
};

export type AuthTokenPayload = {
  id: string;
  email: string;
  role: Role;
  teams: TeamRole[];
  status: string;
  lastLoginAt: string | null;
};

export type AuthenticatedRequest = Request & { user?: AuthTokenPayload };

const DEFAULT_TEAM_ID = "core-team";
const DEFAULT_TEAM_NAME = process.env.DEFAULT_TEAM_NAME ?? "Core Team";

const normalizeRole = (role: string | null | undefined): Role => {
  switch (role) {
    case "owner":
    case "admin":
    case "developer":
    case "viewer":
      return role;
    case "editor":
      return "developer";
    case "user":
    default:
      return "viewer";
  }
};

const toTeamRole = (role: string | null | undefined): TeamRole => ({
  teamId: DEFAULT_TEAM_ID,
  teamName: DEFAULT_TEAM_NAME,
  role: normalizeRole(role)
});

const sanitizeUser = (record: UserRecord): SanitizedUser => ({
  id: String(record.id),
  email: record.email,
  role: normalizeRole(record.role),
  status: record.status ?? "active",
  lastLoginAt: record.last_login_at ?? null,
  createdAt: record.created_at,
  teams: [toTeamRole(record.role)]
});

const resolveAccessToken = (req: Request) => {
  const header = req.headers.authorization;
  if (!header) {
    return null;
  }
  const [, token] = header.split(" ");
  return token ?? null;
};

const decodeToken = (token: string | null): (JwtPayload & { role: string }) | null => {
  if (!token) {
    return null;
  }
  const payload = JWT.verify(token);
  if (!payload) {
    return null;
  }
  return payload;
};

const issueSessionTokens = (user: UserRecord, req: Request) => {
  const baseUser = sanitizeUser(user);
  if (baseUser.status && baseUser.status !== "active") {
    return null;
  }

  RefreshTokenModel.purgeExpired();

  const loginTimestamp = new Date().toISOString();
  UserModel.updateLastLogin(user.id);

  const refreshToken = RefreshTokenModel.issueToken({
    userId: user.id,
    userAgent: typeof req.headers["user-agent"] === "string" ? (req.headers["user-agent"] as string) : undefined,
    ipAddress: req.ip
  });

  const accessToken = JWT.signAccess({ id: user.id, email: user.email, role: baseUser.role });

  const enrichedUser: SanitizedUser = {
    ...baseUser,
    lastLoginAt: loginTimestamp
  };

  return { token: accessToken, accessToken, refreshToken, user: enrichedUser };
};

export const authRouter = express.Router();

authRouter.post("/register", (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const existing = UserModel.findByEmail(email);
  if (existing) {
    return res.status(400).json({ error: "User exists" });
  }

  const hashed = Hash.make(password);
  UserModel.create(email, hashed, "viewer");
  const created = UserModel.findByEmail(email);
  if (!created) {
    return res.status(500).json({ error: "Failed to create user" });
  }

  const session = issueSessionTokens(created, req);
  AuditLogModel.record({
    eventType: "user.registered",
    actorId: created.id,
    actorEmail: created.email
  });

  if (!session) {
    return res.status(403).json({ error: "Account is not active" });
  }

  return res.json(session);
});

authRouter.post("/login", (req: Request, res: Response) => {
  const { email, password } = req.body as { email?: string; password?: string };

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = UserModel.findByEmail(email);
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }

  if (!Hash.verify(password, user.password_hash)) {
    AuditLogModel.record({
      eventType: "auth.login_failed",
      actorId: user.id,
      actorEmail: user.email,
      metadata: { reason: "invalid_password" }
    });
    return res.status(401).json({ error: "Invalid password" });
  }

  const session = issueSessionTokens(user, req);
  if (!session) {
    return res.status(403).json({ error: "Account is not active" });
  }

  AuditLogModel.record({
    eventType: "auth.login",
    actorId: user.id,
    actorEmail: user.email,
    metadata: {
      ip: req.ip,
      userAgent: req.headers["user-agent"] ?? null
    }
  });

  return res.json(session);
});

authRouter.post("/refresh", (req: Request, res: Response) => {
  const { refreshToken } = req.body as { refreshToken?: string };
  if (!refreshToken) {
    return res.status(400).json({ error: "Refresh token is required" });
  }

  const userId = RefreshTokenModel.verifyToken(refreshToken);
  if (!userId) {
    return res.status(401).json({ error: "Invalid refresh token" });
  }

  const user = UserModel.findById(userId);
  if (!user) {
    RefreshTokenModel.revokeToken(refreshToken);
    return res.status(401).json({ error: "User not found" });
  }

  const accessToken = JWT.signAccess({ id: user.id, email: user.email, role: normalizeRole(user.role) });
  const sanitized = sanitizeUser(user);

  AuditLogModel.record({
    eventType: "auth.refresh",
    actorId: user.id,
    actorEmail: user.email
  });

  return res.json({ token: accessToken, accessToken, user: sanitized });
});

authRouter.post("/logout", (req: Request, res: Response) => {
  const { refreshToken, allSessions } = req.body as { refreshToken?: string; allSessions?: boolean };

  if (allSessions) {
    const token = resolveAccessToken(req);
    const payload = decodeToken(token);
    if (!payload) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    RefreshTokenModel.revokeAllForUser(payload.id);
    AuditLogModel.record({
      eventType: "auth.logout_all",
      actorId: payload.id,
      actorEmail: payload.email
    });
    return res.json({ ok: true });
  }

  if (!refreshToken) {
    return res.status(400).json({ error: "Refresh token is required" });
  }

  RefreshTokenModel.revokeToken(refreshToken);
  const logoutPayload = (() => {
    const token = resolveAccessToken(req);
    return decodeToken(token);
  })();
  AuditLogModel.record({
    eventType: "auth.logout",
    actorId: (() => {
      if (!logoutPayload) return null;
      const value = Number.parseInt(String(logoutPayload.id), 10);
      return Number.isFinite(value) ? value : null;
    })(),
    actorEmail: logoutPayload?.email ?? null
  });
  return res.json({ ok: true });
});

authRouter.get("/me", (req: Request, res: Response) => {
  const token = resolveAccessToken(req);
  const decoded = decodeToken(token);
  if (!decoded) {
    return res.json({ user: null });
  }

  const record = UserModel.findById(decoded.id);
  if (!record) {
    return res.json({ user: null });
  }

  return res.json({ user: sanitizeUser(record) });
});

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const token = resolveAccessToken(req);
  const payload = decodeToken(token);

  if (!payload) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const role = normalizeRole(payload.role);
  const record = UserModel.findById(payload.id);
  if (!record) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const user = sanitizeUser(record);
  if (user.status && user.status !== "active") {
    return res.status(403).json({ error: "Account is not active" });
  }

  const authUser: AuthTokenPayload = {
    id: String(payload.id),
    email: payload.email,
    role,
    teams: [toTeamRole(role)],
    status: user.status,
    lastLoginAt: user.lastLoginAt
  };

  (req as AuthenticatedRequest).user = authUser;
  return next();
};

export const requireRole = (...roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  const authReq = req as AuthenticatedRequest;
  const user = authReq.user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const normalizedRoles = roles.map((role) => normalizeRole(role));

  if (user.role === "owner" || normalizedRoles.length === 0) {
    return next();
  }

  const allowed =
    normalizedRoles.includes(user.role) || user.teams.some((team) => normalizedRoles.includes(team.role));
  if (!allowed) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  return next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) =>
  requireRole("admin")(req, res, next);

export const authenticate = requireAuth;

export const authorizeRoles = (roles: Role[]) => requireRole(...roles);

export const registerAuthRoutes = (app: express.Express) => {
  app.use("/api/auth", authRouter);
};
