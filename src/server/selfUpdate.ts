/**
 * Keeping the builder on the PC up to date from the app.
 *
 *   GET  /api/power/version   which code it runs, and what is newer on GitHub
 *   POST /api/power/update    pull it in, install, rebuild the app, restart
 *   GET  /api/power/update    how the update is going
 *
 * The app on Vercel updates itself on every merge; the builder on the PC only
 * when someone pulls there. When they drift apart, new screens call routes the
 * builder does not have yet. This closes that gap.
 *
 * It only ever fast-forwards the branch the PC is on to the one it tracks on
 * GitHub: local commits or uncommitted edits that the update would touch make
 * git refuse, and the update stops and says so — nothing is overwritten.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";
import type { Express, Request, Response } from "express";

import { authenticateAgent, type AgentRequest } from "./agentAuth.js";
import { launcherRunning } from "./powerTools.js";
import { BuildService } from "../orchestrator/BuildService.js";
import { Logger } from "../utils/Logger.js";

const exec = promisify(execFile);
const ROOT = process.cwd();
const FETCH_EVERY_MS = 10 * 60 * 1000;
const isWindows = process.platform === "win32";

const git = async (args: string[], timeout = 60_000): Promise<string> =>
  (await exec("git", args, { cwd: ROOT, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();

const npm = (args: string[], cwd: string) =>
  exec(isWindows ? "npm.cmd" : "npm", args, { cwd, timeout: 15 * 60_000, windowsHide: true, shell: isWindows, maxBuffer: 32 * 1024 * 1024 });

export interface VersionInfo {
  available: boolean;
  reason: string | null;
  commit: string | null;
  subject: string | null;
  date: string | null;
  branch: string | null;
  upstream: string | null;
  /** Files changed on the PC and not committed. */
  dirty: number;
  behind: number;
  ahead: number;
  incoming: Array<{ commit: string; subject: string; date: string }>;
  checkedAt: string | null;
  fetchError: string | null;
}

let lastFetch = 0;
let lastFetchError: string | null = null;

export const readVersion = async (refresh: boolean): Promise<VersionInfo> => {
  const empty: VersionInfo = {
    available: false,
    reason: null,
    commit: null,
    subject: null,
    date: null,
    branch: null,
    upstream: null,
    dirty: 0,
    behind: 0,
    ahead: 0,
    incoming: [],
    checkedAt: null,
    fetchError: null
  };
  if (!fs.existsSync(path.join(ROOT, ".git"))) return { ...empty, reason: "The builder is not running from a git checkout, so it cannot update itself." };

  const [head, branch] = await Promise.all([git(["log", "-1", "--format=%h%x1f%s%x1f%cI"]), git(["rev-parse", "--abbrev-ref", "HEAD"])]);
  const [commit, subject, date] = head.split("\x1f");
  const dirty = (await git(["status", "--porcelain", "--untracked-files=no"])).split("\n").filter(Boolean).length;
  let upstream: string | null = null;
  try {
    upstream = await git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  } catch {
    return { ...empty, commit, subject, date, branch, dirty, reason: `The branch ${branch} does not track a branch on GitHub.` };
  }

  if (refresh || Date.now() - lastFetch > FETCH_EVERY_MS) {
    const [remote, ...rest] = upstream.split("/");
    try {
      await git(["fetch", "--quiet", remote, rest.join("/")], 90_000);
      lastFetchError = null;
    } catch (error) {
      lastFetchError = error instanceof Error ? error.message.split("\n").slice(-2).join(" ").slice(0, 300) : String(error);
    }
    lastFetch = Date.now();
  }
  const [counts, incomingRaw] = await Promise.all([
    git(["rev-list", "--left-right", "--count", `HEAD...${upstream}`]),
    git(["log", "--format=%h%x1f%s%x1f%cI", "-n", "20", `HEAD..${upstream}`])
  ]);
  const [ahead, behind] = counts.split(/\s+/).map(Number);
  return {
    available: true,
    reason: null,
    commit,
    subject,
    date,
    branch,
    upstream,
    dirty,
    behind,
    ahead,
    incoming: incomingRaw
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [c, s, d] = line.split("\x1f");
        return { commit: c, subject: s, date: d };
      }),
    checkedAt: new Date(lastFetch).toISOString(),
    fetchError: lastFetchError
  };
};

/* ---------------- the update itself ---------------- */

interface UpdateJob {
  state: "running" | "done" | "failed";
  startedAt: string;
  finishedAt: string | null;
  steps: Array<{ at: string; text: string; ok: boolean }>;
  restarting: boolean;
  message: string | null;
}

let job: UpdateJob | null = null;

const step = (text: string, ok = true) => {
  job?.steps.push({ at: new Date().toISOString(), text, ok });
  Logger.log(`Update: ${text}`);
};

