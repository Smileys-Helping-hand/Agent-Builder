import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import { authenticate, authorizeRoles } from "./auth.js";
import { BuildEngine } from "../orchestrator/BuildEngine.js";
import { MergeEngine } from "../orchestrator/MergeEngine.js";
import { Logger } from "../utils/Logger.js";

const engine = BuildEngine.getInstance();
const merger = MergeEngine.getInstance();

const listProjectExports = async () => {
  const root = process.env.PROJECT_OUTPUT ?? path.resolve("./projects");
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
};

export const registerBuildRoutes = (app: Express) => {
  app.post(
    "/api/build/start",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      const { prompt, mode, autonomy, repositories, sessionId } = req.body as {
        prompt?: string;
        mode?: any;
        autonomy?: any;
        repositories?: string[];
        sessionId?: string;
      };

      if (!prompt?.trim()) {
        return res.status(400).json({ error: "prompt is required" });
      }

      try {
        const job = engine.startBuild({
          prompt: prompt.trim(),
          mode,
          autonomy,
          repositories: repositories ?? [],
          sessionId
        });
        return res.status(201).json({ job });
      } catch (error) {
        Logger.error("Failed to start build", error);
        const message = error instanceof Error ? error.message : String(error);
        return res.status(500).json({ error: message });
      }
    }
  );

  app.get(
    "/api/build/status/:id",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      const id = req.params.id;
      const job = engine.getBuild(id);
      if (!job) {
        return res.status(404).json({ error: "Build not found" });
      }
      return res.json({ job });
    }
  );

  app.get(
    "/api/build/history",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    (_req: Request, res: Response) => {
      const jobs = engine.listBuilds();
      res.json({ jobs });
    }
  );

  app.post(
    "/api/build/cancel",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    (req: Request, res: Response) => {
      const { id } = req.body as { id?: string };
      if (!id) {
        return res.status(400).json({ error: "id is required" });
      }
      const job = engine.cancelBuild(id);
      if (!job) {
        return res.status(404).json({ error: "Build not found" });
      }
      res.json({ job });
    }
  );

  app.post(
    "/api/build/merge",
    authenticate,
    authorizeRoles(["editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { sourceA, sourceB, outputDir, strategy } = req.body as {
        sourceA?: string;
        sourceB?: string;
        outputDir?: string;
        strategy?: "semantic" | "overwrite";
      };

      if (!sourceA || !sourceB) {
        return res.status(400).json({ error: "sourceA and sourceB are required" });
      }

      try {
        const report = await merger.merge({ sourceA, sourceB, outputDir, strategy });
        res.json({ report });
      } catch (error) {
        Logger.error("Repo merge failed", error);
        const message = error instanceof Error ? error.message : String(error);
        res.status(500).json({ error: message });
      }
    }
  );

  app.get(
    "/api/project/export",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (_req: Request, res: Response) => {
      const projects = await listProjectExports();
      res.json({ projects });
    }
  );
};
