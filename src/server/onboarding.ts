import { Router } from "express";
import { ConfigVault } from "../utils/ConfigVault.js";
import { Hash } from "../utils/hash.js";
import { UserModel } from "../models/UserModel.js";

export const onboardingRouter = Router();

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

onboardingRouter.post("/complete", (req, res) => {
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
