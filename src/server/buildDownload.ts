import type { Express, Request, Response } from "express";
import fs from "fs";
import path from "path";
import { authenticate, authorizeRoles } from "./auth.js";
import { Logger } from "../utils/Logger.js";

const resolveDistDir = (taskId: string) => {
  const root = path.resolve(process.env.PROJECT_OUTPUT ?? "./projects");
  return path.join(root, taskId, "dist");
};

const platformPreference: Partial<Record<NodeJS.Platform, string[]>> = {
  win32: [".exe", ".msi", ".nsis"],
  darwin: [".dmg", ".pkg", ".zip"],
  linux: [".AppImage", ".deb", ".rpm", ".tar.gz", ".tgz"]
};

type Artifact = { relative: string; fullPath: string; mtime: number; isFile: boolean };

const walkArtifacts = async (dir: string, prefix = ""): Promise<Artifact[]> => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const collected: Artifact[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      collected.push(...(await walkArtifacts(fullPath, relative)));
    } else {
      const stats = await fs.promises.stat(fullPath);
      collected.push({ relative, fullPath, mtime: stats.mtimeMs, isFile: stats.isFile() });
    }
  }
  return collected.filter((item) => item.isFile).sort((a, b) => b.mtime - a.mtime);
};

const detectPlatform = (req: Request): NodeJS.Platform => {
  const ua = String(req.headers["user-agent"] ?? "").toLowerCase();
  if (ua.includes("windows")) return "win32";
  if (ua.includes("mac") || ua.includes("darwin")) return "darwin";
  if (ua.includes("linux")) return "linux";
  return process.platform;
};

const pickArtifact = (artifacts: Artifact[], requested: string | undefined, platform: NodeJS.Platform) => {
  if (requested) {
    const safe = requested.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.\/+/, "");
    const decoded = decodeURIComponent(safe);
    return artifacts.find((artifact) => artifact.relative === decoded);
  }

  const preferred = platformPreference[platform] ?? [];
  const matched = artifacts.find((artifact) => preferred.some((ext) => artifact.relative.endsWith(ext)));
  return matched ?? artifacts[0];
};

const errorPayload = (message: string, code: number) => ({ ok: false, error: { message, code } });

export const registerBuildDownloadRoutes = (app: Express) => {
  app.get(
    "/api/builds/download/:taskId",
    authenticate,
    authorizeRoles(["viewer", "editor", "admin", "owner"]),
    async (req: Request, res: Response) => {
      const { taskId } = req.params;
      const requested = (req.query?.file as string | undefined)?.trim();

      if (!taskId) {
        return res.status(400).json(errorPayload("A task id is required", 400));
      }

      const distDir = resolveDistDir(taskId);

      try {
        await fs.promises.access(distDir, fs.constants.R_OK);
      } catch (error) {
        Logger.warn(`No dist directory for task ${taskId}: ${(error as Error).message}`);
        return res.status(404).json(errorPayload("No packaged artifacts found for this task", 404));
      }

      try {
        const artifacts = await walkArtifacts(distDir);
        if (!artifacts.length) {
          Logger.warn(`No downloadable build artifacts located for ${taskId}`);
          return res.status(404).json(errorPayload("No downloadable build artifacts were located", 404));
        }

        const platform = detectPlatform(req);
        const target = pickArtifact(artifacts, requested, platform);
        if (!target) {
          return res.status(404).json(errorPayload("Requested artifact was not found", 404));
        }

        const resolved = path.resolve(target.fullPath);
        const resolvedRoot = path.resolve(distDir);
        if (!resolved.startsWith(resolvedRoot)) {
          Logger.warn(`Rejected path traversal attempt for ${taskId}: ${requested}`);
          return res.status(400).json(errorPayload("Invalid artifact path", 400));
        }

        const stats = await fs.promises.stat(resolved);

        Logger.log(`Serving packaged artifact for ${taskId}: ${target.relative}`);
        res.setHeader("Access-Control-Expose-Headers", "Content-Disposition,Content-Length,Last-Modified");
        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Length", String(stats.size));
        res.setHeader("Last-Modified", stats.mtime.toUTCString());
        res.setHeader("Cache-Control", "no-store");

        return res.download(resolved, path.basename(target.relative), (err) => {
          if (err) {
            Logger.error(`Download failed for ${taskId}:`, err.message);
            if (!res.headersSent) {
              res.status(500).json(errorPayload("Unable to download the requested build", 500));
            }
          }
        });
      } catch (error) {
        Logger.error(`Unexpected build download failure for ${taskId}:`, (error as Error).message);
        return res
          .status(500)
          .json(errorPayload("An unexpected error occurred while preparing the download", 500));
      }
    }
  );
};