export const runUpdate = async (actor: string): Promise<void> => {
  const before = await git(["rev-parse", "HEAD"]);
  step(`Started by ${actor} at ${before.slice(0, 7)}`);
  try {
    await git(["pull", "--ff-only"], 180_000);
  } catch (error) {
    const detail = error instanceof Error ? (error as Error & { stderr?: string }).stderr || error.message : String(error);
    throw new Error(
      /local changes|would be overwritten|not possible to fast-forward|diverg/i.test(detail)
        ? `git would not update: the PC has its own changes in the way (${detail.split("\n").find((line) => line.trim())?.trim()}). Commit or put them aside on the PC, then try again.`
        : `git pull failed: ${detail.split("\n").slice(0, 3).join(" ")}`
    );
  }
  const after = await git(["rev-parse", "HEAD"]);
  if (after === before) {
    step("Already up to date");
    return;
  }
  const changed = (await git(["diff", "--name-only", before, after])).split("\n").filter(Boolean);
  step(`Pulled ${(await git(["rev-list", "--count", `${before}..${after}`]))} update(s): ${changed.length} file(s) changed`);

  if (changed.some((file) => file === "package.json" || file === "package-lock.json")) {
    step("Installing the builder's packages…");
    try {
      await npm(["install", "--no-audit", "--no-fund"], ROOT);
    } catch (error) {
      // New code with the old packages may not even start, so go back to the
      // code that matches what is installed. --keep leaves any local edits alone.
      const detail = error instanceof Error ? error.message.split("\n").slice(-3).join(" ").slice(0, 300) : String(error);
      step(`Installing failed (${detail}); going back to ${before.slice(0, 7)}`, false);
      await git(["reset", "--keep", before]).catch(() => undefined);
      await npm(["install", "--no-audit", "--no-fund"], ROOT).catch(() => undefined);
      throw new Error(
        `The update needs new packages and installing them failed${isWindows ? " (Windows keeps some of them locked while the builder runs)" : ""}, so the builder stayed on the code it was running. Stop the builder, run "git pull" and "npm install" in its folder, then start it again.`
      );
    }
    step("Packages installed");
  }
  const appChanged = changed.some((file) => file.startsWith("remote/"));
  if (changed.some((file) => file === "remote/package.json" || file === "remote/package-lock.json")) {
    step("Installing the app's packages…");
    await npm(["install", "--no-audit", "--no-fund"], path.join(ROOT, "remote"));
  }
  if (appChanged && fs.existsSync(path.join(ROOT, "remote", "node_modules"))) {
    step("Rebuilding the app this PC serves…");
    try {
      await npm(["run", "build"], path.join(ROOT, "remote"));
      step("App rebuilt");
    } catch (error) {
      // The hosted app is unaffected; only the copy on the PC is behind.
      step(`The PC's own copy of the app did not rebuild (${error instanceof Error ? error.message.slice(0, 160) : error}); the hosted app is unaffected`, false);
    }
  }
};

export const registerSelfUpdateRoutes = (app: Express) => {
  app.get("/api/power/version", authenticateAgent("read"), async (req: Request, res: Response) => {
    try {
      res.json(await readVersion(req.query.refresh === "1"));
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  app.get("/api/power/update", authenticateAgent("read"), (_req: Request, res: Response) => {
    res.json({ job });
  });

  app.post("/api/power/update", authenticateAgent("execute"), async (req: Request, res: Response) => {
    if (job?.state === "running") return res.status(409).json({ error: "An update is already running.", job });
    const building = BuildService.active().filter((build) => build.state === "running");
    if (building.length && req.body?.force !== true) {
      return res.status(409).json({
        error: `${building.length} build(s) running: ${building.map((build) => build.projectName).join(", ")}. Updating restarts the builder, which stops them (they can be continued). Update anyway?`,
        building: building.length
      });
    }
    let version: VersionInfo;
    try {
      version = await readVersion(true);
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
    if (!version.available) return res.status(409).json({ error: version.reason });
    if (version.behind === 0) return res.json({ job: null, message: "Already up to date." });

    const actor = (req as AgentRequest).actor ?? "app";
    job = { state: "running", startedAt: new Date().toISOString(), finishedAt: null, steps: [], restarting: false, message: null };
    res.json({ job, message: `Updating ${version.behind} change(s). Follow it here.` });

    try {
      await runUpdate(actor);
      const restart = await launcherRunning();
      job.state = "done";
      job.finishedAt = new Date().toISOString();
      job.restarting = restart;
      job.message = restart
        ? "Updated. Restarting now — back in about 30 seconds."
        : "Updated. Restart the builder at the PC (Stop, then Start Agent Builder) to use it.";
      step(job.message);
      if (restart) setTimeout(() => process.exit(0), 1500).unref?.();
    } catch (error) {
      job.state = "failed";
      job.finishedAt = new Date().toISOString();
      job.message = error instanceof Error ? error.message : String(error);
      step(job.message, false);
    }
  });
};
