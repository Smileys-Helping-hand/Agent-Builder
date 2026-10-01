/**
 * How far along a build is, as one number — the same reading the app's bars
 * give, so the Hub and the app never disagree about a build.
 *
 * Two things move it: the passes used (with where the current pass is), and
 * how close the quality is to its target. Quality counts most, because
 * reaching the target is what ends a build; the pass position keeps it moving
 * while a long pass is still installing, checking or repairing.
 */
import type { BuildRecord } from "./BuildService.js";

/** How far through a pass each stage is. Mirrors remote/app/build/parts.tsx. */
export const STAGE_PROGRESS: Record<string, number> = {
  starting: 0.04,
  running: 0.18,
  verifying: 0.42,
  repairing: 0.58,
  analyzing: 0.76,
  improving: 0.9,
  packaging: 0.97,
  complete: 1,
  "between passes": 1
};

export const STAGE_TEXT: Record<string, string> = {
  starting: "Getting ready",
  running: "Writing code",
  verifying: "Running the checks",
  repairing: "Fixing what failed",
  analyzing: "Scoring the result",
  improving: "Improving it",
  packaging: "Packaging it up",
  complete: "Finishing the pass",
  "between passes": "Starting the next pass"
};

type Readable = Pick<BuildRecord, "stage" | "iterations" | "maxIterations" | "qualityScore" | "qualityThreshold" | "state" | "repairAttempt">;

/** 0–1: how much of the build is done. */
export const buildFraction = (build: Readable): number => {
  if (build.state === "completed") return 1;
  const inPass = STAGE_PROGRESS[build.stage ?? "starting"] ?? 0.1;
  const max = Math.max(1, build.maxIterations || 1);
  const passes = Math.min(1, (Math.max(1, build.iterations) - 1 + inPass) / max);
  const target = build.qualityThreshold || 90;
  const quality = Math.min(1, Math.max(0, build.qualityScore) / target);
  return Math.min(1, 0.6 * quality + 0.4 * passes);
};

/** In words: "Pass 2 of up to 5 · Running the checks · quality 64 of 90". */
export const buildProgressLine = (build: Readable): string => {
  const stage = build.stage ?? "starting";
  const words = STAGE_TEXT[stage] ?? stage;
  const attempt = stage === "repairing" && build.repairAttempt ? ` (attempt ${build.repairAttempt})` : "";
  const pass = build.iterations ? `Pass ${build.iterations} of up to ${build.maxIterations}` : "Starting";
  const quality = build.qualityScore > 0 ? ` · quality ${Math.round(build.qualityScore)} of ${build.qualityThreshold || 90}` : "";
  return `${pass} · ${words}${attempt}${quality}`;
};
