/**
 * InstallDoctor — fixes a failing `npm install` without asking a model.
 *
 * What it replaces: when install failed, the repair loop asked the model to fix
 * it, and the model added packages. Lanternfall went from 15 dependencies to 44
 * (a whole Vue stack in a Phaser game), Driftworks from 16 to 30 (two of them
 * do not exist), and both failed every install for two weeks after; their
 * original package.json files resolve cleanly. The failure that started it was
 * the PC's (a full disk), not the code's.
 *
 * So, from npm's own error:
 *   - the PC's problem (disk full, no network, a locked file): nothing in the
 *     project is changed, and the caller is told not to let a model try;
 *   - a package that does not exist (E404), a version that does not exist
 *     (ETARGET), or a peer conflict (ERESOLVE): the packages named, if they were
 *     added since the baseline (the starting point, or the last commit whose
 *     install passed), are removed;
 *   - and every package added since the baseline that nothing in the project
 *     uses (no import, no mention in a config file or script) is removed too.
 * Packages the code really uses are never removed. The result says what it
 * did; the caller runs install again to see whether it worked.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

const run = promisify(execFile);

export type InstallProblem = "missing-package" | "no-such-version" | "conflict" | "environment" | "unknown";

export interface InstallDiagnosis {
  problem: InstallProblem;
  packages: string[];
  detail: string;
}

export interface InstallRepair {
  diagnosis: InstallDiagnosis;
  changed: boolean;
  removed: string[];
  /** Added since the baseline but used by the code, so kept. */
  keptInUse: string[];
  summary: string;
}

const decode = (name: string) => decodeURIComponent(name).replace(/^%40/, "@");

/** What npm's output says went wrong (exported for tests). */
export const diagnoseInstall = (output: string): InstallDiagnosis => {
  const text = output.replace(/\r/g, "");
  if (/ENOSPC|no space left on device/i.test(text)) return { problem: "environment", packages: [], detail: "the disk is full" };
  if (/EAI_AGAIN|ENOTFOUND registry|ECONNRESET|ETIMEDOUT|ECONNREFUSED|network request.*failed|getaddrinfo/i.test(text)) return { problem: "environment", packages: [], detail: "npm could not reach the registry (network)" };
  if (/EPERM|EBUSY|EACCES|operation not permitted|resource busy or locked/i.test(text)) return { problem: "environment", packages: [], detail: "a file was locked or not writable (another program, or antivirus)" };
  const missing = [...text.matchAll(/404 Not Found - GET https?:\/\/registry\.npmjs\.org\/(\S+?)(?: - |\s|$)/g)].map((m) => decode(m[1]));
  const missingByName = [...text.matchAll(/'(@?[^'@\s]+)@[^']*' is not in (?:this|the npm) registry/g)].map((m) => m[1]);
  if (missing.length || missingByName.length) return { problem: "missing-package", packages: [...new Set([...missing, ...missingByName])], detail: "a package that does not exist on npm" };
  const versions = [...text.matchAll(/No matching version found for (@?[^@\s]+)@/g)].map((m) => m[1]);
  if (versions.length || /ETARGET/.test(text)) return { problem: "no-such-version", packages: [...new Set(versions)], detail: "a version that does not exist" };
  if (/ERESOLVE/.test(text)) {
    const from = [...text.matchAll(/(?:peer|peerOptional) \S+ from (@?[^@\s]+)@/g)].map((m) => m[1]);
    const conflicting = [...text.matchAll(/Conflicting peer dependency: (@?[^@\s]+)@/g)].map((m) => m[1]);
    return { problem: "conflict", packages: [...new Set([...from, ...conflicting])], detail: "packages whose required versions conflict" };
  }
  return { problem: "unknown", packages: [], detail: "npm failed in a way this does not recognise" };
};

type Pkg = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> };

const depsOf = (pkg: Pkg) => ({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });

const SOURCE = /\.(m?[jt]sx?|cjs|vue|svelte)$/;
const SKIP = new Set(["node_modules", "dist", "build", ".git", ".next", "out", "coverage"]);

/** Every package the project's source imports or requires (exported for tests). Config files and scripts are checked in inUse(). */
export const namesInUse = (dir: string, limit = 4000): Set<string> => {
  const used = new Set<string>();
  const add = (spec: string) => {
    if (!spec || spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("node:")) return;
    const parts = spec.split("/");
    used.add(spec.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0]);
  };
  const scanText = (text: string) => {
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["']([^"'\n]+)["']/g)) add(m[1]);
  };
  let seen = 0;
  const stack = [dir];
  while (stack.length && seen < limit) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (SKIP.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (SOURCE.test(entry.name)) {
        seen++;
        try {
          scanText(fs.readFileSync(full, "utf8"));
        } catch {
          // unreadable file: skip
        }
      }
    }
  }
  return used;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether `name` is used, counting config mentions and the short names tools use for plugins. */
