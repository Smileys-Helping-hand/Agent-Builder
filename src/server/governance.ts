import express from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { GovernanceStore } from "../state/GovernanceStore.js";

export const registerGovernanceRoutes = (app: express.Express) => {
  app.get(
    "/api/governance/audit",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (_req, res) => {
      const records = await GovernanceStore.listAudits();
      res.json({ records });
    }
  );

  app.post(
    "/api/governance/audit",
    authenticate,
    authorizeRoles(["admin", "owner"]),
    async (req, res) => {
      const { action, actor, target, metadata, timestamp } = req.body as {
        action?: string;
        actor?: string;
        target?: string;
        metadata?: Record<string, unknown>;
        timestamp?: string;
      };
      if (!action || !actor || !target) {
        return res.status(400).json({ error: "action, actor, and target are required" });
      }
      const record = await GovernanceStore.recordAudit({
        action,
        actor,
        target,
        metadata,
        timestamp: timestamp ?? new Date().toISOString()
      });
      res.status(201).json({ record });
    }
  );

  app.get(
    "/api/governance/consent",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (_req, res) => {
      const records = await GovernanceStore.listConsents();
      res.json({ records });
    }
  );

  app.post(
    "/api/governance/consent",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req, res) => {
      const { subject, grantedBy, scope, expiresAt, timestamp } = req.body as {
        subject?: string;
        grantedBy?: string;
        scope?: string;
        expiresAt?: string;
        timestamp?: string;
      };
      if (!subject || !grantedBy || !scope) {
        return res.status(400).json({ error: "subject, grantedBy, and scope are required" });
      }
      const record = await GovernanceStore.recordConsent({
        subject,
        grantedBy,
        scope,
        expiresAt,
        timestamp
      });
      res.status(201).json({ record });
    }
  );
};
