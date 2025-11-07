import fs from "fs";
import path from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt, { type Secret, type SignOptions } from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";

const USERS_PATH = path.resolve("./data/users.json");

type Role = "owner" | "admin" | "editor" | "viewer";

type TeamRole = {
  teamId: string;
  teamName: string;
  role: Role;
};

type UserRecord = {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: string;
  teams: TeamRole[];
};

type AuthTokenPayload = {
  sub: string;
  email: string;
  teams: TeamRole[];
};

const DEFAULT_TEAM_ID = "core-team";
const DEFAULT_TEAM_NAME = process.env.DEFAULT_TEAM_NAME ?? "Core Team";

const ensureTeams = (user: UserRecord): UserRecord => {
  if (!Array.isArray(user.teams) || user.teams.length === 0) {
    user.teams = [
      {
        teamId: DEFAULT_TEAM_ID,
        teamName: DEFAULT_TEAM_NAME,
        role: "owner"
      }
    ];
  }
  return user;
};

const readUsers = async (): Promise<UserRecord[]> => {
  try {
    const raw = await fs.promises.readFile(USERS_PATH, "utf8");
    const users = JSON.parse(raw) as UserRecord[];
    return users.map((user) => ensureTeams(user));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

const writeUsers = async (users: UserRecord[]) => {
  await fs.promises.mkdir(path.dirname(USERS_PATH), { recursive: true });
  await fs.promises.writeFile(USERS_PATH, JSON.stringify(users, null, 2));
};

const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET environment variable.");
  }
  return secret;
};

const createToken = (user: UserRecord) => {
  const secret: Secret = getSecret();
  const expiresIn = (process.env.AUTH_TOKEN_EXPIRES_IN ?? "1h") as SignOptions["expiresIn"];
  const payload: AuthTokenPayload = { sub: user.id, email: user.email, teams: user.teams };
  return jwt.sign(payload, secret, { expiresIn });
};

export type AuthenticatedRequest = Request & { user?: AuthTokenPayload };

const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization;
  if (!header) {
    return res.status(401).json({ error: "Missing authorization header" });
  }

  const [, token] = header.split(" ");
  if (!token) {
    return res.status(401).json({ error: "Invalid authorization header" });
  }

  try {
    const secret = getSecret();
    const payload = jwt.verify(token, secret) as AuthTokenPayload;
    (req as AuthenticatedRequest).user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

const authorizeRoles = (roles: Role[]) => (req: Request, res: Response, next: NextFunction) => {
  const user = (req as AuthenticatedRequest).user;
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const hasRole = user.teams.some((team) => roles.includes(team.role));
  if (!hasRole) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  return next();
};

const sanitizeUser = (user: UserRecord) => ({ id: user.id, email: user.email, teams: user.teams });

export const registerAuthRoutes = (app: express.Express) => {
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const users = await readUsers();
    const existing = users.find((user) => user.email.toLowerCase() === email.toLowerCase());
    if (existing) {
      return res.status(409).json({ error: "User already exists" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user: UserRecord = ensureTeams({
      id: uuidv4(),
      email,
      passwordHash,
      createdAt: new Date().toISOString(),
      teams: [
        {
          teamId: DEFAULT_TEAM_ID,
          teamName: DEFAULT_TEAM_NAME,
          role: "owner"
        }
      ]
    });

    users.push(user);
    await writeUsers(users);

    const token = createToken(user);
    return res.status(201).json({ token, user: sanitizeUser(user) });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const users = await readUsers();
    const user = users.find((candidate) => candidate.email.toLowerCase() === email.toLowerCase());
    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = createToken(user);
    return res.json({ token, user: sanitizeUser(user) });
  });

  app.get("/api/auth/me", authenticate, async (req: Request, res: Response) => {
    const payload = (req as AuthenticatedRequest).user;
    if (!payload) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return res.json({ user: { id: payload.sub, email: payload.email, teams: payload.teams } });
  });
};

export type { AuthTokenPayload, Role, TeamRole };
export { authenticate, authorizeRoles };
