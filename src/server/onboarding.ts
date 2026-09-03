import { Router } from "express";
import { ConfigVault } from "../utils/ConfigVault.js";
import { Hash } from "../utils/hash.js";
import { UserModel } from "../models/UserModel.js";
import { authenticate, authorizeRoles } from "./auth.js";

export const onboardingRouter = Router();

const isFirstRun = () => !ConfigVault.isConfigured() && UserModel.count() === 0;

onboardingRouter.get("/status", (_req, res) => {
  const config = ConfigVault.load();
  if (!config) {
    return res.json({ configured: false });
  }
  return res.json({
    configured: true,
    workspaceName: config.workspaceName,
    adminEmail: config.adminEmail,
    aiProvider: config.aiProvider,
    tier: config.adminRole
  });
});

// First run: open, since no account exists yet to authenticate with.
// Any run after that must prove ownership of the workspace already.
onboardingRouter.post("/complete", (req, res, next) => {
  if (isFirstRun()) {
    return next();
  }
  return authenticate(req, res, () => authorizeRoles(["owner"])(req, res, next));
}, (req, res) => {
  const { workspaceName, adminEmail, adminPassword, aiProvider, providerKey } =
    (req.body ?? {}) as {
      workspaceName?: string;
      adminEmail?: string;
      adminPassword?: string;
      aiProvider?: string;
      providerKey?: string;
    };

  if (!workspaceName || !adminEmail || !adminPassword || !aiProvider) {
    return res.status(400).json({ error: "Workspace name, admin email/password, and AI provider are required." });
  }

  const passwordHash = Hash.make(adminPassword);

  const existing = UserModel.findByEmail(adminEmail);
  if (!existing) {
    UserModel.create(adminEmail, passwordHash, "owner");
  } else {
    UserModel.updateCredentials(existing.id, { passwordHash, role: "owner" });
  }

  ConfigVault.save({
    workspaceName,
    adminEmail,
    adminRole: "owner",
    aiProvider,
    providerKey,
    createdAt: new Date().toISOString(),
    passwordHash
  });

  return res.json({ ok: true });
});
