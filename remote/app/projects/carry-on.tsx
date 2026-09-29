"use client";

/**
 * Carrying on with projects from the app: cloning one from GitHub, and the
 * builds that work on a copy of a project until you apply what they did.
 */
import Link from "next/link";
import { useState } from "react";

import { api, type ProjectBuild } from "@/lib/api";
import { Busy, Icon, ago, useRemote, useToast } from "../ui";

const STATE_LABEL: Record<ProjectBuild["state"], string> = {
  running: "Working",
  paused: "Paused",
  completed: "Finished",
  ended: "Ended",
  stopped: "Stopped",
  error: "Failed",
  interrupted: "Interrupted"
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Clone a repository onto the PC and, if asked, start on it straight away. */
export function CloneCard({ onClose, onCloned }: { onClose: () => void; onCloned: () => Promise<void> | void }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);

  const clone = async () => {
    setBusy(true);
    try {
      const res = await api.cloneProject({ url: url.trim(), name: name.trim() || undefined, instruction: instruction.trim() || undefined });
      toast(res.message, "ok");
      setUrl("");
      setName("");
      setInstruction("");
      await onCloned();
      onClose();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ borderColor: "var(--accent)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 16 }}>Clone from GitHub</strong>
        <button className="btn small" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      <p className="hint" style={{ marginTop: 4 }}>
        Copies the repository onto the PC and adds it to your projects. Give it something to do and it starts straight away.
        Private repositories work once GitHub is signed in on the PC.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        <input
          placeholder="https://github.com/owner/repo"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoCapitalize="off"
          autoCorrect="off"
          inputMode="url"
        />
        <input placeholder="Folder name (optional, defaults to the repo name)" value={name} onChange={(event) => setName(event.target.value)} />
        <textarea
          rows={3}
          placeholder="What should it do first? (optional) e.g. Get it running, then add a contact form"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
        />
        <div className="btn-row">
          <button className="btn primary" onClick={clone} disabled={busy || !url.trim()}>
            {busy ? <Busy label="Cloning…" /> : instruction.trim() ? "Clone and start" : "Clone"}
          </button>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The builds that have worked on this project, newest first. Each one ran on a
 * copy; "Apply" writes its changes into the project, skipping any file you have
 * edited since it started.
 */
export function ProjectBuildList({ projectId, refreshKey = 0 }: { projectId: string; refreshKey?: number }) {
  const toast = useToast();
  const builds = useRemote(() => api.projectBuilds(projectId), 8000);
  const [busy, setBusy] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, string>>({});
  const [seenKey, setSeenKey] = useState(refreshKey);

  if (refreshKey !== seenKey) {
    setSeenKey(refreshKey);
    void builds.refresh();
  }

  const list = builds.data?.builds ?? [];
  if (list.length === 0) return null;

  const showDiff = async (build: ProjectBuild) => {
    if (diffs[build.buildId] !== undefined) {
      setDiffs(({ [build.buildId]: _hidden, ...rest }) => rest);
      return;
    }
    setBusy(`${build.buildId}:diff`);
    try {
      const res = await api.projectBuildDiff(build.buildId);
      setDiffs((prev) => ({ ...prev, [build.buildId]: res.diff || "No changes." }));
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  const apply = async (build: ProjectBuild) => {
    setBusy(`${build.buildId}:apply`);
    try {
      const res = await api.applyProjectBuild(build.buildId);
      const parts = [`${res.applied.length} file(s) written into the project`];
      if (res.unchanged.length) parts.push(`${res.unchanged.length} already the same`);
      if (res.conflicts.length) parts.push(`${res.conflicts.length} skipped because you changed them since: ${res.conflicts.join(", ")}`);
      toast(parts.join("; ") + ".", res.conflicts.length ? "info" : "ok");
      await builds.refresh();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ marginTop: 16 }}>
      <strong style={{ fontSize: 14 }}>Work on this project</strong>
      <div style={{ display: "grid", gap: 10, marginTop: 8 }}>
        {list.map((build) => {
          const running = build.state === "running" || build.state === "paused";
          const diff = diffs[build.buildId];
          return (
            <div key={build.buildId} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600 }}>{build.instruction}</span>
                <span className={`chip ${running ? "accent" : build.state === "error" ? "warn" : ""}`}>
                  {STATE_LABEL[build.state] ?? build.state}
                  {build.qualityScore ? ` · ${Math.round(build.qualityScore)}` : ""}
                </span>
              </div>
              <small style={{ color: "var(--muted)", display: "block", marginTop: 4 }}>
                {ago(build.createdAt)} · {build.changes.length} file(s) changed
                {build.appliedAt ? ` · applied ${ago(build.appliedAt)}` : running ? " · working on a copy; the project is untouched" : ""}
              </small>
              <Link href={`/build/?id=${encodeURIComponent(build.buildId)}`} className="follow-link">
                {running ? "Follow it live — its thinking, checks and files →" : "See how it went →"}
              </Link>
              {build.lastApply?.conflicts.length ? (
                <small style={{ color: "var(--warn)", display: "block", marginTop: 4 }}>
                  Not applied (you had changed them): {build.lastApply.conflicts.join(", ")}
                </small>
              ) : null}
              <div className="btn-row" style={{ marginTop: 8 }}>
                <button className="btn small" onClick={() => showDiff(build)} disabled={busy !== null || build.changes.length === 0}>
                  {busy === `${build.buildId}:diff` ? <Busy label="Loading…" /> : diff !== undefined ? "Hide changes" : "View changes"}
                </button>
                <button
                  className="btn small primary"
                  onClick={() => apply(build)}
                  disabled={busy !== null || running || build.changes.length === 0}
                  title={running ? "Wait for it to finish, or stop it, first" : undefined}
                >
                  {busy === `${build.buildId}:apply` ? <Busy label="Applying…" /> : <>{Icon.check} {build.appliedAt ? "Apply again" : "Apply to project"}</>}
                </button>
              </div>
              {diff !== undefined ? (
                <pre
                  style={{
                    marginTop: 8,
                    maxHeight: 360,
                    overflow: "auto",
                    fontSize: 12,
                    background: "rgba(0,0,0,0.3)",
                    padding: 10,
                    borderRadius: 8,
                    whiteSpace: "pre"
                  }}
                >
                  {diff}
                </pre>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
