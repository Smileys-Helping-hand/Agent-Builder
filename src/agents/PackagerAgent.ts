import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { BaseAgent } from "./BaseAgent.js";
import type { Task } from "../orchestrator/types.js";
import { Logger } from "../utils/Logger.js";
import { emitServerEvent } from "../server/eventBus.js";

const PLATFORM_SCRIPT: Partial<Record<NodeJS.Platform, string>> = {
  win32: "package:win",
  darwin: "package:mac",
  linux: "package:linux"
};

const PLATFORM_PRIORITY: Partial<Record<NodeJS.Platform, string[]>> = {
  win32: [".exe", ".msi", ".nsis"],
  darwin: [".dmg", ".pkg", ".zip"],
  linux: [".AppImage", ".deb", ".rpm", ".tar.gz", ".tgz"]
};

type ArtifactRecord = { name: string; relative: string; fullPath: string; mtime: number; size: number };
type PackagerOutput = {
  version: string;
  distPath: string;
  artifacts: string[];
  primaryArtifact?: string;
  downloadUrl: string;
  notes: string;
};

type BuildStage =
  | "packager:start"
  | "packager:versioned"
  | "packager:build"
  | "packager:package"
  | "packager:mirror"
  | "packager:complete"
  | "packager:error";

const getOutputRoot = () => path.resolve(process.env.PROJECT_OUTPUT ?? "./projects");

const bumpPatch = (version: string) => {
  const [major = 1, minor = 0, patch = 0] = version
    .split(".")
    .map((segment) => Number(segment) || 0);
  return `${major}.${minor}.${patch + 1}`;
};

const readVersion = async (versionPath: string): Promise<string> => {
  try {
    const existing = JSON.parse(await fs.promises.readFile(versionPath, "utf8")) as { version?: string };
    if (existing?.version) return existing.version;
  } catch {
    // ignore
  }
  return "1.0.0";
};

const copyRecursive = async (src: string, dest: string) => {
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  await fs.promises.mkdir(dest, { recursive: true });
  for (const entry of entries) {
    const sourcePath = path.join(src, entry.name);
    const targetPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyRecursive(sourcePath, targetPath);
    } else if (entry.isFile()) {
      await fs.promises.copyFile(sourcePath, targetPath);
    }
  }
};

const discoverArtifacts = async (dir: string, prefix = ""): Promise<ArtifactRecord[]> => {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files: ArtifactRecord[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverArtifacts(fullPath, relative)));
      continue;
    }
    const stats = await fs.promises.stat(fullPath);
    files.push({ name: entry.name, relative, fullPath, mtime: stats.mtimeMs, size: stats.size });
  }
  return files.sort((a, b) => b.mtime - a.mtime);
};

const selectBestArtifact = (artifacts: ArtifactRecord[]): ArtifactRecord | undefined => {
  if (!artifacts.length) return undefined;
  const priority = PLATFORM_PRIORITY[process.platform] ?? [];
  const prioritized = artifacts.find((artifact) => priority.some((ext) => artifact.name.endsWith(ext)));
  return prioritized ?? artifacts[0];
};

export class PackagerAgent extends BaseAgent {
  constructor() {
    super("PackagerAgent");
  }

  canHandle(task: Task): boolean {
    return task.agentType === "PackagerAgent";
  }

  private emitBuild(stage: BuildStage, taskId: string, payload: Record<string, unknown> = {}) {
    emitServerEvent({
      type: "build",
      payload: { stage, taskId, timestamp: new Date().toISOString(), ...payload }
    });
  }

  private runStep(command: string, label: string, env: NodeJS.ProcessEnv = {}) {
    Logger.log(`[Packager] ${label}`);
    try {
      execSync(command, {
        cwd: process.cwd(),
        stdio: "inherit",
        env: { ...process.env, NODE_ENV: "production", ...env }
      });
    } catch (error) {
      const message = (error as Error).message ?? "step failed";
      throw new Error(`${label} failed: ${message}`);
    }
  }

  protected async execute(task: Task): Promise<PackagerOutput> {
    const root = process.cwd();
    const projectsRoot = getOutputRoot();
    const taskDir = path.join(projectsRoot, task.id);
    const distDir = path.join(taskDir, "dist");
    const versionPath = path.join(taskDir, "version.json");
    const releaseDir = path.resolve(root, "release");

    this.emitBuild("packager:start", task.id);
    await fs.promises.mkdir(taskDir, { recursive: true });

    const currentVersion = await readVersion(versionPath);
    const nextVersion = bumpPatch(currentVersion);
    await fs.promises.writeFile(versionPath, JSON.stringify({ version: nextVersion }, null, 2));
    this.emitBuild("packager:versioned", task.id, { version: nextVersion });

    if (fs.existsSync(releaseDir)) {
      await fs.promises.rm(releaseDir, { recursive: true, force: true });
    }

    try {
      this.emitBuild("packager:build", task.id, { version: nextVersion });
      this.runStep("npm run prepare-build-env", "Building backend and dashboard assets");

      const targetScript = process.env.PACKAGER_TARGET ?? PLATFORM_SCRIPT[process.platform] ?? "package:all";
      this.emitBuild("packager:package", task.id, { script: targetScript });
      this.runStep(`npm run ${targetScript}`, "Packaging desktop application", { SKIP_PREPARE: "1" });

      await fs.promises.rm(distDir, { recursive: true, force: true });
      await fs.promises.mkdir(distDir, { recursive: true });

      if (!fs.existsSync(releaseDir)) {
        throw new Error("Electron build output was not found (expected release directory)");
      }

      this.emitBuild("packager:mirror", task.id);
      await copyRecursive(releaseDir, distDir);

      const artifacts = await discoverArtifacts(distDir);
      if (!artifacts.length) {
        throw new Error("No packaged artifacts were produced");
      }

      const best = selectBestArtifact(artifacts);
      const downloadUrl = best
        ? `/api/builds/download/${task.id}?file=${encodeURIComponent(best.relative)}`
        : `/api/builds/download/${task.id}`;
      const notes = `Packaged ${artifacts.length} artifact(s) at v${nextVersion}`;

      Logger.log(`[Packager] Completed version ${nextVersion} with ${artifacts.length} artifacts`);

      const output: PackagerOutput = {
        version: nextVersion,
        distPath: distDir,
        artifacts: artifacts.map((item) => item.relative),
        primaryArtifact: best?.relative,
        downloadUrl,
        notes
      };

      this.emitBuild("packager:complete", task.id, output);

      return output;
    } catch (error) {
      const message = (error as Error).message ?? "Packager failed";
      Logger.error(`[Packager] ${message}`);
      this.emitBuild("packager:error", task.id, { error: message });
      throw error;
    }
  }
}
