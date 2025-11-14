import express from "express";
import { LicenseModel, type LicenseTier } from "../models/LicenseModel.js";
import { authenticate, authorizeRoles } from "./auth.js";

export const registerLicenseRoutes = (app: express.Express) => {
  const router = express.Router();

  router.get("/status", authenticate, authorizeRoles(["viewer", "editor", "admin", "owner"]), (_req, res) => {
    const license = LicenseModel.getActive();
    res.json({ license });
  });

  router.post(
    "/activate",
    authenticate,
    authorizeRoles(["admin", "owner"]),
    (req, res) => {
      const { key, tier, metadata } = (req.body ?? {}) as {
        key?: string;
        tier?: LicenseTier;
        metadata?: Record<string, unknown>;
      };

      if (!key || !tier) {
        return res.status(400).json({ error: "License key and tier are required." });
      }

      const license = LicenseModel.activate(key, tier, metadata);
      res.json({ license });
    }
  );

  app.use("/api/license", router);
};
