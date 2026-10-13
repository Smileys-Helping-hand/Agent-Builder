/**
 * Jarvis's library: what he asked Agent Builder to make, and what came of it.
 *
 *   GET    /api/jarvis/library?kind=   newest first, each with its result now
 *   DELETE /api/jarvis/library/:id    take an entry off the list (not its result)
 *
 * Each entry is resolved when it is read: a build's state, score and folder,
 * an app's state, a drawing's pictures (as signed image links), a MediaGen
 * job's image or video, a research topic's findings, a template idea's
 * practice. Builds he started before the library existed are listed too.
 */
import type { Express, Request, Response } from "express";

import { TemplateAcademy } from "../academy/TemplateAcademy.js";
import { ArtLibrary } from "../media/ArtLibrary.js";
import { MediaGen } from "../media/MediaGen.js";
import { BuildService, type BuildView } from "../orchestrator/BuildService.js";
import { AppBuilder, type AppPlatform } from "../orders/AppBuilder.js";
import { ResearchStore } from "../research/ResearchStore.js";
import { JarvisLibrary, type LibraryEntry, type LibraryKind } from "../state/JarvisLibrary.js";
import { signLink } from "../utils/SignedLinks.js";
import { authenticateAgent } from "./agentAuth.js";

export type LibraryState = "working" | "done" | "failed" | "gone";

export interface LibraryItem extends Omit<LibraryEntry, "results"> {
  state: LibraryState;
  /** One line on where it stands: "Scored 100, passed", "Drawing 12 of 20". */
  detail: string | null;
  /** The phone app's screen for it. */
  open: string | null;
  score: number | null;
  /** Finished pictures, as image links signed for an hour. */
  pictures: Array<{ id: string; name: string; path: string }>;
  /** A MediaGen result. */
  media: { url: string; type: string } | null;
  /** Older builds he started, found from the builds rather than recorded here. */
  fromBuilds?: boolean;
}

const KINDS: LibraryKind[] = ["build", "app", "picture", "media", "project", "research", "template"];
const JARVIS = /^agent:jarvis/;
const LIMIT = 80;

const picture = (id: string) => {
  const item = ArtLibrary.get(id);
  if (!item) return null;
  const token = signLink("art-image", item.id, 60 * 60 * 1000);
  return { id: item.id, name: item.name, path: `/api/art/${encodeURIComponent(item.id)}/image?t=${encodeURIComponent(token)}` };
};

const buildState = (build: BuildView): { state: LibraryState; detail: string } => {
  const score = Math.round(build.bestScore ?? build.qualityScore ?? 0);
  if (build.state === "running" || build.state === "paused") {
    return { state: "working", detail: `${build.state === "paused" ? "Paused" : "Building"}, pass ${build.iterations}, best ${score} so far` };
  }
  if (build.passed) return { state: "done", detail: `Scored ${score}, passed` };
  if (build.state === "completed") return { state: "done", detail: `Finished at ${score}` };
  return { state: "failed", detail: `${build.state === "interrupted" ? "Interrupted" : build.state === "error" ? "Failed" : "Stopped"} at ${score}` };
};

const blank = (entry: LibraryEntry): LibraryItem => {
  const { results: _results, ...rest } = entry;
  return { ...rest, state: "working", detail: null, open: null, score: null, pictures: [], media: null };
};