const inUse = (name: string, used: Set<string>, configText: string, scripts: string, eslintText = ""): boolean => {
  if (used.has(name)) return true;
  if (name.startsWith("@types/")) {
    const of = name.slice(7).replace(/^(.+)__(.+)$/, "@$1/$2");
    return used.has(of) || of === "node";
  }
  const short = name.replace(/^eslint-plugin-/, "").replace(/^@([^/]+)\/eslint-plugin$/, "@$1").replace(/^eslint-config-/, "");
  const quoted = (s: string, text: string) => new RegExp(`["'\\s/(]${escapeRe(s)}["'\\s/)]`).test(text);
  if (quoted(name, configText)) return true;
  // A plugin's short name ("react" for eslint-plugin-react) counts only in ESLint's own config, where it means the plugin.
  if (short !== name && quoted(short, eslintText)) return true;
  // A script that runs the tool by its command name (vitest, tsc for typescript, eslint…).
  const bin = name === "typescript" ? "tsc" : name.replace(/^@[^/]+\//, "");
  return new RegExp(`(^|[\\s&|;])${escapeRe(bin)}(\\s|$)`).test(scripts);
};

const readJson = (file: string): Pkg | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Pkg;
  } catch {
    return null;
  }
};

/** package.json as it was at a commit. */
const pkgAt = async (dir: string, ref: string): Promise<Pkg | null> => {
  try {
    const { stdout } = await run("git", ["-C", dir, "show", `${ref}:package.json`], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout) as Pkg;
  } catch {
    return null;
  }
};

/** The first commit of a working copy: its starting point. */
export const firstCommit = async (dir: string): Promise<string | null> => {
  try {
    const { stdout } = await run("git", ["-C", dir, "rev-list", "--max-parents=0", "HEAD"], { windowsHide: true });
    return stdout.trim().split("\n").pop() || null;
  } catch {
    return null;
  }
};

export const InstallDoctor = {
  diagnose: diagnoseInstall,

  /**
   * Repair package.json in `dir` from npm's `output`, against the baseline
   * commit (its package.json is what is known to have worked, or the start).
   * Writes package.json only; the caller commits and runs install again.
   */
  async repair(dir: string, output: string, baselineRef?: string | null, options: { dryRun?: boolean } = {}): Promise<InstallRepair> {
    const diagnosis = diagnoseInstall(output);
    const none = (summary: string): InstallRepair => ({ diagnosis, changed: false, removed: [], keptInUse: [], summary });
    if (diagnosis.problem === "environment") return none(`Install failed because of the PC (${diagnosis.detail}), not the project: nothing changed.`);
    const file = path.join(dir, "package.json");
    const pkg = readJson(file);
    if (!pkg) return none("No readable package.json.");
    const baseline = (await pkgAt(dir, baselineRef ?? (await firstCommit(dir)) ?? "HEAD")) ?? {};
    const before = depsOf(baseline);
    const now = depsOf(pkg);
    const added = Object.keys(now).filter((name) => !(name in before));
    const used = namesInUse(dir);
    const configText = fs
      .readdirSync(dir)
      .filter((name) => /^(\.eslintrc|\.prettierrc|tsconfig|jest\.config|vite\.config|vitest\.config|babel\.config|\.babelrc|postcss\.config)/.test(name))
      .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
      .join("\n");
    const scripts = Object.values(pkg.scripts ?? {}).join(" ; ");
    const eslintText = fs
      .readdirSync(dir)
      .filter((name) => /^(\.eslintrc|eslint\.config)/.test(name))
      .map((name) => fs.readFileSync(path.join(dir, name), "utf8"))
      .join("\n");
    const named = new Set(diagnosis.packages);
    const remove = new Set<string>();
    const keptInUse: string[] = [];
    for (const name of added) {
      if (named.has(name) && (diagnosis.problem === "missing-package" || diagnosis.problem === "no-such-version")) remove.add(name);
      else if (!inUse(name, used, configText, scripts, eslintText)) remove.add(name);
      else keptInUse.push(name);
    }
    // A package that does not exist is removed even if it was there from the start: it can never install.
    if (diagnosis.problem === "missing-package") for (const name of named) if (name in now && !used.has(name)) remove.add(name);
    if (!remove.size) return { ...none(`Nothing to remove: ${added.length ? `the ${added.length} package(s) added since the baseline are all used` : "no packages were added since the baseline"}.`), keptInUse };
    for (const name of remove) {
      delete pkg.dependencies?.[name];
      delete pkg.devDependencies?.[name];
    }
    if (!options.dryRun) fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
    const removed = [...remove].sort();
    return {
      diagnosis,
      changed: true,
      removed,
      keptInUse,
      summary: `npm failed on ${diagnosis.detail}${diagnosis.packages.length ? ` (${diagnosis.packages.join(", ")})` : ""}. Removed ${removed.length} package(s) added since the baseline that ${diagnosis.packages.some((p) => remove.has(p)) ? "caused it or " : ""}nothing in the project uses: ${removed.join(", ")}.${keptInUse.length ? ` Kept ${keptInUse.length} that the code uses.` : ""}`
    };
  }
};
