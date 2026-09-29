/**
 * Live previews: a template's site, or what a build has made, served by this
 * builder so the app can show it in a pane — no download, no opening files from
 * disk (which browsers refuse to run), and no waiting for anything to deploy.
 *
 *   GET /api/previews/template/:id     where the template's preview is, and whether it is ready
 *   GET /api/previews/build/:buildId   the same for a build
 *   GET /preview/:kind/:id/:token/…    the site itself
 *
 * An <iframe> cannot send the agent key, so the site is served under a token in
 * the path instead: an HMAC of what it shows, so it opens that one preview and
 * nothing else, and relative asset paths (./assets/…) inherit it. The token
 * comes only from the authenticated routes above.
 *
 * What is served is the built site: dist/ when there is one (every template and
 * most builds, since the Verifier runs the build), otherwise the folder itself
 * when it is a plain static site. A Vite project's own index.html points at
 * /src/main.tsx and would be blank, so it is never served unbuilt: a template
 * without a build is built once, in the background, while the pane says so.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import express, { type Express, type Request, type Response } from "express";

import { BuildService } from "../orchestrator/BuildService.js";
import { Catalog } from "../orders/Catalog.js";
import { Logger } from "../utils/Logger.js";
import { authenticateAgent } from "./agentAuth.js";

const run = promisify(execFile);
const SECRET_PATH = path.resolve("./data/preview-secret");

/** Kept on disk so preview links survive a restart of the builder. */
const secret = (() => {
  try {
    const existing = fs.readFileSync(SECRET_PATH, "utf8").trim();
    if (existing.length >= 32) return existing;
  } catch {
    // First run.
  }
  const fresh = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
    fs.writeFileSync(SECRET_PATH, fresh, { mode: 0o600 });
  } catch (error) {
    Logger.warn("Preview links will change on restart: could not save their secret", { error: String(error) });
  }
  return fresh;
})();

type Kind = "template" | "build";

const tokenFor = (kind: Kind, id: string): string =>
  crypto.createHmac("sha256", secret).update(`${kind}:${id}`).digest("base64url").slice(0, 32);

const tokenMatches = (kind: Kind, id: string, token: string): boolean => {
  const expected = Buffer.from(tokenFor(kind, id));
  const given = Buffer.from(token);
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

/** A Vite (or similar) source page: its scripts point at source files, so it is blank until built. */
const isSourceIndex = (html: string): boolean => /<script[^>]+src="\/?src\/[^"]+\.(t|j)sx?"/i.test(html);

/** The folder to serve for a project folder, or why there is none yet. */
const servable = (folder: string): { root: string | null; reason: string | null } => {
  if (!folder || !fs.existsSync(folder)) return { root: null, reason: "Its folder is not there." };
  const dist = path.join(folder, "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) return { root: dist, reason: null };
  const index = path.join(folder, "index.html");
  if (fs.existsSync(index)) {
    if (!isSourceIndex(fs.readFileSync(index, "utf8"))) return { root: folder, reason: null };
    return { root: null, reason: "It has not been built yet, so there is no site to show. It appears once a pass builds it." };
  }
  return { root: null, reason: "There is no web page in it yet (no index.html)." };
};

const templateFolder = (id: string): string | null => {
  const template = Catalog.all().find((item) => item.id === id);
  return template?.sourcePath && fs.existsSync(template.sourcePath) ? template.sourcePath : null;
};

/* ---------------- building a template's preview on demand ---------------- */

const building = new Map<string, Promise<void>>();
const buildErrors = new Map<string, string>();

const buildTemplate = (id: string, folder: string): void => {
  if (building.has(id)) return;
  buildErrors.delete(id);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const options = { cwd: folder, timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: process.platform === "win32" };
  const job = (async () => {
    Logger.log("Building a template preview", { id });
    if (!fs.existsSync(path.join(folder, "node_modules"))) {
      await run(npm, ["install", "--no-audit", "--no-fund"], options);
    }
    await run(npm, ["run", "build"], { ...options, env: { ...process.env, BASE_PATH: "./" } });
    Logger.log("Template preview ready", { id });
  })()
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      buildErrors.set(id, message.slice(-600));
      Logger.warn("Template preview build failed", { id, error: message.slice(-600) });
    })
    .finally(() => building.delete(id));
  building.set(id, job);
};

