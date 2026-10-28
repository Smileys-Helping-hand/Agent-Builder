/**
 * Customers changing their finished site from their dashboard on the site.
 *
 * Polled with the orders. Each change is one of two kinds:
 *
 * - Fields (name, headline, contact details, colours, font, section layout):
 *   made exactly in the delivered site's src/content.ts (ContentEdits), the
 *   site rebuilt in place, and the change is live at the same link in about
 *   a minute. No model involved; if the rebuild fails, the old content goes back.
 * - A note in their own words ("add a gallery of our work"): built by the
 *   model on a copy of the delivered site. Only if that build passes the same
 *   gates as a customer delivery does it replace the site; otherwise the site
 *   stays exactly as it was and the customer is told.
 * - Their database (the platform and its public keys, from the Database panel
 *   on their dashboard): written into the site's .env.local and the site
 *   rebuilt, so every visitor's data goes there. A site built before it had a
 *   data layer gets one (DbKit) on a copy, by the model, through the same
 *   gates as a note.
 */
import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import { promisify } from "util";

import { DbKit, isPlatform } from "../database/DbKit.js";
import { copyForBuild } from "../ecosystem/ProjectBuilds.js";
import { BuildService, buildEvents, type BuildRecord } from "../orchestrator/BuildService.js";
import { shareableBuildPreview } from "../server/previews.js";
import { GameMode } from "../utils/GameMode.js";
import { Logger } from "../utils/Logger.js";
import { readPublicUrl } from "../utils/PublicUrl.js";
import { applyContentEdits } from "./ContentEdits.js";
import { customerSafe } from "./OrderPipeline.js";
import { OrderStore } from "./OrderStore.js";
import { Packager } from "./Packager.js";
import { SiteClient, type SiteEditRequest } from "./SiteClient.js";

const run = promisify(execFile);

/** Below this a note's build does not replace the customer's site (the delivery bar, OrderPipeline's SHIPPABLE_SCORE). */
const SHIPPABLE = 60;

/** Edits being worked on now, so a poll during one does not start it again. */
const inFlight = new Set<string>();

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const commit = async (dir: string, message: string) => {
  try {
    await run("git", ["add", "-A"], { cwd: dir, windowsHide: true });
    await run("git", ["commit", "-q", "--no-verify", "-m", message], { cwd: dir, windowsHide: true });
  } catch {
    // Nothing to commit, or not a repository: the files are what matter.
  }
};

/** Make the field edits and rebuild in place. Throws (with the old content put back) when it cannot. */
async function applyFields(dir: string, edit: SiteEditRequest): Promise<string[]> {
  const file = path.join(dir, "src", "content.ts");
  if (!fs.existsSync(file)) throw new Error("this site has no content file to edit; it needs the studio");
  const before = fs.readFileSync(file, "utf8");
  const result = applyContentEdits(before, edit.patch ?? {}, edit.sections);
  if (result.changed.length === 0) {
    if (result.skipped.length) throw new Error(`${result.skipped.join(", ")} cannot be changed on this site`);
    return [];
  }
  fs.writeFileSync(file, result.source);
  const built = await Packager.buildWebsite(dir).catch(() => null);
  if (!built) {
    fs.writeFileSync(file, before);
    await Packager.buildWebsite(dir).catch(() => null);
    throw new Error("the site did not build with that change, so it was left as it was");
  }
  await commit(dir, `Owner's edit from their dashboard: ${result.changed.join(", ")}`);
  return result.changed;
}

/**
 * The owner's database keys into the site, rebuilt with them ("live"), or
 * "needs-build" when the site has no data layer yet. A failed rebuild puts the
 * old keys back.
 */
async function applyDatabase(dir: string, edit: SiteEditRequest): Promise<"live" | "needs-build"> {
  const chosen = edit.database!;
  if (!isPlatform(chosen.platform)) throw new Error("that database is not one this site can use");
  if (!DbKit.state(dir).installed) return "needs-build";
  const envFile = path.join(dir, ".env.local");
  const before = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : null;
  if (DbKit.state(dir).platform !== chosen.platform) DbKit.install(dir, chosen.platform);
  DbKit.writeKeys(dir, chosen.platform, chosen.values ?? {});
  const built = await Packager.buildWebsite(dir).catch(() => null);
  if (!built) {
    if (before === null) fs.rmSync(envFile, { force: true });
    else fs.writeFileSync(envFile, before);
    await Packager.buildWebsite(dir).catch(() => null);
    throw new Error("the site did not build with those keys, so it was left as it was");
  }
  await commit(dir, `Owner connected ${chosen.platform} from their dashboard`);
  return "live";
}

