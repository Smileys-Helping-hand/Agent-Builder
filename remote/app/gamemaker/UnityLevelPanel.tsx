"use client";

import { useEffect, useRef, useState } from "react";
import { api, machineImage, type UnityLevelJob, type UnityStudioStatus } from "@/lib/api";
import { Busy, useToast } from "../ui";

const RUNNING: UnityLevelJob["status"][] = ["planning", "creating-project", "blender", "unity"];
const STATUS_LABEL: Record<UnityLevelJob["status"], string> = {
  planning: "Designing the level",
  "creating-project": "Creating the Unity project",
  blender: "Modelling in Blender",
  unity: "Building in Unity",
  done: "Ready",
  failed: "Failed"
};

/** Unity Level Studio: a prompt in, a playable Unity level (scene, previews, optional player build) out. */
export default function UnityLevelPanel({ onLevelDone }: { onLevelDone?: () => void }) {
  const toast = useToast();
  const [status, setStatus] = useState<UnityStudioStatus | null>(null);
  const [jobs, setJobs] = useState<UnityLevelJob[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState<"none" | "windows" | "webgl">("none");
  const [starting, setStarting] = useState(false);
  const [images, setImages] = useState<Record<string, string>>({});
  const wasRunning = useRef(false);

  const load = async () => {
    try {
      const [s, j] = await Promise.all([api.unityStatus(), api.unityLevels()]);
      setStatus(s);
      setJobs(j.jobs);
      setSelected((current) => current ?? j.jobs[0]?.id ?? null);
    } catch {
      // The page's own banner reports a lost connection.
    }
  };

  useEffect(() => {
    load();
  }, []);

  const running = jobs.some((j) => RUNNING.includes(j.status));
  useEffect(() => {
    if (!running) {
      if (wasRunning.current) onLevelDone?.();
      wasRunning.current = false;
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [running]);

  const job = jobs.find((j) => j.id === selected) ?? null;

  // Previews come from the builder with the key, so they are fetched, not linked.
  useEffect(() => {
    if (!job) return;
    job.previews.forEach((_, i) => {
      const key = `${job.id}:${i}`;
      if (images[key]) return;
      machineImage(`/api/autonomous/unity/levels/${encodeURIComponent(job.id)}/preview/${i}`)
        .then((url) => setImages((m) => ({ ...m, [key]: url })))
        .catch(() => {});
    });
  }, [job?.id, job?.previews.length]);

  const start = async () => {
    if (!prompt.trim()) return;
    setStarting(true);
    try {
      const res = await api.startUnityLevel(prompt.trim(), target);
      setJobs((list) => [res.job, ...list]);
      setSelected(res.job.id);
      setPrompt("");
      toast("Level design started — this takes a few minutes.", "ok");
    } catch (err: any) {
      toast(err?.message || "Could not start the level", "error");
    } finally {
      setStarting(false);
    }
  };

  const unityOk = status?.unity.installed;
  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="section-title" style={{ marginTop: 0 }}>🏔️ Unity Level Studio</div>
      <p style={{ fontSize: 13, color: "var(--muted)", margin: "4px 0 10px" }}>
        Describe a level and get a playable 3D Unity scene: sculpted terrain, water, sky and post-processing,
        props modelled in Blender (or built in Unity when Blender is missing), collectibles, enemies and an exit.
        Each level is added to the same Unity project in play order.
      </p>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <span className={`tag ${unityOk ? "ok" : "warn"}`}>
          {unityOk ? `Unity ${status?.unity.version}` : status ? "No Unity editor found" : "Checking Unity…"}
        </span>
        {status && (
          <span className={`tag ${status.blender.installed ? "ok" : "warn"}`} title={status.blender.path ?? "Install Blender or set BLENDER_PATH"}>
            {status.blender.installed ? "Blender found" : "Blender not installed: Unity builds the models"}
          </span>
        )}
        {status && <span className="tag info" title={status.project}>{status.projectExists ? "Level project ready" : "Project is created on first build"}</span>}
        {status?.projectOpenInEditor && <span className="tag warn">Project is open in the Unity Editor: close it to build</span>}
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <input
          type="text"
          className="input"
          style={{ flex: 1, minWidth: 260 }}
          placeholder="e.g. a frozen mountain pass at dawn with a ruined watchtower, frost shards to collect and ice golems on patrol"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && start()}
        />
        <select className="input" style={{ width: 170 }} value={target} onChange={(e) => setTarget(e.target.value as typeof target)}>
          <option value="none">Scene only</option>
          <option value="windows">+ Windows game (.exe)</option>
          <option value="webgl" disabled={!status?.unity.webgl}>+ WebGL (browser)</option>
        </select>
        <button className="btn primary" disabled={starting || !prompt.trim() || !unityOk} onClick={start}>
          {starting ? <Busy label="Starting…" /> : <>🎮 Build Level</>}
        </button>
      </div>

      {jobs.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 14 }}>
          {jobs.slice(0, 8).map((j) => (
            <button key={j.id} className={`btn small ${j.id === selected ? "primary" : "ghost"}`} onClick={() => setSelected(j.id)}>
              {j.status === "done" ? "✅" : j.status === "failed" ? "⚠️" : "⏳"} {j.plan?.title ?? j.prompt.slice(0, 28)}
            </button>
          ))}
        </div>
      )}

      {job && (
        <div className="evolution-scorecard" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h4 style={{ margin: 0, color: "#fff" }}>{job.plan?.title ?? job.prompt}</h4>
            <span className={`tag ${job.status === "done" ? "ok" : job.status === "failed" ? "warn" : "info"}`}>
              {RUNNING.includes(job.status) ? <Busy label={STATUS_LABEL[job.status]} /> : STATUS_LABEL[job.status]}
            </span>
          </div>
          {job.plan && (
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 4 }}>
              {job.plan.biome} · {job.plan.timeOfDay} · {job.plan.assets.length} asset types ·{" "}
              {job.plan.plannedBy === "model" ? "designed by the 3D model" : "designed from biome rules (the model did not answer)"} ·{" "}
              models {job.blender === "built" ? "from Blender" : "built in Unity"}
            </div>
          )}
          {job.plan?.story && <p style={{ fontSize: 13, margin: "8px 0", fontStyle: "italic" }}>{job.plan.story}</p>}
          {job.error && <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, color: "#f87171", margin: "8px 0" }}>{job.error}</pre>}
          {job.previews.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 8, marginTop: 8 }}>
              {job.previews.map((_, i) =>
                images[`${job.id}:${i}`] ? (
                  <img key={i} src={images[`${job.id}:${i}`]} alt={`Level preview ${i + 1}`} style={{ width: "100%", borderRadius: 8, border: "1px solid var(--line, #333)" }} />
                ) : (
                  <div key={i} style={{ aspectRatio: "16 / 9", borderRadius: 8, background: "rgba(255,255,255,0.04)" }} />
                )
              )}
            </div>
          )}
          {job.status === "done" && (
            <div style={{ fontSize: 12.5, marginTop: 8 }}>
              Open <code>{job.project}</code> in Unity and press Play on <code>{job.scene}</code>
              {job.player ? <> — or run <code>{job.player}</code></> : null}.
            </div>
          )}
          <details style={{ marginTop: 8 }} open={RUNNING.includes(job.status)}>
            <summary style={{ fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>Steps ({job.steps.length})</summary>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11.5, maxHeight: 220, overflowY: "auto", margin: "6px 0 0" }}>{job.steps.join("\n")}</pre>
          </details>
        </div>
      )}
    </div>
  );
}
