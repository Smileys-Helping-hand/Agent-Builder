"use client";

import type { Build, BuildCheck, BuildIterationDetail } from "@/lib/api";
import { isLive } from "../activity";
import { Icon, Meter, ago, duration } from "../ui";

/** What the current pass is doing, in words. */
export const STAGE_LABEL: Record<string, string> = {
  starting: "Getting ready",
  running: "Writing code",
  verifying: "Running the checks",
  repairing: "Fixing what failed",
  analyzing: "Scoring the result",
  improving: "Improving it",
  packaging: "Packaging it up",
  complete: "Finishing the pass",
  "between passes": "Starting the next pass",
  error: "Hit a problem"
};

/** The steps a pass goes through, in order, for the stepper. */
export const STEPS = [
  { id: "running", label: "Write" },
  { id: "verifying", label: "Check" },
  { id: "repairing", label: "Fix" },
  { id: "analyzing", label: "Score" },
  { id: "improving", label: "Improve" }
] as const;

export const CHECK_LABEL: Record<string, string> = {
  install: "Installs",
  typecheck: "Types",
  build: "Builds",
  test: "Tests",
  lint: "Lint"
};

export type Tone = "good" | "warn" | "bad" | "busy" | "muted";

/** One line that says where a build stands, and the colour to say it in. */
export const describe = (build: Build): { label: string; tone: Tone } => {
  if (isLive(build)) {
    return build.state === "paused" ? { label: "Paused", tone: "warn" } : { label: "Building", tone: "busy" };
  }
  switch (build.state) {
    case "completed":
      if (build.passed === true) return { label: "Works", tone: "good" };
      if (build.passed === false) return { label: "Finished · checks failing", tone: "warn" };
      return { label: "Finished", tone: "good" };
    case "error":
      return { label: "Failed", tone: "bad" };
    case "interrupted":
      return { label: "Interrupted", tone: "warn" };
    case "stopped":
      return { label: "Stopped", tone: "muted" };
    case "running":
    case "paused":
      // Listed as running but no longer held by the builder: it ended without
      // a word, most likely an older builder that restarted.
      return { label: "Ended", tone: "muted" };
    default:
      return { label: build.state, tone: "muted" };
  }
};

export const needsLook = (build: Build): boolean => {
  if (isLive(build)) return false;
  return build.state === "error" || build.state === "interrupted" || (build.state === "completed" && build.passed === false);
};

export const works = (build: Build): boolean => build.state === "completed" && build.passed !== false;

export const StateBadge = ({ build }: { build: Build }) => {
  const { label, tone } = describe(build);
  return <span className={`badge ${tone}`}>{tone === "busy" ? <i className="badge-dot" /> : null}{label}</span>;
};

/** The pass the builder left the folder at: the best-scoring one. */
export const bestPass = (build: Build): BuildIterationDetail | undefined =>
  build.iterationDetail.reduce<BuildIterationDetail | undefined>(
    (best, pass) => (!best || pass.qualityScore > best.qualityScore ? pass : best),
    undefined
  );

export const latestPass = (build: Build): BuildIterationDetail | undefined =>
  build.iterationDetail[build.iterationDetail.length - 1];

export const Checks = ({ checks, compact = false }: { checks?: BuildCheck[]; compact?: boolean }) => {
  const applicable = (checks ?? []).filter((check) => check.applicable);
  if (applicable.length === 0) return null;
  return (
    <div className={`checks ${compact ? "compact" : ""}`}>
      {applicable.map((check) => (
        <span key={check.name} className={`check ${check.passed ? "ok" : "fail"}`} title={`${check.name}: ${check.passed ? "passes" : "fails"}`}>
          {check.passed ? Icon.check : Icon.alert}
          {CHECK_LABEL[check.name] ?? check.name}
        </span>
      ))}
    </div>
  );
};

export const Stepper = ({ stage, attempt }: { stage?: string | null; attempt?: number | null }) => {
  const index = STEPS.findIndex((step) => step.id === stage);
  return (
    <div className="stepper" aria-label="Where this pass is">
      {STEPS.map((step, position) => (
        <div
          key={step.id}
          className={`step ${position < index ? "done" : ""} ${position === index ? "now" : ""}`}
          title={STAGE_LABEL[step.id]}
        >
          <i />
          <span>
            {step.label}
            {step.id === "repairing" && position === index && attempt ? ` ${attempt}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
};

/** A build in a list: what it is, where it stands, and how good it is so far. */
export const BuildCard = ({ build, onOpen }: { build: Build; onOpen: () => void }) => {
  const live = isLive(build);
  const pass = latestPass(build);
  const score = live ? build.qualityScore : build.bestScore ?? build.qualityScore;
  const where = live
    ? `Pass ${build.iterations || 1}${build.maxIterations ? ` of up to ${build.maxIterations}` : ""} · ${
        STAGE_LABEL[build.stage ?? "starting"] ?? build.stage
      }`
    : `${build.iterations} pass${build.iterations === 1 ? "" : "es"} · ${build.finishedAt ? `ended ${ago(build.finishedAt)}` : `started ${ago(build.startedAt)}`}`;

  return (
    <button className={`card build-card ${live ? "live" : ""}`} onClick={onOpen}>
      <div className="build-card-top">
        <div style={{ minWidth: 0, flex: 1 }}>
          <strong className="build-name">{build.projectName}</strong>
          <small className="muted">{where}</small>
        </div>
        <StateBadge build={build} />
      </div>
      <Meter value={score} target={build.qualityThreshold} />
      <div className="build-card-foot">
        <span className="score">
          {Math.round(score)}
          <small>/100</small>
        </span>
        <Checks checks={pass?.checks} compact />
        <span className="muted time">
          {Icon.clock} {duration(build.startedAt, live ? null : build.finishedAt)}
        </span>
      </div>
      {!live && build.state === "error" && build.error ? <p className="card-error">{build.error}</p> : null}
      {build.orderId ? <span className="chip" style={{ marginTop: 8 }}>order</span> : null}
    </button>
  );
};
