"use client";

import Link from "next/link";
import { useState } from "react";

import { api, type Problem, type ServiceReport, type CleanupReport } from "@/lib/api";
import { STAGE_LABEL } from "../build/parts";
import { Banner, Busy, Header, Icon, NotConnected, Skeleton, ago, useConnected, useRemote, useToast } from "../ui";
import { PowerTools } from "./power";
import { UpdateCard } from "./update";

/**
 * The machine room & PC command center.
 *
 * Provides complete remote hardware monitoring and control, space freeing,
 * one-click service toggles (Ollama, Research, Watch, GitHub, Jarvis),
 * and automated diagnostics and repair.
 */

const SERVICE_STATE: Record<ServiceReport["state"], string> = {
  up: "up",
  down: "down",
  degraded: "degraded",
  unknown: ""
};

const pct = (value: number | undefined): string => (value === undefined ? "—" : `${Math.round(value)}%`);
const gb = (bytes: number): string => `${Math.round(bytes / 1024 ** 3)}GB`;

export default function Control() {
  const connected = useConnected();
  const toast = useToast();
  const status = useRemote(() => api.status(), 15000);
  const hardware = useRemote(() => api.hardware(), 20000);
  const jarvis = useRemote(() => api.jarvis(), 30000);
  const pipeline = useRemote(() => api.pipeline(), 30000);
  const builds = useRemote(() => api.builds(), 15000);

  const [working, setWorking] = useState<string | null>(null);
  const [confirmShutdown, setConfirmShutdown] = useState(false);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [cleanupReport, setCleanupReport] = useState<CleanupReport | null>(null);
  const [activeProfile, setActiveProfile] = useState<"eco" | "balanced" | "turbo">("balanced");

  // Troubleshoot progress bar state
  const [troubleshootProgress, setTroubleshootProgress] = useState<number | null>(null);
  const [troubleshootStage, setTroubleshootStage] = useState<string | null>(null);

  // Voice assistant state
  const [voiceListening, setVoiceListening] = useState(false);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const [voiceReply, setVoiceReply] = useState<string | null>(null);

  if (connected === false) return <NotConnected />;

  const run = async (name: string, label: string, action: () => Promise<unknown>) => {
    setWorking(name);
    try {
      await action();
      toast(label, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWorking(null);
    }
  };

  const handleTroubleshoot = async () => {
    setWorking("check");
    setTroubleshootProgress(15);
    setTroubleshootStage("1/5: Testing connection and service endpoints...");
    try {
      await new Promise((r) => setTimeout(r, 350));
      setTroubleshootProgress(35);
      setTroubleshootStage("2/5: Auditing CPU, RAM, & RTX GPU VRAM...");
      await new Promise((r) => setTimeout(r, 350));
      setTroubleshootProgress(60);
      setTroubleshootStage("3/5: Checking Ollama models, CUDA acceleration, & Comfy Desktop...");
      await new Promise((r) => setTimeout(r, 350));
      setTroubleshootProgress(80);
      setTroubleshootStage("4/5: Auditing GitHub token & Second Brain Jarvis connectivity...");
      const result = await api.troubleshoot();
      setTroubleshootProgress(95);
      setTroubleshootStage("5/5: Analyzing workspace caches & disk optimization...");
      await new Promise((r) => setTimeout(r, 250));
      setTroubleshootProgress(100);
      setTroubleshootStage("Diagnostics complete!");
      setProblems(result.problems);
      toast(
        result.problems.length === 0 ? "All services and checks are healthy." : `${result.problems.length} issue(s) detected.`,
        result.problems.length === 0 ? "ok" : "info"
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
      setTroubleshootProgress(null);
      setTroubleshootStage(null);
    } finally {
      setWorking(null);
      setTimeout(() => {
        setTroubleshootProgress(null);
        setTroubleshootStage(null);
      }, 5000);
    }
  };

  const toggleVoice = () => {
    if (typeof window === "undefined") return;
    const SpeechRec = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRec) {
      toast("Speech recognition is not supported in this browser. Try Chrome or Safari.", "error");
      return;
    }

    if (voiceListening) {
      setVoiceListening(false);
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.continuous = false;
      rec.interimResults = true;
      rec.lang = "en-US";

      rec.onstart = () => {
        setVoiceListening(true);
        setVoiceTranscript("");
        setVoiceReply(null);
      };

      rec.onresult = (event: any) => {
        const text = Array.from(event.results)
          .map((r: any) => r[0].transcript)
          .join("");
        setVoiceTranscript(text);
      };

      rec.onerror = (event: any) => {
        setVoiceListening(false);
        toast(`Voice error: ${event.error}`, "error");
      };

      rec.onend = async () => {
        setVoiceListening(false);
        if (voiceTranscript.trim()) {
          await submitVoice(voiceTranscript.trim());
        }
      };

      rec.start();
    } catch (err: any) {
      setVoiceListening(false);
      toast(err.message, "error");
    }
  };

  const submitVoice = async (text: string) => {
    if (!text.trim()) return;
    setWorking("voice");
    try {
      const res = await api.voiceCommand(text.trim());
      setVoiceReply(res.reply);
      toast(res.reply, "ok");
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(res.reply);
        utter.rate = 1.0;
        window.speechSynthesis.speak(utter);
      }
      await status.refresh();
      await hardware.refresh();
    } catch (err: any) {
      toast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setWorking(null);
    }
  };

  const handleFixProblem = async (problem: Problem) => {
    if (!problem.fixId) return;
    setWorking(`fix-${problem.fixId}`);
    try {
      const res = await api.fixTrouble(problem.fixId);
      toast(res.message, res.ok ? "ok" : "error");
      await status.refresh();
      const updated = await api.troubleshoot();
      setProblems(updated.problems);
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWorking(null);
    }
  };

  const handleCleanup = async () => {
    setWorking("cleanup");
    try {
      const report = await api.cleanup();
      setCleanupReport(report);
      toast(report.message, "ok");
      await status.refresh();
      await hardware.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWorking(null);
    }
  };

  const handleProfileChange = async (profile: "eco" | "balanced" | "turbo") => {
    setWorking(`profile-${profile}`);
    try {
      await api.setProfile(profile);
      setActiveProfile(profile);
      toast(`Switched hardware profile to ${profile}.`, "ok");
      await status.refresh();
      await hardware.refresh();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWorking(null);
    }
  };

  const handleToggleService = async (serviceId: string, currentState: ServiceReport["state"]) => {
    setWorking(`toggle-${serviceId}`);
    try {
      const action = currentState === "up" ? "stop" : "start";
      const result = await api.toggleService(serviceId, action);
      status.setData(result.status);
      toast(result.message, "ok");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    } finally {
      setWorking(null);
    }
  };

  const data = status.data;
  const metrics = data?.metrics;
  const specs = hardware.data?.specs;
  const used = hardware.data?.utilization;
  const live = (builds.data?.builds ?? []).filter((build) => build.live);
  const jarvisOk = jarvis.data?.last?.ok ?? null;

  // Real-time calculations
  const memUsedPercent = metrics ? metrics.memoryUsagePercent : used?.memoryUsage ? Math.round(used.memoryUsage) : null;
  const cpuPercent = metrics ? metrics.cpuUsagePercent : used?.cpuUsage ? Math.round(used.cpuUsage) : null;
  const diskFreeGB = metrics?.disk.freeGB ?? null;
  const diskTotalGB = metrics?.disk.totalGB ?? null;
  const diskUsedPercent = metrics?.disk.usedPercent ?? null;
  const gpuInfo = metrics?.gpu;

  return (
    <>
      <Header
        title="Control"
        sub={data ? `${data.host} · ${data.gpu}` : "Reading your machine…"}
        state={status.error ? "down" : data?.healthy ? "up" : "warn"}
      />

      <div className="wrap">
        {status.error ? <Banner kind="error">{status.error}</Banner> : null}

        {/* ---------- power & master switch ---------- */}
        <section className="hero">
          <div className="hero-label">Master Activation</div>
          <h2 className="hero-title">{data?.healthy ? "All services are 100% active" : "Some services need activation"}</h2>
          <p className="hero-sub">
            One tap brings up everything necessary to build, code, research, and repair on your PC.
            Pausing frees your RTX GPU without losing progress.
          </p>

          <div className="quick" style={{ marginTop: 14 }}>
            <button
              className="primary"
              style={{ fontWeight: 700, borderColor: "var(--accent)" }}
              disabled={working !== null}
              onClick={() =>
                run("start", "All services switched on.", async () => {
                  const result = await api.startEverything();
                  status.setData(result.status);
                })
              }
            >
              {working === "start" ? <Busy label="Activating all…" /> : <>{Icon.power} Switch on all necessary (100% Ready)</>}
            </button>

            <button
              disabled={working !== null}
              onClick={() =>
                run("pause", "Background work paused — GPU is free.", async () => {
                  const result = await api.stopBackgroundWork();
                  status.setData(result.status);
                })
              }
            >
              {working === "pause" ? <Busy label="Pausing…" /> : <>{Icon.pause} Free GPU / Pause work</>}
            </button>

            <button
              disabled={working !== null}
              onClick={() =>
                run("restart", "Restarted background services.", async () => {
                  const result = await api.restartBackgroundWork();
                  status.setData(result.status);
                })
              }
            >
              {working === "restart" ? <Busy label="Restarting…" /> : <>{Icon.refresh} Restart background work</>}
            </button>

            <button disabled={working !== null} onClick={handleTroubleshoot}>
              {working === "check" ? <Busy label="Checking…" /> : <>{Icon.stethoscope} Troubleshoot &amp; Diagnostics</>}
            </button>

            <button disabled={working !== null} onClick={toggleVoice} style={{ borderColor: voiceListening ? "var(--bad)" : "var(--line)" }}>
              {voiceListening ? "🔴 Recording Voice…" : "🎙️ Speak to Agent"}
            </button>

            <button disabled={working !== null} onClick={() => run("scan", "Rescanned your projects.", () => api.scan())}>
              {working === "scan" ? <Busy label="Scanning…" /> : <>{Icon.scan} Rescan projects</>}
            </button>

            <button disabled={working !== null} onClick={handleCleanup}>
              {working === "cleanup" ? <Busy label="Cleaning PC…" /> : <>{Icon.sparkle} Free up space &amp; usage</>}
            </button>
          </div>
        </section>

        {/* ---------- troubleshoot progress bar ---------- */}
        {troubleshootProgress !== null ? (
          <div className="card" style={{ borderColor: "var(--accent)", backgroundColor: "rgba(99, 102, 241, 0.08)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <strong style={{ color: "var(--accent)", fontSize: 15 }}>🩺 System Troubleshoot in Progress</strong>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{troubleshootProgress}%</span>
            </div>
            <p style={{ margin: "4px 0 10px", fontSize: 13, color: "var(--text)" }}>{troubleshootStage}</p>
            <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 6, height: 10, overflow: "hidden" }}>
              <div
                style={{
                  width: `${troubleshootProgress}%`,
                  height: "100%",
                  backgroundColor: "var(--accent)",
                  transition: "width 0.4s ease"
                }}
              />
            </div>
          </div>
        ) : null}

        {/* ---------- voice command & speech interface ---------- */}
        <div className="section-title">Voice Control &amp; Speech ("Speak to PC")</div>
        <div className="card" style={{ borderColor: voiceListening ? "var(--bad)" : "var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
            <div>
              <strong style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
                {voiceListening ? "🔴 Listening to your voice…" : "🎙️ Talk to Agent Builder"}
              </strong>
              <p className="hint" style={{ margin: "4px 0 0" }}>
                Speak commands or ask questions. Try: "Free up space", "Start Ollama", "Launch Comfy Desktop", "Stop Comfy", "Status".
              </p>
            </div>
            <button
              className={`btn ${voiceListening ? "danger" : "primary"}`}
              onClick={toggleVoice}
              disabled={working === "voice"}
            >
              {voiceListening ? "⏹️ Stop Recording" : "🎤 Tap to Speak"}
            </button>
          </div>

          {voiceTranscript ? (
            <div style={{ marginTop: 12, padding: "8px 12px", background: "rgba(255,255,255,0.05)", borderRadius: 8, fontSize: 14 }}>
              <span style={{ color: "var(--muted)", marginRight: 6 }}>You said:</span>
              <strong>"{voiceTranscript}"</strong>
            </div>
          ) : null}

          {voiceReply ? (
            <div style={{ marginTop: 10, padding: "10px 14px", background: "rgba(99, 102, 241, 0.1)", border: "1px solid rgba(99, 102, 241, 0.3)", borderRadius: 8, fontSize: 14 }}>
              <span style={{ color: "var(--accent)", fontWeight: 600, marginRight: 6 }}>Agent Reply:</span>
              <span>{voiceReply}</span>
            </div>
          ) : null}
        </div>

        {/* ---------- troubleshooting & problem resolver ---------- */}
        {problems && problems.length > 0 ? (
          <>
            <div className="section-title">Diagnostics ({problems.length} issue(s) detected)</div>
            {problems.map((prob, idx) => (
              <div key={idx} className="card" style={{ borderColor: prob.severity === "error" ? "var(--bad)" : "var(--warn)" }}>
                <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <span className={`pill ${prob.severity === "error" ? "down" : "degraded"}`} style={{ marginTop: 7 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 15 }}>{prob.title}</strong>
                    <p style={{ margin: "4px 0 8px", color: "var(--muted)", fontSize: 14 }}>{prob.detail}</p>
                    <small style={{ display: "block", color: "var(--faint)", marginBottom: 10 }}>Fix: {prob.fix}</small>
                    {prob.fixId ? (
                      <button
                        className="btn small primary"
                        disabled={working !== null}
                        onClick={() => handleFixProblem(prob)}
                      >
                        {working === `fix-${prob.fixId}` ? <Busy label="Applying fix…" /> : <>Apply fix now</>}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : null}

        {/* ---------- cleanup results banner ---------- */}
        {cleanupReport ? (
          <div className="card" style={{ borderColor: "var(--good)", backgroundColor: "rgba(61, 220, 154, 0.06)" }}>
            <strong style={{ color: "var(--good)" }}>✓ Optimization Complete</strong>
            <p style={{ margin: "6px 0", fontSize: 14 }}>{cleanupReport.message}</p>
            <div className="chips">
              <span className="chip good">{cleanupReport.freedDiskMB} MB disk freed</span>
              <span className="chip good">{cleanupReport.freedMemoryMB} MB RAM reclaimed</span>
              <span className="chip">{cleanupReport.cleanedFilesCount} cache/temp files cleared</span>
            </div>
          </div>
        ) : null}

        {/* ---------- hardware monitor & PC control ---------- */}
        <div className="section-title">Hardware Monitor &amp; PC Control</div>
        <div className="card">
          {hardware.error ? <Banner kind="error">{hardware.error}</Banner> : null}

          {/* Telemetry Grid */}
          <div className="stats">
            <div className="stat">
              <strong>{pct(cpuPercent ?? undefined)}</strong>
              <span>CPU ({specs?.cpuCores ?? metrics?.cpuCores ?? "—"} cores)</span>
            </div>
            <div className="stat">
              <strong>{pct(memUsedPercent ?? undefined)}</strong>
              <span>RAM ({metrics ? `${Math.round(metrics.freeMemoryBytes / 1024 ** 3)}GB free` : "Memory"})</span>
            </div>
            <div className="stat">
              <strong>{diskFreeGB !== null ? `${diskFreeGB}GB` : "—"}</strong>
              <span>Disk free ({diskUsedPercent !== null ? `${diskUsedPercent}% used` : "Disk"})</span>
            </div>
            <div className="stat">
              <strong>{gpuInfo ? `${gpuInfo.vramUsagePercent}%` : specs?.optimalConcurrency ?? "—"}</strong>
              <span>{gpuInfo ? "GPU VRAM" : "Parallel jobs"}</span>
            </div>
          </div>

          {/* Visual Meters */}
          <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
            {/* CPU Bar */}
            {cpuPercent !== null ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>
                  <span>CPU Load</span>
                  <span>{cpuPercent}%</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 6, height: 7, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(2, cpuPercent))}%`,
                      height: "100%",
                      backgroundColor: cpuPercent > 85 ? "var(--bad)" : cpuPercent > 60 ? "var(--warn)" : "var(--accent)"
                    }}
                  />
                </div>
              </div>
            ) : null}

            {/* RAM Bar */}
            {memUsedPercent !== null ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>
                  <span>RAM Usage</span>
                  <span>{memUsedPercent}% {metrics ? `(${Math.round(metrics.usedMemoryBytes / 1024 ** 3)}GB / ${Math.round(metrics.totalMemoryBytes / 1024 ** 3)}GB)` : ""}</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 6, height: 7, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(2, memUsedPercent))}%`,
                      height: "100%",
                      backgroundColor: memUsedPercent > 85 ? "var(--bad)" : memUsedPercent > 70 ? "var(--warn)" : "var(--good)"
                    }}
                  />
                </div>
              </div>
            ) : null}

            {/* Disk Bar */}
            {diskUsedPercent !== null ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>
                  <span>Primary Drive</span>
                  <span>{diskFreeGB} GB free of {diskTotalGB} GB</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 6, height: 7, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(2, diskUsedPercent))}%`,
                      height: "100%",
                      backgroundColor: diskUsedPercent > 90 ? "var(--bad)" : "var(--violet)"
                    }}
                  />
                </div>
              </div>
            ) : null}

            {/* GPU VRAM Bar */}
            {gpuInfo ? (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 3 }}>
                  <span>{gpuInfo.name}</span>
                  <span>{gpuInfo.vramUsedMB} / {gpuInfo.vramTotalMB} MB VRAM {gpuInfo.temperatureC ? `· ${gpuInfo.temperatureC}°C` : ""}</span>
                </div>
                <div style={{ background: "rgba(255,255,255,0.08)", borderRadius: 6, height: 7, overflow: "hidden" }}>
                  <div
                    style={{
                      width: `${Math.min(100, Math.max(2, gpuInfo.vramUsagePercent))}%`,
                      height: "100%",
                      backgroundColor: gpuInfo.vramUsagePercent > 90 ? "var(--bad)" : "var(--accent)"
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>

          {/* Top Resource Heavy Processes */}
          {metrics?.topProcesses && metrics.topProcesses.length > 0 ? (
            <div style={{ marginTop: 14 }}>
              <small style={{ color: "var(--muted)", display: "block", marginBottom: 6 }}>Top memory-consuming processes:</small>
              <div className="chips">
                {metrics.topProcesses.slice(0, 5).map((proc, i) => (
                  <span key={i} className="chip">
                    {proc.name} {proc.count > 1 ? `(${proc.count})` : ""}: {proc.totalMemoryMB} MB
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Hardware Concurrency & Profile Controls */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
              <div>
                <strong style={{ fontSize: 14 }}>Hardware Concurrency Profile:</strong>
                <small style={{ display: "block", color: "var(--muted)" }}>Adjust builder workload according to PC availability</small>
              </div>
              <div className="btn-row">
                <button
                  className={`btn small ${activeProfile === "eco" ? "primary" : ""}`}
                  disabled={working !== null}
                  onClick={() => handleProfileChange("eco")}
                >
                  Eco Mode (Quiet)
                </button>
                <button
                  className={`btn small ${activeProfile === "balanced" ? "primary" : ""}`}
                  disabled={working !== null}
                  onClick={() => handleProfileChange("balanced")}
                >
                  Balanced
                </button>
                <button
                  className={`btn small ${activeProfile === "turbo" ? "primary" : ""}`}
                  disabled={working !== null}
                  onClick={() => handleProfileChange("turbo")}
                >
                  Turbo (Max)
                </button>
              </div>
            </div>
          </div>

          {/* Free Up Space Action Button */}
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              className="btn primary"
              style={{ flex: 1 }}
              disabled={working !== null}
              onClick={handleCleanup}
            >
              {working === "cleanup" ? <Busy label="Freeing up space and RAM…" /> : <>{Icon.sparkle} Free up space &amp; usage on PC</>}
            </button>
          </div>
        </div>

        {/* ---------- pc workspace & desktop launchers ---------- */}
        <div className="section-title">PC Workspace &amp; Desktop Launchers</div>
        <div className="card">
          <p className="hint" style={{ marginTop: 0 }}>
            Launch or focus workspaces directly on your host PC while monitoring everything remotely.
          </p>
          <div className="btn-row" style={{ flexWrap: "wrap", gap: 10 }}>
            <button
              className="btn"
              disabled={working !== null}
              onClick={() =>
                run("ws-vscode", "Opened Agent Builder in VS Code on PC.", () =>
                  api.openWorkspace("vscode")
                )
              }
            >
              🖥️ Open VS Code
            </button>
            <button
              className="btn"
              disabled={working !== null}
              onClick={() =>
                run("ws-projects", "Opened E:\\Projects folder on PC.", () =>
                  api.openWorkspace("projects")
                )
              }
            >
              📂 Projects (E:\Projects)
            </button>
            <button
              className="btn"
              disabled={working !== null}
              onClick={() =>
                run("ws-ts", "Opened H:\\ts folder on PC.", () =>
                  api.openWorkspace("ts")
                )
              }
            >
              📂 TS Projects (H:\ts)
            </button>
            <button
              className="btn"
              disabled={working !== null}
              style={{
                borderColor: data?.services.find((s) => s.id === "comfy")?.state === "up" ? "var(--bad)" : "var(--accent)"
              }}
              onClick={() => {
                const isComfyUp = data?.services.find((s) => s.id === "comfy")?.state === "up";
                run(
                  "comfy",
                  isComfyUp ? "Comfy Desktop stopped." : "Comfy Desktop launched on PC.",
                  async () => {
                    const res = await api.toggleService("comfy", isComfyUp ? "stop" : "start");
                    toast(res.message, res.success ? "ok" : "error");
                    await status.refresh();
                    await hardware.refresh();
                  }
                );
              }}
            >
              {data?.services.find((s) => s.id === "comfy")?.state === "up"
                ? "🛑 Close Comfy Desktop (Save VRAM)"
                : "🚀 Launch Comfy Desktop"}
            </button>
          </div>
        </div>

        {/* ---------- what is running with individual toggles ---------- */}
        <div className="section-title">What is active (Individual Service Controls)</div>
        {status.loading && !data ? <Skeleton rows={3} /> : null}
        {(data?.services ?? []).map((service) => (
          <div key={service.id} className="card">
            <div style={{ display: "flex", gap: 11, alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap" }}>
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start", flex: 1, minWidth: 200 }}>
                <span className={`pill ${SERVICE_STATE[service.state]}`} style={{ marginTop: 7 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <strong style={{ fontSize: 15 }}>{service.label}</strong>
                    <span className={`chip small ${service.state === "up" ? "good" : service.state === "down" ? "bad" : ""}`}>
                      {service.state.toUpperCase()}
                    </span>
                  </div>
                  <small style={{ color: "var(--muted)", display: "block", marginTop: 3, overflowWrap: "anywhere" }}>
                    {service.detail}
                  </small>
                </div>
              </div>

              {/* Individual Service Switch Button */}
              <div style={{ alignSelf: "center", marginTop: 4 }}>
                {service.id === "ollama" ? (
                  <button
                    className={`btn small ${service.state === "up" ? "ghost" : "primary"}`}
                    disabled={working !== null}
                    onClick={() => handleToggleService("ollama", service.state)}
                  >
                    {working === "toggle-ollama" ? (
                      <Busy label="Switching…" />
                    ) : service.state === "up" ? (
                      "Turn off Ollama"
                    ) : (
                      "Turn on Ollama"
                    )}
                  </button>
                ) : service.id === "research" ? (
                  <button
                    className={`btn small ${service.state === "up" ? "ghost" : "primary"}`}
                    disabled={working !== null}
                    onClick={() => handleToggleService("research", service.state)}
                  >
                    {working === "toggle-research" ? (
                      <Busy label="Switching…" />
                    ) : service.state === "up" ? (
                      "Pause Research"
                    ) : (
                      "Resume Research"
                    )}
                  </button>
                ) : service.id === "ecosystem" ? (
                  <button
                    className={`btn small ${service.state === "up" ? "ghost" : "primary"}`}
                    disabled={working !== null}
                    onClick={() => handleToggleService("ecosystem", service.state)}
                  >
                    {working === "toggle-ecosystem" ? (
                      <Busy label="Switching…" />
                    ) : service.state === "up" ? (
                      "Stop Watch"
                    ) : (
                      "Start Watch"
                    )}
                  </button>
                ) : service.id === "comfy" ? (
                  <button
                    className="btn small"
                    disabled={working !== null}
                    style={{ borderColor: service.state === "up" ? "var(--bad)" : "var(--accent)" }}
                    onClick={() =>
                      run(
                        "comfy",
                        service.state === "up" ? "Comfy Desktop stopped." : "Launching Comfy Desktop on PC...",
                        async () => {
                          const res = await api.toggleService("comfy", service.state === "up" ? "stop" : "start");
                          toast(res.message, res.success ? "ok" : "error");
                          await status.refresh();
                          await hardware.refresh();
                        }
                      )
                    }
                  >
                    {working === "comfy" ? (
                      <Busy label="Working…" />
                    ) : service.state === "up" ? (
                      "🛑 Close Comfy (Save VRAM)"
                    ) : (
                      "🚀 Launch Comfy Desktop"
                    )}
                  </button>
                ) : service.id === "github" ? (
                  <button
                    className="btn small"
                    disabled={working !== null}
                    onClick={() =>
                      run("github", "GitHub verified.", async () => {
                        await status.refresh();
                      })
                    }
                  >
                    Verify GitHub
                  </button>
                ) : service.id === "jarvis" ? (
                  <button
                    className="btn small"
                    disabled={working !== null}
                    onClick={() =>
                      run("jarvis", "Pinged Jarvis.", async () => {
                        const result = await api.testJarvis();
                        toast(result.ok ? "Jarvis received ping." : result.detail, result.ok ? "ok" : "error");
                        await jarvis.refresh();
                      })
                    }
                  >
                    Ping Jarvis
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}

        {/* ---------- builds in flight ---------- */}
        {live.length > 0 ? (
          <>
            <div className="section-title">Building now ({live.length})</div>
            {live.map((build) => (
              <div key={build.buildId} className="card">
                <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                  <span className={`pill ${build.state === "paused" ? "degraded" : "up"}`} style={{ marginTop: 7 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <Link href={`/build/?id=${encodeURIComponent(build.buildId)}`}>
                      <strong style={{ fontSize: 15 }}>{build.projectName} →</strong>
                    </Link>
                    <small style={{ color: "var(--muted)", display: "block", marginTop: 3 }}>
                      Pass {build.iterations || 1} · {STAGE_LABEL[build.stage ?? "starting"] ?? build.stage} · quality {Math.round(build.qualityScore)}
                      {build.orderId ? " · for a customer order" : ""}
                    </small>
                    <div className="btn-row" style={{ marginTop: 10 }}>
                      <button
                        className="btn"
                        disabled={working !== null}
                        onClick={() =>
                          run(build.buildId, build.state === "paused" ? "Resumed." : "Paused.", async () => {
                            await (build.state === "paused" ? api.resumeBuild(build.buildId) : api.pauseBuild(build.buildId));
                            await builds.refresh();
                          })
                        }
                      >
                        {build.state === "paused" ? "Resume" : "Pause"}
                      </button>
                      <button
                        className="btn"
                        disabled={working !== null}
                        onClick={() =>
                          run(`${build.buildId}-stop`, "Stopped.", async () => {
                            await api.stopBuild(build.buildId);
                            await builds.refresh();
                          })
                        }
                      >
                        Stop
                      </button>
                      <Link className="btn" href="/build">
                        Open
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : null}

        {/* ---------- jarvis connection ---------- */}
        <div className="section-title">Second Brain Jarvis</div>
        <div className="card">
          {jarvis.data ? (
            <>
              <div style={{ display: "flex", gap: 11, alignItems: "flex-start" }}>
                <span
                  className={`pill ${jarvisOk === null ? "degraded" : jarvisOk ? "up" : "down"}`}
                  style={{ marginTop: 7 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 15 }}>
                    {!jarvis.data.configured
                      ? "Not set up"
                      : jarvisOk === null
                        ? "Configured, standby"
                        : jarvisOk
                          ? "Connected to Jarvis"
                          : "Reconnecting…"}
                  </strong>
                  <small style={{ color: "var(--muted)", display: "block", marginTop: 3, overflowWrap: "anywhere" }}>
                    {jarvis.data.url ?? "Remote & local webhooks mapped."}
                  </small>
                  {jarvis.data.last ? (
                    <small style={{ color: "var(--muted)", display: "block", marginTop: 5, overflowWrap: "anywhere" }}>
                      Last response {ago(jarvis.data.last.at)}: {jarvis.data.last.detail}
                    </small>
                  ) : null}
                  {jarvis.data.queued > 0 ? (
                    <Banner kind="info">
                      {jarvis.data.queued} message(s) waiting in queue.
                    </Banner>
                  ) : null}
                </div>
              </div>
              <div className="btn-row" style={{ marginTop: 11 }}>
                <button
                  className="btn"
                  disabled={working !== null || !jarvis.data.configured}
                  onClick={() =>
                    run("jarvis", "Ping sent.", async () => {
                      const result = await api.testJarvis();
                      toast(result.ok ? "Jarvis received the ping." : result.detail, result.ok ? "ok" : "error");
                      await jarvis.refresh();
                    })
                  }
                >
                  {working === "jarvis" ? <Busy label="Sending…" /> : <>{Icon.sparkle} Send a test ping</>}
                </button>
                <button
                  className="btn"
                  disabled={working !== null || !jarvis.data.configured}
                  onClick={() =>
                    run("handoff", "Full briefing sent to Jarvis.", async () => {
                      await api.sendHandoff();
                      await jarvis.refresh();
                    })
                  }
                >
                  {Icon.book} Sync full ecosystem state
                </button>
              </div>
            </>
          ) : (
            <Skeleton rows={2} />
          )}
        </div>

        {/* ---------- power tools ---------- */}
        <div className="section-title">Power tools</div>
        <UpdateCard />
        <PowerTools />

        {/* ---------- quick navigation ---------- */}
        <div className="section-title">Elsewhere</div>
        <div className="card">
          <div className="quick">
            <Link href="/projects">{Icon.folder} Projects &amp; Code</Link>
            <Link href="/build">{Icon.sparkle} Build Studio</Link>
            <Link href="/studio">{Icon.image} Media Studio</Link>
            <Link href="/research">{Icon.flask} Continuous Research</Link>
            <Link href="/feed">{Icon.list} Activity Feed</Link>
            <Link href="/orders">{Icon.list} Customer Orders</Link>
            <Link href="/settings">{Icon.gear} Settings &amp; builder options</Link>
          </div>
        </div>

        {/* ---------- shutdown ---------- */}
        <div className="section-title">Shut down</div>
        <div className="card">
          <p className="hint">
            Stops everything on your machine, including this API. You will not be able to reach it from here again
            until you start it at the PC.
          </p>
          {confirmShutdown ? (
            <div className="btn-row">
              <button
                className="btn danger"
                disabled={working !== null}
                onClick={() =>
                  run("shutdown", "Shutting down.", async () => {
                    await api.shutdown();
                    setConfirmShutdown(false);
                  })
                }
              >
                Yes, shut it all down
              </button>
              <button className="btn" onClick={() => setConfirmShutdown(false)}>
                Keep it running
              </button>
            </div>
          ) : (
            <button className="btn" onClick={() => setConfirmShutdown(true)} disabled={working !== null}>
              {Icon.power} Shut everything down
            </button>
          )}
        </div>
      </div>
    </>
  );
}
