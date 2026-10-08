/**
 * AppBuilder — a finished website as an app: an Android APK (Capacitor) and a
 * Windows program (Tauri), made on this PC from the build's built site.
 *
 * The packaging this replaces ran `pkg` (a bundler for Node command-line
 * programs) over React web apps, which made nothing usable. These are the
 * toolchains this PC already ships Moswords (Android) and Agent Builder itself
 * (Tauri) with:
 *
 *   android   Capacitor shell around the site → app-debug.apk, installable on
 *             any Android phone (sideloaded; a Play Store release needs the
 *             customer's own signing key).
 *   windows   Tauri shell → one .exe, no installer needed (Windows 10/11 have
 *             the WebView2 it runs on).
 *
 * One shell project per platform under data/apps is reused for every app, and
 * the Rust build shares one target folder, so only the first app is slow
 * (~3 minutes for Windows); later ones reuse what was compiled. App builds run
 * one at a time, in the background: a request through the tunnel cannot wait
 * minutes, so callers start one, poll its status, then download the file.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { Logger } from "../utils/Logger.js";
import { accentOf, iconPng } from "./AppIcons.js";
import { Packager } from "./Packager.js";

const run = promisify(execFile);
const isWindows = process.platform === "win32";

export type AppPlatform = "android" | "windows";
export const APP_PLATFORMS: AppPlatform[] = ["android", "windows"];

export interface AppJob {
  buildId: string;
  platform: AppPlatform;
  state: "building" | "ready" | "failed";
  startedAt: string;
  finishedAt: string | null;
  /** The finished file, when ready. */
  file: string | null;
  fileName: string | null;
  error: string | null;
  /** What it is doing, in a few words, while it builds. */
  stage: string;
}

const APPS = path.resolve(process.env.APPS_DIR ?? "data/apps");
const TARGET = path.resolve(process.env.APP_TARGET_DIR ?? "data/app-target");

const jobs = new Map<string, AppJob>();
let queue: Promise<unknown> = Promise.resolve();

const key = (buildId: string, platform: AppPlatform) => `${buildId}:${platform}`;
const shell = (platform: AppPlatform) => path.join(APPS, `_${platform}-shell`);

/** A name a file system, a package id and a Cargo crate all accept. */
export const appNames = (title: string): { display: string; slug: string; id: string } => {
  const display = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "").trim().slice(0, 60) || "App";
  const slug = display.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";
  // Java package segments may not start with a digit or be a keyword.
  const segment = slug.replace(/-/g, "").replace(/^(\d)/, "app$1").slice(0, 30) || "app";
  return { display, slug: /^[a-z]/.test(slug) ? slug : `app-${slug}`, id: `za.co.arpcloud.${segment}` };
};

const npm = (args: string[], cwd: string, timeout = 900_000) => run(isWindows ? "npm.cmd" : "npm", args, { cwd, windowsHide: true, timeout, shell: isWindows, maxBuffer: 32 * 1024 * 1024 });
const npx = (args: string[], cwd: string, env: NodeJS.ProcessEnv = {}, timeout = 1_800_000) =>
  run(isWindows ? "npx.cmd" : "npx", args, { cwd, windowsHide: true, timeout, shell: isWindows, env: { ...process.env, ...env }, maxBuffer: 32 * 1024 * 1024 });

const replaceIn = (file: string, edits: Array<[RegExp, string]>) => {
  let text = fs.readFileSync(file, "utf8");
  for (const [pattern, value] of edits) text = text.replace(pattern, value);
  fs.writeFileSync(file, text);
};

/** The site to wrap, as one folder with an index.html. */
const siteFor = async (sourceDir: string, buildId: string): Promise<string> => {
  const built = await Packager.buildWebsite(sourceDir, buildId);
  if (!built) throw new Error("The website did not build, so there is nothing to make an app from.");
  return built.dist;
};

const ensureAndroidShell = async (job: AppJob): Promise<string> => {
  const dir = shell("android");
  if (fs.existsSync(path.join(dir, "android", "gradlew.bat")) || fs.existsSync(path.join(dir, "android", "gradlew"))) return dir;
  job.stage = "setting up Android (first app only)";
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "www"), { recursive: true });
  fs.writeFileSync(path.join(dir, "www", "index.html"), "<!doctype html><title>App</title>");
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "app-shell", private: true, version: "1.0.0", dependencies: { "@capacitor/android": "^8.2.0", "@capacitor/cli": "^8.2.0", "@capacitor/core": "^8.2.0" } }, null, 2)
  );
  fs.writeFileSync(path.join(dir, "capacitor.config.json"), JSON.stringify({ appId: "za.co.arpcloud.app", appName: "App", webDir: "www" }, null, 2));
  await npm(["install", "--no-audit", "--no-fund"], dir);
  await npx(["cap", "add", "android"], dir);
  return dir;
};

