/**
 * Live previews: a template's site, or what a build has made, served by this
 * builder so the app can show it in a pane — no download, no opening files from
 * disk (which browsers refuse to run), and no waiting for anything to deploy.
 *
 *   GET /api/previews/template/:id     where the template's preview is, and whether it is ready
 *   GET /api/previews/build/:buildId   the same for a build
 *   GET /api/previews/project/:id      the same for a project on the PC
 *   POST /api/previews/project/:id/build  build a fresh preview of it, in a copy
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
 *
 * A project is shown from its own build output (dist/, out/ or build/) when it
 * has one. "Build a fresh preview" copies it (the files git would see) into
 * data/previews/projects/ and builds there, so previewing never writes a
 * thing into the project itself.
 */
import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import express, { type Express, type Request, type Response } from "express";

import { BuildService, type BuildAudit } from "../orchestrator/BuildService.js";
import { auditSite, findBrowser, renderPage } from "../orchestrator/SiteAudit.js";
import { Verifier } from "../orchestrator/Verifier.js";
import { Workspace } from "../orchestrator/Workspace.js";
import { Catalog } from "../orders/Catalog.js";
import { EcosystemStore } from "../ecosystem/EcosystemStore.js";
import { listProjectFiles } from "../ecosystem/ProjectBuilds.js";
import { Logger } from "../utils/Logger.js";
import { authenticateAgent } from "./agentAuth.js";
import { EDITOR_SCRIPT } from "./previewEditor.js";

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

type Kind = "template" | "build" | "project";
const KINDS: Kind[] = ["template", "build", "project"];

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
  // Vite's dist/, Next's static out/, Create React App's build/.
  for (const output of ["dist", "out", "build"]) {
    const built = path.join(folder, output);
    if (fs.existsSync(path.join(built, "index.html"))) return { root: built, reason: null };
  }
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

/**
 * Added to every previewed page: reports script errors, failed loads and
 * console.error to the pane showing it, so what breaks while you click through
 * shows up in the app (and can be handed to a fix pass). It only ever sends
 * error text, to the parent frame, and changes nothing on the page.
 */
const REPORTER = `<script data-agent-builder-preview>(function(){if(window.parent===window)return;var n=0;function send(kind,message){if(++n>50)return;try{parent.postMessage({type:"ab-preview-report",kind:kind,message:String(message).slice(0,400),page:location.hash||location.pathname.split("/").pop()||"/"},"*")}catch(e){}}window.addEventListener("error",function(e){var t=e.target;if(t&&t!==window&&(t.src||t.href)){send("resource","Could not load "+(t.src||t.href))}else{send("error",(e.message||"Script error")+(e.filename?" ("+(e.filename.split("?")[0].split("/").pop()||"page")+":"+e.lineno+")":""))}},true);window.addEventListener("unhandledrejection",function(e){var r=e.reason;send("error","Unhandled rejection: "+(r&&r.message?r.message:r))});var ce=console.error;console.error=function(){try{send("console",Array.prototype.map.call(arguments,function(a){return a&&a.message?a.message:String(a)}).join(" "))}catch(e){}return ce.apply(console,arguments)};window.addEventListener("load",function(){send("loaded",document.title||"")})})();</script>`;

/**
 * A site built for the root of a domain asks for "/assets/app.js", which from
 * inside /preview/…/ would ask the builder instead. Point those at the site's
 * own files, but only the ones that are really there.
 */