/* ---------------- routes ---------------- */

const describe = (kind: Kind, id: string, root: string | null, reason: string | null, extra: Record<string, unknown> = {}) => ({
  kind,
  id,
  ready: Boolean(root),
  url: root ? `/preview/${kind}/${encodeURIComponent(id)}/${tokenFor(kind, id)}/` : null,
  reason,
  ...extra
});

export const registerPreviewRoutes = (app: Express) => {
  app.get("/api/previews/template/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const id = req.params.id;
    const folder = templateFolder(id);
    if (!folder) {
      const template = Catalog.all().find((item) => item.id === id);
      if (!template) return res.status(404).json({ error: "Unknown template." });
      return res.json(describe("template", id, null, "This template has no code yet, so there is nothing to preview.", { hosted: template.previewUrl ?? null }));
    }
    const { root, reason } = servable(folder);
    if (!root && fs.existsSync(path.join(folder, "package.json"))) {
      // Build it now; the pane shows that it is preparing and asks again.
      buildTemplate(id, folder);
      return res.json(
        describe("template", id, null, buildErrors.get(id) ? `The preview did not build: ${buildErrors.get(id)}` : "Preparing the preview — building the site once, about a minute.", {
          preparing: building.has(id),
          failed: buildErrors.has(id)
        })
      );
    }
    res.json(describe("template", id, root, reason));
  });

  /** Rebuild a template's preview, after its code has changed. */
  app.post("/api/previews/template/:id/rebuild", authenticateAgent("execute"), (req: Request, res: Response) => {
    const folder = templateFolder(req.params.id);
    if (!folder) return res.status(404).json({ error: "That template has no code." });
    buildTemplate(req.params.id, folder);
    res.json({ success: true, preparing: true });
  });

  app.get("/api/previews/build/:buildId", authenticateAgent("read"), (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    const { root, reason } = servable(build.outputDir);
    // The folder changes every pass; the app reloads the pane when it sees a new one.
    const version = root ? Math.round(fs.statSync(path.join(root, "index.html")).mtimeMs) : null;
    res.json(describe("build", build.buildId, root, reason, { version, live: build.live }));
  });

  // The sites themselves. Only after the token checks out does anything on disk get looked at.
  app.use("/preview/:kind/:id/:token", (req: Request, res: Response, next) => {
    const kind = req.params.kind as Kind;
    const { id, token } = req.params;
    if ((kind !== "template" && kind !== "build") || !tokenMatches(kind, id, token)) {
      return res.status(404).send("Not found");
    }
    const folder = kind === "template" ? templateFolder(id) : BuildService.view(id)?.outputDir ?? null;
    const { root } = folder ? servable(folder) : { root: null };
    if (!root) {
      return res
        .status(404)
        .type("html")
        .send(`<!doctype html><meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:2rem;color:#555">There is nothing to preview yet.</body>`);
    }
    // Never show a preview's .git, node_modules or source maps of the builder itself.
    if (/(^|\/)(\.git|node_modules)(\/|$)/.test(req.path)) return res.status(404).send("Not found");
    // The pane is sandboxed, so its requests come from origin "null", and module
    // scripts (what Vite emits) are always fetched in CORS mode: without this
    // the page loads and stays blank. The files are read-only and already behind
    // the token.
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.removeHeader("Access-Control-Allow-Credentials");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Robots-Tag", "noindex");
    express.static(root, { index: "index.html", dotfiles: "deny", fallthrough: false })(req, res, next);
  });

  Logger.log("Preview routes registered");
};
