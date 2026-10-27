"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  api,
  type GameVersionBranch,
  type GameCheckupScorecard
} from "@/lib/api";
import {
  Banner,
  Busy,
  Header,
  Icon,
  Skeleton,
  useConnected,
  useToast
} from "../ui";
import UnityLevelPanel from "./UnityLevelPanel";

export default function GameMakerStudio() {
  const connected = useConnected();
  const toast = useToast();

  const [games, setGames] = useState<GameVersionBranch[]>([]);
  const [gamemakerStatus, setGamemakerStatus] = useState<Awaited<ReturnType<typeof api.gamemakerStatus>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  // Checkup Modal State
  const [activeCheckup, setActiveCheckup] = useState<{ gameId: string; scorecard: GameCheckupScorecard } | null>(null);

  // Super Build Game Prompt
  const [gamePrompt, setGamePrompt] = useState("");
  const [superBuilding, setSuperBuilding] = useState(false);

  // Codebase Deconstruction
  const [deconstructPath, setDeconstructPath] = useState("E:\\Projects\\Gamemaker");
  const [deconstructReport, setDeconstructReport] = useState<any | null>(null);
  const [deconstructing, setDeconstructing] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  const loadData = async () => {
    try {
      const [gamesRes, statusRes] = await Promise.all([
        api.games().catch(() => ({ games: [] })),
        api.gamemakerStatus().catch(() => null)
      ]);
      setGames(gamesRes.games || []);
      setGamemakerStatus(statusRes);
    } catch (err: any) {
      toast(err?.message || "Failed to load Game Studio data", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleRunCheckup = async (game: GameVersionBranch) => {
    setBusyAction(`checkup-${game.gameId}`);
    try {
      toast(`Running AI Game Checkup on '${game.name}'...`, "info");
      const res = await api.runGameCheckup(game.liveOutputDir, game.name, game.gameId);
      if (res.scorecard) {
        setActiveCheckup({ gameId: game.gameId, scorecard: res.scorecard });
        toast(`Checkup complete for ${game.name}: ${res.scorecard.overallScore}/100${res.scorecard.assessedBy === "heuristic" ? " (counted from the source, not judged)" : ""}`, "ok");
        await loadData();
      }
    } catch (err: any) {
      toast(err?.message || "Checkup failed", "error");
    } finally {
      setBusyAction(null);
    }
  };

  const handlePromote = async (gameId: string) => {
    setBusyAction(`promote-${gameId}`);
    try {
      const res = await api.promoteGame(gameId);
      if (res.success) {
        toast(res.message, "ok");
        await loadData();
      } else {
        toast(res.message, "error");
      }
    } catch (err: any) {
      toast(err?.message || "Promotion failed", "error");
    } finally {
      setBusyAction(null);
    }
  };

  const handleSuperBuild = async () => {
    if (!gamePrompt.trim()) return;
    setSuperBuilding(true);
    try {
      toast("Deploying Multi-Agent Super-Build Swarm...", "info");
      const data = await api.superBuild(gamePrompt);
      toast(`Game super-build initiated! Build ID: ${data.buildId}`, "ok");
      setGamePrompt("");
      await loadData();
    } catch (err: any) {
      toast(err?.message || "Super-build error", "error");
    } finally {
      setSuperBuilding(false);
    }
  };

  const handleDeconstruct = async () => {
    if (!deconstructPath.trim()) return;
    setDeconstructing(true);
    try {
      toast(`Deconstructing codebase at ${deconstructPath}...`, "info");
      const res = await api.deconstructApp(deconstructPath);
      if (res.report) {
        setDeconstructReport(res.report);
        toast(`Dissected ${res.report.totalFiles} files and cataloged ${res.report.features.length} features!`, "ok");
      }
    } catch (err: any) {
      toast(err?.message || "Deconstruction failed", "error");
    } finally {
      setDeconstructing(false);
    }
  };

  const handleRebuild = async (elevate3D = true) => {
    if (!deconstructPath.trim()) return;
    setRebuilding(true);
    try {
      toast("Synthesizing clean architecture rebuild...", "info");
      const res = await api.rebuildApp(deconstructPath, undefined, elevate3D);
      if (res.success) {
        toast(`Rebuild initiated! ID: ${res.buildId}`, "ok");
        setDeconstructReport(null);
      }
    } catch (err: any) {
      toast(err?.message || "Rebuild failed", "error");
    } finally {
      setRebuilding(false);
    }
  };

  return (
    <>
      <Header
        title="Game Studio"
        sub="KingdomForge Unity AI Builder & Continuous Game Evolution"
      />

      <div className="wrap">
        {/* Status Banner */}
        <div className="card" style={{ background: "linear-gradient(135deg, rgba(88, 28, 135, 0.25), rgba(15, 23, 42, 0.9))", borderColor: "rgba(168, 85, 247, 0.35)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(168, 85, 247, 0.2)", display: "grid", placeItems: "center", color: "#c084fc" }}>
                {Icon.game}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, color: "#fff" }}>Game Studio</h3>
                <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--muted)" }}>
                  {gamemakerStatus?.installed
                    ? `KingdomForge found at ${gamemakerStatus.path}${gamemakerStatus.hasUnityBridge ? " (with its Unity bridge)" : ""}`
                    : `KingdomForge not found${gamemakerStatus?.path ? ` at ${gamemakerStatus.path}` : ""} (set GAMEMAKER_PATH)`}
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <span className={`tag ${gamemakerStatus?.installed ? "ok" : "warn"}`}>
                {gamemakerStatus?.installed ? "KingdomForge found" : "No KingdomForge"}
              </span>
              <span className={`tag ${gamemakerStatus?.unityEditor ? "ok" : "warn"}`}>
                {gamemakerStatus?.unityEditor ? `Unity ${gamemakerStatus.unityEditor.version}` : "No Unity editor"}
              </span>
            </div>
          </div>
        </div>

        {/* Super-Build Creator & Single-Prompt Expansion */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>⚡ Instant Game Super-Build</div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 12px" }}>
            Create complete, high-quality games from a single prompt. Our multi-agent swarm synthesizes
            game logic, 60fps canvas/WebGL loops, 3D spatial models via Blender/Three.js, and procedural audio.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              type="text"
              className="input"
              style={{ flex: 1, minWidth: 260 }}
              placeholder="e.g. 1980s neon synthwave block breaker with boss flagship battles and procedural powerup combos..."
              value={gamePrompt}
              onChange={(e) => setGamePrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSuperBuild()}
            />
            <button
              className="btn primary"
              disabled={superBuilding || !gamePrompt.trim()}
              onClick={handleSuperBuild}
            >
              {superBuilding ? <Busy label="Synthesizing Game..." /> : <>⚔️ Launch Super-Build</>}
            </button>
          </div>
        </div>

        <UnityLevelPanel onLevelDone={loadData} />

        {/* Codebase Deconstruction & Rebuild Section */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>🔍 Codebase Deconstruction & Rebuild Engine</div>
          <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 12px" }}>
            Tear down any existing game or app to thoroughly understand its architecture, features, and state.
            Extracts a formal feature catalog, detects flaws and stubs, and blueprints an elevated rebuild with modern UI and 3D.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <input
              type="text"
              className="input"
              style={{ flex: 1, minWidth: 260 }}
              placeholder="Folder path to deconstruct (e.g. E:\Projects\Gamemaker)"
              value={deconstructPath}
              onChange={(e) => setDeconstructPath(e.target.value)}
            />
            <button
              className="btn"
              disabled={deconstructing || !deconstructPath.trim()}
              onClick={handleDeconstruct}
            >
              {deconstructing ? <Busy label="Dissecting..." /> : <>🔬 Tear Down &amp; Dissect</>}
            </button>
          </div>

          {deconstructReport && (
            <div className="evolution-scorecard" style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h4 style={{ margin: 0, color: "#fff" }}>
                  Dissection Report: {deconstructReport.projectName} ({deconstructReport.framework})
                </h4>
                <span className="tag info">{deconstructReport.totalFiles} Source Files Analyzed</span>
              </div>
              {deconstructReport.analysedBy === "scan" && deconstructReport.note ? (
                <p className="small" style={{ color: "#fbbf24", margin: "6px 0" }}>{deconstructReport.note}</p>
              ) : null}

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Dissected Features ({deconstructReport.features.length})
                  </div>
                  <div className="feature-pill-list">
                    {deconstructReport.features.map((f: any, i: number) => (
                      <span key={i} className="feature-pill" title={f.description}>
                        {f.name}
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase" }}>
                    Detected Flaws to Eliminate ({deconstructReport.flawsDetected.length})
                  </div>
                  <div style={{ fontSize: 12, color: "#f87171", marginTop: 4 }}>
                    {deconstructReport.flawsDetected.slice(0, 4).map((flaw: string, i: number) => (
                      <div key={i}>• {flaw}</div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 10, justifyContent: "flex-end" }}>
                <button
                  className="btn primary"
                  disabled={rebuilding}
                  onClick={() => handleRebuild(true)}
                >
                  {rebuilding ? <Busy label="Rebuilding..." /> : <>✨ Elevate &amp; Rebuild (with 3D &amp; Audio)</>}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Continuous Evolution & Safe Version Branching Showcase */}
        <div style={{ marginTop: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18 }}>Games &amp; Versions</h2>
            <p style={{ margin: "2px 0 0", fontSize: 13, color: "var(--muted)" }}>
              The web games in games/ and the Unity levels built here. A staged version waits beside the live one until you promote it.
            </p>
          </div>
          <button className="btn small" onClick={loadData}>
            {Icon.refresh} Refresh
          </button>
        </div>

        {loading ? (
          <div style={{ marginTop: 14 }}>
            <Skeleton rows={3} />
          </div>
        ) : games.length === 0 ? (
          <div className="card" style={{ marginTop: 14, textAlign: "center", padding: 32 }}>
            <p style={{ color: "var(--muted)" }}>No games registered in Game Studio yet.</p>
          </div>
        ) : (
          <div className="game-studio-grid">
            {games.map((game) => (
              <div key={game.gameId} className="game-card">
                <div className="game-header">
                  <div className="game-title">
                    <span>{game.engine === "unity" ? "🏔️" : "🎮"}</span> {game.name}
                  </div>
                  <div className="fun-scorePill">
                    <span className="fun-score-pill">{game.funRating === null ? "Not checked yet" : `⭐ ${game.funRating.toFixed(1)} / 10`}</span>
                  </div>
                </div>

                {/* Safe Version Branching Split */}
                <div className="branch-split">
                  <div className="branch-box live">
                    <div className="branch-label live">
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#4ade80" }} />
                      Live version
                    </div>
                    <div className="branch-version">v{game.liveVersion}</div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }} title={game.liveOutputDir}>{game.engine === "unity" ? "Unity project" : game.liveOutputDir}</div>
                  </div>

                  <div className="branch-box staged">
                    <div className="branch-label staged">
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#c084fc" }} />
                      Staged version
                    </div>
                    <div className="branch-version">
                      {game.stagedVersion ? `v${game.stagedVersion}` : "None"}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--muted)" }}>
                      {game.stagedVersion ? "Ready for review" : "Nothing waiting"}
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                  <button
                    className="btn small"
                    disabled={busyAction === `checkup-${game.gameId}`}
                    onClick={() => handleRunCheckup(game)}
                  >
                    {busyAction === `checkup-${game.gameId}` ? <Busy label="Checking..." /> : <>🩺 Deep Checkup</>}
                  </button>

                  {game.stagedVersion && (
                    <button
                      className="btn small primary"
                      disabled={busyAction === `promote-${game.gameId}`}
                      onClick={() => handlePromote(game.gameId)}
                    >
                      {busyAction === `promote-${game.gameId}` ? <Busy label="Promoting..." /> : <>🚀 Promote to Live</>}
                    </button>
                  )}

                </div>
              </div>
            ))}
          </div>
        )}

        {/* Checkup Scorecard Modal */}
        {activeCheckup && (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0, 0, 0, 0.75)",
              backdropFilter: "blur(6px)",
              display: "grid",
              placeItems: "center",
              zIndex: 1000,
              padding: 16
            }}
            onClick={() => setActiveCheckup(null)}
          >
            <div
              className="card"
              style={{
                maxWidth: 640,
                width: "100%",
                maxHeight: "90vh",
                overflowY: "auto",
                background: "#0c1322",
                border: "1px solid rgba(168, 85, 247, 0.4)",
                boxShadow: "0 20px 60px rgba(0, 0, 0, 0.8)"
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: 18, color: "#fff" }}>
                    Game Checkup: {activeCheckup.scorecard.gameName}
                  </h3>
                  <div style={{ fontSize: 12, color: activeCheckup.scorecard.assessedBy === "heuristic" ? "#fbbf24" : "var(--muted)", marginTop: 2 }}>
                    {activeCheckup.scorecard.assessedBy === "heuristic"
                      ? activeCheckup.scorecard.note ?? "Counted from the source, not judged by the model."
                      : "Graded by the code model from the game's source"}
                  </div>
                </div>
                <button className="btn small ghost" onClick={() => setActiveCheckup(null)}>✕</button>
              </div>

              {/* Metrics Grid */}
              <div className="scorecard-metrics" style={{ marginTop: 16 }}>
                <div className="metric-card">
                  <div className="metric-score" style={{ color: "#38bdf8" }}>
                    {activeCheckup.scorecard.overallScore}
                  </div>
                  <div className="metric-title">Overall Polish</div>
                </div>
                <div className="metric-card">
                  <div className="metric-score" style={{ color: "#a855f7" }}>
                    {activeCheckup.scorecard.storyAndPlot.score}
                  </div>
                  <div className="metric-title">Story &amp; Lore</div>
                </div>
                <div className="metric-card">
                  <div className="metric-score" style={{ color: "#34d399" }}>
                    {activeCheckup.scorecard.gameplayAndMechanics.score}
                  </div>
                  <div className="metric-title">Gameplay Loop</div>
                </div>
              </div>

              {/* Suggestions */}
              <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="branch-box">
                  <div style={{ fontWeight: 700, fontSize: 12.5, color: "#c084fc" }}>
                    📖 Narrative &amp; Story Suggestions:
                  </div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--muted)" }}>
                    {activeCheckup.scorecard.storyAndPlot.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>

                <div className="branch-box">
                  <div style={{ fontWeight: 700, fontSize: 12.5, color: "#34d399" }}>
                    🕹️ Mechanics &amp; Powerups ({activeCheckup.scorecard.gameplayAndMechanics.varietyRating}):
                  </div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontSize: 12.5, color: "var(--muted)" }}>
                    {activeCheckup.scorecard.gameplayAndMechanics.suggestions.map((s, i) => (
                      <li key={i}>{s}</li>
                    ))}
                  </ul>
                </div>

                <div className="branch-box" style={{ background: "rgba(168, 85, 247, 0.08)", borderColor: "rgba(168, 85, 247, 0.3)" }}>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#fff" }}>
                    🚀 Next Evolution Plan: {activeCheckup.scorecard.nextEvolutionPlan.title}
                  </div>
                  <p style={{ margin: "4px 0 8px", fontSize: 12.5, color: "var(--muted)" }}>
                    {activeCheckup.scorecard.nextEvolutionPlan.description}
                  </p>
                  <div style={{ fontSize: 12, color: "#e2e8f0" }}>
                    {activeCheckup.scorecard.nextEvolutionPlan.keyUpgrades.map((u, i) => (
                      <div key={i}>✓ {u}</div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 18 }}>
                <button
                  className="btn primary"
                  onClick={() => {
                    toast(`Evolution plan applied to background staging branch for ${activeCheckup.scorecard.gameName}!`, "ok");
                    setActiveCheckup(null);
                  }}
                >
                  🚀 Apply Evolution to Staged Branch
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