const rebase = (html: string, root: string, requested: string): string => {
  const depth = Math.max(0, requested.split("/").filter(Boolean).length - (requested.endsWith("/") ? 0 : 1));
  const prefix = depth ? "../".repeat(depth) : "./";
  return html.replace(/(\s(?:src|href)=["'])\/(?!\/)([^"'?#]*)/gi, (match, lead: string, rest: string) =>
    rest && fs.existsSync(path.join(root, rest)) ? `${lead}${prefix}${rest}` : match
  );
};

/** The error reporter goes first in <head>; the live editor's hands at the end of <body>. */
const withReporter = (html: string): string => {
  const reported = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (head) => `${head}${REPORTER}`) : `${REPORTER}${html}`;
  return /<\/body>/i.test(reported) ? reported.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${EDITOR_SCRIPT}</body>`) : `${reported}${EDITOR_SCRIPT}`;
};

/* ---------------- building a template's preview on demand ---------------- */

/** Newest change to a template's source, so a build older than it is rebuilt. */
const newestSource = (folder: string): number => {
  let newest = 0;
  const visit = (target: string) => {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(target);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(target)) {
        if (entry !== "node_modules" && entry !== "dist") visit(path.join(target, entry));
      }
    } else {
      newest = Math.max(newest, stat.mtimeMs);
    }
  };
  for (const entry of ["src", "index.html", "package.json", "vite.config.ts", "template.json"]) visit(path.join(folder, entry));
  return newest;
};

/** A template whose site was built before its code last changed (an update, an applied edit). */
const isStale = (folder: string): boolean => {
  const built = path.join(folder, "dist", "index.html");
  if (!fs.existsSync(built)) return false;
  return newestSource(folder) > fs.statSync(built).mtimeMs + 1000;
};

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

/* ---------------- a project's preview ---------------- */

const PROJECT_PREVIEWS = path.resolve("./data/previews/projects");

interface ProjectPreviewJob {
  state: "running" | "done" | "failed";
  startedAt: string;
  step: string;
  error: string | null;
}
const projectJobs = new Map<string, ProjectPreviewJob>();

const previewCopy = (id: string): string => path.join(PROJECT_PREVIEWS, id.replace(/[^a-zA-Z0-9_-]/g, "_"));

/**
 * What to show for a project: whichever is newer of its own build output and
 * a fresh preview built in a copy.
 */
const projectRoot = (id: string): { root: string | null; reason: string | null; from: "project" | "preview" | null } => {
  const project = EcosystemStore.getProject(id);
  if (!project) return { root: null, reason: "Unknown project.", from: null };
  const own = servable(project.path);
  const copy = fs.existsSync(previewCopy(id)) ? servable(previewCopy(id)) : { root: null, reason: null };
  const mtime = (root: string | null) => (root ? fs.statSync(path.join(root, "index.html")).mtimeMs : 0);
  if (copy.root && mtime(copy.root) >= mtime(own.root)) return { root: copy.root, reason: null, from: "preview" };
  if (own.root) return { root: own.root, reason: null, from: "project" };
  const buildable = fs.existsSync(path.join(project.path, "package.json"));
  return {
    root: null,
    from: null,
    reason: buildable
      ? "It has not been built, so there is no site to show yet. Build a fresh preview: it is made in a copy, the project is not touched."
      : own.reason
  };
};

const buildProjectPreview = (id: string, projectPath: string): void => {
  if (projectJobs.get(id)?.state === "running") return;
  const job: ProjectPreviewJob = { state: "running", startedAt: new Date().toISOString(), step: "Copying the project", error: null };
  projectJobs.set(id, job);
  const target = previewCopy(id);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  const options = { cwd: target, timeout: 15 * 60_000, maxBuffer: 32 * 1024 * 1024, windowsHide: true, shell: process.platform === "win32" };
  void (async () => {
    // Keep node_modules from last time (the slow part); everything else is fresh.
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(target)) {
      if (entry !== "node_modules") fs.rmSync(path.join(target, entry), { recursive: true, force: true });
    }
    const files = await listProjectFiles(projectPath);
    for (const file of files) {
      const to = path.join(target, file);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(projectPath, file), to);
    }
    const pkg = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    if (Object.keys(deps).length) {
      job.step = "Installing its packages (the first time takes a few minutes)";
      const ci = fs.existsSync(path.join(target, "package-lock.json")) && !fs.existsSync(path.join(target, "node_modules"));
      await run(npm, ci ? ["ci", "--no-audit", "--no-fund"] : ["install", "--no-audit", "--no-fund"], options);
    }
    job.step = "Building the site";
    const env = { ...process.env, BASE_PATH: "./", PUBLIC_URL: ".", NODE_ENV: "production" };
    if (deps.vite && !/next build|react-scripts/.test(pkg.scripts?.build ?? "")) {
      // Built to be served from any folder, not only the root of a domain.
      await run(npx, ["vite", "build", "--base", "./"], { ...options, env });
    } else if (pkg.scripts?.build) {
      await run(npm, ["run", "build"], { ...options, env });
    } else {
      throw new Error("It has no build script, and it is not a Vite project.");
    }
    if (!servable(target).root) throw new Error("It built, but made no index.html in dist/, out/ or build/ to show.");
    job.state = "done";
    job.step = "Ready";
    Logger.log("Project preview ready", { id });
  })().catch((error: unknown) => {
    const message = error instanceof Error ? (error as Error & { stderr?: string }).stderr || error.message : String(error);
    job.state = "failed";
    job.error = message.slice(-800);
    Logger.warn("Project preview build failed", { id, error: job.error });
  });
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
    // Built before its code last changed: rebuild, so the preview is what a
    // customer would get (and has the latest live editing), not yesterday's.
    if (fs.existsSync(path.join(folder, "package.json")) && (building.has(id) || (isStale(folder) && !buildErrors.has(id)))) {
      buildTemplate(id, folder);
      return res.json(
        describe("template", id, null, "Its code changed since the preview was built — rebuilding it, about a minute.", { preparing: true, failed: false })
      );
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

  app.get("/api/previews/project/:id", authenticateAgent("read"), (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    const { root, reason, from } = projectRoot(project.id);
    const job = projectJobs.get(project.id);
    const canBuild = fs.existsSync(path.join(project.path, "package.json"));
    res.json(
      describe("project", project.id, root, job?.state === "running" ? "Building a fresh preview in a copy of the project…" : reason, {
        version: root ? Math.round(fs.statSync(path.join(root, "index.html")).mtimeMs) : null,
        builtAt: root ? fs.statSync(path.join(root, "index.html")).mtime.toISOString() : null,
        from,
        canBuild,
        preparing: job?.state === "running",
        failed: job?.state === "failed",
        job: job ?? null
      })
    );
  });

  /** Build a fresh preview of a project in a copy of it. The project itself is not touched. */
  app.post("/api/previews/project/:id/build", authenticateAgent("execute"), (req: Request, res: Response) => {
    const project = EcosystemStore.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: "Unknown project." });
    if (!fs.existsSync(path.join(project.path, "package.json"))) {
      return res.status(400).json({ error: "This project has no package.json, so there is nothing to build — it is shown as it is." });
    }
    buildProjectPreview(project.id, project.path);
    res.json({ success: true, preparing: true });
  });

  // The sites themselves. Only after the token checks out does anything on disk get looked at.
  app.use("/preview/:kind/:id/:token", (req: Request, res: Response, next) => {
    const kind = req.params.kind as Kind;
    const { id, token } = req.params;
    if (!KINDS.includes(kind) || !tokenMatches(kind, id, token)) {
      return res.status(404).send("Not found");
    }
    let root: string | null;
    if (kind === "project") root = projectRoot(id).root;
    else {
      const folder = kind === "template" ? templateFolder(id) : BuildService.view(id)?.outputDir ?? null;
      root = folder ? servable(folder).root : null;
    }
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
    // Pages get the error reporter; everything else is served as it is.
    const requested = decodeURIComponent(req.path);
    if (requested.endsWith("/") || requested.endsWith(".html")) {
      const file = path.resolve(root, `.${requested.endsWith("/") ? `${requested}index.html` : requested}`);
      const inside = file === root || file.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
      if (inside && fs.existsSync(file) && fs.statSync(file).isFile()) {
        return res.type("html").send(withReporter(rebase(fs.readFileSync(file, "utf8"), root, requested)));
      }
    }
    express.static(root, { index: "index.html", dotfiles: "deny", fallthrough: false })(req, res, next);
  });

  /**
   * Test & audit what a build made: its own checks again (install, typecheck,
   * build, tests, lint — never scaffolding anything into it), then the built
   * site read for what a visitor would trip over, plus whatever the preview
   * reported while someone clicked through it. Kept with the build.
   * POST /api/autonomous/:buildId/audit  Body: { runtime?: [{ kind, message, page }] }
   */
  const auditing = new Set<string>();
  app.post("/api/autonomous/:buildId/audit", authenticateAgent("execute"), async (req: Request, res: Response) => {
    const build = BuildService.view(req.params.buildId);
    if (!build) return res.status(404).json({ error: "Unknown build." });
    if (BuildService.isRunning(build.buildId)) {
      return res.status(409).json({ error: "It is still building, and every pass already runs these checks. Pause or stop it to audit it now." });
    }
    if (!build.outputDir || !fs.existsSync(build.outputDir)) return res.status(404).json({ error: "Its folder is not there any more." });
    if (auditing.has(build.buildId)) return res.status(409).json({ error: "An audit of this build is already running." });

    const runtime = (Array.isArray(req.body?.runtime) ? req.body.runtime : [])
      .slice(0, 30)
      .filter((entry: unknown) => entry && typeof (entry as { message?: unknown }).message === "string")
      .map((entry: { kind?: unknown; message: string; page?: unknown }) => ({
        kind: typeof entry.kind === "string" ? entry.kind.slice(0, 20) : "error",
        message: entry.message.slice(0, 400),
        page: typeof entry.page === "string" ? entry.page.slice(0, 120) : undefined
      }));

    auditing.add(build.buildId);
    try {
      const report = await Verifier.verify(new Workspace(build.outputDir), { scaffoldTests: false });
      // After the checks, since the build check is what produces dist/.
      const { root } = servable(build.outputDir);
      // Render the start page in a real browser when there is one: an app built
      // with React is an empty shell in its markup, and only a browser shows what
      // it draws and which errors it throws while loading.
      const rendered = new Map<string, string>();
      const loadErrors: Array<{ kind: string; message: string; page?: string }> = [];
      const browser = root ? findBrowser() : null;
      if (root && browser) {
        const port = Number(process.env.PORT) || 4000;
        const url = `http://127.0.0.1:${port}/preview/build/${encodeURIComponent(build.buildId)}/${tokenFor("build", build.buildId)}/`;
        const page = await renderPage(browser, url);
        if (page?.dom) {
          rendered.set(path.join(root, "index.html"), page.dom);
          for (const message of page.errors) loadErrors.push({ kind: "error", message, page: "load" });
        }
      }
      const site = root ? auditSite(root, rendered) : { findings: [], pages: 0, files: 0 };
      const audit: BuildAudit = {
        at: new Date().toISOString(),
        passed: report.passed,
        score: report.score,
        checks: report.checks.map((check) => ({ name: check.name, applicable: check.applicable, passed: check.passed, durationMs: check.durationMs })),
        blocker: report.blockingCheck ? { name: report.blockingCheck.name, output: report.blockingCheck.output.slice(-2500) } : null,
        findings: site.findings.slice(0, 60),
        runtime: [...loadErrors, ...runtime].slice(0, 40),
        pages: site.pages,
        site: Boolean(root),
        rendered: rendered.size > 0
      };
      BuildService.recordAudit(build.buildId, audit);
      res.json({ audit });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      auditing.delete(build.buildId);
    }
  });

  Logger.log("Preview routes registered");
};
