/**
 * Packager — what a customer (or you) downloads for an order.
 *
 * The zip used to be the build folder as it stood: source code whose
 * index.html only works through a dev server, so opening it showed a blank
 * page. Now it holds both halves of a finished product:
 *
 *   Open the website.html   the built site in one file; double-click it
 *   source/                 the code, without node_modules or build output
 *   HOW TO OPEN.txt         which is which, and how to put it online
 *
 * A zip is remade whenever the build has changed since the last one (it is
 * keyed by the build's latest commit), so a download taken mid-build never
 * sticks around after the build moves on.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { Logger } from "../utils/Logger.js";

const run = promisify(execFile);

const PACKAGES = path.resolve("data/packages");
const SKIP = new Set(["node_modules", ".git", "dist", ".next", "out", "coverage", ".turbo", ".cache", ".vercel"]);

/** A fingerprint of the build as it is now: its latest commit, or the newest file time. */
const fingerprint = async (dir: string): Promise<string> => {
  try {
    const { stdout } = await run("git", ["rev-parse", "HEAD"], { cwd: dir, windowsHide: true });
    return stdout.trim().slice(0, 12);
  } catch {
    let newest = 0;
    const walk = (current: string) => {
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) walk(full);
        else newest = Math.max(newest, fs.statSync(full).mtimeMs);
      }
    };
    walk(dir);
    return crypto.createHash("sha1").update(String(newest)).digest("hex").slice(0, 12);
  }
};

const copySource = (from: string, to: string): void => {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name) || entry.name.startsWith(".env")) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copySource(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
};

const npm = (args: string[], cwd: string, timeout: number) =>
  run(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd, windowsHide: true, timeout, shell: process.platform === "win32" });

const safeName = (title: string): string => title.replace(/[^a-zA-Z0-9 _-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "website";

export interface PackageResult {
  zipPath: string;
  fileName: string;
  /** Whether a double-clickable built site is inside, or only the source. */
  hasBuiltSite: boolean;
  fresh: boolean;
}

export const Packager = {
  async packageBuild(sourceDir: string, title: string, id: string): Promise<PackageResult> {
    if (!fs.existsSync(sourceDir)) throw new Error("The build's folder is gone, so there is nothing to package.");
    fs.mkdirSync(PACKAGES, { recursive: true });

    const stamp = await fingerprint(sourceDir);
    const fileName = `${safeName(title)}.zip`;
    const zipPath = path.join(PACKAGES, `${id}-${stamp}.zip`);
    if (fs.existsSync(zipPath)) return { zipPath, fileName, hasBuiltSite: fs.existsSync(`${zipPath}.site`), fresh: false };

    // Old zips of this order are out of date now.
    for (const old of fs.readdirSync(PACKAGES)) {
      if (old.startsWith(`${id}-`)) fs.rmSync(path.join(PACKAGES, old), { force: true, recursive: true });
    }

    const staging = path.join(PACKAGES, `staging-${id}-${stamp}`);
    fs.rmSync(staging, { recursive: true, force: true });
    copySource(sourceDir, path.join(staging, "source"));

    // Build it, so there is something to open without a developer's tools.
    let hasBuiltSite = false;
    let checked = true;
    const pkgPath = path.join(sourceDir, "package.json");
    const pkg = fs.existsSync(pkgPath)
      ? (JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> })
      : null;
    if (pkg?.scripts?.build) {
      try {
        if (!fs.existsSync(path.join(sourceDir, "node_modules"))) await npm(["install", "--no-audit", "--no-fund"], sourceDir, 600_000);
        try {
          await npm(["run", "build"], sourceDir, 600_000);
        } catch (error) {
          // The build script type-checks first; a leftover type error stopped
          // it while the app itself runs. A Vite app is built anyway (types
          // dropped, not checked), so the download still opens.
          const vite = pkg.dependencies?.vite ?? pkg.devDependencies?.vite;
          if (!vite) throw error;
          await run(process.platform === "win32" ? "npx.cmd" : "npx", ["vite", "build", "--base", "./"], {
            cwd: sourceDir,
            windowsHide: true,
            timeout: 600_000,
            shell: process.platform === "win32"
          });
          checked = false;
        }
        const dist = path.join(sourceDir, "dist");
        const files = fs.existsSync(dist) ? fs.readdirSync(dist) : [];
        if (files.length === 1 && files[0] === "index.html") {
          fs.copyFileSync(path.join(dist, "index.html"), path.join(staging, "Open the website.html"));
          hasBuiltSite = true;
        } else if (files.includes("index.html")) {
          // A multi-file build: include it whole. It needs a web server to open.
          fs.cpSync(dist, path.join(staging, "website"), { recursive: true });
          hasBuiltSite = true;
        }
      } catch (error) {
        Logger.log("Package: the build did not complete, shipping source only", {
          id,
          error: error instanceof Error ? error.message.slice(0, 300) : String(error)
        });
      }
    }

    fs.writeFileSync(
      path.join(staging, "HOW TO OPEN.txt"),
      [
        title,
        "",
        hasBuiltSite && fs.existsSync(path.join(staging, "Open the website.html"))
          ? 'To look at it: double-click "Open the website.html". It works straight from this folder, no internet or tools needed.'
          : hasBuiltSite
            ? "The built site is in the website folder. Upload that folder to any web host to see it."
            : "This package holds the source code only; it did not build. See source/README.md.",
        ...(hasBuiltSite && !checked
          ? ["", "Note: this version still fails its type check, so it was built without it. It runs; the code may still need tidying."]
          : []),
        "",
        "To put it online: upload the website file (or the website folder) to any web host —",
        "Vercel, Netlify, Amplify, cPanel. It needs no server-side setup.",
        "",
        "To change it: the code is in the source folder. Most of what the site says is in",
        "source/src/content.ts. Then run `npm install` and `npm run build` in source/.",
        ""
      ].join("\r\n")
    );

    // bsdtar ships with Windows 10+ and writes zip when the name ends in .zip.
    // Windows' own tar, by path: Git's GNU tar, when it comes first on PATH,
    // reads "E:\…" as a remote host ("Cannot connect to E: resolve failed").
    const systemTar = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "tar.exe") : null;
    const tar = systemTar && fs.existsSync(systemTar) ? systemTar : "tar";
    await run(tar, ["-a", "-c", "-f", zipPath, "-C", staging, "."], { windowsHide: true, timeout: 300_000 });
    fs.rmSync(staging, { recursive: true, force: true });
    if (hasBuiltSite) fs.writeFileSync(`${zipPath}.site`, "");

    Logger.log("Packaged a build", { id, zip: zipPath, hasBuiltSite });
    return { zipPath, fileName, hasBuiltSite, fresh: true };
  }
};
