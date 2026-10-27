"use client";

import { useEffect, useState, useMemo } from "react";
import type { Build } from "@/lib/api";
import { STAGE_LABEL, STEPS, useNow } from "./parts";
import { Icon, Meter } from "../ui";

export type ProgressViewMode = "quest" | "cyber" | "classic";

interface StoryDispatch {
  icon: string;
  narrative: string;
  chapter: string;
}

const elapsed = (since: string | null | undefined, now: number): string => {
  if (!since) return "";
  const seconds = Math.max(0, Math.round((now - new Date(since).getTime()) / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
};

const QUEST_STAGES: Record<string, { title: string; icon: string; realm: string }> = {
  starting: { title: "Gathering Ancient Runes", icon: "📜", realm: "The Sanctuary" },
  running: { title: "Forging the Core Matrix", icon: "⚒️", realm: "The Astral Anvil" },
  verifying: { title: "Trial of the Wardens", icon: "🛡️", realm: "The Testing Citadel" },
  repairing: { title: "Slaying the Bugs", icon: "⚔️", realm: "The Shadow Breach" },
  analyzing: { title: "Tallying the Relic XP", icon: "💎", realm: "Hall of Honor" },
  improving: { title: "Masterwork Ascension", icon: "✨", realm: "The Celestial Spire" },
  packaging: { title: "Sealing the Legendary Scroll", icon: "📦", realm: "The Vault" },
  complete: { title: "Quest Triumphant", icon: "👑", realm: "Mount Victory" }
};

export const GamifiedBuildProgress = ({ build, compact = false }: { build: Build; compact?: boolean }) => {
  const now = useNow();
  const [viewMode, setViewMode] = useState<ProgressViewMode>(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("build_progress_view") as ProgressViewMode) || "quest";
    }
    return "quest";
  });

  const setMode = (mode: ProgressViewMode) => {
    setViewMode(mode);
    if (typeof window !== "undefined") {
      localStorage.setItem("build_progress_view", mode);
    }
  };

  const stage = build.stage ?? "starting";
  const quest = QUEST_STAGES[stage] ?? { title: STAGE_LABEL[stage] ?? stage, icon: "⚡", realm: "The Realm" };
  const target = build.qualityThreshold ?? 90;
  const currentScore = Math.round(build.qualityScore);
  const max = build.maxIterations ?? 0;
  const currentPass = Math.max(1, build.iterations);
  const paused = build.state === "paused";

  // Story vignette generator based on build dynamics
  const storyDispatch = useMemo<StoryDispatch>(() => {
    const timeStr = build.passSince ? elapsed(build.passSince, now) : "";
    if (paused) {
      return {
        icon: "⏸️",
        chapter: "The Campfire Pause",
        narrative: "The party rests beside the campfire, awaiting your command to resume the march."
      };
    }
    if (stage === "running") {
      return {
        icon: "⚒️",
        chapter: `Pass ${currentPass}: The Astral Forge`,
        narrative: `The master artisan channels arcane TypeScript runes (${timeStr}). Architecting logic engines and responsive vistas...`
      };
    }
    if (stage === "verifying") {
      return {
        icon: "🛡️",
        chapter: `Pass ${currentPass}: Warden Examination`,
        narrative: `The Sphinx Wardens challenge each function: checking types, bundle weight, and automated tests...`
      };
    }
    if (stage === "repairing") {
      return {
        icon: "⚔️",
        chapter: `Pass ${currentPass}: The Bug Battle`,
        narrative: `Ambush! Rogue anomalies detected${build.repairAttempt ? ` (Battle ${build.repairAttempt})` : ""}. Slaying compile errors and mending armor fractures!`
      };
    }
    if (stage === "analyzing" || stage === "improving") {
      return {
        icon: "💎",
        chapter: `Pass ${currentPass}: Evaluating Honor`,
        narrative: `Relic assessed at Tier ${currentScore}/${target}! Elevating aesthetic polish and optimizing runtime speeds...`
      };
    }
    return {
      icon: "✨",
      chapter: `Pass ${currentPass}: The Grand Journey`,
      narrative: `Expedition moving forward through ${quest.realm} (${timeStr}).`
    };
  }, [stage, paused, currentPass, build.passSince, now, build.repairAttempt, currentScore, target, quest.realm]);

  // Stepper milestones
  const activeStepIdx = STEPS.findIndex(s => s.id === stage);

  return (
    <div className={`gamified-progress-card ${compact ? "compact" : ""}`}>
      {/* View Mode Toggle Bar */}
      <div className="view-mode-bar">
        <span className="view-title">VISUAL TELEMETRY</span>
        <div className="mode-pill-group">
          <button
            className={`mode-pill ${viewMode === "quest" ? "active" : ""}`}
            onClick={() => setMode("quest")}
            title="Gamified Quest Mode with Hero & Mini-Story"
          >
            ⚔️ Quest
          </button>
          <button
            className={`mode-pill ${viewMode === "cyber" ? "active" : ""}`}
            onClick={() => setMode("cyber")}
            title="Sci-Fi Cyber Core Reactor Mode"
          >
            🚀 Cyber Core
          </button>
          <button
            className={`mode-pill ${viewMode === "classic" ? "active" : ""}`}
            onClick={() => setMode("classic")}
            title="Classic Clean Progress Bars"
          >
            📊 Classic
          </button>
        </div>
      </div>

      {/* MODE 1: GAMIFIED QUEST MODE */}
      {viewMode === "quest" && (
        <div className="quest-view">
          {/* Hero & Quest Banner */}
          <div className="quest-banner">
            <div className="hero-avatar">
              <span className="avatar-icon">{paused ? "🛡️" : quest.icon}</span>
              <div className="level-badge">LVL {currentScore}</div>
            </div>
            <div className="quest-details">
              <div className="quest-realm-tag">
                <span>{quest.realm}</span> • <span>Pass {currentPass} of {max || 60}</span>
              </div>
              <h3 className="quest-title">{quest.title}</h3>
              <p className="story-ticker">
                <span className="story-icon">{storyDispatch.icon}</span>
                <span className="story-text">"{storyDispatch.narrative}"</span>
              </p>
            </div>
            <div className="quest-timer">
              <span className="timer-label">THIS PASS</span>
              <span className="timer-val">{elapsed(build.passSince, now) || "0s"}</span>
            </div>
          </div>

          {/* Stepper Milestone Path */}
          <div className="quest-path">
            {STEPS.map((s, idx) => {
              const isPast = activeStepIdx > idx;
              const isCurrent = activeStepIdx === idx;
              return (
                <div key={s.id} className={`path-step ${isPast ? "passed" : isCurrent ? "current" : "future"}`}>
                  <div className="step-node">
                    {isPast ? "✓" : isCurrent ? "⚔️" : idx + 1}
                  </div>
                  <span className="step-name">{s.label}</span>
                </div>
              );
            })}
          </div>

          {/* Gamified Health / Quality & XP Bars */}
          <div className="quest-bars">
            <div className="quest-bar-row">
              <div className="bar-header">
                <span className="bar-title">🏆 ARTIFACT QUALITY (XP)</span>
                <span className="bar-numbers">{currentScore} / {target} XP</span>
              </div>
              <div className="game-bar-track quality">
                <div
                  className="game-bar-fill quality"
                  style={{ width: `${Math.min(100, (currentScore / target) * 100)}%` }}
                />
              </div>
            </div>

            {max ? (
              <div className="quest-bar-row">
                <div className="bar-header">
                  <span className="bar-title">🗺️ EXPEDITION REACH</span>
                  <span className="bar-numbers">{currentPass} / {max} Passes</span>
                </div>
                <div className="game-bar-track passes">
                  <div
                    className="game-bar-fill passes"
                    style={{ width: `${Math.min(100, (currentPass / max) * 100)}%` }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* MODE 2: CYBER CORE REACTOR MODE */}
      {viewMode === "cyber" && (
        <div className="cyber-view">
          <div className="cyber-reactor-grid">
            <div className="reactor-core-wrap">
              <div className={`reactor-core ${paused ? "paused" : "spinning"}`}>
                <div className="reactor-ring outer" />
                <div className="reactor-ring inner" />
                <div className="reactor-value">
                  <span className="core-score">{currentScore}%</span>
                  <span className="core-label">INTEGRITY</span>
                </div>
              </div>
            </div>

            <div className="cyber-telemetry">
              <div className="telemetry-item">
                <span className="label">ACTIVE MATRIX PHASE</span>
                <span className="value cyan">{paused ? "HALTED" : STAGE_LABEL[stage] || stage}</span>
              </div>
              <div className="telemetry-item">
                <span className="label">ITERATION CYCLE</span>
                <span className="value purple">{currentPass} / {max || 60}</span>
              </div>
              <div className="telemetry-item">
                <span className="label">TARGET THRESHOLD</span>
                <span className="value green">{target}% Production Grade</span>
              </div>
              <div className="telemetry-item">
                <span className="label">DIAGNOSTIC LOG</span>
                <span className="value mono">{storyDispatch.narrative}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODE 3: CLASSIC CLEAN MODE */}
      {viewMode === "classic" && (
        <div className="classic-view">
          <div className="progress-row">
            <div className="progress-label">
              <strong>{paused ? "Paused" : STAGE_LABEL[stage] ?? stage}</strong>
              <span>
                {stage === "repairing" && build.repairAttempt ? `attempt ${build.repairAttempt} · ` : ""}
                {paused ? "waiting for you" : elapsed(build.stageSince, now)}
              </span>
            </div>
            <div className={`bar ${paused ? "paused" : "active"}`}>
              <i style={{ width: `${((build as any).stageProgress ?? 0.3) * 100}%` }} />
            </div>
          </div>
          {!compact && max ? (
            <div className="progress-row">
              <div className="progress-label">
                <strong>Pass {currentPass} of up to {max}</strong>
                <span>{build.passSince ? `this pass ${elapsed(build.passSince, now)}` : ""}</span>
              </div>
              <div className="bar passes">
                <i style={{ width: `${Math.min(100, (currentPass / max) * 100)}%` }} />
              </div>
            </div>
          ) : null}
          {!compact ? (
            <div className="progress-row">
              <div className="progress-label">
                <strong>Quality {currentScore}</strong>
                <span>target {target}</span>
              </div>
              <Meter value={build.qualityScore} target={target} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
};
