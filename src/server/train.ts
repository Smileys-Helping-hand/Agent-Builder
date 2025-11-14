import type { Application, Request, Response } from "express";
import { authenticate, authorizeRoles } from "./auth.js";
import { LocalTrainer } from "../tools/LocalTrainer.js";
import { Logger } from "../utils/Logger.js";

export const registerTrainingRoutes = (app: Application) => {
  app.post(
    "/api/train/start",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (_req: Request, res: Response) => {
      try {
        const result = await LocalTrainer.startTraining();
        return res.json({
          message: `Training dataset updated with ${result.examples} examples`,
          datasetPath: result.path,
          provider: result.provider
        });
      } catch (error) {
        Logger.error("Failed to start local training", error);
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: message });
      }
    }
  );
};