const ensureWindowsShell = async (job: AppJob): Promise<string> => {
  const dir = shell("windows");
  if (fs.existsSync(path.join(dir, "node_modules", "@tauri-apps", "cli"))) return dir;
  job.stage = "setting up Windows (first app only)";
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "src-tauri", "src"), { recursive: true });
  fs.mkdirSync(path.join(dir, "www"), { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "app-shell", private: true, version: "1.0.0", devDependencies: { "@tauri-apps/cli": "^2.1.0" } }, null, 2));
  fs.writeFileSync(path.join(dir, "src-tauri", "build.rs"), "fn main() {\n    tauri_build::build()\n}\n");
  fs.writeFileSync(
    path.join(dir, "src-tauri", "src", "main.rs"),
    '#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]\n\nfn main() {\n    tauri::Builder::default()\n        .run(tauri::generate_context!())\n        .expect("error while running the app");\n}\n'
  );
  await npm(["install", "--no-audit", "--no-fund"], dir);
  return dir;
};

const buildAndroid = async (job: AppJob, sourceDir: string, title: string): Promise<{ file: string; fileName: string }> => {
  const site = await siteFor(sourceDir, job.buildId);
  const dir = await ensureAndroidShell(job);
  const names = appNames(title);
  job.stage = "putting the site in the app";
  fs.rmSync(path.join(dir, "www"), { recursive: true, force: true });
  fs.cpSync(site, path.join(dir, "www"), { recursive: true });
  fs.writeFileSync(path.join(dir, "capacitor.config.json"), JSON.stringify({ appId: names.id, appName: names.display, webDir: "www" }, null, 2));
  await npx(["cap", "sync", "android"], dir);
  // The name on the phone and the app's id, and its icon in the brand's colour.
  const res = path.join(dir, "android", "app", "src", "main", "res");
  const escaped = names.display.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/'/g, "\\'");
  replaceIn(path.join(res, "values", "strings.xml"), [
    [/(<string name="app_name">)[^<]*(<\/string>)/, `$1${escaped}$2`],
    [/(<string name="title_activity_main">)[^<]*(<\/string>)/, `$1${escaped}$2`]
  ]);
  replaceIn(path.join(dir, "android", "app", "build.gradle"), [[/applicationId\s+"[^"]+"/, `applicationId "${names.id}"`]]);
  const icons = path.join(APPS, `icons-${job.buildId}`);
  fs.rmSync(icons, { recursive: true, force: true });
  fs.mkdirSync(icons, { recursive: true });
  fs.writeFileSync(path.join(icons, "icon.png"), iconPng(accentOf(sourceDir)));
  // Tauri's icon tool makes every Android launcher size from one picture.
  const tauri = await ensureWindowsShell(job).catch(() => null);
  if (tauri) {
    await npx(["tauri", "icon", path.join(icons, "icon.png"), "-o", icons], tauri).catch(() => undefined);
    const androidIcons = path.join(icons, "android");
    if (fs.existsSync(androidIcons)) {
      for (const folder of fs.readdirSync(androidIcons)) {
        if (!fs.existsSync(path.join(res, folder))) continue;
        for (const file of fs.readdirSync(path.join(androidIcons, folder))) fs.copyFileSync(path.join(androidIcons, folder, file), path.join(res, folder, file));
      }
    }
  }
  job.stage = "building the Android app";
  const android = path.join(dir, "android");
  // By its full path: with NoDefaultCurrentDirectoryInExePath set, cmd does not look in the current folder.
  if (isWindows) await run("cmd.exe", ["/c", path.join(android, "gradlew.bat"), "assembleDebug", "--no-daemon", "-q"], { cwd: android, windowsHide: true, timeout: 1_800_000, maxBuffer: 32 * 1024 * 1024 });
  else await run("./gradlew", ["assembleDebug", "--no-daemon", "-q"], { cwd: android, timeout: 1_800_000, maxBuffer: 32 * 1024 * 1024 });
  const apk = path.join(android, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
  if (!fs.existsSync(apk)) throw new Error("Gradle finished without an APK.");
  const out = path.join(APPS, job.buildId);
  fs.mkdirSync(out, { recursive: true });
  const fileName = `${names.display}.apk`;
  fs.copyFileSync(apk, path.join(out, fileName));
  return { file: path.join(out, fileName), fileName };
};

const buildWindows = async (job: AppJob, sourceDir: string, title: string): Promise<{ file: string; fileName: string }> => {
  const site = await siteFor(sourceDir, job.buildId);
  const dir = await ensureWindowsShell(job);
  const names = appNames(title);
  job.stage = "putting the site in the app";
  fs.rmSync(path.join(dir, "www"), { recursive: true, force: true });
  fs.cpSync(site, path.join(dir, "www"), { recursive: true });
  const crate = names.slug.replace(/^[^a-z]+/, "") || "app";
  fs.writeFileSync(
    path.join(dir, "src-tauri", "Cargo.toml"),
    `[package]\nname = "${crate}"\nversion = "1.0.0"\nedition = "2021"\n\n[build-dependencies]\ntauri-build = { version = "2", features = [] }\n\n[dependencies]\ntauri = { version = "2", features = [] }\n\n[profile.release]\nstrip = true\nlto = true\nopt-level = "s"\n`
  );
  fs.writeFileSync(
    path.join(dir, "src-tauri", "tauri.conf.json"),
    JSON.stringify(
      {
        $schema: "https://schema.tauri.app/config/2",
        productName: names.display,
        version: "1.0.0",
        identifier: names.id,
        build: { frontendDist: "../www" },
        app: { windows: [{ title: names.display, width: 1200, height: 800, resizable: true }], security: { csp: null } },
        bundle: { active: false, icon: ["icons/icon.ico", "icons/icon.png"] }
      },
      null,
      2
    )
  );
  const icons = path.join(dir, "src-tauri", "icons");
  fs.rmSync(icons, { recursive: true, force: true });
  fs.mkdirSync(icons, { recursive: true });
  fs.writeFileSync(path.join(dir, "icon-source.png"), iconPng(accentOf(sourceDir)));
  await npx(["tauri", "icon", "icon-source.png", "-o", icons], dir);
  job.stage = "building the Windows app";
  await npx(["tauri", "build", "--no-bundle"], dir, { CARGO_TARGET_DIR: TARGET });
  const exe = path.join(TARGET, "release", `${crate}.exe`);
  if (!fs.existsSync(exe)) throw new Error("The Windows build finished without a program.");
  const out = path.join(APPS, job.buildId);
  fs.mkdirSync(out, { recursive: true });
  const fileName = `${names.display}.exe`;
  fs.copyFileSync(exe, path.join(out, fileName));
  return { file: path.join(out, fileName), fileName };
};

export const AppBuilder = {
  /** Where an app build for this build and platform stands, or null when none was asked for. */
  status(buildId: string, platform: AppPlatform): AppJob | null {
    return jobs.get(key(buildId, platform)) ?? null;
  },

  /**
   * Start making the app (or return the one in progress or done). Only one
   * app builds at a time: both toolchains are heavy, and the shells are shared.
   */
  start(buildId: string, platform: AppPlatform, sourceDir: string, title: string): AppJob {
    const existing = jobs.get(key(buildId, platform));
    if (existing && (existing.state === "building" || (existing.state === "ready" && existing.file && fs.existsSync(existing.file)))) return existing;
    const job: AppJob = { buildId, platform, state: "building", startedAt: new Date().toISOString(), finishedAt: null, file: null, fileName: null, error: null, stage: "waiting its turn" };
    jobs.set(key(buildId, platform), job);
    queue = queue.then(async () => {
      try {
        fs.mkdirSync(APPS, { recursive: true });
        const made = platform === "android" ? await buildAndroid(job, sourceDir, title) : await buildWindows(job, sourceDir, title);
        Object.assign(job, { state: "ready", file: made.file, fileName: made.fileName, stage: "done", finishedAt: new Date().toISOString() });
        Logger.log("Made an app", { buildId, platform, file: made.file });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Object.assign(job, { state: "failed", error: message.slice(0, 600), stage: "failed", finishedAt: new Date().toISOString() });
        Logger.error("Could not make the app", { buildId, platform, error: message.slice(0, 600) });
      }
    });
    return job;
  },

  /** Make the app and wait for it: for scripts and tests, not for web requests. */
  async make(buildId: string, platform: AppPlatform, sourceDir: string, title: string): Promise<AppJob> {
    AppBuilder.start(buildId, platform, sourceDir, title);
    await queue;
    return jobs.get(key(buildId, platform))!;
  }
};
