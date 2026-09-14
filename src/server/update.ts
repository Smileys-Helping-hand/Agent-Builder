import express, { Request, Response } from "express";
import fs from "fs";
import path from "path";

// A packaged desktop build has no package.json in its working directory, and
// reading it here at import time crashed the API sidecar on launch. The bundler
// injects the version as a literal (esbuild `define`); running from source falls
// back to reading package.json, and to "0.0.0" if even that is missing.
declare const __APP_VERSION__: string | undefined;

const readAppVersion = (): string => {
  if (typeof __APP_VERSION__ === "string") return __APP_VERSION__;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const packageJson = { version: readAppVersion() };

const parseVersion = (value: string | undefined) => value?.trim() ?? "0.0.0";

const isUpdateAvailable = (current: string, latest: string) => {
  const currentParts = current.split(".").map((part) => Number(part));
  const latestParts = latest.split(".").map((part) => Number(part));
  for (let index = 0; index < Math.max(currentParts.length, latestParts.length); index += 1) {
    const currentValue = currentParts[index] ?? 0;
    const latestValue = latestParts[index] ?? 0;
    if (latestValue > currentValue) {
      return true;
    }
    if (latestValue < currentValue) {
      return false;
    }
  }
  return false;
};

export const registerUpdateRoute = (app: express.Express) => {
  app.get("/api/update/check", (_req: Request, res: Response) => {
    const currentVersion = parseVersion(packageJson.version);
    const advertisedVersion = parseVersion(process.env.AGENT_BUILDER_LATEST ?? packageJson.version);
    res.json({
      currentVersion,
      latestVersion: advertisedVersion,
      updateAvailable: isUpdateAvailable(currentVersion, advertisedVersion)
    });
  });
};
