/**
 * ProjectScanner — finds every project on this machine and reads its real state.
 *
 * Scans the configured roots for git repositories and records what an agent
 * needs to pick one up cold: what it is, what it is built with, which branch it
 * is on, whether there is uncommitted work, and what was last done to it.
 *
 * Read-only by design. Nothing here writes to a project; a scan of 60 repos
 * must be safe to run on a timer.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { EcosystemStore, type EcosystemProject } from "./EcosystemStore.js";
import { Logger } from "../utils/Logger.js";

const run = promisify(execFile);

/** Where projects live. Override with ECOSYSTEM_ROOTS (comma-separated). */
export const projectRoots = (): string[] =>
  (process.env.ECOSYSTEM_ROOTS ?? "H:/ts,E:/Projects,K:/Projects")
    .split(",")
    .map((root) => root.trim())
    .filter((root) => root.length > 0 && fs.existsSync(root));

const MAX_DEPTH = 2;
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", ".next", "target", "venv", ".venv", "__pycache__"]);

const git = async (cwd: string, args: string[]): Promise<string> => {
  try {
    const { stdout } = await run("git", args, { cwd, timeout: 10_000, windowsHide: true });
    return stdout.trim();
  } catch {
    return "";
  }
};

const readIfPresent = (file: string, maxBytes = 4000): string | null => {
  try {
    if (!fs.existsSync(file)) return null;
    const handle = fs.openSync(file, "r");
    try {
      const buffer = Buffer.alloc(maxBytes);
      const read = fs.readSync(handle, buffer, 0, maxBytes, 0);
      return buffer.subarray(0, read).toString("utf8");
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return null;
  }
};

/** First real paragraph of a README, with markdown chrome stripped. */
const readmeExcerpt = (projectPath: string): string | null => {
  const candidates = ["README.md", "readme.md", "Readme.md", "README.MD"];
  for (const name of candidates) {
    const raw = readIfPresent(path.join(projectPath, name));
    if (!raw) continue;
    const text = raw
      .split("\n")
      .filter((line) => !line.trim().startsWith("#") && !line.trim().startsWith("![") && !line.trim().startsWith("["))
      .join(" ")
      .replace(/[*_`>]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 20) return text.slice(0, 600);
  }
  return null;
};

type PackageJson = {
  name?: string;
  description?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const readPackageJson = (projectPath: string): PackageJson | null => {
  const raw = readIfPresent(path.join(projectPath, "package.json"), 20_000);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
};

/** What the project is built with — used for routing work and for briefings. */
const detectStack = (projectPath: string, pkg: PackageJson | null): { kind: string; stack: string[] } => {
  const dependencies = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(dependencies, name);
  const fileExists = (name: string) => fs.existsSync(path.join(projectPath, name));

  const stack: string[] = [];
  if (pkg) stack.push("node");
  if (has("next")) stack.push("next.js");
  if (has("react")) stack.push("react");
  if (has("vue")) stack.push("vue");
  if (has("svelte")) stack.push("svelte");
  if (has("vite")) stack.push("vite");
  if (has("express")) stack.push("express");
  if (has("typescript") || fileExists("tsconfig.json")) stack.push("typescript");
  if (has("electron")) stack.push("electron");
  if (has("@tauri-apps/cli") || fileExists("src-tauri")) stack.push("tauri");
  if (has("firebase") || has("firebase-admin")) stack.push("firebase");
  if (has("@prisma/client") || fileExists("prisma")) stack.push("prisma");
  if (has("vitest")) stack.push("vitest");
  if (has("jest")) stack.push("jest");
  if (fileExists("requirements.txt") || fileExists("pyproject.toml")) stack.push("python");
  if (fileExists("Cargo.toml")) stack.push("rust");
  if (fileExists("go.mod")) stack.push("go");
  if (fileExists("Dockerfile")) stack.push("docker");
  if (fileExists("amplify.yml") || fileExists("amplify")) stack.push("amplify");

  const kind = stack.includes("tauri")
    ? "desktop"
    : stack.includes("electron")
      ? "desktop"
      : stack.includes("next.js") || stack.includes("vite") || stack.includes("react")
        ? "web"
        : stack.includes("express")
          ? "service"
          : stack.includes("python")
            ? "python"
            : stack.includes("rust")
              ? "rust"
              : pkg
                ? "node"
                : "unknown";

  return { kind, stack };
};

const slugify = (projectPath: string): string =>
  projectPath
    .replace(/^[a-zA-Z]:/, (drive) => drive.replace(":", ""))
    .replace(/[\\/]+/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

/** Directories containing a .git folder, at most MAX_DEPTH below each root. */
export const findRepositories = (roots: string[] = projectRoots()): string[] => {
  const found: string[] = [];
  const walk = (directory: string, depth: number) => {
    if (depth > MAX_DEPTH) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((entry) => entry.isDirectory() && entry.name === ".git")) {
      found.push(directory.replace(/\\/g, "/"));
      return; // Nested repos below a repo are that repo's business.
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || SKIP_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
      walk(path.join(directory, entry.name), depth + 1);
    }
  };
  for (const root of roots) walk(root, 0);
  return found;
};

const scanRepository = async (projectPath: string, root: string): Promise<Omit<EcosystemProject, "scannedAt">> => {
  const pkg = readPackageJson(projectPath);
  const { kind, stack } = detectStack(projectPath, pkg);

  const [branch, remote, statusOutput, lastCommit, tracking] = await Promise.all([
    git(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(projectPath, ["config", "--get", "remote.origin.url"]),
    git(projectPath, ["status", "--porcelain"]),
    git(projectPath, ["log", "-1", "--format=%cI%x1f%s"]),
    git(projectPath, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"])
  ]);

  const dirtyCount = statusOutput ? statusOutput.split("\n").filter((line) => line.trim().length > 0).length : 0;
  const [commitDate, commitSubject] = lastCommit ? lastCommit.split("\u001f") : ["", ""];
  const [ahead, behind] = tracking ? tracking.split(/\s+/).map((value) => Number(value) || 0) : [0, 0];

  return {
    id: slugify(projectPath),
    name: pkg?.name?.split("/").pop() ?? path.basename(projectPath),
    path: projectPath,
    root,
    kind,
    description: pkg?.description ?? null,
    stack,
    scripts: pkg?.scripts ?? {},
    gitBranch: branch || null,
    gitRemote: remote || null,
    gitDirty: dirtyCount,
    gitAhead: ahead ?? 0,
    gitBehind: behind ?? 0,
    lastCommitAt: commitDate || null,
    lastCommitSubject: commitSubject || null,
    hasClaudeMd: fs.existsSync(path.join(projectPath, "CLAUDE.md")),
    readmeExcerpt: readmeExcerpt(projectPath)
  };
};

export interface ScanResult {
  scanned: number;
  removed: number;
  durationMs: number;
  roots: string[];
}

export const ProjectScanner = {
  /** Rescan every root and bring the registry in line with what is on disk. */
  async scanAll(): Promise<ScanResult> {
    const started = Date.now();
    const roots = projectRoots();
    const repositories = findRepositories(roots);
    const keptPaths: string[] = [];

    const scanned: Array<Omit<EcosystemProject, "scannedAt">> = [];
    for (const repository of repositories) {
      const root = roots.find((candidate) => repository.startsWith(candidate.replace(/\\/g, "/"))) ?? path.dirname(repository);
      try {
        scanned.push(await scanRepository(repository, root));
      } catch (error) {
        Logger.log("Project scan failed", { repository, error: error instanceof Error ? error.message : String(error) });
      }
    }

    // Names come from package.json, and several projects here share one
    // ("nextn" for two different apps), which makes the list and every briefing
    // ambiguous. Where a name is not unique, the folder name is the honest label.
    const nameCounts = new Map<string, number>();
    for (const project of scanned) {
      nameCounts.set(project.name, (nameCounts.get(project.name) ?? 0) + 1);
    }
    for (const project of scanned) {
      if ((nameCounts.get(project.name) ?? 0) > 1) project.name = path.basename(project.path);
    }

    // Some projects are cloned in two places and share a folder name too
    // (VerifiedBizLink lives on both drives). Add the drive so the list is
    // unambiguous about which copy you are looking at.
    const folderCounts = new Map<string, number>();
    for (const project of scanned) {
      folderCounts.set(project.name, (folderCounts.get(project.name) ?? 0) + 1);
    }
    for (const project of scanned) {
      if ((folderCounts.get(project.name) ?? 0) > 1) {
        const drive = project.path.slice(0, 2).toUpperCase();
        project.name = `${project.name} (${drive})`;
      }
      EcosystemStore.upsertProject(project);
      keptPaths.push(project.path);
    }

    // Prune only within the roots we just scanned. Scanning one root must not
    // evict projects belonging to another — an earlier version wiped the whole
    // registry when ECOSYSTEM_ROOTS was narrowed for a single run.
    const removed = EcosystemStore.removeMissingProjects(keptPaths, roots);
    const durationMs = Date.now() - started;
    EcosystemStore.recordEvent(null, "scan", `Scanned ${keptPaths.length} project(s) in ${(durationMs / 1000).toFixed(1)}s`);
    return { scanned: keptPaths.length, removed, durationMs, roots };
  },

  /** Refresh a single project (cheap enough to call before handing out a briefing). */
  async rescanProject(id: string): Promise<EcosystemProject | null> {
    const existing = EcosystemStore.getProject(id);
    if (!existing || !fs.existsSync(existing.path)) return null;
    const project = await scanRepository(existing.path, existing.root);
    return EcosystemStore.upsertProject(project);
  }
};