/** Build the note on a copy; report when it ends. Resolves once the build has started. */
async function startNoteBuild(orderId: string, edit: SiteEditRequest, from: string): Promise<void> {
  const order = OrderStore.get(orderId)!;
  const { workDir } = await copyForBuild(from, order.title, "edit");
  // A database for a site that had none: the data layer and the owner's keys go in before the model wires it up.
  if (edit.database && isPlatform(edit.database.platform)) {
    DbKit.install(workDir, edit.database.platform);
    DbKit.writeKeys(workDir, edit.database.platform, edit.database.values ?? {});
  }
  const build = BuildService.start({
    projectName: order.title,
    description: `${order.brief}\n\nThis site was built and delivered already; the owner is using it. Now make this change they asked for, and leave everything else as it is: ${edit.note}`,
    targetPlatforms: ["web"],
    profile: "deep",
    qualityThreshold: 92,
    maxIterations: 6,
    workingDir: workDir,
    startedBy: `edit:${order.id}`
  });
  OrderStore.note(orderId, "instruction", `Owner's change from their dashboard: ${edit.note} (build ${build.buildId}).`);

  const finish = (record: BuildRecord, ok: boolean) => {
    if (record.buildId !== build.buildId) return;
    buildEvents.off("completed", onCompleted);
    buildEvents.off("failed", onFailed);
    inFlight.delete(edit.editId);
    // The same bar as a delivery: a usable score, and installs, compiles, builds and opens.
    const good = ok && record.qualityScore >= SHIPPABLE && customerSafe(record).ok;
    if (!good) {
      OrderStore.note(orderId, "failed", `The owner's change did not reach the delivery bar (quality ${Math.round(record.qualityScore)}); their site was left as it was.`);
      void SiteClient.reportEdit(order.externalId!, {
        editId: edit.editId,
        status: "failed",
        message: "We could not make that change well enough on our own, so your site was left as it was. The studio has been told and will follow up."
      });
      return;
    }
    const previewUrl = shareableBuildPreview(record.buildId, readPublicUrl());
    OrderStore.update(orderId, { deliverablePath: record.outputDir, ...(previewUrl ? { deliverableUrl: previewUrl } : {}), qualityScore: record.qualityScore });
    OrderStore.note(orderId, "delivered", `The owner's change is live (quality ${Math.round(record.qualityScore)}).`);
    void SiteClient.reportEdit(order.externalId!, { editId: edit.editId, status: "done", previewUrl });
  };
  const onCompleted = (record: BuildRecord) => finish(record, true);
  const onFailed = (record: BuildRecord) => finish(record, false);
  buildEvents.on("completed", onCompleted);
  buildEvents.on("failed", onFailed);
}

export const SiteEdits = {
  /** Take the site's waiting edits; returns how many were started. */
  async process(): Promise<number> {
    if (!SiteClient.isConfigured()) return 0;
    const edits = await SiteClient.pendingEdits();
    let started = 0;
    for (const edit of edits) {
      if (inFlight.has(edit.editId)) continue;
      const order = OrderStore.findByExternalId("site", edit.orderId);
      const dir = order?.deliverablePath && fs.existsSync(order.deliverablePath) ? order.deliverablePath : null;
      if (!order || !dir) {
        await SiteClient.reportEdit(edit.orderId, {
          editId: edit.editId,
          status: "failed",
          message: "Your site's files are not on the build machine, so the studio will make this change by hand."
        });
        continue;
      }
      // One thing at a time per site: a build working on it, or game mode, means later.
      if ((order.buildId && BuildService.isRunning(order.buildId)) || GameMode.isOn()) continue;
      if ((edit.note || (edit.database && !DbKit.state(dir).installed)) && BuildService.active().length > 0) continue;

      inFlight.add(edit.editId);
      started += 1;
      await SiteClient.reportEdit(edit.orderId, { editId: edit.editId, status: "applying" });
      try {
        if (edit.database) {
          const result = await applyDatabase(dir, edit);
          if (result === "needs-build") {
            const note = `Keep everything this site saves (forms, bookings, products, posts, accounts) through src/lib/db, which is already added and connected to ${edit.database.platform}; show loading and error states, and keep the site looking and working as it does.`;
            OrderStore.note(order.id, "instruction", `Owner connected ${edit.database.platform}; the site had no data layer, so the studio is adding one.`);
            await startNoteBuild(order.id, { ...edit, note }, dir);
            continue;
          }
          OrderStore.note(order.id, "instruction", `Owner connected ${edit.database.platform} from their dashboard; the site is rebuilt with it.`);
          inFlight.delete(edit.editId);
          await SiteClient.reportEdit(edit.orderId, { editId: edit.editId, status: "done", previewUrl: order.deliverableUrl });
          continue;
        }
        const changed = await applyFields(dir, edit);
        if (changed.length) OrderStore.note(order.id, "instruction", `Owner changed ${changed.join(", ")} from their dashboard; live now.`);
        if (edit.note) {
          // The fields are live already; the note is built on top of them.
          await startNoteBuild(order.id, edit, dir);
          continue;
        }
        inFlight.delete(edit.editId);
        await SiteClient.reportEdit(edit.orderId, { editId: edit.editId, status: "done", previewUrl: order.deliverableUrl });
      } catch (error) {
        inFlight.delete(edit.editId);
        Logger.warn("A customer's site edit could not be made", { order: order.id, edit: edit.editId, error: errorMessage(error) });
        await SiteClient.reportEdit(edit.orderId, { editId: edit.editId, status: "failed", message: errorMessage(error).slice(0, 300) });
      }
    }
    return started;
  }
};