async function resolve(entry: LibraryEntry): Promise<LibraryItem> {
  const item = blank(entry);
  if (entry.error) return { ...item, state: "failed", detail: entry.error };
  const first = entry.refs[0] ?? "";

  switch (entry.kind) {
    case "build": {
      const build = first ? BuildService.view(first) : null;
      if (!build) return { ...item, state: "gone", detail: "The build is no longer in the history" };
      return { ...item, ...buildState(build), title: entry.title || build.projectName, score: Math.round(build.bestScore ?? 0), open: `/build/?id=${encodeURIComponent(build.buildId)}` };
    }

    case "app": {
      const job = first ? AppBuilder.status(first, (entry.platform ?? "android") as AppPlatform) : null;
      const open = first ? `/build/?id=${encodeURIComponent(first)}` : null;
      const label = entry.platform === "windows" ? "Windows app" : "Android app";
      if (!job) return { ...item, open, state: "gone", detail: `The ${label} is not on this PC since a restart; make it again from the build` };
      if (job.state === "building") return { ...item, open, detail: `Making the ${label}: ${job.stage}` };
      if (job.state === "ready") return { ...item, open, state: "done", detail: `${label} ready: ${job.fileName ?? "download it from the build"}` };
      return { ...item, open, state: "failed", detail: job.error ?? `The ${label} failed` };
    }

    case "picture": {
      // Saved picture ids first; otherwise the drawing jobs, saving what they made.
      let ids = entry.results;
      if (ids.length === 0) {
        const jobs = entry.refs.map((id) => ArtLibrary.job(id));
        const made = jobs.map((job) => job?.item?.id).filter((id): id is string => Boolean(id));
        const working = jobs.filter((job) => job && (job.state === "queued" || job.state === "drawing"));
        const failed = jobs.filter((job) => job?.state === "failed");
        if (made.length > 0 && working.length === 0) JarvisLibrary.saveResults(entry.id, made);
        ids = made;
        if (working.length > 0) {
          const drawing = working.find((job) => job?.state === "drawing");
          return {
            ...item,
            open: "/studio/",
            pictures: ids.map(picture).filter((p): p is NonNullable<typeof p> => p !== null),
            detail: drawing ? `Drawing ${drawing.progress.value} of ${drawing.progress.max}` : `${working.length} waiting to be drawn`
          };
        }
        if (made.length === 0) {
          return { ...item, open: "/studio/", state: failed.length ? "failed" : "gone", detail: failed[0]?.error ?? "The drawing was lost in a restart before it finished" };
        }
      }
      const pictures = ids.map(picture).filter((p): p is NonNullable<typeof p> => p !== null);
      if (pictures.length === 0) return { ...item, open: "/studio/", state: "gone", detail: "The pictures were removed from the library" };
      return { ...item, open: "/studio/", state: "done", pictures, detail: `${pictures.length} picture${pictures.length === 1 ? "" : "s"}` };
    }

    case "media": {
      const saved = entry.results[0];
      if (saved) {
        const [type, url] = saved.split("|", 2);
        return { ...item, state: "done", media: { type, url }, detail: type === "video" ? "Video ready" : "Image ready", open: "/studio/" };
      }
      if (!first || !MediaGen.configured()) return { ...item, state: "gone", detail: "MediaGen is not connected" };
      try {
        const job = await MediaGen.job(first);
        if (job.status === "completed" && job.mediaUrl) {
          JarvisLibrary.saveResults(entry.id, [`${job.mediaType}|${job.mediaUrl}`]);
          return { ...item, state: "done", media: { type: job.mediaType, url: job.mediaUrl }, detail: job.mediaType === "video" ? "Video ready" : "Image ready", open: "/studio/" };
        }
        if (job.status === "failed" || job.status === "interrupted") return { ...item, state: "failed", detail: job.error ?? `MediaGen: ${job.status}`, open: "/studio/" };
        return { ...item, detail: `MediaGen: ${job.status}${job.percentage ? ` ${Math.round(job.percentage)}%` : ""}`, open: "/studio/" };
      } catch (error) {
        return { ...item, detail: `MediaGen did not answer: ${error instanceof Error ? error.message : String(error)}`, open: "/studio/" };
      }
    }

    case "research": {
      const topic = first ? ResearchStore.getTopicSummary(first) : null;
      if (!topic) return { ...item, state: "gone", detail: "The topic was removed" };
      return {
        ...item,
        title: entry.action === "research.ask" ? entry.title : topic.title,
        state: topic.status === "running" ? "working" : "done",
        detail: `${topic.findingCount} findings, ${topic.corroboratedCount} confirmed by a second source`,
        open: "/research/"
      };
    }

    case "template": {
      const idea = first ? TemplateAcademy.get(first) : null;
      if (!idea) return { ...item, state: "gone", detail: "The idea was removed from the academy" };
      const state: LibraryState = idea.status === "graduated" || idea.status === "published" ? "done" : idea.status === "parked" ? "failed" : "working";
      return { ...item, title: idea.name, state, score: idea.bestScore, detail: `${idea.status}, best ${idea.bestScore}/100`, open: "/academy/" };
    }

    case "project":
      return { ...item, state: "done", detail: "Project folder created", open: "/projects/" };
  }
  return item;
}

export const registerJarvisLibraryRoutes = (app: Express) => {
  app.get("/api/jarvis/library", authenticateAgent("read"), async (req: Request, res: Response) => {
    const kind = KINDS.includes(req.query.kind as LibraryKind) ? (req.query.kind as LibraryKind) : undefined;
    const entries = JarvisLibrary.list({ kind, limit: LIMIT });
    const items = await Promise.all(entries.map((entry) => resolve(entry)));

    // Builds he started some other way, or before the library kept a list.
    if (!kind || kind === "build") {
      const known = JarvisLibrary.buildRefs();
      for (const build of BuildService.list()) {
        if (!JARVIS.test(build.startedBy ?? "") || known.has(build.buildId)) continue;
        items.push({
          id: -Number(build.buildId.replace(/\D/g, "").slice(-12) || 0),
          at: build.startedAt,
          action: "build",
          kind: "build",
          title: build.projectName,
          request: build.description?.slice(0, 2000) ?? "",
          refs: [build.buildId],
          platform: null,
          error: null,
          ...buildState(build),
          score: Math.round(build.bestScore ?? 0),
          open: `/build/?id=${encodeURIComponent(build.buildId)}`,
          pictures: [],
          media: null,
          fromBuilds: true
        });
      }
    }

    items.sort((a, b) => (a.at < b.at ? 1 : -1));
    const counts = Object.fromEntries(KINDS.map((k) => [k, items.filter((item) => item.kind === k).length]));
    res.json({ items: items.slice(0, LIMIT), counts });
  });

  app.delete("/api/jarvis/library/:id", authenticateAgent("write"), (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0 || !JarvisLibrary.remove(id)) return res.status(404).json({ error: "No such entry." });
    res.json({ ok: true });
  });
};
